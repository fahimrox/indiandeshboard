// Screener V3 Phase 2A Part 2 — isolated batch orchestration (SERVER ONLY).
// Wires together, but never reimplements, the Phase 1 / Phase 2A Part 1
// foundation: loads the F&O universe once, normalizes/dedupes symbols,
// fetches intraday+daily candles through a bounded-concurrency, cached
// candle layer, and calls assembleScreenerV3Row for every accepted symbol.
//
// No API route, no UI, no scheduler, no DB/Supabase work happens here.
// The orchestration core never reads the machine clock — every freshness/
// completion decision is driven by the caller's explicit `referenceMs`.
import type { SpotInterval, CandleSeries } from "./candles.server.ts";
import { fetchSpotCandles } from "./candles.server.ts";
import { getStockFnoUniverse } from "./instrument-master.server.ts";
import { normalizeNseSymbolKey } from "./fno-universe.ts";
import type { FnoInstrumentUniverse } from "./instrument-types.ts";
import { assembleScreenerV3Row } from "./row-assembler.ts";
import type { ScreenerV3Row } from "./row-types.ts";
import { invalidInput, isFailure, propagateFailure, type DataResult, ok } from "./types.ts";
import {
  assertValidCachePolicy,
  buildCandleCacheKey,
  createCandleCache,
  defaultCandleCache,
  type CandleCache,
  type CandleCachePolicy,
} from "./candle-cache.server.ts";
import type {
  RejectedSymbol,
  ScreenerV3Batch,
  ScreenerV3BatchHealthSummary,
  ScreenerV3BatchInput,
  ScreenerV3BatchResult,
} from "./batch-types.ts";

// ── Verified candle fetch plan (see candles.server.ts ALLOWED_RANGES) ───────
// Intraday: 1m/1d gives the full current session's 1-minute candles, which is
// all that lastCompleted/sessionVwap/openingRange(5/15/30)/return(5/15/30m)/
// rollingVolume/volumeAcceleration ever need (all session-scoped features).
// Daily: 1d/3mo (~63 trading sessions) comfortably covers ATR(14)'s 15-candle
// minimum plus previous-session OHLC, with buffer for holiday gaps or a
// handful of quarantined duplicate-trading-date candles — without fetching
// unnecessary history.
export const INTRADAY_INTERVAL: SpotInterval = "1m";
export const INTRADAY_RANGE = "1d";
export const DAILY_INTERVAL: SpotInterval = "1d";
export const DAILY_RANGE = "3mo";

// ── Cache policy defaults ────────────────────────────────────────────────
// Intraday candles advance every minute; a 60s fresh window matches that
// cadence, and a 15-minute max-stale tolerates a brief provider hiccup
// without serving a badly outdated snapshot.
export const DEFAULT_INTRADAY_CACHE_POLICY: CandleCachePolicy = {
  freshMs: 60_000,
  maxStaleMs: 15 * 60_000,
};
// Daily candles advance once per session; a 30-minute fresh window avoids
// redundant re-fetches within one batch run, and a 24h max-stale tolerates a
// single missed refresh without presenting genuinely old data as current.
export const DEFAULT_DAILY_CACHE_POLICY: CandleCachePolicy = {
  freshMs: 30 * 60_000,
  maxStaleMs: 24 * 60 * 60_000,
};

// ── Bounded global concurrency ───────────────────────────────────────────
export const DEFAULT_CONCURRENCY = 4;
export const MAX_CONCURRENCY = 32;

export function isValidConcurrency(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= MAX_CONCURRENCY;
}

interface ConcurrencyLimiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Deterministic FIFO concurrency limiter. At most `limit` `fn` invocations
 * are in flight at once; additional callers queue and are resumed in the
 * order they arrived. No timers, no machine-clock reads.
 */
function createConcurrencyLimiter(limit: number): ConcurrencyLimiter {
  let active = 0;
  const queue: Array<() => void> = [];

  function release(): void {
    active--;
    const resume = queue.shift();
    if (resume) resume();
  }

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return { run };
}

// ── Dependency injection ─────────────────────────────────────────────────

export interface RowOrchestratorDeps {
  loadUniverse: (opts?: { forceRefresh?: boolean }) => Promise<DataResult<FnoInstrumentUniverse>>;
  fetchCandles: (
    symbol: string,
    interval: SpotInterval,
    opts: { range?: string; nowMs?: number },
  ) => Promise<DataResult<CandleSeries>>;
  /** Optional injected cache instance (defaults to the shared process-local cache). */
  cache?: CandleCache;
}

/** Production defaults wrapping the existing Phase 1 foundation, unmodified. */
export function createDefaultRowOrchestratorDeps(): RowOrchestratorDeps {
  return {
    loadUniverse: (opts) => getStockFnoUniverse(opts),
    fetchCandles: (symbol, interval, opts) => fetchSpotCandles(symbol, interval, opts),
    cache: defaultCandleCache,
  };
}

// ── Symbol normalization / selection ─────────────────────────────────────

interface SymbolSelection {
  accepted: string[]; // deterministic first-seen order, normalized, deduped
  rejected: RejectedSymbol[];
}

/** Trims, normalizes, rejects unsafe/blank input, and dedupes preserving first-seen order. */
function normalizeExplicitSymbols(symbols: readonly string[]): SymbolSelection {
  const accepted: string[] = [];
  const rejected: RejectedSymbol[] = [];
  const seen = new Set<string>();
  for (const raw of symbols) {
    const trimmed = (raw ?? "").trim();
    const normalized = normalizeNseSymbolKey(trimmed);
    if (!normalized) {
      rejected.push({
        input: raw,
        reason: trimmed ? `unsafe or unsupported NSE symbol: "${trimmed}"` : "blank symbol",
      });
      continue;
    }
    if (seen.has(normalized)) continue; // duplicate after normalization -> silently deduped
    seen.add(normalized);
    accepted.push(normalized);
  }
  return { accepted, rejected };
}

/**
 * Derives symbols from the current stock F&O universe. The universe's
 * `underlyings` array already excludes index-only symbols and is in a
 * deterministic (symbol-sorted) order; this defensively re-validates and
 * dedupes rather than assuming that invariant holds for an injected fake.
 */
function deriveSymbolsFromUniverse(universe: FnoInstrumentUniverse, limit: number | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of universe.underlyings) {
    const normalized = normalizeNseSymbolKey(u.normalizedSymbol ?? u.symbol);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (limit !== undefined && out.length >= limit) break;
  }
  return out;
}

// ── Batch orchestration ───────────────────────────────────────────────────

export async function runScreenerV3Batch(
  input: ScreenerV3BatchInput,
  deps: RowOrchestratorDeps = createDefaultRowOrchestratorDeps(),
): Promise<ScreenerV3BatchResult> {
  const { referenceMs } = input;
  if (!Number.isFinite(referenceMs) || referenceMs <= 0) {
    return invalidInput("referenceMs must be a finite positive epoch ms", { source: "row-orchestrator" });
  }

  const concurrency = input.concurrency ?? DEFAULT_CONCURRENCY;
  if (!isValidConcurrency(concurrency)) {
    return invalidInput(
      `concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`,
      { source: "row-orchestrator" },
    );
  }

  let limit: number | undefined;
  if (input.limit !== undefined) {
    if (!Number.isInteger(input.limit) || input.limit <= 0) {
      return invalidInput("limit must be a positive integer", { source: "row-orchestrator" });
    }
    limit = input.limit;
  }

  let intradayPolicy: CandleCachePolicy;
  let dailyPolicy: CandleCachePolicy;
  try {
    intradayPolicy = { ...DEFAULT_INTRADAY_CACHE_POLICY, ...input.cachePolicy?.intraday };
    dailyPolicy = { ...DEFAULT_DAILY_CACHE_POLICY, ...input.cachePolicy?.daily };
    assertValidCachePolicy(intradayPolicy);
    assertValidCachePolicy(dailyPolicy);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return invalidInput(`invalid cache policy: ${reason}`, { source: "row-orchestrator" });
  }

  const cache = deps.cache ?? createCandleCache();
  const limiter = createConcurrencyLimiter(concurrency);

  // Universe is loaded exactly ONCE per batch, regardless of symbol source,
  // because every row (explicit or derived) shares the same universe result.
  const universeResult = await deps.loadUniverse({});

  const explicitSymbols = input.symbols;
  let requestedCount: number;
  let accepted: string[];
  const rejected: RejectedSymbol[] = [];

  if (explicitSymbols !== undefined) {
    requestedCount = explicitSymbols.length;
    const selection = normalizeExplicitSymbols(explicitSymbols);
    accepted = selection.accepted;
    rejected.push(...selection.rejected);
    // A universe failure does NOT block explicit-symbol rows; it is passed
    // through to assembleScreenerV3Row per row, truthfully, below.
  } else {
    if (isFailure(universeResult)) {
      // Preserve the universe's actual failure status/reason rather than
      // relabeling it — a truthful top-level failure, not an invented one.
      return propagateFailure(universeResult);
    }
    accepted = deriveSymbolsFromUniverse(universeResult.value, limit);
    requestedCount = universeResult.value.underlyings.length;
  }

  if (accepted.length === 0) {
    return invalidInput(
      explicitSymbols !== undefined
        ? "no valid symbols after validation (all requested symbols were rejected or empty)"
        : "no valid symbols available from the F&O universe",
      { source: "row-orchestrator" },
    );
  }

  const cacheCounts = { freshHits: 0, providerRefreshes: 0, staleFallbacks: 0 };
  let providerFailureCount = 0;

  async function fetchViaCache(
    symbol: string,
    interval: SpotInterval,
    range: string,
    policy: CandleCachePolicy,
  ): Promise<DataResult<CandleSeries>> {
    const key = buildCandleCacheKey(symbol, interval, range);
    const outcome = await cache.getOrFetch(key, referenceMs, policy, () =>
      limiter.run(() => deps.fetchCandles(symbol, interval, { range, nowMs: referenceMs })),
    );
    switch (outcome.event) {
      case "fresh-hit":
        cacheCounts.freshHits++;
        break;
      case "provider-refresh":
        cacheCounts.providerRefreshes++;
        break;
      case "stale-fallback":
        cacheCounts.staleFallbacks++;
        providerFailureCount++;
        break;
      case "provider-failure":
        providerFailureCount++;
        break;
    }
    return outcome.result;
  }

  // One symbol's failure (candle fetch, or an unexpected internal error) must
  // never cancel row-building for unrelated symbols -> allSettled, not all.
  const settled = await Promise.allSettled(
    accepted.map(async (symbol) => {
      const [intraday, daily] = await Promise.all([
        fetchViaCache(symbol, INTRADAY_INTERVAL, INTRADAY_RANGE, intradayPolicy),
        fetchViaCache(symbol, DAILY_INTERVAL, DAILY_RANGE, dailyPolicy),
      ]);
      return assembleScreenerV3Row({ symbol, referenceMs, universe: universeResult, intraday, daily });
    }),
  );

  const rows: ScreenerV3Row[] = [];
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    if (outcome.status === "fulfilled") {
      rows.push(outcome.value);
    } else {
      const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      rejected.push({ input: accepted[i], reason: `internal error while building row: ${reason}` });
    }
  }

  if (rows.length === 0) {
    return invalidInput(
      "internal invariant failure: no rows could be constructed for any accepted symbol",
      { source: "row-orchestrator" },
    );
  }

  const health: ScreenerV3BatchHealthSummary = { complete: 0, degraded: 0, partial: 0, unavailable: 0 };
  for (const row of rows) health[row.health.status]++;

  const batch: ScreenerV3Batch = {
    referenceMs,
    requestedCount,
    acceptedSymbolCount: rows.length,
    rejectedSymbols: rejected,
    rows,
    universeStatus: universeResult.status,
    universeReason: isFailure(universeResult) ? universeResult.reason : undefined,
    health,
    cache: cacheCounts,
    providerFailureCount,
  };

  return ok(batch, { source: "row-orchestrator", timestamp: referenceMs });
}
