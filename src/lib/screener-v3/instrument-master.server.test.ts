process.env.NODE_ENV = "test"; // enable default-deny-guarded test helpers

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isFreshCacheAge,
  isUsableStaleAge,
  projectRecordsAsOf,
  getStockFnoUniverse,
  getCachedStockFnoUniverse,
  _clearInstrumentCache,
  _seedInstrumentCacheForTest,
} from "./instrument-master.server.ts";
import type { UpstoxInstrumentRecord } from "./instrument-types.ts";

const IST = 5.5 * 3600 * 1000;
const istMs = (y: number, mo: number, d: number, h = 15, mi = 30) => Date.UTC(y, mo - 1, d, h, mi) - IST;
const FAR_FUTURE = istMs(2099, 1, 28); // always current regardless of test clock
const NEAR = istMs(2026, 7, 28);

function records(expiry: number): UpstoxInstrumentRecord[] {
  return [
    { segment: "NSE_EQ", instrument_key: "NSE_EQ|INE001", trading_symbol: "RELIANCE", name: "RELIANCE", isin: "INE001" },
    {
      segment: "NSE_FO", underlying_type: "EQUITY", underlying_symbol: "RELIANCE", instrument_type: "FUT",
      instrument_key: "FUT|R", trading_symbol: "RELIANCEFUT", expiry, lot_size: 100, weekly: false,
      underlying_key: "NSE_EQ|INE001", exchange_token: "1",
    },
  ];
}

test("cache-age helpers reject negative age and enforce bounds", () => {
  assert.equal(isFreshCacheAge(-1), false); // clock skew -> not fresh
  assert.equal(isFreshCacheAge(0), true);
  assert.equal(isFreshCacheAge(6 * 60 * 60 * 1000), false); // == TTL boundary
  assert.equal(isUsableStaleAge(-1), false);
  assert.equal(isUsableStaleAge(48 * 60 * 60 * 1000), true); // == max stale
  assert.equal(isUsableStaleAge(48 * 60 * 60 * 1000 + 1), false);
});

test("projectRecordsAsOf reprojects usability against nowMs", () => {
  const before = projectRecordsAsOf(records(NEAR), NEAR - 1000, istMs(2026, 7, 18, 10, 0));
  assert.equal(before.usable, true);
  // After the near expiry, the only future is expired -> no current underlyings.
  const after = projectRecordsAsOf(records(NEAR), NEAR - 1000, istMs(2026, 8, 1, 10, 0));
  assert.equal(after.usable, false);
});

test("getStockFnoUniverse serves a fresh usable seeded cache without network", async () => {
  _clearInstrumentCache();
  _seedInstrumentCacheForTest(records(FAR_FUTURE), Date.now());
  const r = await getStockFnoUniverse();
  assert.equal(r.status, "available");
  assert.equal(r.source, "upstox:memory-cache");
  assert.ok(r.value && r.value.underlyings.length === 1);
  _clearInstrumentCache();
});

test("getCachedStockFnoUniverse flags a future-dated (negative age) cache as unusable", () => {
  _clearInstrumentCache();
  _seedInstrumentCacheForTest(records(FAR_FUTURE), Date.now() + 5 * 60 * 1000); // fetchedAt in the future
  const c = getCachedStockFnoUniverse();
  assert.ok(c);
  assert.ok(c!.ageMs < 0);
  assert.equal(c!.usable, false); // negative age is never usable
  _clearInstrumentCache();
});

test("dev/test guards throw when NODE_ENV is not development/test", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  assert.throws(() => _clearInstrumentCache());
  assert.throws(() => _seedInstrumentCacheForTest(records(FAR_FUTURE), Date.now()));
  process.env.NODE_ENV = prev;
});
