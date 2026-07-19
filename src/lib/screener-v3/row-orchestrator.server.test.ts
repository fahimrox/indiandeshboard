import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runScreenerV3Batch,
  INTRADAY_INTERVAL,
  INTRADAY_RANGE,
  DAILY_INTERVAL,
  DAILY_RANGE,
  ENRICHED_MAX_SYMBOLS,
  type RowOrchestratorDeps,
} from "./row-orchestrator.server.ts";
import { createCandleCache } from "./candle-cache.server.ts";
import { ok, providerError, unavailable, isFailure, isUsable, type DataResult } from "./types.ts";
import type { DerivativesEnrichmentRequest } from "./derivatives-orchestrator.server.ts";
import type { ScreenerV3Derivatives } from "./derivatives-types.ts";
import type { CandleSeries, SpotInterval } from "./candles.server.ts";
import { istDateStr } from "./ist-time.ts";
import type {
  FnoInstrumentUniverse,
  FnoUnderlyingInstrument,
  FuturesContract,
} from "./instrument-types.ts";
import type { Candle } from "./candles.ts";

// ── Time fixtures ────────────────────────────────────────────────────────
const IST = 5.5 * 3600 * 1000;
const istMs = (y: number, mo: number, d: number, h: number, mi: number, s = 0) =>
  Date.UTC(y, mo - 1, d, h, mi, s) - IST;
const REF = istMs(2026, 7, 20, 16, 0); // well after the 09:15-15:30 session
const NEAR_FUT_EXPIRY = istMs(2026, 7, 30, 15, 30);

// ── Candle fixture builders (mirrors row-assembler.test.ts conventions) ───
function bar(min: number, over: Partial<Candle> = {}): Candle {
  return {
    timestamp: istMs(2026, 7, 20, Math.floor(min / 60), min % 60),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
    source: "yahoo",
    interval: "1m",
    ...over,
  };
}
function fullSessionCandles(): Candle[] {
  return Array.from({ length: 375 }, (_, i) => bar(555 + i));
}
function dailyBar(y: number, mo: number, d: number): Candle {
  return {
    timestamp: istMs(y, mo, d, 9, 15),
    open: 100,
    high: 105,
    low: 95,
    close: 100,
    volume: 5000,
    source: "yahoo",
    interval: "1d",
  };
}
function fullDailyCandles(): Candle[] {
  const days = [17, 16, 15, 14, 13, 10, 9, 8, 7, 6, 3, 2, 1];
  const junDays = [30, 29, 26, 25, 24, 23, 22];
  const out: Candle[] = [];
  for (const d of junDays) out.push(dailyBar(2026, 6, d));
  for (const d of days) out.push(dailyBar(2026, 7, d));
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

function mkSeries(candles: Candle[], interval: "1m" | "1d", symbol = "RELIANCE"): CandleSeries {
  return {
    symbol,
    yahooSymbol: `${symbol}.NS`,
    interval,
    range: interval === "1d" ? DAILY_RANGE : INTRADAY_RANGE,
    candles,
    firstTimestamp: candles[0]?.timestamp ?? null,
    lastTimestamp: candles[candles.length - 1]?.timestamp ?? null,
    count: candles.length,
    source: "yahoo",
    requestedAt: REF,
    responseTimestamp: REF,
    ageMs: 0,
    sessionDateIst: candles.length ? istDateStr(candles[candles.length - 1].timestamp) : null,
    hygiene: {
      alignedCount: candles.length,
      misalignedCount: 0,
      outOfSessionCount: 0,
      duplicateIdentical: 0,
      conflictingTimestamps: 0,
      cadenceGaps: 0,
      duplicateTradingDates: 0,
      lastCandleForming: false,
      futureTimestamp: false,
    },
    notes: [],
  };
}

function okIntraday(symbol = "RELIANCE"): DataResult<CandleSeries> {
  return ok(mkSeries(fullSessionCandles(), "1m", symbol));
}
function okDaily(symbol = "RELIANCE"): DataResult<CandleSeries> {
  return ok(mkSeries(fullDailyCandles(), "1d", symbol));
}

// ── Universe fixture builders ─────────────────────────────────────────────
function mkFut(expiry: number): FuturesContract {
  return {
    instrumentKey: `FUT|${expiry}`,
    tradingSymbol: "FUT",
    expiry,
    expiryDateIst: istDateStr(expiry),
    lotSize: 250,
    weekly: false,
    exchangeToken: "1",
  };
}
function mkUnderlying(symbol: string): FnoUnderlyingInstrument {
  return {
    symbol,
    normalizedSymbol: symbol,
    name: symbol,
    spotInstrumentKey: `NSE_EQ|${symbol}`,
    spotMappingStatus: "resolved",
    spotResolved: true,
    diagnosticSpotKey: `NSE_EQ|${symbol}`,
    conflictingSpotKeys: [],
    spotTradingSymbol: symbol,
    isin: symbol,
    futures: [mkFut(NEAR_FUT_EXPIRY)],
    options: [],
    nearMonthFutures: mkFut(NEAR_FUT_EXPIRY),
    futuresExpiries: [NEAR_FUT_EXPIRY],
    optionExpiries: [],
    lotSize: 250,
  };
}
function mkUniverse(symbols: string[]): FnoInstrumentUniverse {
  const underlyings = symbols.map(mkUnderlying).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const bySymbol: Record<string, FnoUnderlyingInstrument> = Object.create(null);
  for (const u of underlyings) bySymbol[u.normalizedSymbol] = u;
  return {
    underlyings,
    bySymbol,
    metadata: {
      source: "test",
      fetchedAt: REF,
      effectiveDateIst: istDateStr(REF),
      effectiveMinuteOfDay: 0,
      totalRawInstruments: symbols.length,
      totalNseEquity: symbols.length,
      totalStockFutures: symbols.length,
      totalStockOptions: 0,
      totalActiveStockOptions: 0,
      currentFuturesUnderlyings: symbols.length,
      fullyResolvedMappings: symbols.length,
      optionStructureReadyUnderlyings: 0,
      spotResolvedCount: symbols.length,
      spotMissingKeyCount: 0,
      spotInvalidKeyCount: 0,
      spotUnresolvedRecordCount: 0,
      spotConflictingCount: 0,
      invalidRecordsSkipped: 0,
      malformedRecordsSkipped: 0,
      duplicateContractsCollapsed: 0,
      conflictingDuplicateContracts: 0,
      sameKeyConflicts: 0,
      coordinateConflicts: 0,
      equityDuplicatesCollapsed: 0,
      equityConflictingKeys: 0,
      status: "available",
    },
  };
}

// ── Deterministic fake deps builder ───────────────────────────────────────
interface FakeCandleResponses {
  intraday?: (symbol: string) => DataResult<CandleSeries>;
  daily?: (symbol: string) => DataResult<CandleSeries>;
}

function makeFakeDeps(opts: {
  universe: DataResult<FnoInstrumentUniverse>;
  responses?: FakeCandleResponses;
  cache?: ReturnType<typeof createCandleCache>;
}): { deps: RowOrchestratorDeps; calls: { universe: number; candles: Array<{ symbol: string; interval: SpotInterval; range?: string }> } } {
  const calls = { universe: 0, candles: [] as Array<{ symbol: string; interval: SpotInterval; range?: string }> };
  const deps: RowOrchestratorDeps = {
    loadUniverse: async () => {
      calls.universe++;
      return opts.universe;
    },
    fetchCandles: async (symbol, interval, fetchOpts) => {
      calls.candles.push({ symbol, interval, range: fetchOpts.range });
      if (interval === INTRADAY_INTERVAL) {
        return opts.responses?.intraday?.(symbol) ?? okIntraday(symbol);
      }
      return opts.responses?.daily?.(symbol) ?? okDaily(symbol);
    },
    cache: opts.cache ?? createCandleCache(),
  };
  return { deps, calls };
}

function unwrap<T>(r: DataResult<T>): T {
  if (isFailure(r)) throw new Error(`expected success, got failure: ${r.reason}`);
  return r.value;
}

// ── 1. Universe loaded exactly once per batch ─────────────────────────────
test("1. universe loaded exactly once for a batch", async () => {
  const { deps, calls } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE", "TCS", "INFY"])) });
  const result = await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE", "TCS"] }, deps);
  assert.equal(calls.universe, 1);
  assert.ok(!isFailure(result));
});

// ── 2 & 3. Dedup + first-seen order ────────────────────────────────────────
test("2. duplicate requested symbols are normalized/deduplicated", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])) });
  const result = await runScreenerV3Batch(
    { referenceMs: REF, symbols: ["reliance", "RELIANCE", " Reliance ", "RELIANCE.NS"] },
    deps,
  );
  const batch = unwrap(result);
  assert.equal(batch.acceptedSymbolCount, 1);
  assert.equal(batch.rows.length, 1);
  assert.equal(batch.rows[0].identity.symbol, "RELIANCE");
});

test("3. first-seen symbol order is preserved", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE", "TCS", "INFY"])) });
  const result = await runScreenerV3Batch(
    { referenceMs: REF, symbols: ["TCS", "RELIANCE", "tcs", "INFY", "reliance"] },
    deps,
  );
  const batch = unwrap(result);
  assert.deepEqual(batch.rows.map((r) => r.identity.symbol), ["TCS", "RELIANCE", "INFY"]);
});

// ── 4. Invalid symbols cause zero provider calls ──────────────────────────
test("4. invalid symbols cause zero provider calls for those symbols", async () => {
  const { deps, calls } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])) });
  const result = await runScreenerV3Batch(
    { referenceMs: REF, symbols: ["RELIANCE", "  ", "BAD.SYMBOL", "has space", "RELI/ANCE"] },
    deps,
  );
  const batch = unwrap(result);
  assert.equal(batch.rejectedSymbols.length, 4);
  assert.equal(batch.acceptedSymbolCount, 1);
  const fetchedSymbols = new Set(calls.candles.map((c) => c.symbol));
  assert.deepEqual([...fetchedSymbols], ["RELIANCE"]);
});

// ── 5. Omitted symbols derived from stock F&O universe only ───────────────
test("5. omitted symbols are derived from stock F&O universe only", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE", "TCS", "INFY"])) });
  const result = await runScreenerV3Batch({ referenceMs: REF }, deps);
  const batch = unwrap(result);
  assert.deepEqual(
    batch.rows.map((r) => r.identity.symbol).sort(),
    ["INFY", "RELIANCE", "TCS"],
  );
});

// ── 6. Omitted symbols + universe failure -> top-level failure ────────────
test("6. omitted symbols + universe failure yields top-level failure", async () => {
  const { deps } = makeFakeDeps({ universe: providerError("upstox down") });
  const result = await runScreenerV3Batch({ referenceMs: REF }, deps);
  assert.ok(isFailure(result));
  if (isFailure(result)) {
    assert.equal(result.status, "provider_error");
    assert.match(result.reason, /upstox down/);
  }
});

// ── 7. Explicit symbols + universe failure still produce rows ─────────────
test("7. explicit symbols + universe failure still produce rows", async () => {
  const { deps } = makeFakeDeps({ universe: providerError("upstox down") });
  const result = await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE", "TCS"] }, deps);
  const batch = unwrap(result);
  assert.equal(batch.rows.length, 2);
  assert.equal(batch.universeStatus, "provider_error");
  assert.match(batch.universeReason ?? "", /upstox down/);
  for (const row of batch.rows) {
    assert.equal(row.identity.spotMappingStatus, "universe_unavailable");
  }
});

// ── 8. Each unique symbol fetches intraday and daily exactly once ─────────
test("8. each unique symbol fetches intraday and daily exactly once", async () => {
  const { deps, calls } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE", "TCS"])) });
  await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE", "TCS", "reliance"] }, deps);
  const relianceCalls = calls.candles.filter((c) => c.symbol === "RELIANCE");
  const tcsCalls = calls.candles.filter((c) => c.symbol === "TCS");
  assert.equal(relianceCalls.length, 2); // one intraday + one daily
  assert.equal(tcsCalls.length, 2);
  assert.equal(relianceCalls.filter((c) => c.interval === INTRADAY_INTERVAL).length, 1);
  assert.equal(relianceCalls.filter((c) => c.interval === DAILY_INTERVAL).length, 1);
});

// ── 9. Global provider concurrency never exceeds configured limit ─────────
test("9. global provider concurrency never exceeds configured limit", async () => {
  const universe = ok(mkUniverse(["A", "B", "C", "D", "E", "F", "G", "H"]));
  let active = 0;
  let maxActive = 0;
  const deps: RowOrchestratorDeps = {
    loadUniverse: async () => universe,
    fetchCandles: async (symbol, interval) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return interval === INTRADAY_INTERVAL ? okIntraday(symbol) : okDaily(symbol);
    },
    cache: createCandleCache(),
  };
  const result = await runScreenerV3Batch(
    { referenceMs: REF, symbols: ["A", "B", "C", "D", "E", "F", "G", "H"], concurrency: 3 },
    deps,
  );
  assert.ok(!isFailure(result));
  assert.ok(maxActive <= 3, `expected maxActive <= 3, got ${maxActive}`);
});

// ── 10. One provider failure does not cancel other symbols ────────────────
test("10. one provider failure does not cancel other symbols", async () => {
  const { deps } = makeFakeDeps({
    universe: ok(mkUniverse(["RELIANCE", "TCS"])),
    responses: {
      intraday: (symbol) => (symbol === "RELIANCE" ? providerError("boom") : okIntraday(symbol)),
    },
  });
  const result = await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE", "TCS"] }, deps);
  const batch = unwrap(result);
  assert.equal(batch.rows.length, 2);
  const tcsRow = batch.rows.find((r) => r.identity.symbol === "TCS")!;
  assert.equal(tcsRow.health.status, "complete");
});

// ── 11. Failed intraday fetch still yields the symbol row ─────────────────
test("11. a failed intraday fetch still yields the symbol row", async () => {
  const { deps } = makeFakeDeps({
    universe: ok(mkUniverse(["RELIANCE"])),
    responses: { intraday: () => unavailable("no intraday data") },
  });
  const result = await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE"] }, deps);
  const batch = unwrap(result);
  assert.equal(batch.rows.length, 1);
  // Daily fallback still usable -> lastCompleted resolves via previous session close.
  assert.ok(isUsable(batch.rows[0].metrics.lastCompleted));
});

// ── 12. Failed daily fetch still yields the symbol row ─────────────────────
test("12. a failed daily fetch still yields the symbol row", async () => {
  const { deps } = makeFakeDeps({
    universe: ok(mkUniverse(["RELIANCE"])),
    responses: { daily: () => unavailable("no daily data") },
  });
  const result = await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE"] }, deps);
  const batch = unwrap(result);
  assert.equal(batch.rows.length, 1);
  assert.ok(isUsable(batch.rows[0].metrics.lastCompleted));
  assert.ok(isFailure(batch.rows[0].metrics.atr14Daily));
});

// ── 13. Fresh cache hit causes zero provider calls (batch-level) ──────────
test("13. fresh cache hit causes zero provider calls across batches sharing a cache", async () => {
  const cache = createCandleCache();
  const { deps, calls } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])), cache });
  await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE"] }, deps);
  assert.equal(calls.candles.length, 2);
  // Second batch, small time delta -> within fresh window for both policies.
  const result2 = await runScreenerV3Batch({ referenceMs: REF + 1000, symbols: ["RELIANCE"] }, deps);
  const batch2 = unwrap(result2);
  assert.equal(calls.candles.length, 2, "no additional provider calls on fresh hit");
  assert.equal(batch2.cache.freshHits, 2);
  assert.equal(batch2.cache.providerRefreshes, 0);
});

// ── 14. Expired cache refresh success replaces last-good (batch-level) ────
test("14. expired cache entry refresh success is reflected in cache summary", async () => {
  const cache = createCandleCache();
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])), cache });
  await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE"] }, deps);
  // Past intraday freshMs (60s) and daily freshMs (30min) -> both refresh.
  const result2 = await runScreenerV3Batch(
    { referenceMs: REF + 31 * 60_000, symbols: ["RELIANCE"] },
    deps,
  );
  const batch2 = unwrap(result2);
  assert.equal(batch2.cache.providerRefreshes, 2);
  assert.equal(batch2.cache.freshHits, 0);
});

// ── 15. Refresh failure returns stale last-good within max-stale age ──────
test("15. refresh failure returns stale last-good within max-stale age", async () => {
  const cache = createCandleCache();
  let shouldFail = false;
  const { deps } = makeFakeDeps({
    universe: ok(mkUniverse(["RELIANCE"])),
    responses: {
      intraday: (symbol) => (shouldFail ? providerError("timeout") : okIntraday(symbol)),
    },
    cache,
  });
  await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE"] }, deps);
  shouldFail = true;
  // Past intraday freshMs (60s) but within maxStaleMs (15min).
  const result2 = await runScreenerV3Batch(
    { referenceMs: REF + 5 * 60_000, symbols: ["RELIANCE"] },
    deps,
  );
  const batch2 = unwrap(result2);
  assert.equal(batch2.cache.staleFallbacks, 1);
  assert.equal(batch2.rows.length, 1);
});

// ── 16. Too-old last-good is not used ──────────────────────────────────────
test("16. too-old last-good is not used", async () => {
  const cache = createCandleCache();
  let shouldFail = false;
  const { deps } = makeFakeDeps({
    universe: ok(mkUniverse(["RELIANCE"])),
    responses: {
      intraday: (symbol) => (shouldFail ? providerError("timeout") : okIntraday(symbol)),
    },
    cache,
  });
  await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE"] }, deps);
  shouldFail = true;
  // Beyond intraday maxStaleMs (15min).
  const result2 = await runScreenerV3Batch(
    { referenceMs: REF + 20 * 60_000, symbols: ["RELIANCE"] },
    deps,
  );
  const batch2 = unwrap(result2);
  assert.equal(batch2.providerFailureCount >= 1, true);
  const row = batch2.rows[0];
  // Intraday failed and is too old to fall back on; row still exists via daily fallback path.
  assert.ok(row);
});

// ── 17. Future-dated cache entry is not treated as fresh (batch-level) ────
test("17. future-dated cache entry is not treated as fresh at batch level", async () => {
  const cache = createCandleCache();
  const { deps, calls } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])), cache });
  await runScreenerV3Batch({ referenceMs: REF + 100_000, symbols: ["RELIANCE"] }, deps);
  const before = calls.candles.length;
  await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE"] }, deps);
  assert.ok(calls.candles.length > before, "an earlier referenceMs must trigger a fresh provider call, not a cache hit");
});

// ── 18 & 19. In-flight dedup (integration-level via concurrent batches) ──
test("18. in-flight duplicate requests share one provider call across concurrent batches", async () => {
  const cache = createCandleCache();
  let callCount = 0;
  let resolveFn: ((v: DataResult<CandleSeries>) => void) | null = null;
  const deps: RowOrchestratorDeps = {
    loadUniverse: async () => ok(mkUniverse(["RELIANCE"])),
    fetchCandles: async (symbol, interval) => {
      if (interval === DAILY_INTERVAL) return okDaily(symbol);
      callCount++;
      return new Promise<DataResult<CandleSeries>>((resolve) => {
        resolveFn = resolve;
      });
    },
    cache,
  };
  const p1 = runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE"] }, deps);
  const p2 = runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE"] }, deps);
  // Allow microtasks to progress so both requests reach the cache layer.
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(callCount, 1, "concurrent batches for the same key share one provider call");
  resolveFn!(okIntraday("RELIANCE"));
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.ok(!isFailure(r1));
  assert.ok(!isFailure(r2));
});

test("19. failed in-flight request does not poison later requests (batch-level)", async () => {
  const cache = createCandleCache();
  let calls = 0;
  const { deps } = makeFakeDeps({
    universe: ok(mkUniverse(["RELIANCE"])),
    responses: {
      intraday: (symbol) => {
        calls++;
        return calls === 1 ? providerError("first fails") : okIntraday(symbol);
      },
    },
    cache,
  });
  const first = await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE"] }, deps);
  assert.ok(!isFailure(first));
  const second = await runScreenerV3Batch({ referenceMs: REF + 1000, symbols: ["RELIANCE"] }, deps);
  const batch2 = unwrap(second);
  assert.equal(batch2.cache.providerRefreshes >= 1, true);
});

// ── 20. Cache key separates interval/range combinations (batch-level) ─────
test("20. intraday and daily fetches use distinct cache keys", async () => {
  const cache = createCandleCache();
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])), cache });
  await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE"] }, deps);
  assert.equal(cache.size(), 2, "intraday and daily must occupy distinct cache entries");
});

// ── 21. Health summary matches returned rows ───────────────────────────────
test("21. health summary matches returned rows", async () => {
  const { deps } = makeFakeDeps({
    universe: ok(mkUniverse(["RELIANCE", "TCS", "INFY"])),
    responses: {
      intraday: (symbol) => (symbol === "TCS" ? unavailable("no intraday") : okIntraday(symbol)),
    },
  });
  const result = await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE", "TCS", "INFY"] }, deps);
  const batch = unwrap(result);
  const counted = { complete: 0, degraded: 0, partial: 0, unavailable: 0 };
  for (const row of batch.rows) counted[row.health.status]++;
  assert.deepEqual(batch.health, counted);
  assert.equal(
    batch.health.complete + batch.health.degraded + batch.health.partial + batch.health.unavailable,
    batch.rows.length,
  );
});

// ── 22. Provider-failure and cache summaries are deterministic ────────────
test("22. provider-failure and cache summaries are deterministic across repeated identical runs", async () => {
  const buildDeps = () =>
    makeFakeDeps({
      universe: ok(mkUniverse(["RELIANCE", "TCS"])),
      responses: { intraday: (symbol) => (symbol === "TCS" ? providerError("boom") : okIntraday(symbol)) },
    }).deps;
  const r1 = unwrap(await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE", "TCS"] }, buildDeps()));
  const r2 = unwrap(await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE", "TCS"] }, buildDeps()));
  assert.deepEqual(r1.cache, r2.cache);
  assert.equal(r1.providerFailureCount, r2.providerFailureCount);
  assert.deepEqual(r1.health, r2.health);
});

// ── 23. referenceMs used without machine-clock calls ───────────────────────
test("23. referenceMs is used consistently without a machine-clock read", async () => {
  // A referenceMs far in the past must still produce deterministic, non-crashing output
  // (no hidden Date.now() substitution silently overriding the explicit value).
  const farPast = istMs(2020, 1, 2, 16, 0);
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])) });
  const result = await runScreenerV3Batch({ referenceMs: farPast, symbols: ["RELIANCE"] }, deps);
  const batch = unwrap(result);
  assert.equal(batch.referenceMs, farPast);
  assert.equal(batch.rows[0].identity.referenceMs, farPast);
});

// ── 24. Caller inputs are not mutated ──────────────────────────────────────
test("24. caller inputs are not mutated", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE", "TCS"])) });
  const symbols = ["TCS", "RELIANCE", "tcs"];
  const symbolsCopy = [...symbols];
  const input = { referenceMs: REF, symbols, cachePolicy: { intraday: { freshMs: 1000, maxStaleMs: 2000 } } };
  const inputSnapshot = JSON.parse(JSON.stringify(input));
  await runScreenerV3Batch(input, deps);
  assert.deepEqual(symbols, symbolsCopy);
  assert.deepEqual(input, inputSnapshot);
});

// ── 25. Limit and concurrency validation ───────────────────────────────────
test("25. limit and concurrency validation reject invalid values", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])) });

  for (const concurrency of [0, -1, 1.5, 1000]) {
    const r = await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE"], concurrency }, deps);
    assert.ok(isFailure(r), `concurrency=${concurrency} should be rejected`);
    if (isFailure(r)) assert.equal(r.status, "invalid_input");
  }
  for (const limit of [0, -1, 1.5]) {
    const r = await runScreenerV3Batch({ referenceMs: REF, limit }, deps);
    assert.ok(isFailure(r), `limit=${limit} should be rejected`);
  }
});

test("25b. referenceMs validation rejects non-finite/non-positive values", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])) });
  for (const referenceMs of [0, -1, NaN, Infinity]) {
    const r = await runScreenerV3Batch({ referenceMs, symbols: ["RELIANCE"] }, deps);
    assert.ok(isFailure(r));
    if (isFailure(r)) assert.equal(r.status, "invalid_input");
  }
});

test("25c. invalid cache policy overrides are rejected", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])) });
  const r = await runScreenerV3Batch(
    { referenceMs: REF, symbols: ["RELIANCE"], cachePolicy: { intraday: { freshMs: -1, maxStaleMs: 100 } } },
    deps,
  );
  assert.ok(isFailure(r));
  if (isFailure(r)) assert.equal(r.status, "invalid_input");
});

// ── 26. Empty/fully-rejected symbol set returns truthful failure ─────────
test("26. empty symbol array returns truthful failure", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])) });
  const r = await runScreenerV3Batch({ referenceMs: REF, symbols: [] }, deps);
  assert.ok(isFailure(r));
  if (isFailure(r)) assert.equal(r.status, "invalid_input");
});

test("26b. fully-rejected symbol set returns truthful failure", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])) });
  const r = await runScreenerV3Batch({ referenceMs: REF, symbols: ["  ", "bad symbol", ""] }, deps);
  assert.ok(isFailure(r));
  if (isFailure(r)) assert.equal(r.status, "invalid_input");
});

// ── Additional: universe never used for mapping when symbols explicit + universe ok ──
test("explicit symbol not present in the universe still yields a row with truthful mapping failure", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])) });
  const result = await runScreenerV3Batch({ referenceMs: REF, symbols: ["UNKNOWNSYM"] }, deps);
  const batch = unwrap(result);
  assert.equal(batch.rows.length, 1);
  assert.equal(batch.rows[0].identity.spotMappingStatus, "not_in_universe");
});

// ── Additional: limit is applied to derived symbols, not explicit ones ────
test("limit truncates derived symbols deterministically", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["AAA", "BBB", "CCC", "DDD"])) });
  const result = await runScreenerV3Batch({ referenceMs: REF, limit: 2 }, deps);
  const batch = unwrap(result);
  assert.equal(batch.rows.length, 2);
  assert.deepEqual(batch.rows.map((r) => r.identity.symbol), ["AAA", "BBB"]);
});

// ── Additional: rows stay in accepted-symbol order even when provider calls
//    settle out of order (later-requested symbols resolving first). ────────
test("row order follows accepted-symbol order regardless of provider completion order", async () => {
  const universe = ok(mkUniverse(["AAA", "BBB", "CCC"]));
  // Resolve C fastest, A slowest, so completion order is the reverse of input.
  const delayFor: Record<string, number> = { AAA: 30, BBB: 15, CCC: 1 };
  const deps: RowOrchestratorDeps = {
    loadUniverse: async () => universe,
    fetchCandles: async (symbol, interval) => {
      await new Promise((r) => setTimeout(r, delayFor[symbol] ?? 1));
      return interval === INTRADAY_INTERVAL ? okIntraday(symbol) : okDaily(symbol);
    },
    cache: createCandleCache(),
  };
  const result = await runScreenerV3Batch(
    { referenceMs: REF, symbols: ["AAA", "BBB", "CCC"], concurrency: 8 },
    deps,
  );
  const batch = unwrap(result);
  assert.deepEqual(batch.rows.map((r) => r.identity.symbol), ["AAA", "BBB", "CCC"]);
});

// ── Additional: a THROWN provider call (not a returned failure) must release
//    its concurrency slot and must not cancel unrelated symbols. ───────────
test("a thrown provider fetch releases its slot and does not cancel other symbols", async () => {
  const universe = ok(mkUniverse(["A", "B", "C", "D", "E"]));
  let active = 0;
  let maxActive = 0;
  const deps: RowOrchestratorDeps = {
    loadUniverse: async () => universe,
    fetchCandles: async (symbol, interval) => {
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        await new Promise((r) => setTimeout(r, 3));
        // Symbol A's intraday fetch throws synchronously-after-await (a rejection).
        if (symbol === "A" && interval === INTRADAY_INTERVAL) {
          throw new Error("provider exploded");
        }
        return interval === INTRADAY_INTERVAL ? okIntraday(symbol) : okDaily(symbol);
      } finally {
        active--;
      }
    },
    cache: createCandleCache(),
  };
  const result = await runScreenerV3Batch(
    { referenceMs: REF, symbols: ["A", "B", "C", "D", "E"], concurrency: 2 },
    deps,
  );
  const batch = unwrap(result);
  // All five symbols still produce rows; A's thrown intraday becomes a provider
  // failure inside the cache, and its row survives via the daily fallback path.
  assert.equal(batch.rows.length, 5);
  assert.ok(maxActive <= 2, `expected maxActive <= 2, got ${maxActive}`);
  assert.equal(batch.providerFailureCount >= 1, true);
});

// ══════════════════════════════════════════════════════════════════════════
// Phase 2B Part 4 — additive derivatives enrichment integration
// Uses an INJECTED fake enrichDerivatives (never a live provider). Verifies the
// row orchestrator wires the Part 3 enrichBatch boundary correctly: one batched
// call, truthful attachment, failure isolation, cap enforcement, determinism.
// ══════════════════════════════════════════════════════════════════════════

/** Minimal truthful ScreenerV3Derivatives value for attachment assertions. */
function mkDerivatives(symbol: string, referenceMs: number): ScreenerV3Derivatives {
  return {
    selection: {
      futureInstrumentKey: `FUT|${symbol}`,
      futureExpiryMs: NEAR_FUT_EXPIRY,
      optionExpiryMs: null,
      anchorPrice: 100,
      atmStrike: null,
      callInstrumentKey: null,
      putInstrumentKey: null,
      resolvedFrom: "instrument_master",
    },
    future: unavailable(`no future data for ${symbol}`, { source: "test" }),
    call: unavailable("no CE", { source: "test" }),
    put: unavailable("no PE", { source: "test" }),
    health: { status: "unavailable", usableLegs: 0, staleLegs: 0, failedLegs: 3, reasons: [] },
    referenceMs,
  };
}

interface EnrichCalls {
  count: number;
  batches: DerivativesEnrichmentRequest[][];
  referenceMs: number[];
  universeStatuses: string[];
}
/** Injected fake for RowOrchestratorDeps.enrichDerivatives. */
function makeEnrichFake(
  resultFor?: (rk: string, symbol: string, referenceMs: number) => DataResult<ScreenerV3Derivatives>,
): { enrichDerivatives: NonNullable<RowOrchestratorDeps["enrichDerivatives"]>; calls: EnrichCalls } {
  const calls: EnrichCalls = { count: 0, batches: [], referenceMs: [], universeStatuses: [] };
  const enrichDerivatives: NonNullable<RowOrchestratorDeps["enrichDerivatives"]> = async ({
    universe,
    requests,
    referenceMs,
  }) => {
    calls.count++;
    calls.batches.push([...requests]);
    calls.referenceMs.push(referenceMs);
    calls.universeStatuses.push(universe.status);
    const m = new Map<string, DataResult<ScreenerV3Derivatives>>();
    for (const r of requests) {
      m.set(r.requestKey, resultFor ? resultFor(r.requestKey, r.symbol, referenceMs) : ok(mkDerivatives(r.symbol, referenceMs)));
    }
    return m;
  };
  return { enrichDerivatives, calls };
}

// ── E1. Enrichment OFF -> zero derivatives work, no derivatives key ──────────
test("E1. enrichment off performs zero derivatives calls and omits the derivatives key", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE", "TCS"])) });
  const { enrichDerivatives, calls } = makeEnrichFake();
  deps.enrichDerivatives = enrichDerivatives;
  const batch = unwrap(await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE", "TCS"] }, deps));
  assert.equal(calls.count, 0);
  for (const row of batch.rows) assert.equal("derivatives" in row, false, "no derivatives key in plain mode");
});

// ── E2. Enrichment ON -> exactly one enrichBatch call for the whole batch ────
test("E2. enrichment on invokes enrichBatch exactly once per batch", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE", "TCS", "INFY"])) });
  const { enrichDerivatives, calls } = makeEnrichFake();
  deps.enrichDerivatives = enrichDerivatives;
  const batch = unwrap(
    await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE", "TCS", "INFY"], includeDerivatives: true }, deps),
  );
  assert.equal(calls.count, 1, "one batched enrichBatch call");
  assert.equal(calls.batches[0].length, 3, "one request per selected row");
  for (const row of batch.rows) assert.ok(row.derivatives, "each row carries derivatives");
});

// ── E3. Universe loaded exactly once even with enrichment on ─────────────────
test("E3. universe loaded once; enrichment reuses the same universe result", async () => {
  const { deps, calls } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])) });
  const { enrichDerivatives, calls: eCalls } = makeEnrichFake();
  deps.enrichDerivatives = enrichDerivatives;
  await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE"], includeDerivatives: true }, deps);
  assert.equal(calls.universe, 1, "no extra universe load for derivatives");
  assert.equal(eCalls.universeStatuses[0], "available", "reused universe result passed to enrichBatch");
});

// ── E4. Duplicate symbols cause no duplicate enrichment work ─────────────────
test("E4. duplicate symbols produce a single enrichment request", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])) });
  const { enrichDerivatives, calls } = makeEnrichFake();
  deps.enrichDerivatives = enrichDerivatives;
  await runScreenerV3Batch(
    { referenceMs: REF, symbols: ["RELIANCE", "reliance", "RELIANCE.NS"], includeDerivatives: true },
    deps,
  );
  assert.equal(calls.count, 1);
  assert.equal(calls.batches[0].length, 1, "deduped to a single request");
  assert.equal(calls.batches[0][0].requestKey, "RELIANCE");
});

// ── E5. Invalid symbol triggers no derivatives request for it ────────────────
test("E5. invalid symbols are excluded from enrichment; valid ones still enriched", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])) });
  const { enrichDerivatives, calls } = makeEnrichFake();
  deps.enrichDerivatives = enrichDerivatives;
  const batch = unwrap(
    await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE", "has space", "BAD.SYMBOL"], includeDerivatives: true }, deps),
  );
  assert.equal(calls.count, 1);
  assert.deepEqual(calls.batches[0].map((r) => r.requestKey), ["RELIANCE"]);
  assert.equal(batch.rows.length, 1);
  assert.ok(batch.rows[0].derivatives);
});

// ── E6. All-invalid symbols -> no enrichment call at all ─────────────────────
test("E6. all-invalid symbols never reach the derivatives boundary", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])) });
  const { enrichDerivatives, calls } = makeEnrichFake();
  deps.enrichDerivatives = enrichDerivatives;
  const r = await runScreenerV3Batch({ referenceMs: REF, symbols: ["  ", "bad symbol"], includeDerivatives: true }, deps);
  assert.ok(isFailure(r));
  assert.equal(calls.count, 0);
});

// ── E7. Rows without a usable anchor are not enriched (no enrichBatch call) ──
test("E7. a row without a usable anchor price is not enriched", async () => {
  const { deps } = makeFakeDeps({
    universe: ok(mkUniverse(["RELIANCE"])),
    responses: { intraday: () => unavailable("no intraday"), daily: () => unavailable("no daily") },
  });
  const { enrichDerivatives, calls } = makeEnrichFake();
  deps.enrichDerivatives = enrichDerivatives;
  const batch = unwrap(await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE"], includeDerivatives: true }, deps));
  assert.equal(calls.count, 0, "no anchor -> no enrichment request -> no batch call");
  assert.equal(batch.rows.length, 1);
  assert.equal("derivatives" in batch.rows[0], false);
});

// ── E8. Anchor price comes from the row's lastCompleted metric ───────────────
test("E8. enrichment anchor price equals the row's lastCompleted price", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])) });
  const { enrichDerivatives, calls } = makeEnrichFake();
  deps.enrichDerivatives = enrichDerivatives;
  const batch = unwrap(await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE"], includeDerivatives: true }, deps));
  const lc = batch.rows[0].metrics.lastCompleted;
  assert.ok(isUsable(lc));
  if (isUsable(lc)) assert.equal(calls.batches[0][0].anchorPrice, lc.value.price);
});

// ── E9. Row order is preserved after enrichment ──────────────────────────────
test("E9. enrichment preserves deterministic row order", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["AAA", "BBB", "CCC"])) });
  const { enrichDerivatives } = makeEnrichFake();
  deps.enrichDerivatives = enrichDerivatives;
  const batch = unwrap(
    await runScreenerV3Batch({ referenceMs: REF, symbols: ["CCC", "AAA", "BBB"], includeDerivatives: true }, deps),
  );
  assert.deepEqual(batch.rows.map((r) => r.identity.symbol), ["CCC", "AAA", "BBB"]);
});

// ── E10. Correct request-key association on attachment ───────────────────────
test("E10. derivatives attach to the correct row by request key", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE", "TCS"])) });
  // Tag each derivatives value with its symbol via the selection key.
  const { enrichDerivatives } = makeEnrichFake((rk, symbol, ref) => ok(mkDerivatives(symbol, ref)));
  deps.enrichDerivatives = enrichDerivatives;
  const batch = unwrap(
    await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE", "TCS"], includeDerivatives: true }, deps),
  );
  for (const row of batch.rows) {
    assert.ok(row.derivatives);
    assert.equal(row.derivatives!.selection.futureInstrumentKey, `FUT|${row.identity.symbol}`);
  }
});

// ── E11. One derivatives failure is isolated to its row ──────────────────────
test("E11. a single derivatives failure does not affect other rows", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE", "TCS"])) });
  const { enrichDerivatives } = makeEnrichFake((rk, symbol, ref) =>
    symbol === "RELIANCE" ? providerError("derivatives down") : ok(mkDerivatives(symbol, ref)),
  );
  deps.enrichDerivatives = enrichDerivatives;
  const batch = unwrap(
    await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE", "TCS"], includeDerivatives: true }, deps),
  );
  const reliance = batch.rows.find((r) => r.identity.symbol === "RELIANCE")!;
  const tcs = batch.rows.find((r) => r.identity.symbol === "TCS")!;
  assert.equal("derivatives" in reliance, false, "failed enrichment -> no fabricated object");
  assert.ok(tcs.derivatives, "other row still enriched");
  // Base row survives intact regardless.
  assert.ok(reliance.metrics.lastCompleted);
});

// ── E12. Provider-wide derivatives failure keeps usable base rows ────────────
test("E12. batch-wide derivatives failure leaves base rows intact and unfabricated", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE", "TCS"])) });
  const { enrichDerivatives } = makeEnrichFake(() => providerError("provider outage"));
  deps.enrichDerivatives = enrichDerivatives;
  const batch = unwrap(
    await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE", "TCS"], includeDerivatives: true }, deps),
  );
  assert.equal(batch.rows.length, 2);
  for (const row of batch.rows) {
    assert.equal("derivatives" in row, false, "no derivatives key on top-level failure");
    assert.equal(row.health.status, "complete", "base health unaffected");
  }
});

// ── E13. Attached derivatives referenceMs equals the base request reference ──
test("E13. attached derivatives referenceMs equals the batch referenceMs exactly", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])) });
  const { enrichDerivatives } = makeEnrichFake();
  deps.enrichDerivatives = enrichDerivatives;
  const batch = unwrap(await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE"], includeDerivatives: true }, deps));
  assert.equal(batch.rows[0].derivatives!.referenceMs, REF);
});

// ── E14. Stale top-level enrichment still attaches its value ─────────────────
test("E14. a stale top-level derivatives result attaches its value", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])) });
  const { stale } = await import("./types.ts");
  const { enrichDerivatives } = makeEnrichFake((rk, symbol, ref) => stale(mkDerivatives(symbol, ref), { source: "test" }));
  deps.enrichDerivatives = enrichDerivatives;
  const batch = unwrap(await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE"], includeDerivatives: true }, deps));
  assert.ok(batch.rows[0].derivatives, "stale enrichment attaches");
});

// ── E15. Enriched symbol cap is enforced (explicit) ──────────────────────────
test("E15. enriched batch is capped to ENRICHED_MAX_SYMBOLS with truthful rejections", async () => {
  const symbols = Array.from({ length: ENRICHED_MAX_SYMBOLS + 5 }, (_, i) => `SYM${i}`);
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(symbols)) });
  const { enrichDerivatives, calls } = makeEnrichFake();
  deps.enrichDerivatives = enrichDerivatives;
  const batch = unwrap(await runScreenerV3Batch({ referenceMs: REF, symbols, includeDerivatives: true }, deps));
  assert.equal(batch.rows.length, ENRICHED_MAX_SYMBOLS, "rows capped");
  assert.equal(batch.acceptedSymbolCount, ENRICHED_MAX_SYMBOLS);
  assert.equal(calls.batches[0].length, ENRICHED_MAX_SYMBOLS, "enrichment capped");
  const capReasons = batch.rejectedSymbols.filter((r) => /enriched batch capped/.test(r.reason));
  assert.equal(capReasons.length, 5, "5 over-cap symbols rejected truthfully");
});

// ── E16. Enriched cap applies to universe-derived requests too ───────────────
test("E16. enriched cap applies to universe-derived symbols consistently", async () => {
  const symbols = Array.from({ length: ENRICHED_MAX_SYMBOLS + 10 }, (_, i) => `SYM${String(i).padStart(3, "0")}`);
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(symbols)) });
  const { enrichDerivatives, calls } = makeEnrichFake();
  deps.enrichDerivatives = enrichDerivatives;
  // No explicit symbols -> universe-derived; large limit must not exceed the cap.
  const batch = unwrap(await runScreenerV3Batch({ referenceMs: REF, limit: 250, includeDerivatives: true }, deps));
  assert.equal(batch.rows.length, ENRICHED_MAX_SYMBOLS);
  assert.equal(calls.batches[0].length, ENRICHED_MAX_SYMBOLS);
});

// ── E17. Plain mode is unaffected by the enriched cap ────────────────────────
test("E17. plain mode processes more than the enriched cap (cap does not apply)", async () => {
  const symbols = Array.from({ length: ENRICHED_MAX_SYMBOLS + 5 }, (_, i) => `SYM${i}`);
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(symbols)) });
  const { enrichDerivatives, calls } = makeEnrichFake();
  deps.enrichDerivatives = enrichDerivatives;
  const batch = unwrap(await runScreenerV3Batch({ referenceMs: REF, symbols }, deps));
  assert.equal(batch.rows.length, ENRICHED_MAX_SYMBOLS + 5, "plain mode not capped");
  assert.equal(calls.count, 0);
});

// ── E18. Enrichment uses the request referenceMs, never a caller side-channel ─
test("E18. enrichBatch receives the batch referenceMs (server-owned reference)", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])) });
  const { enrichDerivatives, calls } = makeEnrichFake();
  deps.enrichDerivatives = enrichDerivatives;
  const customRef = REF + 12_345;
  await runScreenerV3Batch({ referenceMs: customRef, symbols: ["RELIANCE"], includeDerivatives: true }, deps);
  assert.equal(calls.referenceMs[0], customRef);
});

// ── E19. Enrichment does not change base health/cache summaries ──────────────
test("E19. base orchestration summaries are unchanged by enrichment", async () => {
  const buildDeps = () => {
    const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE", "TCS"])) });
    return deps;
  };
  const plain = unwrap(await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE", "TCS"] }, buildDeps()));
  const enrichedDeps = buildDeps();
  enrichedDeps.enrichDerivatives = makeEnrichFake().enrichDerivatives;
  const enriched = unwrap(
    await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE", "TCS"], includeDerivatives: true }, enrichedDeps),
  );
  assert.deepEqual(enriched.health, plain.health);
  assert.deepEqual(enriched.cache, plain.cache);
  assert.equal(enriched.providerFailureCount, plain.providerFailureCount);
});

// ── E20. includeDerivatives=true but no dep wired -> plain rows, no crash ────
test("E20. enrichment requested without a wired dependency yields plain rows", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE"])) });
  // deps.enrichDerivatives intentionally left undefined.
  const batch = unwrap(await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE"], includeDerivatives: true }, deps));
  assert.equal(batch.rows.length, 1);
  assert.equal("derivatives" in batch.rows[0], false);
});

// ── E21. A THROWN derivatives subsystem error never fails the base batch ─────
test("E21. a thrown enrichDerivatives never discards base rows or 500s the batch", async () => {
  const { deps } = makeFakeDeps({ universe: ok(mkUniverse(["RELIANCE", "TCS"])) });
  deps.enrichDerivatives = async () => {
    throw new Error("SECRET_TOKEN=xyz derivatives subsystem exploded");
  };
  const batch = unwrap(
    await runScreenerV3Batch({ referenceMs: REF, symbols: ["RELIANCE", "TCS"], includeDerivatives: true }, deps),
  );
  assert.equal(batch.rows.length, 2, "base rows survive a derivatives throw");
  for (const row of batch.rows) {
    assert.equal("derivatives" in row, false, "no fabricated derivatives after a throw");
    assert.equal(row.health.status, "complete", "base health intact");
  }
});
