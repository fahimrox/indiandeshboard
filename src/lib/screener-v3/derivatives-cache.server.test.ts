// Phase 2B Part 3 — bounded derivatives cache tests. Deterministic: every test
// drives freshness with an explicit referenceMs and proves single-flight with
// DEFERRED promises (never timers/sleeps). No live network, no real clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDerivativesCache,
  assertValidDerivativesCachePolicy,
  type DerivativesCachePolicy,
} from "./derivatives-cache.server.ts";
import { ok, unavailable, providerError, invalidInput, isOk, isFailure, type DataResult } from "./types.ts";

const REF = 1_785_000_000_000;
const POLICY: DerivativesCachePolicy = {
  freshTtlMs: 1_000,
  staleTtlMs: 5_000,
  unavailableTtlMs: 500,
  maxEntries: 100,
};

interface Snap {
  instrumentKey: string;
  value: number;
}
function snap(k: string, v: number): Snap {
  return { instrumentKey: k, value: v };
}
const id = (s: string): string => s;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A loader returning a fixed map, counting invocations and recording misses. */
function fixedLoader(map: ReadonlyMap<string, DataResult<Snap>>) {
  const state = { calls: 0, lastMisses: [] as string[] };
  const loader = async (misses: readonly string[]) => {
    state.calls++;
    state.lastMisses = [...misses];
    return map;
  };
  return { loader, state };
}
function mapOf(...pairs: Array<[string, DataResult<Snap>]>): ReadonlyMap<string, DataResult<Snap>> {
  return new Map(pairs);
}

// ── Policy validation ─────────────────────────────────────────────────────────
test("CA27. invalid policy rejected at construction and per call", async () => {
  assert.throws(() => createDerivativesCache({ ...POLICY, freshTtlMs: -1 }));
  assert.throws(() => createDerivativesCache({ ...POLICY, staleTtlMs: 100, freshTtlMs: 200 }));
  assert.throws(() => createDerivativesCache({ ...POLICY, unavailableTtlMs: NaN }));
  assert.throws(() => createDerivativesCache({ ...POLICY, maxEntries: 0 }));
  assert.throws(() => createDerivativesCache({ ...POLICY, maxEntries: 1.5 }));
  assert.throws(() => assertValidDerivativesCachePolicy({ ...POLICY, freshTtlMs: Infinity }));
  const cache = createDerivativesCache(POLICY);
  await assert.rejects(() =>
    cache.loadMany({
      namespace: "future",
      items: ["A"],
      keyOf: id,
      referenceMs: REF,
      policy: { ...POLICY, maxEntries: -3 },
      loader: fixedLoader(mapOf(["A", ok(snap("A", 1))])).loader,
    }),
  );
});

test("CA25. invalid referenceMs rejected", async () => {
  const cache = createDerivativesCache(POLICY);
  const { loader } = fixedLoader(mapOf(["A", ok(snap("A", 1))]));
  for (const bad of [0, -1, NaN, Infinity]) {
    await assert.rejects(() => cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: bad, policy: POLICY, loader }));
  }
});

// ── Fresh / refresh ─────────────────────────────────────────────────────────
test("CA1. fresh successful hit skips loader", async () => {
  const cache = createDerivativesCache(POLICY);
  const { loader, state } = fixedLoader(mapOf(["A", ok(snap("A", 42))]));
  const r1 = await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  const r2 = await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF + 500, policy: POLICY, loader });
  assert.equal(state.calls, 1);
  assert.ok(isOk(r2.get("A")!));
  if (isOk(r2.get("A")!)) assert.equal((r2.get("A") as { value: Snap }).value.value, 42);
});

test("CA2. fresh zero-valued snapshot preserved", async () => {
  const cache = createDerivativesCache(POLICY);
  const { loader } = fixedLoader(mapOf(["A", ok(snap("A", 0))]));
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  const r = await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF + 100, policy: POLICY, loader });
  const got = r.get("A")!;
  assert.ok(isOk(got));
  if (isOk(got)) assert.equal(got.value.value, 0);
});

test("CA3. fresh expiry causes refresh", async () => {
  const cache = createDerivativesCache(POLICY);
  const { loader, state } = fixedLoader(mapOf(["A", ok(snap("A", 1))]));
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF + POLICY.freshTtlMs, policy: POLICY, loader });
  assert.equal(state.calls, 2);
});

test("CA4. refresh success replaces cached value", async () => {
  const cache = createDerivativesCache(POLICY);
  let v = 1;
  const loader = async () => mapOf(["A", ok(snap("A", v))]);
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  v = 2;
  const r = await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF + POLICY.freshTtlMs, policy: POLICY, loader });
  const got = r.get("A")!;
  assert.ok(isOk(got));
  if (isOk(got)) assert.equal(got.value.value, 2);
});

// ── Stale fallback ─────────────────────────────────────────────────────────
test("CA5. provider_error refresh uses eligible stale cached value", async () => {
  const cache = createDerivativesCache(POLICY);
  let fail = false;
  const loader = async () => (fail ? mapOf(["A", providerError("boom")]) : mapOf(["A", ok(snap("A", 7))]));
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  fail = true;
  const r = await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF + 2_000, policy: POLICY, loader });
  const got = r.get("A")!;
  assert.equal(got.status, "stale");
  if (got.status === "stale") {
    assert.equal(got.value.value, 7);
    assert.match(got.reason ?? "", /provider refresh failed/);
    assert.doesNotMatch(got.reason ?? "", /boom/);
  }
});

test("CA6. thrown loader uses eligible stale cached value", async () => {
  const cache = createDerivativesCache(POLICY);
  let boom = false;
  const loader = async () => {
    if (boom) throw new Error("network exploded");
    return mapOf(["A", ok(snap("A", 9))]);
  };
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  boom = true;
  const r = await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF + 2_000, policy: POLICY, loader });
  const got = r.get("A")!;
  assert.equal(got.status, "stale");
  if (got.status === "stale") {
    assert.equal(got.value.value, 9);
    assert.doesNotMatch(got.reason ?? "", /exploded/);
  }
});

test("CA7. stale window expired → provider_error, no fallback", async () => {
  const cache = createDerivativesCache(POLICY);
  let fail = false;
  const loader = async () => (fail ? mapOf(["A", providerError("down")]) : mapOf(["A", ok(snap("A", 1))]));
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  fail = true;
  const r = await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF + POLICY.staleTtlMs + 1, policy: POLICY, loader });
  assert.equal(r.get("A")!.status, "provider_error");
});

test("CA8. unavailable refresh does not use stale positive fallback", async () => {
  const cache = createDerivativesCache(POLICY);
  let gone = false;
  const loader = async () => (gone ? mapOf(["A", unavailable("no record")]) : mapOf(["A", ok(snap("A", 3))]));
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  gone = true;
  const r = await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF + 2_000, policy: POLICY, loader });
  assert.equal(r.get("A")!.status, "unavailable");
});

test("CA9. invalid_input refresh does not use stale fallback", async () => {
  const cache = createDerivativesCache(POLICY);
  let bad = false;
  const loader = async () => (bad ? mapOf(["A", invalidInput("nope")]) : mapOf(["A", ok(snap("A", 3))]));
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  bad = true;
  const r = await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF + 2_000, policy: POLICY, loader });
  assert.equal(r.get("A")!.status, "invalid_input");
});

// ── Cache-ability of failures ──────────────────────────────────────────────
test("CA10. provider_error is not cached", async () => {
  const cache = createDerivativesCache(POLICY);
  const { loader, state } = fixedLoader(mapOf(["A", providerError("x")]));
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF + 1, policy: POLICY, loader });
  assert.equal(state.calls, 2);
});

test("CA11. invalid_input is not cached", async () => {
  const cache = createDerivativesCache(POLICY);
  const { loader, state } = fixedLoader(mapOf(["A", invalidInput("x")]));
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF + 1, policy: POLICY, loader });
  assert.equal(state.calls, 2);
});

test("CA12. unavailable is negative-cached", async () => {
  const cache = createDerivativesCache(POLICY);
  const { loader, state } = fixedLoader(mapOf(["A", unavailable("none")]));
  const r1 = await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  const r2 = await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF + 100, policy: POLICY, loader });
  assert.equal(state.calls, 1); // negative hit skipped the loader
  assert.equal(r1.get("A")!.status, "unavailable");
  assert.equal(r2.get("A")!.status, "unavailable");
});

test("CA13. negative cache expires", async () => {
  const cache = createDerivativesCache(POLICY);
  const { loader, state } = fixedLoader(mapOf(["A", unavailable("none")]));
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF + POLICY.unavailableTtlMs, policy: POLICY, loader });
  assert.equal(state.calls, 2);
});

test("CA14. missing loader-map key → unavailable", async () => {
  const cache = createDerivativesCache(POLICY);
  const { loader } = fixedLoader(mapOf()); // empty
  const r = await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  assert.equal(r.get("A")!.status, "unavailable");
});

// ── Dedup / batching / single-flight ───────────────────────────────────────
test("CA15. duplicate keys in one request load once", async () => {
  const cache = createDerivativesCache(POLICY);
  const { loader, state } = fixedLoader(mapOf(["A", ok(snap("A", 1))]));
  const r = await cache.loadMany({ namespace: "future", items: ["A", "A", "A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  assert.equal(state.calls, 1);
  assert.deepEqual(state.lastMisses, ["A"]);
  assert.ok(isOk(r.get("A")!));
});

test("CA16. concurrent overlapping calls share one in-flight load", async () => {
  const cache = createDerivativesCache(POLICY);
  let calls = 0;
  const d = deferred<ReadonlyMap<string, DataResult<Snap>>>();
  const loader = async () => {
    calls++;
    return d.promise;
  };
  const p1 = cache.loadMany({ namespace: "future", items: ["K"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  const p2 = cache.loadMany({ namespace: "future", items: ["K"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  assert.equal(calls, 1, "only the owning call invokes the loader");
  assert.equal(cache.inFlightCount(), 1);
  d.resolve(mapOf(["K", ok(snap("K", 5))]));
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.ok(isOk(r1.get("K")!));
  assert.ok(isOk(r2.get("K")!));
  assert.equal(cache.inFlightCount(), 0);
});

test("CA17. in-flight entry removed after success", async () => {
  const cache = createDerivativesCache(POLICY);
  const { loader } = fixedLoader(mapOf(["A", ok(snap("A", 1))]));
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  assert.equal(cache.inFlightCount(), 0);
});

test("CA18. in-flight entry removed after failure (thrown loader)", async () => {
  const cache = createDerivativesCache(POLICY);
  const loader = async () => {
    throw new Error("boom");
  };
  const r = await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  assert.equal(r.get("A")!.status, "provider_error");
  assert.equal(cache.inFlightCount(), 0);
});

test("CA19. different keys loaded together in one batch", async () => {
  const cache = createDerivativesCache(POLICY);
  const { loader, state } = fixedLoader(mapOf(["A", ok(snap("A", 1))], ["B", ok(snap("B", 2))]));
  const r = await cache.loadMany({ namespace: "future", items: ["A", "B"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  assert.equal(state.calls, 1);
  assert.deepEqual(state.lastMisses, ["A", "B"]);
  assert.ok(isOk(r.get("A")!) && isOk(r.get("B")!));
});

// ── LRU ─────────────────────────────────────────────────────────────────────
test("CA20. deterministic LRU eviction", async () => {
  const cache = createDerivativesCache({ ...POLICY, maxEntries: 2 });
  const pol = { ...POLICY, maxEntries: 2 };
  const load = (k: string) => {
    const { loader, state } = fixedLoader(mapOf([k, ok(snap(k, 1))]));
    return cache.loadMany({ namespace: "future", items: [k], keyOf: id, referenceMs: REF, policy: pol, loader }).then(() => state);
  };
  await load("A");
  await load("B");
  await load("C"); // evicts A (LRU)
  assert.equal(cache.size(), 2);
  const sA = await load("A"); // A was evicted → loader runs again
  assert.equal(sA.calls, 1);
});

test("CA21. reads update LRU recency", async () => {
  const pol = { ...POLICY, maxEntries: 2 };
  const cache = createDerivativesCache(pol);
  const seed = (k: string) => cache.loadMany({ namespace: "future", items: [k], keyOf: id, referenceMs: REF, policy: pol, loader: fixedLoader(mapOf([k, ok(snap(k, 1))])).loader });
  await seed("A");
  await seed("B");
  // Fresh read of A moves it to MRU (loader must NOT run).
  const aReload = fixedLoader(mapOf(["A", ok(snap("A", 9))]));
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF + 100, policy: pol, loader: aReload.loader });
  assert.equal(aReload.state.calls, 0, "A was a fresh hit");
  await seed("C"); // should evict B (LRU), not A
  const bReload = fixedLoader(mapOf(["B", ok(snap("B", 1))]));
  await cache.loadMany({ namespace: "future", items: ["B"], keyOf: id, referenceMs: REF + 200, policy: pol, loader: bReload.loader });
  assert.equal(bReload.state.calls, 1, "B was evicted and reloaded");
});

test("CA22. writes (refresh) update LRU recency", async () => {
  const pol = { ...POLICY, maxEntries: 2 };
  const cache = createDerivativesCache(pol);
  const seed = (k: string, ref: number) => cache.loadMany({ namespace: "future", items: [k], keyOf: id, referenceMs: ref, policy: pol, loader: fixedLoader(mapOf([k, ok(snap(k, 1))])).loader });
  await seed("A", REF);
  await seed("B", REF);
  // Refresh A after expiry → re-write moves A to MRU.
  await seed("A", REF + POLICY.freshTtlMs);
  await seed("C", REF + POLICY.freshTtlMs); // evicts B, keeps A
  const bReload = fixedLoader(mapOf(["B", ok(snap("B", 1))]));
  await cache.loadMany({ namespace: "future", items: ["B"], keyOf: id, referenceMs: REF + POLICY.freshTtlMs, policy: pol, loader: bReload.loader });
  assert.equal(bReload.state.calls, 1);
});

test("CA23. maximum entry count never exceeded", async () => {
  const pol = { ...POLICY, maxEntries: 3 };
  const cache = createDerivativesCache(pol);
  for (let i = 0; i < 10; i++) {
    const k = `K${i}`;
    await cache.loadMany({ namespace: "future", items: [k], keyOf: id, referenceMs: REF, policy: pol, loader: fixedLoader(mapOf([k, ok(snap(k, i))])).loader });
  }
  assert.equal(cache.size(), 3);
});

test("CA24. namespace separation", async () => {
  const cache = createDerivativesCache(POLICY);
  const a = fixedLoader(mapOf(["K", ok(snap("K", 1))]));
  const b = fixedLoader(mapOf(["K", ok(snap("K", 2))]));
  const ra = await cache.loadMany({ namespace: "future", items: ["K"], keyOf: id, referenceMs: REF, policy: POLICY, loader: a.loader });
  const rb = await cache.loadMany({ namespace: "greek", items: ["K"], keyOf: id, referenceMs: REF, policy: POLICY, loader: b.loader });
  assert.equal(a.state.calls, 1);
  assert.equal(b.state.calls, 1); // different namespace → not a hit on future:K
  const va = ra.get("K")!;
  const vb = rb.get("K")!;
  if (isOk(va) && isOk(vb)) {
    assert.equal(va.value.value, 1);
    assert.equal(vb.value.value, 2);
  }
  assert.equal(cache.size(), 2);
});

// ── Invalid key / clear / completeness / no-clock ───────────────────────────
test("CA26. blank cache key handled truthfully (not loaded)", async () => {
  const cache = createDerivativesCache(POLICY);
  const { loader, state } = fixedLoader(mapOf(["A", ok(snap("A", 1))]));
  const r = await cache.loadMany({ namespace: "future", items: ["   ", "A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  assert.ok(isFailure(r.get("")!));
  assert.equal(r.get("")!.status, "unavailable");
  assert.deepEqual(state.lastMisses, ["A"]); // blank not sent to loader
  assert.ok(isOk(r.get("A")!));
});

test("CA28. no Date.now dependency (clock disabled during load)", async () => {
  const cache = createDerivativesCache(POLICY);
  const { loader } = fixedLoader(mapOf(["A", ok(snap("A", 1))]));
  const origNow = Date.now;
  // eslint-disable-next-line no-global-assign
  Date.now = () => {
    throw new Error("Date.now must not be called by the cache");
  };
  try {
    const r1 = await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
    const r2 = await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF + 100, policy: POLICY, loader });
    assert.ok(isOk(r1.get("A")!) && isOk(r2.get("A")!));
  } finally {
    Date.now = origNow;
  }
});

test("CA29. clear() resets entries without corrupting already-settled results", async () => {
  const cache = createDerivativesCache(POLICY);
  const { loader, state } = fixedLoader(mapOf(["A", ok(snap("A", 5))]));
  const r = await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  cache.clear();
  assert.equal(cache.size(), 0);
  const got = r.get("A")!; // previously settled result must remain intact
  assert.ok(isOk(got));
  if (isOk(got)) assert.equal(got.value.value, 5);
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF + 10, policy: POLICY, loader });
  assert.equal(state.calls, 2); // cleared → loader runs again
});

test("CA30. every unique requested key receives a result", async () => {
  const cache = createDerivativesCache(POLICY);
  // Pre-seed a negative entry for N and a positive for P.
  await cache.loadMany({ namespace: "future", items: ["N"], keyOf: id, referenceMs: REF, policy: POLICY, loader: fixedLoader(mapOf(["N", unavailable("none")])).loader });
  await cache.loadMany({ namespace: "future", items: ["P"], keyOf: id, referenceMs: REF, policy: POLICY, loader: fixedLoader(mapOf(["P", ok(snap("P", 1))])).loader });
  const loader = fixedLoader(mapOf(["M", ok(snap("M", 2))])).loader;
  const r = await cache.loadMany({
    namespace: "future",
    items: ["P", "N", "M", "   ", "P"],
    keyOf: id,
    referenceMs: REF + 100,
    policy: POLICY,
    loader,
  });
  for (const k of ["P", "N", "M", ""]) assert.ok(r.has(k), `missing result for "${k}"`);
});

// ── Exact boundary conditions ───────────────────────────────────────────────
test("CA31. inclusive stale boundary (age === staleTtlMs) still serves stale", async () => {
  const cache = createDerivativesCache(POLICY);
  let fail = false;
  const loader = async () => (fail ? mapOf(["A", providerError("down")]) : mapOf(["A", ok(snap("A", 11))]));
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader });
  fail = true;
  // Exactly at the stale window edge — inclusive → still a stale fallback.
  const r = await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF + POLICY.staleTtlMs, policy: POLICY, loader });
  const got = r.get("A")!;
  assert.equal(got.status, "stale");
  if (got.status === "stale") assert.equal(got.value.value, 11);
});

test("CA32. fresh keys are excluded from the loader miss batch", async () => {
  const cache = createDerivativesCache(POLICY);
  // Seed A (positive, fresh).
  await cache.loadMany({ namespace: "future", items: ["A"], keyOf: id, referenceMs: REF, policy: POLICY, loader: fixedLoader(mapOf(["A", ok(snap("A", 1))])).loader });
  // Request A (still fresh) + B (cold miss): the loader must receive ONLY ["B"].
  const { loader, state } = fixedLoader(mapOf(["B", ok(snap("B", 2))]));
  const r = await cache.loadMany({ namespace: "future", items: ["A", "B"], keyOf: id, referenceMs: REF + 100, policy: POLICY, loader });
  assert.equal(state.calls, 1);
  assert.deepEqual(state.lastMisses, ["B"]); // A served fresh from cache, not reloaded
  assert.ok(isOk(r.get("A")!) && isOk(r.get("B")!));
  if (isOk(r.get("A")!)) assert.equal((r.get("A") as { value: Snap }).value.value, 1);
});
