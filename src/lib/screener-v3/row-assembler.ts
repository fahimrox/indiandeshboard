// Screener V3 Phase 2A — PURE row assembler.
// No IO, no Date.now(), no DB, no scheduler, no network. Accepts already-
// fetched Phase 1 data plus an explicit referenceMs and produces one truthful
// ScreenerV3Row. Reuses Phase 1 feature/candle/fno-universe functions instead
// of reimplementing their math. Never mutates caller-owned inputs.
import type { Candle } from "./candles.ts";
import { dedupeSortStrict, isValidCandleShape } from "./candles.ts";
import type { CandleSeries } from "./candles.server.ts";
import {
  isFailure,
  isUsable,
  ok,
  stale,
  unavailable,
  invalidInput,
  propagateFailure,
  type DataResult,
} from "./types.ts";
import {
  sessionVwap,
  atr,
  previousSessionOhlc,
  openingRange,
  returnWindow,
  rollingVolumeSum,
  rollingAvgVolume,
  volumeAcceleration,
} from "./features.ts";
import {
  normalizeNseSymbolKey,
  findUnderlying,
  getMappingStatus,
  resolveNearestFuture,
  resolveSpotInstrumentKey,
  type MappingStatus,
} from "./fno-universe.ts";
import type { FnoInstrumentUniverse } from "./instrument-types.ts";
import {
  ROW_HEALTH_CHECKED_METRICS,
  type LastCompletedPrice,
  type RowAssemblyInput,
  type RowHealth,
  type RowHealthStatus,
  type RowIdentity,
  type RowMetrics,
  type RowNearestFuture,
  type RowSpotMappingStatus,
  type ScreenerV3Row,
} from "./row-types.ts";

// ── Candle-completion helper (intraday) ─────────────────────────────────────
// Intentionally NOT reusing features.ts's private `completedOnly`/`cleanIntraday`
// (unexported) — this is plumbing to pick the last completed candle, not a
// formula, so it is written locally against the exported candle primitives.
const INTRADAY_INTERVAL_MINUTES: Record<string, number> = { "1m": 1, "3m": 3, "5m": 5 };

function lastCompletedIntradayCandle(
  candles: Candle[],
  referenceMs: number,
): DataResult<LastCompletedPrice> {
  if (candles.length === 0) return unavailable("no intraday candles", { source: "candles" });
  const dd = dedupeSortStrict(candles);
  if (dd.conflictingTimestamps.length > 0) {
    return invalidInput(
      `conflicting duplicate intraday timestamps (${dd.conflictingTimestamps.length})`,
      { source: "candles" },
    );
  }
  const series = dd.candles;
  const iv = series[0].interval;
  const ivMin = INTRADAY_INTERVAL_MINUTES[iv];
  if (ivMin === undefined) {
    return invalidInput(`unsupported intraday interval "${iv}"`, { source: "candles" });
  }
  if (!series.every((c) => c.interval === iv)) {
    return invalidInput("mixed candle intervals in intraday series", { source: "candles" });
  }
  for (const c of series) {
    if (!isValidCandleShape(c)) return invalidInput("invalid candle shape", { source: "candles" });
  }
  const completed = series.filter((c) => c.timestamp + ivMin * 60_000 <= referenceMs);
  const last = completed[completed.length - 1];
  if (!last) return unavailable("no completed intraday candle at referenceMs", { source: "candles" });
  return ok(
    { price: last.close, candleAt: last.timestamp, interval: iv },
    { source: "candles", timestamp: last.timestamp },
  );
}

// ── Generic propagation helper: apply a Phase-1 feature fn over an injected
//    CandleSeries DataResult, downgrading the result to "stale" when the
//    input series itself was stale (never upgrades a failure into a value).
function fromSeries<T>(
  series: DataResult<CandleSeries>,
  compute: (candles: Candle[]) => DataResult<T>,
): DataResult<T> {
  if (isFailure(series)) return propagateFailure(series);
  const computed = compute(series.value.candles);
  if (isFailure(computed)) return computed;
  if (series.status === "stale" && computed.status !== "stale") {
    return stale(computed.value, { source: computed.source, timestamp: computed.timestamp, reason: computed.reason });
  }
  return computed;
}

// ── Last completed price: prefer the most recent completed INTRADAY candle;
//    fall back to the previous completed DAILY session close when intraday
//    data is unusable or has no completed candle yet (e.g. pre-open).
function computeLastCompleted(
  intraday: DataResult<CandleSeries>,
  daily: DataResult<CandleSeries>,
  referenceMs: number,
): DataResult<LastCompletedPrice> {
  let intradayAttempt: DataResult<LastCompletedPrice> | null = null;
  if (isUsable(intraday)) {
    intradayAttempt = lastCompletedIntradayCandle(intraday.value.candles, referenceMs);
    if (isUsable(intradayAttempt)) {
      const val = intradayAttempt.value;
      const staleInput = intraday.status === "stale" || intradayAttempt.status === "stale";
      return staleInput
        ? stale(val, { source: "candles", timestamp: val.candleAt })
        : ok(val, { source: "candles", timestamp: val.candleAt });
    }
  }

  if (isUsable(daily)) {
    const prev = previousSessionOhlc(daily.value.candles, referenceMs);
    if (isUsable(prev)) {
      const val: LastCompletedPrice = {
        price: prev.value.close,
        candleAt: prev.timestamp ?? 0,
        interval: "1d",
      };
      const staleInput = daily.status === "stale" || prev.status === "stale";
      return staleInput
        ? stale(val, { source: "candles", timestamp: val.candleAt })
        : ok(val, { source: "candles", timestamp: val.candleAt });
    }
    // Daily fallback also failed — prefer the intraday attempt's reason when
    // one exists (it was the primary path), else the daily failure.
    if (intradayAttempt && isFailure(intradayAttempt)) return propagateFailure(intradayAttempt);
    return propagateFailure(prev);
  }

  if (intradayAttempt && isFailure(intradayAttempt)) return propagateFailure(intradayAttempt);
  if (isFailure(intraday)) return propagateFailure(intraday);
  if (isFailure(daily)) return propagateFailure(daily);
  return unavailable("no usable intraday or daily candle data for last completed price", { source: "candles" });
}

// ── VWAP distance: derived from two already-computed metrics (not a series). ─
function computeVwapDistancePct(
  lastCompleted: DataResult<LastCompletedPrice>,
  vwap: DataResult<{ vwap: number }>,
): DataResult<number> {
  if (isFailure(lastCompleted)) return propagateFailure(lastCompleted);
  if (isFailure(vwap)) return propagateFailure(vwap);
  const price = lastCompleted.value.price;
  const v = vwap.value.vwap;
  if (v === 0) return unavailable("session VWAP is zero", { source: "candles" });
  const pct = ((price - v) / v) * 100;
  const staleInput = lastCompleted.status === "stale" || vwap.status === "stale";
  return staleInput ? stale(pct, { source: "candles" }) : ok(pct, { source: "candles" });
}

// ── Mapping (futures/option-structure) ──────────────────────────────────────
function computeMapping(
  universe: DataResult<FnoInstrumentUniverse>,
  symbol: string,
  referenceMs: number,
): DataResult<MappingStatus> {
  if (isFailure(universe)) return propagateFailure(universe);
  const status = getMappingStatus(universe.value, symbol, { nowMs: referenceMs });
  if (!status) {
    return unavailable(`symbol "${symbol}" not found in F&O universe`, { source: "fno-universe" });
  }
  return universe.status === "stale"
    ? stale(status, { source: "fno-universe" })
    : ok(status, { source: "fno-universe" });
}

// ── Identity ─────────────────────────────────────────────────────────────
function computeIdentity(
  symbol: string,
  referenceMs: number,
  universe: DataResult<FnoInstrumentUniverse>,
  mapping: DataResult<MappingStatus>,
): RowIdentity {
  let spotInstrumentKey: string | null = null;
  let spotTradingSymbol: string | null = null;
  let nearestFuture: RowNearestFuture | null = null;
  let spotMappingStatus: RowSpotMappingStatus;
  let optionStructureReady = false;

  if (isFailure(universe)) {
    spotMappingStatus = "universe_unavailable";
  } else if (isFailure(mapping)) {
    spotMappingStatus = "not_in_universe";
  } else {
    spotMappingStatus = mapping.value.spotMappingStatus;
    optionStructureReady = mapping.value.optionStructureReady;

    // resolveSpotInstrumentKey defensively rejects contradictory manually
    // built underlying records (e.g. resolved status + null key) — reused
    // as-is rather than re-implemented here.
    spotInstrumentKey = resolveSpotInstrumentKey(universe.value, symbol);
    if (spotInstrumentKey) {
      const u = findUnderlying(universe.value, symbol);
      spotTradingSymbol = u?.spotTradingSymbol ?? null;
    }

    const fut = resolveNearestFuture(universe.value, symbol, { nowMs: referenceMs });
    nearestFuture = fut
      ? {
          instrumentKey: fut.instrumentKey,
          tradingSymbol: fut.tradingSymbol,
          expiry: fut.expiry,
          expiryDateIst: fut.expiryDateIst,
          lotSize: fut.lotSize,
          weekly: fut.weekly,
        }
      : null;
  }

  return {
    symbol,
    referenceMs,
    spotInstrumentKey,
    spotTradingSymbol,
    nearestFuture,
    spotMappingStatus,
    optionStructureReady,
  };
}

// ── Overall row-health precedence ───────────────────────────────────────────
// See row-types.ts for the documented precedence. Implemented here as:
//   1. lastCompleted is a failure -> "unavailable" (no truthful anchor price)
//   2. any OTHER checked metric is a failure -> "partial"
//   3. no failures, but some checked metric is "stale" -> "degraded"
//   4. every checked metric is "available" -> "complete"
export function computeRowHealth(metrics: RowMetrics): RowHealth {
  const reasons: string[] = [];
  let anyFailure = false;
  let anyStale = false;
  let lastCompletedFailed = false;

  for (const key of ROW_HEALTH_CHECKED_METRICS) {
    // Indexing by a union of keys yields a union of DataResult<T> across
    // different T's; isFailure<T>'s generic cannot be inferred uniquely from
    // that union, so the shared discriminant ("status") is checked directly
    // instead of calling the generic narrowing helper.
    const r = metrics[key];
    if (r.status === "available") continue;
    if (r.status === "stale") {
      anyStale = true;
      reasons.push(`${key}: stale${r.reason ? ` - ${r.reason}` : ""}`);
      continue;
    }
    anyFailure = true;
    if (key === "lastCompleted") lastCompletedFailed = true;
    reasons.push(`${key}: ${r.status} - ${r.reason}`);
  }

  let status: RowHealthStatus;
  if (lastCompletedFailed) status = "unavailable";
  else if (anyFailure) status = "partial";
  else if (anyStale) status = "degraded";
  else status = "complete";

  return { status, reasons: status === "complete" ? [] : reasons };
}

// ── Public entry point ──────────────────────────────────────────────────────
/**
 * Deterministically assemble one Screener V3 row from already-fetched Phase 1
 * data. Pure: no network, no DB, no scheduler, no Date.now(). Never mutates
 * `input.universe` / `input.intraday` / `input.daily` or their nested arrays.
 */
export function assembleScreenerV3Row(input: RowAssemblyInput): ScreenerV3Row {
  const { referenceMs } = input;
  if (!Number.isFinite(referenceMs) || referenceMs <= 0) {
    throw new Error("assembleScreenerV3Row: referenceMs must be a finite positive epoch ms");
  }

  const symbol = normalizeNseSymbolKey(input.symbol) ?? input.symbol.trim().toUpperCase();

  const mapping = computeMapping(input.universe, symbol, referenceMs);
  const identity = computeIdentity(symbol, referenceMs, input.universe, mapping);

  const lastCompleted = computeLastCompleted(input.intraday, input.daily, referenceMs);
  const sessionVwapResult = fromSeries(input.intraday, (c) => sessionVwap(c, { referenceMs }));
  const vwapDistancePct = computeVwapDistancePct(lastCompleted, sessionVwapResult);
  const atr14Daily = fromSeries(input.daily, (c) => atr(c, 14));
  const previousSessionOhlcResult = fromSeries(input.daily, (c) => previousSessionOhlc(c, referenceMs));
  const openingRange5 = fromSeries(input.intraday, (c) => openingRange(c, 5, { referenceMs }));
  const openingRange15 = fromSeries(input.intraday, (c) => openingRange(c, 15, { referenceMs }));
  const openingRange30 = fromSeries(input.intraday, (c) => openingRange(c, 30, { referenceMs }));
  const return5m = fromSeries(input.intraday, (c) => returnWindow(c, 5, { referenceMs }));
  const return15m = fromSeries(input.intraday, (c) => returnWindow(c, 15, { referenceMs }));
  const return30m = fromSeries(input.intraday, (c) => returnWindow(c, 30, { referenceMs }));
  const rollingVolume20 = fromSeries(input.intraday, (c) => rollingVolumeSum(c, 20, { referenceMs }));
  const rollingAvgVolume20 = fromSeries(input.intraday, (c) => rollingAvgVolume(c, 20, { referenceMs }));
  const volumeAcceleration10 = fromSeries(input.intraday, (c) => volumeAcceleration(c, 10, { referenceMs }));

  const metrics: RowMetrics = {
    lastCompleted,
    sessionVwap: sessionVwapResult,
    vwapDistancePct,
    atr14Daily,
    previousSessionOhlc: previousSessionOhlcResult,
    openingRange5,
    openingRange15,
    openingRange30,
    return5m,
    return15m,
    return30m,
    rollingVolume20,
    rollingAvgVolume20,
    volumeAcceleration10,
    mapping,
  };

  const health = computeRowHealth(metrics);

  return { identity, metrics, health };
}
