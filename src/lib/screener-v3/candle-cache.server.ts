// Screener V3 Phase 2A Part 2 — isolated, module-local, in-memory candle cache.
// Server-side only (still no DB/filesystem/browser storage). Deterministic:
// every freshness/age decision is driven by an explicit `nowMs` argument, the
// module never reads the machine clock. Safe for concurrent callers via
// in-flight de-duplication — one provider call per unique key at a time.
//
// This module deliberately does NOT reimplement candle math or provider
// fetching. It only decides: serve a fresh cached value, trigger exactly one
// shared refresh, or fall back to a truthfully-labeled stale last-good value.
import type { CandleSeries, SpotInterval } from "./candles.server.ts";
import { isFailure, isOk, ok, propagateFailure, providerError, stale, type DataResult } from "./types.ts";

export interface CandleCachePolicy {
  /** Entries younger than this (ms) are served as a fresh hit — zero provider calls. */
  freshMs: number;
  /** Entries at/under this age (ms) may still be served as a stale fallback after a failed refresh. */
  maxStaleMs: number;
}

export type CandleCacheEvent =
  | "fresh-hit" // served from cache, zero provider calls
  | "provider-refresh" // provider call made and succeeded (cold miss or expired entry)
  | "stale-fallback" // provider call failed, a usable last-good value was served stale
  | "provider-failure"; // provider call failed and no usable last-good value existed

export interface CandleCacheOutcome {
  result: DataResult<CandleSeries>;
  event: CandleCacheEvent;
}

interface CandleCacheEntry {
  value: CandleSeries;
  /** The `nowMs` that was in effect when this value was stored (never a machine-clock read). */
  fetchedAtMs: number;
  source?: string;
  timestamp?: number;
}

/** Cache key must include every parameter that affects the candle response. */
export function buildCandleCacheKey(symbol: string, interval: SpotInterval, range: string): string {
  return `${symbol}|${interval}|${range}`;
}

/** Throws when the policy itself is structurally invalid. Checked once per call, not per entry. */
export function assertValidCachePolicy(policy: CandleCachePolicy): void {
  if (!Number.isFinite(policy.freshMs) || policy.freshMs <= 0) {
    throw new Error("candle-cache: freshMs must be a finite positive number of ms");
  }
  if (!Number.isFinite(policy.maxStaleMs) || policy.maxStaleMs <= 0) {
    throw new Error("candle-cache: maxStaleMs must be a finite positive number of ms");
  }
  if (policy.maxStaleMs < policy.freshMs) {
    throw new Error("candle-cache: maxStaleMs must be >= freshMs");
  }
}

/** Fresh only when age is non-negative (rejects future-dated entries) AND within the TTL. */
function isFreshAge(ageMs: number, policy: CandleCachePolicy): boolean {
  return ageMs >= 0 && ageMs < policy.freshMs;
}
/** Stale is serveable only when age is non-negative AND within the max-stale bound. */
function isUsableStaleAge(ageMs: number, policy: CandleCachePolicy): boolean {
  return ageMs >= 0 && ageMs <= policy.maxStaleMs;
}

export interface CandleCache {
  /**
   * Resolve one candle-cache key against the given policy/nowMs. `fetchFn` is
   * invoked only when no fresh entry exists; concurrent callers for the same
   * key share exactly one in-flight `fetchFn` call.
   */
  getOrFetch(
    key: string,
    nowMs: number,
    policy: CandleCachePolicy,
    fetchFn: () => Promise<DataResult<CandleSeries>>,
  ): Promise<CandleCacheOutcome>;
  /** Test/diagnostic only: current stored-entry count. Never exposes entry internals. */
  size(): number;
  /** Test-only: clears all entries and in-flight state. */
  reset(): void;
}

export function createCandleCache(): CandleCache {
  const entries = new Map<string, CandleCacheEntry>();
  const inFlight = new Map<string, Promise<DataResult<CandleSeries>>>();

  async function getOrFetch(
    key: string,
    nowMs: number,
    policy: CandleCachePolicy,
    fetchFn: () => Promise<DataResult<CandleSeries>>,
  ): Promise<CandleCacheOutcome> {
    if (!Number.isFinite(nowMs) || nowMs <= 0) {
      throw new Error("candle-cache: nowMs must be a finite positive epoch ms");
    }
    assertValidCachePolicy(policy);

    const existing = entries.get(key);
    if (existing) {
      const ageMs = nowMs - existing.fetchedAtMs;
      if (isFreshAge(ageMs, policy)) {
        return {
          result: ok<CandleSeries>(existing.value, { source: existing.source, timestamp: existing.timestamp }),
          event: "fresh-hit",
        };
      }
    }

    // Expired, missing, or future-dated entry -> attempt a provider refresh.
    // Concurrent callers for the same key share exactly one in-flight call.
    let pending = inFlight.get(key);
    if (!pending) {
      pending = fetchFn();
      inFlight.set(key, pending);
      // Remove the in-flight marker once settled (success OR failure) so a
      // failed call never permanently poisons later requests for this key.
      pending
        .catch(() => undefined)
        .finally(() => {
          if (inFlight.get(key) === pending) inFlight.delete(key);
        });
    }

    let result: DataResult<CandleSeries>;
    try {
      result = await pending;
    } catch (err) {
      // fetchFn is documented to return a DataResult rather than throw; this
      // is a defensive fallback so an unexpected throw is still truthful.
      const reason = err instanceof Error ? err.message : String(err);
      result = providerError(`candle-cache: fetch threw: ${reason}`, { source: "candle-cache" });
    }

    if (isOk(result)) {
      entries.set(key, {
        value: result.value,
        fetchedAtMs: nowMs,
        source: result.source,
        timestamp: result.timestamp,
      });
      return { result, event: "provider-refresh" };
    }

    if (isFailure(result)) {
      // Never cache invalid_input / malformed / null-value failures as last-good.
      const lastGood = existing;
      if (lastGood) {
        const ageMs = nowMs - lastGood.fetchedAtMs;
        if (isUsableStaleAge(ageMs, policy)) {
          return {
            result: stale<CandleSeries>(lastGood.value, {
              source: lastGood.source,
              timestamp: lastGood.timestamp,
              reason: `stale fallback after provider failure: ${result.reason}`,
            }),
            event: "stale-fallback",
          };
        }
      }
      return { result: propagateFailure(result), event: "provider-failure" };
    }

    // A fetcher may itself return an already-"stale" DataResult (fetchSpotCandles
    // never does, but the injected-fetcher contract permits it). Such a value is
    // usable but NOT fresh, so it must NEVER be written to `entries`: caching it
    // with fetchedAtMs = nowMs would let a later within-TTL read take the
    // fresh-hit path and relabel stale data as "available". Pass it through
    // truthfully as its own stale result without poisoning the cache.
    return { result, event: "provider-refresh" };
  }

  return {
    getOrFetch,
    size: () => entries.size,
    reset: () => {
      entries.clear();
      inFlight.clear();
    },
  };
}

/** Production default cache instance shared across requests within this process. */
export const defaultCandleCache: CandleCache = createCandleCache();
