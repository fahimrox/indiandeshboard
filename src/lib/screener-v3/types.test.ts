import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ok,
  stale,
  unavailable,
  insufficient,
  providerError,
  invalidInput,
  isOk,
  isUsable,
  isFailure,
  propagateFailure,
  type DataResult,
} from "./types.ts";

test("ok carries a non-null value and available status", () => {
  const r = ok(42, { source: "x", timestamp: 5 });
  assert.equal(r.status, "available");
  assert.equal(r.value, 42);
  assert.equal(r.source, "x");
});

test("stale preserves the last-good value and marks stale", () => {
  const r = stale({ n: 1 }, { reason: "old" });
  assert.equal(r.status, "stale");
  assert.deepEqual(r.value, { n: 1 });
});

test("failure helpers set value null + required reason", () => {
  assert.equal(unavailable("gone").value, null);
  assert.equal(unavailable("gone").status, "unavailable");
  assert.equal(insufficient("short").status, "insufficient_history");
  assert.equal(providerError("boom").status, "provider_error");
  assert.equal(invalidInput("bad").status, "invalid_input");
  assert.equal(invalidInput("bad").reason, "bad");
});

test("metadata cannot override status or value", () => {
  // Hostile metadata attempting to flip the discriminant/value.
  const r = ok(7, { status: "provider_error", value: null } as never);
  assert.equal(r.status, "available");
  assert.equal(r.value, 7);
});

test("narrowing helpers behave correctly", () => {
  const good: DataResult<number> = ok(1);
  const bad: DataResult<number> = unavailable("x");
  const old: DataResult<number> = stale(2);

  assert.equal(isOk(good), true);
  assert.equal(isOk(old), false);
  assert.equal(isUsable(old), true);
  assert.equal(isUsable(bad), false);
  assert.equal(isFailure(bad), true);
  assert.equal(isFailure(good), false);
});

test("isFailure follows the status discriminant, not a nullable payload", () => {
  // Simulates malformed external/runtime data bypassing the type system.
  const contradictory = {
    status: "available",
    value: null,
  } as unknown as DataResult<number>;

  assert.equal(isFailure(contradictory), false);
});

test("propagateFailure retypes a failure without a cast", () => {
  const f = providerError("down");
  const asString: DataResult<string> = propagateFailure<string>(f);
  assert.equal(asString.status, "provider_error");
  assert.equal(asString.value, null);
});

// Compile-time contract checks. These branches never execute at runtime.
if (false) {
  // @ts-expect-error available results must not carry null
  ok(null);

  // @ts-expect-error stale results must not carry undefined
  stale(undefined);
}