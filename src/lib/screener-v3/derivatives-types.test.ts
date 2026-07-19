// Contract shape tests for Phase 2B derivatives types. Runtime assertions lock
// intent; `tsc --noEmit` provides the real structural guarantees.
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  FuturesMarketSnapshot,
  OptionMarketSnapshot,
  DerivativesDepthLevel,
  DerivativesSelection,
} from "./derivatives-types.ts";

const REF = 1_785_000_000_000;

function makeFuture(overrides: Partial<FuturesMarketSnapshot> = {}): FuturesMarketSnapshot {
  const buyDepth: readonly DerivativesDepthLevel[] = [
    { price: 100, quantity: 500, orders: 3 },
    { price: 0, quantity: 0, orders: null }, // zero level is valid
  ];
  return {
    symbol: "RELIANCE",
    tradingSymbol: "RELIANCE FUT 28 JUL 26",
    instrumentKey: "NSE_FO|61284",
    expiryMs: REF + 9 * 86_400_000,
    expiryDateIst: "2026-07-28",
    lotSize: 500,
    lastPrice: 0, // zero is a genuine value, not "missing"
    open: 1300,
    high: 1330,
    low: 1296,
    close: 1327,
    volume: 0,
    averagePrice: null,
    openInterest: null,
    openInterestDayHigh: null,
    openInterestDayLow: null,
    netChange: -5.5,
    totalBuyQuantity: 0,
    totalSellQuantity: null,
    bestBid: 0,
    bestAsk: null,
    buyDepth,
    sellDepth: [],
    providerTimestampMs: null,
    lastTradeTimeMs: null,
    receivedAtMs: REF,
    sessionState: "unknown",
    source: "upstox_full_market_quote",
    ...overrides,
  };
}

function makeOption(overrides: Partial<OptionMarketSnapshot> = {}): OptionMarketSnapshot {
  return {
    symbol: "RELIANCE",
    optionType: "CE",
    strike: 1330,
    expiryMs: REF + 9 * 86_400_000,
    expiryDateIst: "2026-07-28",
    instrumentKey: "NSE_FO|141549",
    lastPrice: 0,
    closePrice: null,
    volume: 0,
    openInterest: null,
    previousOpenInterest: null,
    openInterestChange: null,
    bidPrice: 0, // real zero bid
    bidQuantity: 0,
    askPrice: null, // missing ask
    askQuantity: null,
    impliedVolatilityPct: 0,
    delta: -0.5, // negative delta preserved (a put-like value)
    gamma: 0,
    theta: -1.0878, // negative theta preserved
    vega: 0.92,
    probabilityOfProfit: null,
    providerTimestampMs: null,
    receivedAtMs: REF,
    sessionState: "unknown",
    source: "upstox_option_chain",
    ...overrides,
  };
}

test("C1. futures snapshot preserves zero as a genuine value (not coerced to null)", () => {
  const f = makeFuture();
  assert.equal(f.lastPrice, 0);
  assert.equal(f.volume, 0);
  assert.equal(f.bestBid, 0);
  assert.equal(f.totalBuyQuantity, 0);
});

test("C2. futures snapshot preserves explicit null (missing) fields", () => {
  const f = makeFuture();
  assert.equal(f.openInterest, null);
  assert.equal(f.bestAsk, null);
  assert.equal(f.providerTimestampMs, null);
  assert.equal(f.lastTradeTimeMs, null);
});

test("C3. futures snapshot has NO previousOpenInterest / openInterestChange fields", () => {
  const f = makeFuture();
  assert.equal("openInterestChange" in f, false);
  assert.equal("previousOpenInterest" in f, false);
});

test("C4. depth levels allow zero price/quantity and null orders; arrays readable", () => {
  const f = makeFuture();
  assert.equal(f.buyDepth.length, 2);
  assert.equal(f.buyDepth[0].price, 100);
  assert.equal(f.buyDepth[1].price, 0);
  assert.equal(f.buyDepth[1].quantity, 0);
  assert.equal(f.buyDepth[1].orders, null);
  assert.equal(f.sellDepth.length, 0);
});

test("C5. option snapshot preserves negative Greeks (never clamped)", () => {
  const p = makeOption({ optionType: "PE", delta: -0.4975, theta: -1.098 });
  assert.equal(p.delta, -0.4975);
  assert.equal(p.theta, -1.098);
});

test("C6. option snapshot distinguishes zero bid from missing ask", () => {
  const o = makeOption();
  assert.equal(o.bidPrice, 0);
  assert.equal(o.bidQuantity, 0);
  assert.equal(o.askPrice, null);
  assert.equal(o.askQuantity, null);
});

test("C7. option openInterestChange accepts positive, negative, and zero", () => {
  assert.equal(makeOption({ openInterestChange: 20 }).openInterestChange, 20);
  assert.equal(makeOption({ openInterestChange: -20 }).openInterestChange, -20);
  assert.equal(makeOption({ openInterestChange: 0 }).openInterestChange, 0);
  assert.equal(makeOption({ openInterestChange: null }).openInterestChange, null);
});

test("C8. IV is canonical percent-style on the contract", () => {
  assert.equal(makeOption({ impliedVolatilityPct: 26.0 }).impliedVolatilityPct, 26.0);
});

test("C9. selection identity keeps CE/PE keys independent and nullable", () => {
  const sel: DerivativesSelection = {
    futureInstrumentKey: "NSE_FO|61284",
    futureExpiryMs: REF,
    optionExpiryMs: REF,
    anchorPrice: 1327.2,
    atmStrike: 1330,
    callInstrumentKey: "NSE_FO|141549",
    putInstrumentKey: null, // one leg independently missing
    resolvedFrom: "instrument_master",
  };
  assert.equal(sel.callInstrumentKey, "NSE_FO|141549");
  assert.equal(sel.putInstrumentKey, null);
  assert.equal(sel.resolvedFrom, "instrument_master");
});
