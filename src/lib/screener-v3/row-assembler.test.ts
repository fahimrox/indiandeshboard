import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleScreenerV3Row, computeRowHealth } from "./row-assembler.ts";
import type { Candle, CandleInterval } from "./candles.ts";
import type { CandleSeries } from "./candles.server.ts";
import { ok, stale, unavailable, isFailure, type DataResult } from "./types.ts";
import { istDateStr } from "./ist-time.ts";
import type {
  FnoInstrumentUniverse,
  FnoUnderlyingInstrument,
  FuturesContract,
  OptionContract,
  SpotMappingStatus,
} from "./instrument-types.ts";
import type { RowMetrics } from "./row-types.ts";

// ── Time fixtures ────────────────────────────────────────────────────────
const IST = 5.5 * 3600 * 1000;
const istMs = (y: number, mo: number, d: number, h: number, mi: number, s = 0) =>
  Date.UTC(y, mo - 1, d, h, mi, s) - IST;
// Reference well after the full 09:15-15:30 session: every intraday bar is completed.
const REF = istMs(2026, 7, 20, 16, 0);
const NEAR_FUT_EXPIRY = istMs(2026, 7, 30, 15, 30);
const OPT_EXPIRY = istMs(2026, 7, 30, 15, 30);

// ── Candle fixture builders ─────────────────────────────────────────────
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
function fullSessionCandles(over: Partial<Candle> = {}): Candle[] {
  // 09:15 .. 15:29 inclusive == 375 one-minute bars, full canonical coverage.
  return Array.from({ length: 375 }, (_, i) => bar(555 + i, over));
}
function dailyBar(y: number, mo: number, d: number, over: Partial<Candle> = {}): Candle {
  return {
    timestamp: istMs(y, mo, d, 9, 15),
    open: 100,
    high: 105,
    low: 95,
    close: 100,
    volume: 5000,
    source: "yahoo",
    interval: "1d",
    ...over,
  };
}
function fullDailyCandles(): Candle[] {
  // 20 sequential daily sessions ending 2026-07-17 (the trading day before REF's date).
  const days = [17, 16, 15, 14, 13, 10, 9, 8, 7, 6, 3, 2, 1];
  const junDays = [30, 29, 26, 25, 24, 23, 22];
  const out: Candle[] = [];
  for (const d of junDays) out.push(dailyBar(2026, 6, d));
  for (const d of days) out.push(dailyBar(2026, 7, d));
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

function mkSeries(candles: Candle[], interval: CandleInterval): CandleSeries {
  return {
    symbol: "RELIANCE",
    yahooSymbol: "RELIANCE.NS",
    interval,
    range: interval === "1d" ? "1y" : "5d",
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

function okIntraday(candles: Candle[]): DataResult<CandleSeries> {
  return ok(mkSeries(candles, "1m"));
}
function okDaily(candles: Candle[]): DataResult<CandleSeries> {
  return ok(mkSeries(candles, "1d"));
}

// ── F&O universe fixture builders (mirrors fno-universe.test.ts patterns) ──
function mkFut(expiry: number): FuturesContract {
  return {
    instrumentKey: `FUT|${expiry}`,
    tradingSymbol: "RELIANCE FUT",
    expiry,
    expiryDateIst: istDateStr(expiry),
    lotSize: 250,
    weekly: false,
    exchangeToken: "1",
  };
}
function mkOpt(expiry: number, strike: number, type: "CE" | "PE"): OptionContract {
  return {
    instrumentKey: `${type}|${strike}|${expiry}`,
    tradingSymbol: `RELIANCE${strike}${type}`,
    expiry,
    expiryDateIst: istDateStr(expiry),
    strike,
    optionType: type,
    lotSize: 250,
  };
}
function mkResolvedUnderlying(): FnoUnderlyingInstrument {
  const options = [
    mkOpt(OPT_EXPIRY, 2900, "CE"),
    mkOpt(OPT_EXPIRY, 2900, "PE"),
    mkOpt(OPT_EXPIRY, 3000, "CE"),
    mkOpt(OPT_EXPIRY, 3000, "PE"),
  ];
  return {
    symbol: "RELIANCE",
    normalizedSymbol: "RELIANCE",
    name: "Reliance Industries",
    spotInstrumentKey: "NSE_EQ|INE002A01018",
    spotMappingStatus: "resolved" as SpotMappingStatus,
    spotResolved: true,
    diagnosticSpotKey: "NSE_EQ|INE002A01018",
    conflictingSpotKeys: [],
    spotTradingSymbol: "RELIANCE",
    isin: "INE002A01018",
    futures: [mkFut(NEAR_FUT_EXPIRY)],
    options,
    nearMonthFutures: mkFut(NEAR_FUT_EXPIRY),
    futuresExpiries: [NEAR_FUT_EXPIRY],
    optionExpiries: [OPT_EXPIRY],
    lotSize: 250,
  };
}
function mkConflictingUnderlying(): FnoUnderlyingInstrument {
  const base = mkResolvedUnderlying();
  return {
    ...base,
    spotInstrumentKey: null,
    spotMappingStatus: "conflicting_keys" as SpotMappingStatus,
    spotResolved: false,
    conflictingSpotKeys: ["NSE_EQ|A", "NSE_EQ|B"],
    spotTradingSymbol: null,
  };
}
function mkUniverse(underlyings: FnoUnderlyingInstrument[]): FnoInstrumentUniverse {
  const bySymbol: Record<string, FnoUnderlyingInstrument> = {};
  for (const u of underlyings) bySymbol[u.normalizedSymbol] = u;
  return {
    underlyings,
    bySymbol,
    metadata: {} as FnoInstrumentUniverse["metadata"],
  };
}
function okUniverse(underlyings: FnoUnderlyingInstrument[]): DataResult<FnoInstrumentUniverse> {
  return ok(mkUniverse(underlyings));
}

// A fully-usable baseline input: everything available and internally coherent.
function baselineInput() {
  return {
    symbol: "RELIANCE",
    referenceMs: REF,
    universe: okUniverse([mkResolvedUnderlying()]),
    intraday: okIntraday(fullSessionCandles()),
    daily: okDaily(fullDailyCandles()),
  };
}

// ── 1. Fully available coherent row ─────────────────────────────────────
test("1. fully available coherent row", () => {
  const row = assembleScreenerV3Row(baselineInput());
  assert.equal(row.identity.symbol, "RELIANCE");
  assert.equal(row.identity.spotInstrumentKey, "NSE_EQ|INE002A01018");
  assert.equal(row.identity.optionStructureReady, true);
  assert.equal(row.metrics.lastCompleted.status, "available");
  assert.equal(row.metrics.sessionVwap.status, "available");
  assert.equal(row.metrics.atr14Daily.status, "available");
  assert.equal(row.metrics.mapping.status, "available");
  assert.equal(row.health.status, "complete");
  assert.deepEqual(row.health.reasons, []);
});

// ── 2. Mapping conflict prevents a fully-mapped row ─────────────────────
test("2. mapping conflict disqualifies mapping-dependent identity fields", () => {
  const input = baselineInput();
  input.universe = okUniverse([mkConflictingUnderlying()]);
  const row = assembleScreenerV3Row(input);
  assert.equal(row.identity.spotInstrumentKey, null);
  assert.equal(row.identity.spotTradingSymbol, null);
  assert.equal(row.identity.optionStructureReady, false);
  assert.equal(row.identity.spotMappingStatus, "conflicting_keys");
  // Row still exists with a usable anchor price — not erased by the conflict.
  assert.equal(row.metrics.lastCompleted.status, "available");
});

// ── 3. Intraday unavailable, daily metrics remain truthful ──────────────
test("3. intraday unavailable but daily metrics remain truthful", () => {
  const input = baselineInput();
  input.intraday = unavailable("provider returned no intraday candles");
  const row = assembleScreenerV3Row(input);
  assert.equal(row.metrics.atr14Daily.status, "available");
  assert.equal(row.metrics.previousSessionOhlc.status, "available");
  assert.equal(row.metrics.lastCompleted.status, "available"); // falls back to daily
  assert.equal(row.metrics.sessionVwap.status, "unavailable");
  assert.equal(row.metrics.return5m.status, "unavailable");
  assert.equal(row.metrics.rollingVolume20.status, "unavailable");
  assert.equal(row.health.status, "partial");
});

// ── 4. Daily unavailable, intraday metrics remain truthful ──────────────
test("4. daily unavailable but intraday metrics remain truthful", () => {
  const input = baselineInput();
  input.daily = unavailable("provider returned no daily candles");
  const row = assembleScreenerV3Row(input);
  assert.equal(row.metrics.sessionVwap.status, "available");
  assert.equal(row.metrics.return15m.status, "available");
  assert.equal(row.metrics.lastCompleted.status, "available"); // intraday path
  assert.equal(row.metrics.atr14Daily.status, "unavailable");
  assert.equal(row.metrics.previousSessionOhlc.status, "unavailable");
  assert.equal(row.health.status, "partial");
});

// ── 5. Stale input propagates visibly ────────────────────────────────────
test("5. stale intraday input propagates as stale, not silently as fresh", () => {
  const input = baselineInput();
  input.intraday = stale(mkSeries(fullSessionCandles(), "1m"), { reason: "cache last-good" });
  const row = assembleScreenerV3Row(input);
  assert.equal(row.metrics.lastCompleted.status, "stale");
  assert.equal(row.metrics.sessionVwap.status, "stale");
  assert.equal(row.health.status, "degraded");
  assert.ok(row.health.reasons.some((r) => r.includes("stale")));
});

// ── 6. Forming final candle is not presented as completed ───────────────
test("6. a forming last candle is excluded from lastCompleted", () => {
  const input = baselineInput();
  // Candles through 09:19 (5 bars); referenceMs lands INSIDE the 09:19 bar,
  // so only 09:15..09:18 are genuinely completed.
  const candles = [bar(555), bar(556), bar(557), bar(558), bar(559, { high: 999, close: 999 })];
  input.intraday = okIntraday(candles);
  const referenceMs = istMs(2026, 7, 20, 9, 19, 30); // mid-way through the 09:19 bar
  const row = assembleScreenerV3Row({ ...input, referenceMs });
  assert.equal(row.metrics.lastCompleted.status, "available");
  assert.equal(row.metrics.lastCompleted.value?.price, 100); // 09:18 close, not 09:19's 999
  assert.equal(row.metrics.lastCompleted.value?.candleAt, bar(558).timestamp);
});

// ── 7. Exact return-window gap remains unavailable ───────────────────────
test("7. a missing exact baseline candle leaves the return window unavailable (no substitution)", () => {
  const input = baselineInput();
  // Last completed bar is 15:29 (min 929); drop its exact 5m baseline at 15:24 (min 924).
  const candles = fullSessionCandles().filter((c) => c.timestamp !== bar(924).timestamp);
  input.intraday = okIntraday(candles);
  const row = assembleScreenerV3Row(input);
  assert.equal(row.metrics.return5m.status, "unavailable");
  assert.equal(row.metrics.return5m.value, null);
});

// ── 8. Opening-range data unavailable does not become zero ──────────────
test("8. incomplete opening-range window is a failure, never a fabricated zero", () => {
  const input = baselineInput();
  const candles = fullSessionCandles().filter((c) => c.timestamp !== bar(557).timestamp); // drop 09:17
  input.intraday = okIntraday(candles);
  const row = assembleScreenerV3Row(input);
  assert.ok(isFailure(row.metrics.openingRange5));
  assert.equal(row.metrics.openingRange5.value, null);
  assert.notEqual(row.metrics.openingRange5.value, 0);
});

// ── 9. Genuine zero metric distinguishable from unavailable ─────────────
test("9. a genuine zero rolling volume is available(0), not unavailable", () => {
  const input = baselineInput();
  input.intraday = okIntraday(fullSessionCandles({ volume: 0 }));
  const row = assembleScreenerV3Row(input);
  assert.equal(row.metrics.rollingVolume20.status, "available");
  assert.equal(row.metrics.rollingVolume20.value, 0);

  const missingVolInput = baselineInput();
  const withMissingVolume = fullSessionCandles();
  // rollingVolume20 uses the LAST 20 completed candles of the session; the
  // missing volume must land inside that window to affect the metric.
  const lastIdx = withMissingVolume.length - 1;
  withMissingVolume[lastIdx - 5] = { ...withMissingVolume[lastIdx - 5], volume: null };
  missingVolInput.intraday = okIntraday(withMissingVolume);
  const rowMissing = assembleScreenerV3Row(missingVolInput);
  assert.ok(isFailure(rowMissing.metrics.rollingVolume20));
  assert.equal(rowMissing.metrics.rollingVolume20.value, null);
});

// ── 10. Optional metric failure does not remove the symbol row ──────────
test("10. universe unavailable still yields a row (mapping fails, row survives)", () => {
  const input = baselineInput();
  input.universe = unavailable("F&O master fetch failed");
  const row = assembleScreenerV3Row(input);
  assert.equal(row.identity.symbol, "RELIANCE");
  assert.equal(row.identity.spotMappingStatus, "universe_unavailable");
  assert.ok(isFailure(row.metrics.mapping));
  assert.equal(row.metrics.lastCompleted.status, "available");
  assert.equal(row.health.status, "partial");
});

// ── 11. Overall row-health precedence is deterministic ───────────────────
test("11. row-health precedence: unavailable > partial > degraded > complete", () => {
  const allOk = ok(1);
  const failing = unavailable("x");
  const staleOk = stale(1);

  const base: RowMetrics = {
    lastCompleted: ok({ price: 100, candleAt: 1, interval: "1m" }),
    sessionVwap: allOk as never,
    vwapDistancePct: allOk as never,
    atr14Daily: allOk as never,
    previousSessionOhlc: allOk as never,
    openingRange5: allOk as never,
    openingRange15: allOk as never,
    openingRange30: allOk as never,
    return5m: allOk as never,
    return15m: allOk as never,
    return30m: allOk as never,
    rollingVolume20: allOk as never,
    rollingAvgVolume20: allOk as never,
    volumeAcceleration10: allOk as never,
    mapping: allOk as never,
  };

  assert.equal(computeRowHealth(base).status, "complete");

  const withStale: RowMetrics = { ...base, atr14Daily: staleOk as never };
  assert.equal(computeRowHealth(withStale).status, "degraded");

  const withFailureAndStale: RowMetrics = { ...withStale, return5m: failing };
  // lastCompleted usable -> not unavailable; a failure present -> partial (beats degraded).
  assert.equal(computeRowHealth(withFailureAndStale).status, "partial");

  const anchorFailed: RowMetrics = {
    ...withFailureAndStale,
    lastCompleted: unavailable("no anchor price"),
  };
  // lastCompleted failing always wins, regardless of other stale/failed metrics.
  assert.equal(computeRowHealth(anchorFailed).status, "unavailable");
});

// ── 12. No hidden use of Date.now() ──────────────────────────────────────
test("12. assembleScreenerV3Row never reads the machine clock", () => {
  const original = Date.now;
  Date.now = () => {
    throw new Error("Date.now() must not be called inside the pure row assembler");
  };
  try {
    const row = assembleScreenerV3Row(baselineInput());
    assert.equal(row.identity.referenceMs, REF);
  } finally {
    Date.now = original;
  }
});

// ── 13. Input arrays/objects are not mutated ─────────────────────────────
test("13. the assembler does not mutate caller-owned inputs", () => {
  const input = baselineInput();
  const intradaySnapshot = JSON.parse(JSON.stringify(input.intraday));
  const dailySnapshot = JSON.parse(JSON.stringify(input.daily));
  const universeSnapshot = JSON.parse(JSON.stringify(input.universe));

  assembleScreenerV3Row(input);

  assert.deepEqual(JSON.parse(JSON.stringify(input.intraday)), intradaySnapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(input.daily)), dailySnapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(input.universe)), universeSnapshot);
});

// ── 14. Contradictory manually-built mapping data is rejected defensively ─
test("14. a contradictory resolved-status-but-null-key underlying yields no usable spot key", () => {
  const input = baselineInput();
  const contradictory: FnoUnderlyingInstrument = {
    ...mkResolvedUnderlying(),
    spotMappingStatus: "resolved" as SpotMappingStatus, // claims resolved...
    spotInstrumentKey: null, // ...but carries no usable key (contradiction)
  };
  input.universe = okUniverse([contradictory]);
  const row = assembleScreenerV3Row(input);
  assert.equal(row.identity.spotInstrumentKey, null);
  assert.equal(row.identity.spotTradingSymbol, null);
});

// ── 15. Mapping conflict with complete row data ──────────────────────────
test("15. mapping conflict detected correctly, row health remains complete (data freshness test)", () => {
  const input = baselineInput();
  input.universe = okUniverse([mkConflictingUnderlying()]);
  const row = assembleScreenerV3Row(input);

  // Truthful mapping conflict fields
  assert.equal(row.identity.spotMappingStatus, "conflicting_keys");
  assert.equal(row.identity.optionStructureReady, false);
  assert.equal(row.metrics.mapping.status, "available");
  assert.ok(Array.isArray(row.metrics.mapping.value?.reasons));
  assert.ok(row.metrics.mapping.value?.reasons.some((r) => r.includes("spot mapping not resolved")));

  // Row health measures computation availability/freshness, NOT readiness
  assert.equal(row.health.status, "complete");
  assert.deepEqual(row.health.reasons, []);
});
