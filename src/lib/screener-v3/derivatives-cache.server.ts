// Screener V3 Phase 2B Part 3 — bounded, in-memory derivatives cache (SERVER).
//
// Scope: an isolated, explicitly-constructed cache with deterministic
// fresh / stale / negative-cache policies, per-key single-flight request
// de-duplication, and a batch-preserving `loadMany` API. It is generic over the
// cached value type and namespace-segregated so futures / option-chain / Greek
// entries never collide.
//
// Hard invariants:
//   - In-memory only. NO persistence, NO filesystem, NO browser storage.
//   - Deterministic: every freshness/age decision is driven by an explicit
//     caller `referenceMs`. The module NEVER reads the machine clock
//     (no `Date.now()`), NEVER sets timers, and has NO import-time side effects.
//   - NO hidden global singleton — the cache must be explicitly constructed.
//   - `DataResult.status` (transport/availability) and a snapshot's own
//     `sessionState` are kept strictly separate. A cache-driven stale fallback
//     only ever converts a PREVIOUSLY SUCCESSFUL cached value into a
//     `DataResult.status === "stale"` result; the cached snapshot's own
//     `sessionState` / source are left untouched.
//   - NO raw exception text, provider body, URL or token ever enters a reason.
import {
  ok,
  stale,
  unavailable,
  providerError,
  isOk,
  type DataResult,
  type OkResult,
} from "./types.ts";

// ── Policy ────────────────────────────────────────────────────────────────────
export interface DerivativesCachePolicy {
  /** Age (ms) under which a positive entry is a fresh hit (loader skipped). */
  freshTtlMs: number;
  /**
   * Age (ms) up to which an expired positive entry may still be served as a
   * `stale` fallback AFTER a failed refresh. Must be >= freshTtlMs.
   */
  staleTtlMs: number;
  /** Age (ms) under which a negative-cached `unavailable` is served (loader skipped). */
  unavailableTtlMs: number;
  /** Hard upper bound on stored entries; LRU-evicted when exceeded. Integer >= 1. */
  maxEntries: number;
}

/**
 * Validate a policy. Throws (never silently corrects) on any structurally
 * invalid field. Called both at construction and per `loadMany` call.
 */
export function assertValidDerivativesCachePolicy(policy: DerivativesCachePolicy): void {
  const nonNeg = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!nonNeg(policy?.freshTtlMs)) {
    throw new Error("derivatives-cache: freshTtlMs must be a finite non-negative number of ms");
  }
  if (!nonNeg(policy.staleTtlMs)) {
    throw new Error("derivatives-cache: staleTtlMs must be a finite non-negative number of ms");
  }
  if (!nonNeg(policy.unavailableTtlMs)) {
    throw new Error("derivatives-cache: unavailableTtlMs must be a finite non-negative number of ms");
  }
  if (policy.staleTtlMs < policy.freshTtlMs) {
    throw new Error("derivatives-cache: staleTtlMs must be >= freshTtlMs");
  }
  if (!Number.isInteger(policy.maxEntries) || policy.maxEntries < 1) {
    throw new Error("derivatives-cache: maxEntries must be an integer >= 1");
  }
}

// ── loadMany input ─────────────────────────────────────────────────────────────
export interface LoadManyInput<I, T> {
  /** Type/endpoint namespace, e.g. "future" | "greek" | "chain". Non-blank. */
  namespace: string;
  items: readonly I[];
  /** Stable cache identity for an item (excluding namespace and referenceMs). */
  keyOf: (item: I) => string;
  referenceMs: number;
  policy: DerivativesCachePolicy;
  /**
   * Loads ONLY the true misses (cold + expired) for THIS call, in one batched
   * invocation. Must return a map keyed by the same string `keyOf` produces.
   * A missing map entry is treated as a truthful `unavailable`.
   */
  loader: (misses: readonly I[]) => Promise<ReadonlyMap<string, DataResult<T>>>;
}

export interface DerivativesBatchCache {
  loadMany<I, T>(input: LoadManyInput<I, T>): Promise<ReadonlyMap<string, DataResult<T>>>;
  /** Diagnostic: current stored-entry count (excludes in-flight). */
  size(): number;
  /** Diagnostic: current in-flight load count. */
  inFlightCount(): number;
  /** Test/diagnostic: clear all entries and in-flight markers. */
  clear(): void;
}

// ── Internal entry model ─────────────────────────────────────────────────────
interface PositiveEntry {
  kind: "positive";
  result: OkResult<unknown>;
  storedAtMs: number;
}
interface NegativeEntry {
  kind: "negative";
  storedAtMs: number;
}
type CacheEntry = PositiveEntry | NegativeEntry;

/** Outcome of a single owned/shared load for one key (pre-fallback). */
type PerKeyOutcome =
  | { type: "value"; result: DataResult<unknown> } // loader returned a result for this key
  | { type: "missing" } // key absent from the loader's map
  | { type: "threw" }; // loader threw

const GENERIC_STALE_REASON = "provider refresh failed; using cached derivatives data";
const SOURCE = "derivatives-cache";

export function createDerivativesCache(policy: DerivativesCachePolicy): DerivativesBatchCache {
  // Validate ONCE at construction (explicit error, no silent default).
  assertValidDerivativesCachePolicy(policy);

  // Insertion order == LRU order (oldest first). Read/write move a key to MRU.
  const entries = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<PerKeyOutcome>>();

  function touch(fullKey: string): void {
    const e = entries.get(fullKey);
    if (e) {
      entries.delete(fullKey);
      entries.set(fullKey, e); // re-insert at MRU end
    }
  }

  function writeEntry(fullKey: string, entry: CacheEntry, maxEntries: number): void {
    entries.delete(fullKey);
    entries.set(fullKey, entry); // MRU
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value; // LRU end
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  type Classification =
    | { kind: "fresh"; result: DataResult<unknown> }
    | { kind: "negative-hit"; result: DataResult<unknown> }
    | { kind: "miss"; staleCandidate?: PositiveEntry };

  function classify(fullKey: string, referenceMs: number, p: DerivativesCachePolicy): Classification {
    const entry = entries.get(fullKey);
    if (!entry) return { kind: "miss" };
    const ageMs = referenceMs - entry.storedAtMs;

    if (entry.kind === "negative") {
      if (ageMs >= 0 && ageMs < p.unavailableTtlMs) {
        touch(fullKey);
        return {
          kind: "negative-hit",
          result: unavailable("negative-cached: provider previously returned unavailable", {
            source: SOURCE,
            timestamp: referenceMs,
          }),
        };
      }
      return { kind: "miss" }; // expired negative → reload
    }

    // positive
    if (ageMs >= 0 && ageMs < p.freshTtlMs) {
      touch(fullKey);
      return { kind: "fresh", result: entry.result };
    }
    if (ageMs >= 0 && ageMs <= p.staleTtlMs) {
      touch(fullKey);
      return { kind: "miss", staleCandidate: entry }; // expired but stale-eligible
    }
    return { kind: "miss" }; // beyond stale window (or future-dated) → cold reload
  }

  function staleFallbackOr(
    failure: DataResult<unknown>,
    candidate: PositiveEntry | undefined,
    referenceMs: number,
    p: DerivativesCachePolicy,
  ): DataResult<unknown> {
    if (candidate) {
      const ageMs = referenceMs - candidate.storedAtMs;
      if (ageMs >= 0 && ageMs <= p.staleTtlMs) {
        // Convert a previously-successful value into a truthful stale result.
        // The snapshot's own sessionState/source are preserved by reusing value.
        return stale(candidate.result.value, {
          source: candidate.result.source,
          timestamp: candidate.result.timestamp,
          reason: GENERIC_STALE_REASON,
        });
      }
    }
    return failure;
  }

  async function loadMany<I, T>(input: LoadManyInput<I, T>): Promise<ReadonlyMap<string, DataResult<T>>> {
    const { namespace, items, keyOf, referenceMs, policy: p, loader } = input;

    if (typeof namespace !== "string" || namespace.trim() === "") {
      throw new Error("derivatives-cache: namespace must be a non-empty string");
    }
    if (!Number.isFinite(referenceMs) || referenceMs <= 0) {
      throw new Error("derivatives-cache: referenceMs must be a finite positive epoch ms");
    }
    assertValidDerivativesCachePolicy(p);
    const ns = namespace.trim();

    const result = new Map<string, DataResult<T>>();

    // ── Dedupe by key (first-seen order); blank/invalid key → truthful invalid_input.
    const seen = new Set<string>();
    const order: string[] = [];
    const itemByKey = new Map<string, I>();
    for (const item of items) {
      const rawKey = keyOf(item);
      const key = typeof rawKey === "string" ? rawKey.trim() : "";
      if (key === "") {
        if (!result.has("")) {
          result.set("", unavailable("blank cache key", { source: SOURCE, timestamp: referenceMs }) as DataResult<T>);
        }
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      order.push(key);
      itemByKey.set(key, item);
    }

    // ── Classify each unique key; collect misses + stale candidates.
    const missKeys: string[] = [];
    const staleCandidates = new Map<string, PositiveEntry>();
    for (const key of order) {
      const fk = `${ns}:${key}`;
      const c = classify(fk, referenceMs, p);
      if (c.kind === "fresh" || c.kind === "negative-hit") {
        result.set(key, c.result as DataResult<T>);
        continue;
      }
      missKeys.push(key);
      if (c.staleCandidate) staleCandidates.set(key, c.staleCandidate);
    }

    // ── Single-flight: owned misses (no in-flight) trigger ONE shared loader
    //    call; shared misses reuse an existing in-flight promise. Register
    //    everything SYNCHRONOUSLY (before any await) so concurrent callers see it.
    const promiseByKey = new Map<string, Promise<PerKeyOutcome>>();
    const ownedKeys: string[] = [];
    for (const key of missKeys) {
      const fk = `${ns}:${key}`;
      const existing = inFlight.get(fk);
      if (existing) {
        promiseByKey.set(key, existing); // share the concurrent in-flight load
      } else {
        ownedKeys.push(key);
      }
    }

    if (ownedKeys.length > 0) {
      const ownedItems = ownedKeys.map((k) => itemByKey.get(k) as I);
      // One batched loader invocation for exactly the owned misses.
      const shared: Promise<{ ok: true; map: ReadonlyMap<string, DataResult<T>> } | { ok: false }> = (async () => {
        try {
          const map = await loader(ownedItems);
          return { ok: true as const, map };
        } catch {
          return { ok: false as const }; // raw error deliberately discarded
        }
      })();

      for (const key of ownedKeys) {
        const fk = `${ns}:${key}`;
        const perKey: Promise<PerKeyOutcome> = (async () => {
          const r = await shared;
          if (!r.ok) return { type: "threw" };
          const res = r.map.get(key);
          if (res === undefined) return { type: "missing" };
          // Cache policy: cache successes (positive) and truthful unavailable
          // (negative). NEVER cache provider_error / invalid_input / other.
          if (isOk(res)) {
            writeEntry(fk, { kind: "positive", result: res as OkResult<unknown>, storedAtMs: referenceMs }, p.maxEntries);
          } else if (res.status === "unavailable") {
            writeEntry(fk, { kind: "negative", storedAtMs: referenceMs }, p.maxEntries);
          }
          return { type: "value", result: res as DataResult<unknown> };
        })();
        inFlight.set(fk, perKey);
        promiseByKey.set(key, perKey);
        // Always remove the in-flight marker once settled (success OR failure).
        perKey
          .catch(() => undefined)
          .finally(() => {
            if (inFlight.get(fk) === perKey) inFlight.delete(fk);
          });
      }
    }

    // ── Await all miss keys (owned + shared) and finalize each result.
    await Promise.all(
      missKeys.map(async (key) => {
        const outcome = await promiseByKey.get(key)!;
        const candidate = staleCandidates.get(key);
        let finalRes: DataResult<unknown>;
        if (outcome.type === "missing") {
          finalRes = unavailable(`no loader result for key "${key}"`, { source: SOURCE, timestamp: referenceMs });
        } else if (outcome.type === "threw") {
          finalRes = staleFallbackOr(
            providerError("loader threw during derivatives refresh", { source: SOURCE }),
            candidate,
            referenceMs,
            p,
          );
        } else {
          const res = outcome.result;
          if (isOk(res) || res.status === "unavailable" || res.status === "invalid_input") {
            // available → truthful fresh; unavailable → truthful (no positive
            // fallback); invalid_input → truthful (never stale fallback).
            finalRes = res;
          } else {
            // provider_error (or other failure) → eligible stale fallback.
            finalRes = staleFallbackOr(res, candidate, referenceMs, p);
          }
        }
        result.set(key, finalRes as DataResult<T>);
      }),
    );

    return result;
  }

  return {
    loadMany,
    size: () => entries.size,
    inFlightCount: () => inFlight.size,
    clear: () => {
      entries.clear();
      inFlight.clear();
    },
  };
}
