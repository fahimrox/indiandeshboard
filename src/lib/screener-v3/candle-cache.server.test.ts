import { test } from "node:test";
import assert from "node:assert/strict";
import { createCandleCache, buildCandleCacheKey, assertValidCachePolicy, type CandleCachePolicy } from "./candle-cache.server.ts";
import { ok, stale, providerError, unavailable, invalidInput, isFailure, isUsable, type DataResult } from "./types.ts";
import type { CandleSeries } from "./candles.server.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────
const REF = 1_800_000_000_000; // arbitrary fixed epoch ms, never Date.now()

function mkSeries(overrides: Partial<CandleSeries> = {}): CandleSeries {
  return {
    symbol: "RELIANCE",
    yahooSymbol: "RELIANCE.NS",
    interval: "1m",
    range: "1d",
    candles: [],
    firstTimestamp: null,
    lastTimestamp: null,
    count: 0,
    source: "yahoo",
    requestedAt: REF,
    responseTimestamp: REF,
    ageMs: 0,
    sessionDateIst: "2026-07-20",
    hygiene: {
      alignedCount: 0,
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
    ...overrides,
  };
}

const POLICY: CandleCachePolicy = { freshMs: 60_000, maxStaleMs: 15 * 60_000 };

function okSeries(tag: string): DataResult<CandleSeries> {
  return ok(mkSeries({ symbol: tag }));
}

// ── Cache key ────────────────────────────────────────────────────────────
test("cache key separates interval/range combinations", () => {
  const a = buildCandleCacheKey("RELIANCE", "1m", "1d");
  const b = buildCandleCacheKey("RELIANCE", "1m", "5d");
  const c = buildCandleCacheKey("RELIANCE", "1d", "1d");
  const d = buildCandleCacheKey("TCS", "1m", "1d");
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});

// ── Policy validation ────────────────────────────────────────────────────
test("policy validation rejects invalid TTLs and maxStale < freshMs", () => {
  assert.throws(() => assertValidCachePolicy({ freshMs: 0, maxStaleMs: 1000 }));
  assert.throws(() => assertValidCachePolicy({ freshMs: -1, maxStaleMs: 1000 }));
  assert.throws(() => assertValidCachePolicy({ freshMs: 1000, maxStaleMs: 0 }));
  assert.throws(() => assertValidCachePolicy({ freshMs: 1000, maxStaleMs: 500 }));
  assert.throws(() => assertValidCachePolicy({ freshMs: NaN, maxStaleMs: 1000 }));
  assert.doesNotThrow(() => assertValidCachePolicy({ freshMs: 1000, maxStaleMs: 1000 }));
});

// ── Fresh hit ────────────────────────────────────────────────────────────
test("fresh cache hit causes zero provider calls and preserves source metadata", async () => {
  const cache = createCandleCache();
  const key = buildCandleCacheKey("RELIANCE", "1m", "1d");
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return ok(mkSeries(), { source: "yahoo", timestamp: REF });
  };

  const first = await cache.getOrFetch(key, REF, POLICY, fetchFn);
  assert.equal(first.event, "provider-refresh");
  assert.equal(calls, 1);

  const second = await cache.getOrFetch(key, REF + 1_000, POLICY, fetchFn);
  assert.equal(second.event, "fresh-hit");
  assert.equal(calls, 1, "no provider call on a fresh hit");
  assert.equal(second.result.status, "available");
  assert.equal(second.result.source, "yahoo");
});

// ── Expired entry -> refresh success replaces last-good ─────────────────
test("expired cache entry triggers a refresh; success replaces last-good", async () => {
  const cache = createCandleCache();
  const key = buildCandleCacheKey("RELIANCE", "1m", "1d");
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return ok(mkSeries({ count: calls }), { source: "yahoo", timestamp: REF });
  };

  await cache.getOrFetch(key, REF, POLICY, fetchFn);
  assert.equal(calls, 1);

  // Well past freshMs (60s) -> must refresh.
  const outcome = await cache.getOrFetch(key, REF + POLICY.freshMs + 1, POLICY, fetchFn);
  assert.equal(outcome.event, "provider-refresh");
  assert.equal(calls, 2);
  assert.ok(isUsable(outcome.result));
  if (isUsable(outcome.result)) assert.equal(outcome.result.value.count, 2);
});

// ── Refresh failure with usable last-good -> stale fallback ─────────────
test("refresh failure returns stale last-good within max-stale age, preserving the failure reason", async () => {
  const cache = createCandleCache();
  const key = buildCandleCacheKey("RELIANCE", "1m", "1d");
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    if (calls === 1) return ok(mkSeries({ count: 1 }), { source: "yahoo", timestamp: REF });
    return providerError("yahoo timeout");
  };

  await cache.getOrFetch(key, REF, POLICY, fetchFn);
  // Expired but within maxStaleMs (15 min).
  const outcome = await cache.getOrFetch(key, REF + POLICY.freshMs + 1, POLICY, fetchFn);
  assert.equal(outcome.event, "stale-fallback");
  assert.equal(outcome.result.status, "stale", "never returned as available/fresh");
  assert.ok(isUsable(outcome.result));
  if (isUsable(outcome.result)) {
    assert.equal(outcome.result.value.count, 1);
    assert.match(outcome.result.reason ?? "", /yahoo timeout/);
  }
});

// ── Too-old last-good is not used ────────────────────────────────────────
test("too-old last-good value is not used as a stale fallback", async () => {
  const cache = createCandleCache();
  const key = buildCandleCacheKey("RELIANCE", "1m", "1d");
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    if (calls === 1) return ok(mkSeries({ count: 1 }), { source: "yahoo", timestamp: REF });
    return providerError("yahoo timeout");
  };

  await cache.getOrFetch(key, REF, POLICY, fetchFn);
  // Beyond maxStaleMs (15 min) -> no usable last-good.
  const outcome = await cache.getOrFetch(key, REF + POLICY.maxStaleMs + 1, POLICY, fetchFn);
  assert.equal(outcome.event, "provider-failure");
  assert.ok(isFailure(outcome.result));
  if (isFailure(outcome.result)) assert.match(outcome.result.reason, /yahoo timeout/);
});

// ── Future-dated cache entry is not treated as fresh ─────────────────────
test("future-dated cache entry is not treated as fresh", async () => {
  const cache = createCandleCache();
  const key = buildCandleCacheKey("RELIANCE", "1m", "1d");
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return ok(mkSeries({ count: calls }), { source: "yahoo", timestamp: REF });
  };

  // Store at nowMs = REF + 100_000 (a "future" write relative to the next read).
  await cache.getOrFetch(key, REF + 100_000, POLICY, fetchFn);
  // Read with an EARLIER nowMs -> resulting age is negative -> must not be fresh.
  const outcome = await cache.getOrFetch(key, REF, POLICY, fetchFn);
  assert.equal(outcome.event, "provider-refresh", "negative age must trigger a refresh, not a fresh hit");
  assert.equal(calls, 2);
});

// ── Do-not-cache-as-success cases ────────────────────────────────────────
test("invalid_input / unavailable failures are never cached as a usable last-good", async () => {
  const cache = createCandleCache();
  const key = buildCandleCacheKey("RELIANCE", "1m", "1d");
  const fetchFn = async () => invalidInput("bad request");

  const first = await cache.getOrFetch(key, REF, POLICY, fetchFn);
  assert.equal(first.event, "provider-failure");
  assert.equal(cache.size(), 0, "a failure result must never populate the cache");

  const fetchFn2 = async () => unavailable("no data");
  const second = await cache.getOrFetch(key, REF + 1, POLICY, fetchFn2);
  assert.equal(second.event, "provider-failure");
  assert.equal(cache.size(), 0);
});

// ── Exact TTL boundaries ─────────────────────────────────────────────────
test("ageMs exactly equal to freshMs is NOT fresh (boundary is exclusive) and triggers a refresh", async () => {
  const cache = createCandleCache();
  const key = buildCandleCacheKey("RELIANCE", "1m", "1d");
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return ok(mkSeries({ count: calls }), { source: "yahoo", timestamp: REF });
  };
  await cache.getOrFetch(key, REF, POLICY, fetchFn);
  const outcome = await cache.getOrFetch(key, REF + POLICY.freshMs, POLICY, fetchFn);
  assert.equal(outcome.event, "provider-refresh", "age === freshMs must not be served as fresh");
  assert.equal(calls, 2);
});

test("ageMs exactly equal to maxStaleMs is still a usable stale fallback (boundary is inclusive)", async () => {
  const cache = createCandleCache();
  const key = buildCandleCacheKey("RELIANCE", "1m", "1d");
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    if (calls === 1) return ok(mkSeries({ count: 1 }), { source: "yahoo", timestamp: REF });
    return providerError("yahoo timeout");
  };
  await cache.getOrFetch(key, REF, POLICY, fetchFn);
  const outcome = await cache.getOrFetch(key, REF + POLICY.maxStaleMs, POLICY, fetchFn);
  assert.equal(outcome.event, "stale-fallback", "age === maxStaleMs must still serve stale last-good");
  assert.equal(outcome.result.status, "stale");
});

// ── Provider rejection (thrown async error) is converted, not propagated ──
test("a fetchFn that rejects is converted to a truthful provider-failure, not a thrown promise", async () => {
  const cache = createCandleCache();
  const key = buildCandleCacheKey("RELIANCE", "1m", "1d");
  const fetchFn = async () => {
    throw new Error("network boom");
  };
  const outcome = await cache.getOrFetch(key, REF, POLICY, fetchFn);
  assert.equal(outcome.event, "provider-failure");
  assert.ok(isFailure(outcome.result));
  if (isFailure(outcome.result)) {
    assert.equal(outcome.result.status, "provider_error");
    assert.match(outcome.result.reason, /network boom/);
  }
  assert.equal(cache.size(), 0, "a thrown fetch must not populate the cache");
});

// ── A stale fetcher result must never later become falsely fresh ──────────
test("a fetcher-returned stale result is passed through but never cached as fresh", async () => {
  const cache = createCandleCache();
  const key = buildCandleCacheKey("RELIANCE", "1m", "1d");
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return stale(mkSeries({ count: calls }), { source: "yahoo:stale", timestamp: REF });
  };

  const first = await cache.getOrFetch(key, REF, POLICY, fetchFn);
  assert.equal(first.result.status, "stale", "a stale fetcher result is passed through as stale");
  assert.equal(cache.size(), 0, "a stale result must not be written to the cache");

  // A read well within freshMs must NOT return a fresh hit of the stale value —
  // it must make another provider call rather than relabel stale data as available.
  const second = await cache.getOrFetch(key, REF + 1_000, POLICY, fetchFn);
  assert.notEqual(second.event, "fresh-hit", "stale data must never be served via the fresh-hit path");
  assert.equal(second.result.status, "stale");
  assert.equal(calls, 2, "each call re-fetches because stale is never cached as fresh");
});

// ── In-flight deduplication ───────────────────────────────────────────────
test("concurrent requests for the same key share exactly one provider call (success)", async () => {
  const cache = createCandleCache();
  const key = buildCandleCacheKey("RELIANCE", "1m", "1d");
  let calls = 0;
  let resolveFetch: ((v: DataResult<CandleSeries>) => void) | null = null;
  const fetchFn = () =>
    new Promise<DataResult<CandleSeries>>((resolve) => {
      calls++;
      resolveFetch = resolve;
    });

  const p1 = cache.getOrFetch(key, REF, POLICY, fetchFn);
  const p2 = cache.getOrFetch(key, REF, POLICY, fetchFn);
  const p3 = cache.getOrFetch(key, REF, POLICY, fetchFn);

  assert.equal(calls, 1, "only one fetchFn invocation for concurrent same-key requests");
  resolveFetch!(ok(mkSeries({ count: 42 }), { source: "yahoo", timestamp: REF }));

  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  for (const r of [r1, r2, r3]) {
    assert.equal(r.event, "provider-refresh");
    assert.ok(isUsable(r.result));
    if (isUsable(r.result)) assert.equal(r.result.value.count, 42);
  }
});

test("failed in-flight request does not poison later requests for the same key", async () => {
  const cache = createCandleCache();
  const key = buildCandleCacheKey("RELIANCE", "1m", "1d");
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    if (calls === 1) return providerError("first attempt fails");
    return ok(mkSeries({ count: 2 }), { source: "yahoo", timestamp: REF });
  };

  const first = await cache.getOrFetch(key, REF, POLICY, fetchFn);
  assert.equal(first.event, "provider-failure");
  assert.ok(isFailure(first.result));

  // A later request for the same key must be able to retry cleanly.
  const second = await cache.getOrFetch(key, REF + 1, POLICY, fetchFn);
  assert.equal(second.event, "provider-refresh");
  assert.equal(calls, 2);
  assert.ok(isUsable(second.result));
});

// ── Misc guards ────────────────────────────────────────────────────────────
test("getOrFetch rejects a non-finite/non-positive nowMs", async () => {
  const cache = createCandleCache();
  const key = buildCandleCacheKey("RELIANCE", "1m", "1d");
  await assert.rejects(() => cache.getOrFetch(key, 0, POLICY, async () => ok(mkSeries())));
  await assert.rejects(() => cache.getOrFetch(key, -5, POLICY, async () => ok(mkSeries())));
  await assert.rejects(() => cache.getOrFetch(key, NaN, POLICY, async () => ok(mkSeries())));
});

test("reset clears entries and in-flight state", async () => {
  const cache = createCandleCache();
  const key = buildCandleCacheKey("RELIANCE", "1m", "1d");
  await cache.getOrFetch(key, REF, POLICY, async () => ok(mkSeries()));
  assert.equal(cache.size(), 1);
  cache.reset();
  assert.equal(cache.size(), 0);
});
