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
import { invalidInput, isFailure, isUsable, propagateFailure, type DataResult, ok } from "./types.ts";
import type { ScreenerV3Derivatives } from "./derivatives-types.ts";
import type { DerivativesEnrichmentRequest } from "./derivatives-orchestrator.server.ts";
import {
  createDerivativesOrchestrator,
  type DerivativesOrchestrator,
  type DerivativesOrchestratorPolicy,
} from "./derivatives-orchestrator.server.ts";
import { createDerivativesCache, type DerivativesCachePolicy } from "./derivatives-cache.server.ts";
import { createUpstoxDerivativesProvider } from "./derivatives-provider.server.ts";
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
  ScreenerV3BatchResult,
} from "./batch-types.ts";
// Type-only import of the API-boundary run input (base ScreenerV3BatchInput plus
// the additive Part 4 enrichment flag). `import type` is fully erased at compile
// time, so this adds no runtime dependency and no client-bundle coupling.
import type { ScreenerV3RequestInput } from "./api-request.ts";

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

// ── Server-owned derivatives enrichment policy (Phase 2B Part 4) ───────────
// Every value here is SERVER-OWNED and NEVER caller-overridable. The public API
// exposes only a boolean toggle (`include=derivatives`); no query parameter can
// change any of these, the reference time, the provider, or the access token.

/**
 * Reduced server-side cap on how many symbols a single ENRICHED batch will
 * process. Plain (non-enriched) batches keep their existing limit behaviour.
 * Rationale for 25: each enriched symbol resolves at most one CE + one PE
 * option leg (2 contracts). At 25 symbols that is exactly MAX_OPTION_GREEK_BATCH
 * (50) — one Greek provider call — and well within MAX_FUTURES_BATCH (500). This
 * is the most conservative bound derived from the existing Part 2 provider
 * constraints, keeping the (currently unauthenticated) enriched path bounded.
 * Applied CONSISTENTLY to explicit-symbol and universe-derived requests.
 */
export const ENRICHED_MAX_SYMBOLS = 25;

/** Bounded, process-local derivatives cache policy (server-owned). */
export const DEFAULT_DERIVATIVES_CACHE_POLICY: DerivativesCachePolicy = {
  freshTtlMs: 30_000, // 30s: derivatives quotes/greeks refresh cadence
  staleTtlMs: 5 * 60_000, // 5min: tolerate a brief provider hiccup as stale
  unavailableTtlMs: 60_000, // 1min: avoid hammering a truly-absent contract
  maxEntries: 2_000, // bounded process-local footprint (never unbounded)
};

/** Server-owned derivatives orchestrator policy (chain overlay stays off by default). */
export const DEFAULT_DERIVATIVES_ORCH_POLICY: DerivativesOrchestratorPolicy = {
  // The row orchestrator does not opt any request into the option-chain overlay
  // (Greek V3 is the broad default source), so this cap is a defensive ceiling.
  maxOptionChainRequestsPerBatch: 10,
  optionChainConcurrency: 4,
  cachePolicy: DEFAULT_DERIVATIVES_CACHE_POLICY,
};

// Process-local singletons: the derivatives cache MUST persist across API
// requests (Part 3 TTL / single-flight semantics rely on it) and must NEVER be
// rebuilt per row or per request. Constructed lazily so importing this module
// performs no work and no network call happens until an enriched request runs.
let sharedDerivativesOrchestrator: DerivativesOrchestrator | null = null;
function getSharedDerivativesOrchestrator(): DerivativesOrchestrator {
  if (!sharedDerivativesOrchestrator) {
    const provider = createUpstoxDerivativesProvider();
    const cache = createDerivativesCache(DEFAULT_DERIVATIVES_CACHE_POLICY);
    sharedDerivativesOrchestrator = createDerivativesOrchestrator(
      { provider, cache },
      DEFAULT_DERIVATIVES_ORCH_POLICY,
    );
  }
  return sharedDerivativesOrchestrator;
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
  /**
   * Optional derivatives enrichment entry point (Phase 2B Part 4). Signature
   * matches the Part 3 `DerivativesOrchestrator.enrichBatch`. Defaults to the
   * shared process-local derivatives orchestrator. Injected as a fake in tests.
   * Absent/omitted means enrichment is unavailable and rows stay plain.
   */
  enrichDerivatives?: (input: {
    universe: DataResult<FnoInstrumentUniverse>;
    requests: readonly DerivativesEnrichmentRequest[];
    referenceMs: number;
  }) => Promise<ReadonlyMap<string, DataResult<ScreenerV3Derivatives>>>;
}

/** Production defaults wrapping the existing Phase 1 foundation, unmodified. */
export function createDefaultRowOrchestratorDeps(): RowOrchestratorDeps {
  return {
    loadUniverse: (opts) => getStockFnoUniverse(opts),
    fetchCandles: (symbol, interval, opts) => fetchSpotCandles(symbol, interval, opts),
    cache: defaultCandleCache,
    enrichDerivatives: (input) => getSharedDerivativesOrchestrator().enrichBatch(input),
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
  input: ScreenerV3RequestInput,
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

  // Enriched mode applies a REDUCED, server-owned symbol cap consistently to
  // both explicit and universe-derived requests. Truncation preserves the
  // existing deterministic order; dropped symbols are recorded truthfully in
  // `rejectedSymbols` so nothing is silently processed beyond the cap and
  // nothing beyond the cap is silently discarded. The cap is NOT
  // caller-overridable by any query parameter.
  if (input.includeDerivatives === true && accepted.length > ENRICHED_MAX_SYMBOLS) {
    for (const dropped of accepted.slice(ENRICHED_MAX_SYMBOLS)) {
      rejected.push({
        input: dropped,
        reason: `enriched batch capped at ${ENRICHED_MAX_SYMBOLS} symbols; not processed`,
      });
    }
    accepted = accepted.slice(0, ENRICHED_MAX_SYMBOLS);
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

  // ── Additive derivatives enrichment (Phase 2B Part 4) ────────────────────
  // Only runs when enrichment is enabled AND a dependency is wired. Reuses the
  // ALREADY-loaded `universeResult` (no extra universe load), issues exactly ONE
  // batched `enrichBatch` call (never one provider task per row), and relies on
  // the Part 3 cache/batching/single-flight/concurrency implementation. A
  // derivatives failure never discards a base row or another symbol; only a
  // usable (available/stale) top-level result attaches its value — a top-level
  // failure leaves the property ABSENT (never a fabricated object, never null).
  if (input.includeDerivatives === true && deps.enrichDerivatives) {
    // One enrichment request per row that has a truthful anchor price (the
    // Part 1 ATM selector requires a finite positive anchor). `lastCompleted`
    // is the row's authoritative completed price; rows without a usable one are
    // not enriched (and never fabricated). Request keys are the row's unique
    // normalized symbol (accepted symbols are already deduped).
    const requests: DerivativesEnrichmentRequest[] = [];
    for (const row of rows) {
      const lc = row.metrics.lastCompleted;
      if (isUsable(lc)) {
        requests.push({ requestKey: row.identity.symbol, symbol: row.identity.symbol, anchorPrice: lc.value.price });
      }
    }
    if (requests.length > 0) {
      // Defense-in-depth: the derivatives orchestrator is contracted to return
      // truthful DataResults rather than throw, but an UNEXPECTED throw in the
      // enrichment subsystem must never discard an otherwise-valid base batch or
      // surface as a generic 500. On any throw, rows simply stay plain (no
      // fabricated derivatives), exactly as if enrichment were unavailable.
      try {
        const enriched = await deps.enrichDerivatives({ universe: universeResult, requests, referenceMs });
        for (const row of rows) {
          const d = enriched.get(row.identity.symbol);
          // Attach only a truthful usable value; failures leave `derivatives` absent.
          if (d && isUsable(d)) {
            row.derivatives = d.value;
          }
        }
      } catch {
        // Swallow: base rows remain intact and unfabricated. No raw error text
        // (which could embed provider/credential context) is propagated.
      }
    }
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
