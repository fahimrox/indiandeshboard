// Screener V3 Phase 2A — pure row CONTRACT (types only, no IO, no formulas).
// Every foundational metric is a DataResult<T> so unavailable/stale/invalid
// states are explicit and a metric is NEVER coerced to 0 or dropped silently.
// This file defines the shape only; see row-assembler.ts for the pure builder.
import type { CandleInterval, Candle } from "./candles.ts";
import type { CandleSeries } from "./candles.server.ts";
import type { DataResult } from "./types.ts";
import type { FnoInstrumentUniverse, SpotMappingStatus } from "./instrument-types.ts";
import type { MappingStatus } from "./fno-universe.ts";
import type { ScreenerV3Derivatives } from "./derivatives-types.ts";
import type {
  VwapResult,
  SessionOhlc,
  OpeningRange,
  VolumeAcceleration,
} from "./features.ts";

// ── Identity ─────────────────────────────────────────────────────────────

/**
 * Extends the Phase 1 spot-mapping vocabulary with two Phase 2A-only states
 * that describe why a mapping lookup could not even be attempted (as opposed
 * to being attempted and structurally unresolved). Never added to
 * instrument-types.ts — this union is local to the row contract.
 */
export type RowSpotMappingStatus =
  | SpotMappingStatus
  | "universe_unavailable" // the F&O universe input itself was a failure
  | "not_in_universe"; // the universe was usable but had no matching underlying

export interface RowNearestFuture {
  instrumentKey: string;
  tradingSymbol: string;
  expiry: number; // epoch ms
  expiryDateIst: string;
  lotSize: number;
  weekly: boolean;
}

export interface RowIdentity {
  /** Canonical NSE symbol (normalizeNseSymbolKey form), e.g. "RELIANCE". */
  symbol: string;
  /** Explicit reference/as-of timestamp this row was assembled against. */
  referenceMs: number;
  /** Usable spot instrument key — non-null ONLY when mapping is coherently resolved. */
  spotInstrumentKey: string | null;
  /** Usable spot trading symbol — non-null ONLY when mapping is coherently resolved. */
  spotTradingSymbol: string | null;
  /** Nearest CURRENT future contract metadata at referenceMs, or null if none is mapped. */
  nearestFuture: RowNearestFuture | null;
  /** Raw spot-mapping status (see RowSpotMappingStatus doc above). */
  spotMappingStatus: RowSpotMappingStatus;
  /**
   * Definitive current readiness (a real boolean answer, not missing data):
   * true only when a genuine same-strike CE/PE pair exists in the nearest
   * current option expiry. `false` is a legitimate value here, distinct from
   * `metrics.mapping` being unavailable because the universe couldn't be read.
   */
  optionStructureReady: boolean;
}

// ── Metrics ──────────────────────────────────────────────────────────────

/** A genuinely completed candle's close — never a forming/in-progress bar. */
export interface LastCompletedPrice {
  price: number;
  /** Epoch ms of the completed candle's START time. */
  candleAt: number;
  /** Source candle interval ("1m"/"3m"/"5m" from intraday, or "1d" fallback). */
  interval: CandleInterval;
}

export interface RowMetrics {
  /** Last genuinely completed candle close (intraday if available, else the previous completed daily session). Never named "LTP". */
  lastCompleted: DataResult<LastCompletedPrice>;
  sessionVwap: DataResult<VwapResult>;
  /** (lastCompleted.price - sessionVwap.vwap) / sessionVwap.vwap * 100. */
  vwapDistancePct: DataResult<number>;
  atr14Daily: DataResult<number>;
  previousSessionOhlc: DataResult<SessionOhlc>;
  openingRange5: DataResult<OpeningRange>;
  openingRange15: DataResult<OpeningRange>;
  openingRange30: DataResult<OpeningRange>;
  return5m: DataResult<number>;
  return15m: DataResult<number>;
  return30m: DataResult<number>;
  rollingVolume20: DataResult<number>;
  rollingAvgVolume20: DataResult<number>;
  volumeAcceleration10: DataResult<VolumeAcceleration>;
  /** Full futures/option-structure mapping diagnostics (see fno-universe.getMappingStatus). */
  mapping: DataResult<MappingStatus>;
}

/** Fixed keys checked by row-health precedence, in deterministic order. */
export const ROW_HEALTH_CHECKED_METRICS = [
  "lastCompleted",
  "sessionVwap",
  "vwapDistancePct",
  "atr14Daily",
  "previousSessionOhlc",
  "openingRange5",
  "openingRange15",
  "openingRange30",
  "return5m",
  "return15m",
  "return30m",
  "rollingVolume20",
  "rollingAvgVolume20",
  "volumeAcceleration10",
  "mapping",
] as const satisfies ReadonlyArray<keyof RowMetrics>;

export type RowHealthStatus = "complete" | "partial" | "degraded" | "unavailable";

export interface RowHealth {
  status: RowHealthStatus;
  /**
   * Human-readable contributing reasons in the same deterministic order as
   * ROW_HEALTH_CHECKED_METRICS. Empty only when status is "complete".
   *
   * RowHealth represents data computation availability and freshness.
   * It does NOT mean futures/options readiness or trade eligibility.
   * A successfully detected mapping conflict may coexist with health.status === "complete"
   * because the conflict was truthfully reported through identity.spotMappingStatus,
   * identity.optionStructureReady, and metrics.mapping.value.reasons.
   * Consumers must read mapping status/readiness fields separately.
   */
  reasons: string[];
}

/**
 * Overall row-health precedence (checked top to bottom; first match wins):
 *
 *   1. UNAVAILABLE — `metrics.lastCompleted` itself is a failure. There is no
 *      truthful anchor price for this symbol at all, so the row cannot be
 *      considered even partially usable.
 *   2. DEGRADED     — none of the checked metrics are failures, but at least
 *      one checked metric (including lastCompleted) is "stale" (a real,
 *      usable value carried over from a stale input rather than fresh data).
 *   3. PARTIAL      — at least one checked metric is a failure status, but
 *      lastCompleted is usable (available or stale). One or more optional
 *      metrics (including a mapping conflict) failed without erasing the row.
 *   4. COMPLETE     — every checked metric is "available" (no stale, no
 *      failures).
 *
 * This function lives in row-assembler.ts; documented here alongside the
 * contract it evaluates.
 */
export type RowHealthPrecedenceDoc = never;

/**
 * Compile-time guard: ensures ROW_HEALTH_CHECKED_METRICS lists every key of RowMetrics.
 * If a new metric is added to RowMetrics but not to ROW_HEALTH_CHECKED_METRICS, TS will error.
 */
type AssertNever<T extends never> = T;
type _HealthCheckExhaustive = AssertNever<
  Exclude<keyof RowMetrics, (typeof ROW_HEALTH_CHECKED_METRICS)[number]>
>;

export interface ScreenerV3Row {
  identity: RowIdentity;
  metrics: RowMetrics;
  health: RowHealth;
  /**
   * OPTIONAL, ADDITIVE derivatives enrichment (Phase 2B Part 4). Present ONLY
   * when derivatives enrichment was requested AND the top-level enrichment for
   * this row was usable (available or stale). It is intentionally ABSENT (never
   * `null`, never a fabricated object) when enrichment is off or the top-level
   * enrichment failed — so default plain API JSON stays byte-for-byte
   * backward-compatible.
   *
   * This is a SEPARATE availability envelope from the base-row `health` and the
   * spot `metrics`: derivatives data has its own per-leg DataResults, its own
   * `health`, and its own provider sources/timestamps/session states. Reuses the
   * Phase 2B Part 1 `ScreenerV3Derivatives` contract verbatim; never redefined.
   */
  derivatives?: ScreenerV3Derivatives;
}

// ── Assembler input contract ────────────────────────────────────────────

export interface RowAssemblyInput {
  /** Canonical or raw NSE symbol; normalized internally via normalizeNseSymbolKey. */
  symbol: string;
  /** Explicit as-of timestamp (epoch ms). Required — the assembler never reads the clock. */
  referenceMs: number;
  /** Already-fetched F&O universe result (shared across a batch; not fetched here). */
  universe: DataResult<FnoInstrumentUniverse>;
  /** Already-fetched 1-minute spot candle series result. */
  intraday: DataResult<CandleSeries>;
  /** Already-fetched 1-day spot candle series result. */
  daily: DataResult<CandleSeries>;
}

// Re-exported for convenience so callers building CandleSeries fixtures for
// tests don't need a separate import from candles.server.ts.
export type { CandleSeries, Candle };
