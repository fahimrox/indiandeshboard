import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveDerivativesHealth } from "./derivatives-health.ts";
import { ok, stale, unavailable, type DataResult } from "./types.ts";
import type { FuturesMarketSnapshot, OptionMarketSnapshot } from "./derivatives-types.ts";

const REF = 1_785_000_000_000;

function futVal(): FuturesMarketSnapshot {
  return {
    symbol: "RELIANCE", tradingSymbol: "RELIANCE FUT", instrumentKey: "NSE_FO|1",
    expiryMs: REF, expiryDateIst: "2026-07-28", lotSize: 500,
    lastPrice: 1300, open: 1300, high: 1310, low: 1290, close: 1300,
    volume: 1000, averagePrice: null, openInterest: 5000, openInterestDayHigh: null, openInterestDayLow: null,
    netChange: 5, totalBuyQuantity: null, totalSellQuantity: null, bestBid: 1299, bestAsk: 1301,
    buyDepth: [], sellDepth: [], providerTimestampMs: REF, lastTradeTimeMs: REF, receivedAtMs: REF,
    sessionState: "eod", source: "upstox_full_market_quote",
  };
}
function optVal(t: "CE" | "PE"): OptionMarketSnapshot {
  return {
    symbol: "RELIANCE", optionType: t, strike: 1300, expiryMs: REF, expiryDateIst: "2026-07-28", instrumentKey: "NSE_FO|2",
    lastPrice: 20, closePrice: 18, volume: 500, openInterest: 1000, previousOpenInterest: 900, openInterestChange: 100,
    bidPrice: 19, bidQuantity: 100, askPrice: 21, askQuantity: 100,
    impliedVolatilityPct: 26, delta: 0.5, gamma: 0.01, theta: -1, vega: 0.9, probabilityOfProfit: 33,
    providerTimestampMs: REF, receivedAtMs: REF, sessionState: "eod", source: "upstox_option_chain",
  };
}
const okFut = (): DataResult<FuturesMarketSnapshot> => ok(futVal(), { source: "test" });
const staleFut = (reason: string): DataResult<FuturesMarketSnapshot> => stale(futVal(), { source: "test", reason });
const okCall = (): DataResult<OptionMarketSnapshot> => ok(optVal("CE"), { source: "test" });
const okPut = (): DataResult<OptionMarketSnapshot> => ok(optVal("PE"), { source: "test" });
const staleCall = (reason: string): DataResult<OptionMarketSnapshot> => stale(optVal("CE"), { source: "test", reason });

test("H1. all three available → complete", () => {
  const h = deriveDerivativesHealth({ future: okFut(), call: okCall(), put: okPut() });
  assert.equal(h.status, "complete");
  assert.equal(h.usableLegs, 3);
  assert.equal(h.staleLegs, 0);
  assert.equal(h.failedLegs, 0);
  assert.deepEqual(h.reasons, []);
});

test("H2. one usable-but-stale leg → degraded", () => {
  const h = deriveDerivativesHealth({ future: staleFut("stale futures fallback"), call: okCall(), put: okPut() });
  assert.equal(h.status, "degraded");
  assert.equal(h.usableLegs, 3);
  assert.equal(h.staleLegs, 1);
  assert.equal(h.failedLegs, 0);
  assert.deepEqual(h.reasons, ["stale futures fallback"]);
});

test("H3. one failed + two available (no stale) → partial", () => {
  const h = deriveDerivativesHealth({ future: okFut(), call: unavailable("no CE at ATM"), put: okPut() });
  assert.equal(h.status, "partial");
  assert.equal(h.usableLegs, 2);
  assert.equal(h.staleLegs, 0);
  assert.equal(h.failedLegs, 1);
  assert.deepEqual(h.reasons, ["no CE at ATM"]);
});

test("H4. one stale + one failed → degraded (stale precedence over partial)", () => {
  const h = deriveDerivativesHealth({ future: staleFut("stale fut"), call: unavailable("no CE"), put: okPut() });
  assert.equal(h.status, "degraded");
  assert.equal(h.usableLegs, 2);
  assert.equal(h.staleLegs, 1);
  assert.equal(h.failedLegs, 1);
  // reasons in future→call→put order
  assert.deepEqual(h.reasons, ["stale fut", "no CE"]);
});

test("H5. all three failed → unavailable", () => {
  const h = deriveDerivativesHealth({ future: unavailable("f"), call: unavailable("c"), put: unavailable("p") });
  assert.equal(h.status, "unavailable");
  assert.equal(h.usableLegs, 0);
  assert.equal(h.failedLegs, 3);
});

test("H6. reasons are deterministic in future → call → put order", () => {
  const h = deriveDerivativesHealth({ future: unavailable("F-reason"), call: unavailable("C-reason"), put: unavailable("P-reason") });
  assert.deepEqual(h.reasons, ["F-reason", "C-reason", "P-reason"]);
});

test("H7. identical reasons across legs are deduplicated", () => {
  const h = deriveDerivativesHealth({ future: okFut(), call: unavailable("no contract"), put: unavailable("no contract") });
  assert.equal(h.status, "partial");
  assert.deepEqual(h.reasons, ["no contract"]);
});

test("H8. stale leg without a reason gets a minimal non-fabricated marker", () => {
  const h = deriveDerivativesHealth({ future: stale(futVal(), { source: "test" }), call: okCall(), put: okPut() });
  assert.equal(h.status, "degraded");
  assert.deepEqual(h.reasons, ["stale market data"]);
});
