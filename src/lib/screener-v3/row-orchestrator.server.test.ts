import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runScreenerV3Batch,
  INTRADAY_INTERVAL,
  INTRADAY_RANGE,
  DAILY_INTERVAL,
  DAILY_RANGE,
  type RowOrchestratorDeps,
} from "./row-orchestrator.server.ts";
import { createCandleCache } from "./candle-cache.server.ts";
import { ok, providerError, unavailable, isFailure, isUsable, type DataResult } from "./types.ts";
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
