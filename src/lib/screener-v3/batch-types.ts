// Screener V3 Phase 2A Part 2 — batch orchestration CONTRACT (types only).
// No IO, no formulas. Mirrors the truthful-availability vocabulary already
// established by DataResult<T> (types.ts) and ScreenerV3Row (row-types.ts).
// The orchestrator itself lives in row-orchestrator.server.ts.
import type { DataResult, DataStatus } from "./types.ts";
import type { ScreenerV3Row } from "./row-types.ts";
import type { CandleCachePolicy } from "./candle-cache.server.ts";

// ── Cache policy overrides (partial — merged onto conservative defaults) ────

export interface ScreenerV3BatchCachePolicyOverride {
  intraday?: Partial<CandleCachePolicy>;
  daily?: Partial<CandleCachePolicy>;
}

// ── Batch input ──────────────────────────────────────────────────────────

export interface ScreenerV3BatchInput {
  /**
   * Explicit as-of timestamp (epoch ms). Required. Used consistently for row
   * assembly, cache age, cache expiry, and freshness. The orchestration core
   * never reads the machine clock.
   */
  referenceMs: number;
  /**
   * Explicit symbols to build rows for. When omitted, the batch derives its
   * symbol list from the current stock F&O universe (index underlyings are
   * never included — the universe already excludes them).
   */
  symbols?: string[];
  /**
   * Maximum number of symbols to derive from the universe when `symbols` is
   * omitted. Ignored when `symbols` is explicitly provided. Must be a
   * positive integer when given.
   */
  limit?: number;
  /**
   * Global bound on concurrent provider candle calls for this batch. Must be
   * a positive integer within DEFAULT/MAX bounds (see row-orchestrator).
   * Defaults to a conservative value (4) when omitted.
   */
  concurrency?: number;
  /** Optional partial overrides merged onto the conservative default policies. */
  cachePolicy?: ScreenerV3BatchCachePolicyOverride;
}

// ── Batch output ─────────────────────────────────────────────────────────

export interface RejectedSymbol {
  /** The raw input token that was rejected (as supplied by the caller). */
  input: string;
  /** Truthful, human-readable rejection reason. */
  reason: string;
}

export interface ScreenerV3BatchHealthSummary {
  complete: number;
  degraded: number;
  partial: number;
  unavailable: number;
}

export interface ScreenerV3BatchCacheSummary {
  /** Cache hits within the fresh TTL — zero provider calls made. */
  freshHits: number;
  /** Provider calls that succeeded (cold miss or expired-entry refresh). */
  providerRefreshes: number;
  /** Provider calls that failed but a usable last-good value was served stale. */
  staleFallbacks: number;
}

export interface ScreenerV3Batch {
  /** The explicit referenceMs this batch was assembled against. */
  referenceMs: number;
  /** Count of symbols requested (explicit array length, or derived-before-limit count when omitted). */
  requestedCount: number;
  /** Count of distinct, normalized, valid symbols actually used to build rows. */
  acceptedSymbolCount: number;
  /** Symbols rejected during normalization/validation, with truthful reasons. */
  rejectedSymbols: RejectedSymbol[];
  /** One row per accepted symbol, in deterministic first-seen/universe order. */
  rows: ScreenerV3Row[];
  /** Status of the shared F&O universe DataResult used to build every row. */
  universeStatus: DataStatus;
  /** Present only when universeStatus is a failure status. */
  universeReason?: string;
  /** Row-health counts; must sum to rows.length. */
  health: ScreenerV3BatchHealthSummary;
  /** Candle-cache behavior counts across every unique symbol+interval+range key touched. */
  cache: ScreenerV3BatchCacheSummary;
  /**
   * Count of provider candle-fetch attempts that failed (whether or not a
   * stale fallback ultimately made the row usable). Distinct from row health,
   * which reflects what the row ended up with, not provider call outcomes.
   */
  providerFailureCount: number;
}

/**
 * Top-level result. A partial batch with some symbol/provider failures is
 * still `"available"` as long as at least one truthful row was produced.
 * Reserved failure cases: invalid orchestration input, no valid symbols
 * after validation, omitted symbols with an unusable universe, or an
 * internal invariant failure that prevents building any row at all.
 */
export type ScreenerV3BatchResult = DataResult<ScreenerV3Batch>;
