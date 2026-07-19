import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseScreenerV3Query,
  mapDataStatusToHttp,
  handleScreenerV3Request,
  API_DEFAULT_LIMIT,
  API_CONCURRENCY,
  type ScreenerV3HandlerDeps,
} from "./api-request.ts";
import {
  ok,
  stale,
  invalidInput,
  unavailable,
  insufficient,
  providerError,
  isFailure,
} from "./types.ts";
import type { ScreenerV3Batch, ScreenerV3BatchInput, ScreenerV3BatchResult } from "./batch-types.ts";

// ── Helpers ────────────────────────────────────────────────────────────────
const REF = 1_800_000_000_000;

function params(qs: string): URLSearchParams {
  // Accept a raw query string (without leading "?").
  return new URLSearchParams(qs);
}

function mkBatch(over: Partial<ScreenerV3Batch> = {}): ScreenerV3Batch {
  return {
    referenceMs: REF,
    requestedCount: 0,
    acceptedSymbolCount: 0,
    rejectedSymbols: [],
    rows: [],
    universeStatus: "available",
    health: { complete: 0, degraded: 0, partial: 0, unavailable: 0 },
    cache: { freshHits: 0, providerRefreshes: 0, staleFallbacks: 0 },
    providerFailureCount: 0,
    ...over,
  };
}

/** Builds injected deps and records how the handler called them. */
function makeDeps(opts: {
  now?: number;
  result?: ScreenerV3BatchResult;
  throwErr?: unknown;
}): { deps: ScreenerV3HandlerDeps; calls: { now: number; inputs: ScreenerV3BatchInput[] } } {
  const calls = { now: 0, inputs: [] as ScreenerV3BatchInput[] };
  const deps: ScreenerV3HandlerDeps = {
    now: () => {
      calls.now++;
      return opts.now ?? REF;
    },
    runBatch: async (input) => {
      calls.inputs.push(input);
      if (opts.throwErr !== undefined) throw opts.throwErr;
      return opts.result ?? ok(mkBatch({ referenceMs: input.referenceMs }));
    },
  };
  return { deps, calls };
}

// ═══════════════════════════════════════════════════════════════════════════
// PARSER TESTS
// ═══════════════════════════════════════════════════════════════════════════

test("P1. omitted symbols -> undefined (allows universe derivation)", () => {
  const r = parseScreenerV3Query(params(""));
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.symbols, undefined);
});

test("P2. valid comma-separated symbols preserve caller order", () => {
  const r = parseScreenerV3Query(params("symbols=TCS,RELIANCE,INFY"));
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.symbols, ["TCS", "RELIANCE", "INFY"]);
});

test("P3. whitespace around each symbol is trimmed", () => {
  const r = parseScreenerV3Query(params("symbols=" + encodeURIComponent("  TCS , RELIANCE ,INFY  ")));
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.symbols, ["TCS", "RELIANCE", "INFY"]);
});

test("P4. duplicate symbols are preserved (orchestrator owns dedup)", () => {
  const r = parseScreenerV3Query(params("symbols=RELIANCE,reliance,RELIANCE"));
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.symbols, ["RELIANCE", "reliance", "RELIANCE"]);
});

test("P5. explicit blank symbols= is rejected", () => {
  const r = parseScreenerV3Query(params("symbols="));
  assert.equal(r.ok, false);
});

test("P6. whitespace-only symbols is rejected", () => {
  const r = parseScreenerV3Query(params("symbols=" + encodeURIComponent("   ")));
  assert.equal(r.ok, false);
});

test("P7. interior blank entries (RELIANCE,,TCS) remain visible to the orchestrator", () => {
  const r = parseScreenerV3Query(params("symbols=RELIANCE,,TCS"));
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.symbols, ["RELIANCE", "", "TCS"]);
});

test("P8. repeated symbols parameters are rejected deterministically", () => {
  const r = parseScreenerV3Query(params("symbols=RELIANCE&symbols=TCS"));
  assert.equal(r.ok, false);
});

test("P9. omitted limit defaults to 200", () => {
  const r = parseScreenerV3Query(params("symbols=RELIANCE"));
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.limit, API_DEFAULT_LIMIT);
});

test("P10. limit=1 is accepted", () => {
  const r = parseScreenerV3Query(params("limit=1"));
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.limit, 1);
});

test("P11. limit=250 is accepted", () => {
  const r = parseScreenerV3Query(params("limit=250"));
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.limit, 250);
});

test("P12. limit=0 is rejected", () => {
  assert.equal(parseScreenerV3Query(params("limit=0")).ok, false);
});

test("P13. negative limit is rejected", () => {
  assert.equal(parseScreenerV3Query(params("limit=-5")).ok, false);
});

test("P14. decimal limit is rejected", () => {
  assert.equal(parseScreenerV3Query(params("limit=1.5")).ok, false);
});

test("P15. non-numeric limit is rejected", () => {
  assert.equal(parseScreenerV3Query(params("limit=abc")).ok, false);
});

test("P16. empty limit= is rejected", () => {
  assert.equal(parseScreenerV3Query(params("limit=")).ok, false);
});

test("P17. limit greater than 250 is rejected (no silent clamp)", () => {
  assert.equal(parseScreenerV3Query(params("limit=251")).ok, false);
  assert.equal(parseScreenerV3Query(params("limit=1000")).ok, false);
});

test("P18. repeated identical limit is rejected", () => {
  assert.equal(parseScreenerV3Query(params("limit=200&limit=200")).ok, false);
});

test("P19. repeated conflicting limit is rejected", () => {
  assert.equal(parseScreenerV3Query(params("limit=10&limit=20")).ok, false);
});

test("P20a. whitespace-containing limit is rejected", () => {
  assert.equal(parseScreenerV3Query(params("limit=" + encodeURIComponent(" 50 "))).ok, false);
  assert.equal(parseScreenerV3Query(params("limit=" + encodeURIComponent("5 0"))).ok, false);
});

test("P20b. signed limit (+50) is rejected", () => {
  assert.equal(parseScreenerV3Query(params("limit=%2B50")).ok, false);
});

// ═══════════════════════════════════════════════════════════════════════════
// STATUS MAPPING
// ═══════════════════════════════════════════════════════════════════════════

test("status mapping is exhaustive and correct", () => {
  assert.equal(mapDataStatusToHttp("available"), 200);
  assert.equal(mapDataStatusToHttp("stale"), 200);
  assert.equal(mapDataStatusToHttp("invalid_input"), 400);
  assert.equal(mapDataStatusToHttp("unavailable"), 503);
  assert.equal(mapDataStatusToHttp("insufficient_history"), 503);
  assert.equal(mapDataStatusToHttp("provider_error"), 502);
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER TESTS
// ═══════════════════════════════════════════════════════════════════════════

test("H1. available result -> HTTP 200 and body is the orchestrator result", async () => {
  const result = ok(mkBatch());
  const { deps } = makeDeps({ result });
  const out = await handleScreenerV3Request(params("symbols=RELIANCE"), deps);
  assert.equal(out.status, 200);
  assert.equal(out.body, result);
});

test("H2. stale top-level result -> HTTP 200", async () => {
  const { deps } = makeDeps({ result: stale(mkBatch()) });
  const out = await handleScreenerV3Request(params(""), deps);
  assert.equal(out.status, 200);
});

test("H3. invalid_input result -> HTTP 400", async () => {
  const { deps } = makeDeps({ result: invalidInput("no valid symbols") });
  const out = await handleScreenerV3Request(params("symbols=RELIANCE"), deps);
  assert.equal(out.status, 400);
});

test("H4. unavailable result -> HTTP 503", async () => {
  const { deps } = makeDeps({ result: unavailable("universe down") });
  const out = await handleScreenerV3Request(params(""), deps);
  assert.equal(out.status, 503);
});

test("H5. insufficient_history result -> HTTP 503", async () => {
  const { deps } = makeDeps({ result: insufficient("not enough history") });
  const out = await handleScreenerV3Request(params(""), deps);
  assert.equal(out.status, 503);
});

test("H6. provider_error result -> HTTP 502", async () => {
  const { deps } = makeDeps({ result: providerError("upstox 500") });
  const out = await handleScreenerV3Request(params(""), deps);
  assert.equal(out.status, 502);
});

test("H7. unexpected throw -> HTTP 500", async () => {
  const { deps } = makeDeps({ throwErr: new Error("secret db path C:\\creds\\token.json") });
  const out = await handleScreenerV3Request(params("symbols=RELIANCE"), deps);
  assert.equal(out.status, 500);
});

test("H8. 500 body leaks no thrown message, stack, path, or provider payload", async () => {
  const { deps } = makeDeps({ throwErr: new Error("SECRET_TOKEN=abc123 at C:\\creds\\token.json") });
  const out = await handleScreenerV3Request(params("symbols=RELIANCE"), deps);
  const serialized = JSON.stringify(out.body);
  assert.doesNotMatch(serialized, /SECRET_TOKEN/);
  assert.doesNotMatch(serialized, /token\.json/);
  assert.doesNotMatch(serialized, /abc123/);
  assert.match(serialized, /unexpected internal error/i);
});

test("H9. reference outcome uses the single captured now() value", async () => {
  const { deps, calls } = makeDeps({ now: 1_777_777_777_777 });
  const out = await handleScreenerV3Request(params("symbols=RELIANCE"), deps);
  assert.equal(out.referenceMs, 1_777_777_777_777);
  assert.equal(calls.now, 1);
});

test("H10. now() is called exactly once even on invalid input", async () => {
  const { deps, calls } = makeDeps({});
  await handleScreenerV3Request(params("limit=0"), deps);
  assert.equal(calls.now, 1);
});

test("H11. the same reference value is passed into the orchestrator", async () => {
  const { deps, calls } = makeDeps({ now: 1_555_555_555_555 });
  const out = await handleScreenerV3Request(params("symbols=RELIANCE"), deps);
  assert.equal(calls.inputs.length, 1);
  assert.equal(calls.inputs[0].referenceMs, 1_555_555_555_555);
  assert.equal(calls.inputs[0].referenceMs, out.referenceMs);
});

test("H12. fixed concurrency of exactly 4 is forwarded", async () => {
  const { deps, calls } = makeDeps({});
  await handleScreenerV3Request(params("symbols=RELIANCE"), deps);
  assert.equal(calls.inputs[0].concurrency, API_CONCURRENCY);
  assert.equal(calls.inputs[0].concurrency, 4);
});

test("H13. default limit 200 is forwarded when omitted", async () => {
  const { deps, calls } = makeDeps({});
  await handleScreenerV3Request(params("symbols=RELIANCE"), deps);
  assert.equal(calls.inputs[0].limit, 200);
});

test("H14. a valid provided limit is forwarded", async () => {
  const { deps, calls } = makeDeps({});
  await handleScreenerV3Request(params("limit=50"), deps);
  assert.equal(calls.inputs[0].limit, 50);
});

test("H15. explicit symbols are forwarded in caller order", async () => {
  const { deps, calls } = makeDeps({});
  await handleScreenerV3Request(params("symbols=TCS,RELIANCE,INFY"), deps);
  assert.deepEqual(calls.inputs[0].symbols, ["TCS", "RELIANCE", "INFY"]);
});

test("H16. omitted symbols forwards no symbols field (universe derivation)", async () => {
  const { deps, calls } = makeDeps({});
  await handleScreenerV3Request(params("limit=10"), deps);
  assert.equal(calls.inputs[0].symbols, undefined);
});

test("H17. unsupported public controls cannot override internal settings", async () => {
  const { deps, calls } = makeDeps({ now: 999 });
  // Caller attempts to inject concurrency, referenceMs, cache TTL, provider range.
  await handleScreenerV3Request(
    params("symbols=RELIANCE&concurrency=99&referenceMs=123&cacheTtl=5&range=5y&interval=1d&maxStaleMs=1"),
    deps,
  );
  const input = calls.inputs[0];
  assert.equal(input.concurrency, 4, "concurrency stays server-fixed");
  assert.equal(input.referenceMs, 999, "referenceMs comes from now(), not the caller");
  assert.equal(input.cachePolicy, undefined, "no cache policy is ever derived from the caller");
  // Only the four intended keys exist on the orchestrator input.
  assert.deepEqual(Object.keys(input).sort(), ["concurrency", "limit", "referenceMs", "symbols"].sort());
});

test("H18. invalid query prevents orchestrator invocation", async () => {
  const { deps, calls } = makeDeps({});
  const out = await handleScreenerV3Request(params("limit=0"), deps);
  assert.equal(out.status, 400);
  assert.equal(calls.inputs.length, 0, "runBatch must not be called on invalid input");
  assert.ok(isFailure(out.body as never));
});

// ═══════════════════════════════════════════════════════════════════════════
// PARSER EDGE CASES (audit-added regressions)
// ═══════════════════════════════════════════════════════════════════════════

test("P21. all-blank symbols=,,, parses ok and forwards blanks for orchestrator rejection", () => {
  // Distinct from `symbols=` (empty raw -> parse error) and whitespace-only raw
  // (also a parse error): a comma-only value has a non-empty raw string, so it
  // is NOT rejected at the parse layer. It is split into blank tokens and
  // forwarded verbatim, letting the orchestrator reject each with a truthful
  // per-symbol reason (and ultimately return invalid_input). This locks the
  // documented layering that the API never invents its own symbol rejection.
  const r = parseScreenerV3Query(params("symbols=,,,"));
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.symbols, ["", "", "", ""]);
});

test("P22. pathologically long / overflowing digit limit is rejected (no Infinity clamp)", () => {
  // A 400-digit string passes the ^\d+$ shape test but Number() overflows to
  // Infinity; Infinity > MAX must still be a truthful rejection, never a silent
  // clamp to 250. A large finite value above MAX is likewise rejected.
  assert.equal(parseScreenerV3Query(params("limit=" + "9".repeat(400))).ok, false);
  assert.equal(parseScreenerV3Query(params("limit=9999999999999")).ok, false);
});
