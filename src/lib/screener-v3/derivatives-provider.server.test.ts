// Phase 2B Part 2 — provider-adapter tests. Every test injects a fake fetch and
// a fake token resolver: NO live network, NO real credentials. Assertions prove
// truthful transport/availability, strict normalization, response-token
// matching, and that the access token never leaks into any output.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createUpstoxDerivativesProvider,
  parseUpstoxTimestampMs,
  MAX_FUTURES_BATCH,
  MAX_OPTION_GREEK_BATCH,
} from "./derivatives-provider.server.ts";
import { isOk, isFailure } from "./types.ts";
import type { SelectedFuture, SelectedAtmPair } from "./derivatives-selectors.ts";
import type { OptionContract, OptionType } from "./instrument-types.ts";

// ── Time helper (epoch ms whose IST wall-clock is the given moment) ──────────
function istEpoch(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi, s) - 5.5 * 3_600_000;
}
const REF_FRI = istEpoch(2026, 7, 17, 10, 0, 0); // Friday, in-session
const TOKEN = "TEST_TOKEN_SECRET";

// ── Fake fetch builders ──────────────────────────────────────────────────────
interface Call {
  url: string;
  init?: RequestInit;
}
function jsonFetch(body: unknown, status = 200) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
function textFetch(text: string, status = 200) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(text, { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
function throwingFetch(message: string) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    throw new Error(message);
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const token = () => TOKEN;
function authHeader(call: Call): string | undefined {
  const h = call.init?.headers as Record<string, string> | undefined;
  return h?.Authorization;
}
function assertNoLeak(reason: string | undefined): void {
  if (!reason) return;
  assert.ok(!reason.includes(TOKEN), `reason leaks token: ${reason}`);
  assert.ok(!reason.includes("Bearer"), `reason leaks Bearer: ${reason}`);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
function selFut(overrides: Partial<SelectedFuture> = {}): SelectedFuture {
  return {
    symbol: "RELIANCE",
    instrumentKey: "NSE_FO|RELI",
    tradingSymbol: "RELIANCE FUT",
    expiryMs: istEpoch(2026, 7, 28),
    expiryDateIst: "2026-07-28",
    lotSize: 500,
    ...overrides,
  };
}
function futEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    instrument_token: "NSE_FO|RELI",
    last_price: 1300,
    ohlc: { open: 1290, high: 1320, low: 1288, close: 1295 },
    volume: 100000,
    average_price: 1305,
    oi: 5000,
    oi_day_high: 5200,
    oi_day_low: 4800,
    net_change: 5,
    total_buy_quantity: 1200,
    total_sell_quantity: 1100,
    depth: {
      buy: [
        { price: 1299, quantity: 50, orders: 3 },
        { price: 1298, quantity: 40, orders: 2 },
      ],
      sell: [
        { price: 1301, quantity: 60, orders: 4 },
        { price: 1302, quantity: 30, orders: 1 },
      ],
    },
    timestamp: istEpoch(2026, 7, 17, 15, 30, 0),
    last_trade_time: istEpoch(2026, 7, 17, 9, 58, 0), // fresh vs REF_FRI
    ...overrides,
  };
}
function futResponse(entries: Record<string, unknown>) {
  return { status: "success", data: entries };
}

function optContract(key: string, type: OptionType, strike: number): OptionContract {
  return {
    instrumentKey: key,
    tradingSymbol: `${strike}${type}`,
    expiry: istEpoch(2026, 7, 28),
    expiryDateIst: "2026-07-28",
    strike,
    optionType: type,
    lotSize: 500,
  };
}
function selPair(overrides: Partial<SelectedAtmPair> = {}): SelectedAtmPair {
  return {
    symbol: "RELIANCE",
    expiryMs: istEpoch(2026, 7, 28),
    expiryDateIst: "2026-07-28",
    anchorPrice: 1327,
    atmStrike: 1320,
    call: optContract("NSE_FO|C1320", "CE", 1320),
    put: optContract("NSE_FO|P1320", "PE", 1320),
    ...overrides,
  };
}
function md(o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ltp: 20,
    close_price: 18,
    volume: 500,
    oi: 1000,
    prev_oi: 900,
    bid_price: 19,
    bid_qty: 100,
    ask_price: 21,
    ask_qty: 100,
    ...o,
  };
}
function gk(o: Record<string, unknown> = {}): Record<string, unknown> {
  return { iv: 26, delta: 0.5, gamma: 0.01, theta: -1, vega: 0.9, pop: 33, ...o };
}
function side(key: string, mdO: Record<string, unknown> = {}, gkO: Record<string, unknown> = {}) {
  return { instrument_key: key, market_data: md(mdO), option_greeks: gk(gkO) };
}
function chain(rows: unknown[]) {
  return { status: "success", data: rows };
}

function greekEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    instrument_token: "NSE_FO|C1320",
    last_price: 20,
    cp: 18,
    volume: 500,
    oi: 1000,
    iv: 0.26, // decimal → 26 percent
    delta: 0.5,
    gamma: 0.01,
    theta: -1,
    vega: 0.9,
    pop: 33,
    ...overrides,
  };
}
function greekResponse(entries: Record<string, unknown>) {
  return { status: "success", data: entries };
}
function greekReq(
  key: string,
  type: OptionType,
  strike: number,
  symbol = "RELIANCE",
): { symbol: string; contract: OptionContract } {
  return { symbol, contract: optContract(key, type, strike) };
}

// ═══════════════════════════════════════════════════════════════════════════
// parseUpstoxTimestampMs (pure)
// ═══════════════════════════════════════════════════════════════════════════
test("P1. timestamp parsing: numbers, digit strings, ISO strings, junk", () => {
  assert.equal(parseUpstoxTimestampMs(1_785_000_000_000), 1_785_000_000_000);
  assert.equal(parseUpstoxTimestampMs("1785000000000"), 1_785_000_000_000);
  assert.equal(parseUpstoxTimestampMs("2026-07-17T15:30:00+05:30"), Date.parse("2026-07-17T15:30:00+05:30"));
  assert.equal(parseUpstoxTimestampMs("not-a-date"), null);
  assert.equal(parseUpstoxTimestampMs(NaN), null);
  assert.equal(parseUpstoxTimestampMs(Infinity), null);
  assert.equal(parseUpstoxTimestampMs(0), null);
  assert.equal(parseUpstoxTimestampMs(-5), null);
  assert.equal(parseUpstoxTimestampMs(null), null);
  assert.equal(parseUpstoxTimestampMs(undefined), null);
  assert.equal(parseUpstoxTimestampMs(""), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// Transport
// ═══════════════════════════════════════════════════════════════════════════
test("T1. access token is resolved at call time, not at construction", async () => {
  let tokenCalls = 0;
  const getToken = () => {
    tokenCalls++;
    return TOKEN;
  };
  const { fn } = jsonFetch(futResponse({ "NSE_FO:X": futEntry() }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: getToken });
  assert.equal(tokenCalls, 0, "token must not be read during construction");
  await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI });
  assert.equal(tokenCalls, 1, "token must be resolved exactly at request time");
});

test("T2. missing token → provider_error, no fetch", async () => {
  const { fn, calls } = jsonFetch(futResponse({}));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: () => undefined });
  const map = await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI });
  const r = map.get("NSE_FO|RELI")!;
  assert.equal(r.status, "provider_error");
  assert.equal(calls.length, 0);
  assertNoLeak(isFailure(r) ? r.reason : undefined);
});

test("T3. blank token → provider_error", async () => {
  const { fn, calls } = jsonFetch(futResponse({}));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: () => "   " });
  const map = await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI });
  assert.equal(map.get("NSE_FO|RELI")!.status, "provider_error");
  assert.equal(calls.length, 0);
});

test("T4. Authorization Bearer header is sent, and never leaks into output", async () => {
  const { fn, calls } = jsonFetch(futResponse({ "NSE_FO:X": futEntry() }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI });
  assert.equal(authHeader(calls[0]), `Bearer ${TOKEN}`);
  // Accept header present too.
  const h = calls[0].init?.headers as Record<string, string>;
  assert.equal(h.Accept, "application/json");
});

test("T5. HTTP 401 → provider_error without leaking token", async () => {
  const { fn } = jsonFetch({ status: "error" }, 401);
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const map = await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI });
  const r = map.get("NSE_FO|RELI")!;
  assert.equal(r.status, "provider_error");
  assertNoLeak(isFailure(r) ? r.reason : undefined);
});

test("T6. HTTP 429 → provider_error", async () => {
  const { fn } = jsonFetch({}, 429);
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const map = await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI });
  assert.equal(map.get("NSE_FO|RELI")!.status, "provider_error");
});

test("T7. HTTP 500 → provider_error", async () => {
  const { fn } = jsonFetch({}, 500);
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  assert.equal(
    (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI })).get("NSE_FO|RELI")!.status,
    "provider_error",
  );
});

test("T8. invalid JSON body → provider_error", async () => {
  const { fn } = textFetch("{not valid json", 200);
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI })).get("NSE_FO|RELI")!;
  assert.equal(r.status, "provider_error");
  assertNoLeak(isFailure(r) ? r.reason : undefined);
});

test("T9. Upstox { status: 'error' } envelope → provider_error", async () => {
  const { fn } = jsonFetch({ status: "error", errors: [{ message: "bad" }] }, 200);
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  assert.equal(
    (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI })).get("NSE_FO|RELI")!.status,
    "provider_error",
  );
});

test("T10. fetch throw → provider_error and raw error message never surfaced", async () => {
  const { fn } = throwingFetch(`socket died with Bearer ${TOKEN}`);
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI })).get("NSE_FO|RELI")!;
  assert.equal(r.status, "provider_error");
  assertNoLeak(isFailure(r) ? r.reason : undefined);
});

test("T11. no console logging occurs across success and failure paths", async () => {
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const original: Record<string, unknown> = {};
  let hits = 0;
  for (const m of methods) {
    original[m] = console[m];
    (console as unknown as Record<string, unknown>)[m] = () => {
      hits++;
    };
  }
  try {
    const good = createUpstoxDerivativesProvider({
      fetchImpl: jsonFetch(futResponse({ "NSE_FO:X": futEntry() })).fn,
      getAccessToken: token,
    });
    await good.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI });
    const bad = createUpstoxDerivativesProvider({
      fetchImpl: throwingFetch("boom").fn,
      getAccessToken: token,
    });
    await bad.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI });
  } finally {
    for (const m of methods) (console as unknown as Record<string, unknown>)[m] = original[m];
  }
  assert.equal(hits, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Futures adapter
// ═══════════════════════════════════════════════════════════════════════════
test("FU1. empty input → empty map and zero fetch calls", async () => {
  const { fn, calls } = jsonFetch(futResponse({}));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const map = await provider.fetchFuturesQuotes({ futures: [], referenceMs: REF_FRI });
  assert.equal(map.size, 0);
  assert.equal(calls.length, 0);
});

test("FU2. duplicate future keys are deduplicated (one request key)", async () => {
  const { fn, calls } = jsonFetch(futResponse({ "NSE_FO:X": futEntry() }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  await provider.fetchFuturesQuotes({ futures: [selFut(), selFut()], referenceMs: REF_FRI });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).searchParams.get("instrument_key"), "NSE_FO|RELI");
});

test("FU3. multiple futures use a single batched request", async () => {
  const { fn, calls } = jsonFetch(
    futResponse({
      a: futEntry({ instrument_token: "NSE_FO|RELI" }),
      b: futEntry({ instrument_token: "NSE_FO|SBIN" }),
    }),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const map = await provider.fetchFuturesQuotes({
    futures: [selFut(), selFut({ instrumentKey: "NSE_FO|SBIN", symbol: "SBIN" })],
    referenceMs: REF_FRI,
  });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).searchParams.get("instrument_key"), "NSE_FO|RELI,NSE_FO|SBIN");
  assert.ok(isOk(map.get("NSE_FO|RELI")!));
  assert.ok(isOk(map.get("NSE_FO|SBIN")!));
});

test("FU4. response matched by instrument_token, NOT by the response object key", async () => {
  // Object key is trading-symbol style and unrelated to the requested key.
  const { fn } = jsonFetch(futResponse({ "NSE_FO:RELIANCE26JULFUT": futEntry({ instrument_token: "NSE_FO|RELI" }) }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const map = await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI });
  assert.ok(isOk(map.get("NSE_FO|RELI")!));
});

test("FU5. requested contract missing from response → unavailable", async () => {
  const { fn } = jsonFetch(futResponse({ other: futEntry({ instrument_token: "NSE_FO|OTHER" }) }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const map = await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI });
  assert.equal(map.get("NSE_FO|RELI")!.status, "unavailable");
});

test("FU6. full successful normalization from verified fields", async () => {
  const { fn } = jsonFetch(futResponse({ k: futEntry() }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI })).get("NSE_FO|RELI")!;
  assert.ok(isOk(r));
  if (isOk(r)) {
    const v = r.value;
    assert.equal(v.symbol, "RELIANCE");
    assert.equal(v.instrumentKey, "NSE_FO|RELI");
    assert.equal(v.lastPrice, 1300);
    assert.equal(v.open, 1290);
    assert.equal(v.high, 1320);
    assert.equal(v.low, 1288);
    assert.equal(v.close, 1295);
    assert.equal(v.volume, 100000);
    assert.equal(v.averagePrice, 1305);
    assert.equal(v.openInterest, 5000);
    assert.equal(v.openInterestDayHigh, 5200);
    assert.equal(v.openInterestDayLow, 4800);
    assert.equal(v.netChange, 5);
    assert.equal(v.totalBuyQuantity, 1200);
    assert.equal(v.totalSellQuantity, 1100);
    assert.equal(v.buyDepth.length, 2);
    assert.equal(v.sellDepth.length, 2);
    assert.equal(v.bestBid, 1299);
    assert.equal(v.bestAsk, 1301);
    assert.equal(v.receivedAtMs, REF_FRI);
    assert.equal(v.source, "upstox_full_market_quote");
    assert.equal(v.sessionState, "live");
  }
});

test("FU7. zero values are preserved (never coerced to null)", async () => {
  const { fn } = jsonFetch(
    futResponse({
      k: futEntry({
        last_price: 0,
        volume: 0,
        oi: 0,
        total_buy_quantity: 0,
        depth: { buy: [{ price: 0, quantity: 0, orders: 0 }], sell: [] },
      }),
    }),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI })).get("NSE_FO|RELI")!;
  assert.ok(isOk(r));
  if (isOk(r)) {
    assert.equal(r.value.lastPrice, 0);
    assert.equal(r.value.volume, 0);
    assert.equal(r.value.openInterest, 0);
    assert.equal(r.value.totalBuyQuantity, 0);
    assert.equal(r.value.bestBid, 0); // zero-price level is valid
    assert.equal(r.value.buyDepth[0].quantity, 0);
    assert.equal(r.value.bestAsk, null); // no sell levels
  }
});

test("FU8. invalid numerics and numeric strings become null (no silent coercion)", async () => {
  const { fn } = jsonFetch(
    futResponse({ k: futEntry({ last_price: "not-a-number", oi: "5000", volume: "100" }) }),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI })).get("NSE_FO|RELI")!;
  assert.ok(isOk(r));
  if (isOk(r)) {
    assert.equal(r.value.lastPrice, null);
    assert.equal(r.value.openInterest, null);
    assert.equal(r.value.volume, null);
  }
});

test("FU9. invalid depth levels are discarded, valid order preserved", async () => {
  const { fn } = jsonFetch(
    futResponse({
      k: futEntry({
        depth: {
          buy: [
            { price: 1299, quantity: 50, orders: 3 },
            { price: -5, quantity: 10, orders: 1 }, // invalid negative price → discarded
            { price: 1297, quantity: 20, orders: 2 },
          ],
          sell: [],
        },
      }),
    }),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI })).get("NSE_FO|RELI")!;
  assert.ok(isOk(r));
  if (isOk(r)) {
    assert.equal(r.value.buyDepth.length, 2);
    assert.equal(r.value.buyDepth[0].price, 1299);
    assert.equal(r.value.buyDepth[1].price, 1297);
  }
});

test("FU10. depth is capped at five valid levels per side", async () => {
  const sixLevels = Array.from({ length: 6 }, (_, i) => ({ price: 1300 - i, quantity: 10, orders: 1 }));
  const { fn } = jsonFetch(futResponse({ k: futEntry({ depth: { buy: sixLevels, sell: sixLevels } }) }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI })).get("NSE_FO|RELI")!;
  assert.ok(isOk(r));
  if (isOk(r)) {
    assert.equal(r.value.buyDepth.length, 5);
    assert.equal(r.value.sellDepth.length, 5);
  }
});

test("FU11. best bid/ask come from the first VALID depth level", async () => {
  const { fn } = jsonFetch(
    futResponse({
      k: futEntry({
        depth: {
          buy: [
            { price: "x", quantity: 10, orders: 1 }, // invalid → skipped
            { price: 1299, quantity: 50, orders: 2 },
          ],
          sell: [{ price: 1305, quantity: 30, orders: 1 }],
        },
      }),
    }),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI })).get("NSE_FO|RELI")!;
  assert.ok(isOk(r));
  if (isOk(r)) {
    assert.equal(r.value.bestBid, 1299);
    assert.equal(r.value.bestAsk, 1305);
  }
});

test("FU12. provider timestamp is parsed separately from last-trade time", async () => {
  const iso = "2026-07-17T15:30:00+05:30";
  const { fn } = jsonFetch(
    futResponse({ k: futEntry({ timestamp: iso, last_trade_time: istEpoch(2026, 7, 17, 9, 58, 0) }) }),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI })).get("NSE_FO|RELI")!;
  assert.ok(isOk(r));
  if (isOk(r)) {
    assert.equal(r.value.providerTimestampMs, Date.parse(iso));
    assert.equal(r.value.lastTradeTimeMs, istEpoch(2026, 7, 17, 9, 58, 0));
    assert.notEqual(r.value.providerTimestampMs, r.value.lastTradeTimeMs);
  }
});

test("FU13. last-trade time as a numeric string is parsed to epoch ms", async () => {
  const ltt = istEpoch(2026, 7, 17, 9, 58, 0);
  const { fn } = jsonFetch(futResponse({ k: futEntry({ last_trade_time: String(ltt) }) }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI })).get("NSE_FO|RELI")!;
  assert.ok(isOk(r));
  if (isOk(r)) assert.equal(r.value.lastTradeTimeMs, ltt);
});

test("FU14. Sunday reference + Friday last trade → sessionState eod", async () => {
  const { fn } = jsonFetch(futResponse({ k: futEntry({ last_trade_time: istEpoch(2026, 7, 17, 15, 29, 0) }) }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: istEpoch(2026, 7, 19, 12, 0, 0) })).get(
    "NSE_FO|RELI",
  )!;
  assert.ok(isOk(r));
  if (isOk(r)) assert.equal(r.value.sessionState, "eod");
});

test("FU15. open-session fresh last trade → sessionState live", async () => {
  const { fn } = jsonFetch(futResponse({ k: futEntry({ last_trade_time: istEpoch(2026, 7, 17, 9, 58, 0) }) }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI })).get("NSE_FO|RELI")!;
  assert.ok(isOk(r));
  if (isOk(r)) assert.equal(r.value.sessionState, "live");
});

test("FU16. open-session but lagging last trade → sessionState stale", async () => {
  const { fn } = jsonFetch(futResponse({ k: futEntry({ last_trade_time: istEpoch(2026, 7, 17, 9, 40, 0) }) }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI })).get("NSE_FO|RELI")!;
  assert.ok(isOk(r));
  if (isOk(r)) assert.equal(r.value.sessionState, "stale");
});

test("FU17. future last-trade timestamp → sessionState unknown (and transport still available)", async () => {
  const { fn } = jsonFetch(futResponse({ k: futEntry({ last_trade_time: REF_FRI + 60_000 }) }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI })).get("NSE_FO|RELI")!;
  assert.ok(isOk(r)); // sessionState unknown must NOT become a failed DataResult
  if (isOk(r)) assert.equal(r.value.sessionState, "unknown");
});

test("FU18. futures snapshot has NO previousOpenInterest / openInterestChange fields", async () => {
  const { fn } = jsonFetch(futResponse({ k: futEntry() }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI })).get("NSE_FO|RELI")!;
  assert.ok(isOk(r));
  if (isOk(r)) {
    assert.equal("previousOpenInterest" in r.value, false);
    assert.equal("openInterestChange" in r.value, false);
  }
});

test("FU19. more than 500 unique keys → invalid_input for all, without a fetch", async () => {
  const { fn, calls } = jsonFetch(futResponse({}));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const futures = Array.from({ length: MAX_FUTURES_BATCH + 1 }, (_, i) => selFut({ instrumentKey: `NSE_FO|K${i}` }));
  const map = await provider.fetchFuturesQuotes({ futures, referenceMs: REF_FRI });
  assert.equal(calls.length, 0);
  assert.equal(map.size, MAX_FUTURES_BATCH + 1);
  assert.equal(map.get("NSE_FO|K0")!.status, "invalid_input");
});

test("FU20. blank key → invalid_input under '' and absent from the query; valid key proceeds", async () => {
  const { fn, calls } = jsonFetch(futResponse({ k: futEntry() }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const map = await provider.fetchFuturesQuotes({
    futures: [selFut({ instrumentKey: "   " }), selFut()],
    referenceMs: REF_FRI,
  });
  assert.equal(calls.length, 1);
  // Invalid key is NOT in the HTTP query.
  assert.equal(new URL(calls[0].url).searchParams.get("instrument_key"), "NSE_FO|RELI");
  // Caller is told truthfully: blank key represented as invalid_input under "".
  assert.equal(map.get("")!.status, "invalid_input");
  assert.equal(map.has("   "), false);
  // Valid key still proceeds.
  assert.ok(isOk(map.get("NSE_FO|RELI")!));
});

test("FU21. invalid referenceMs → invalid_input for every fetchable key, no fetch", async () => {
  for (const bad of [0, -1, NaN, Infinity]) {
    const { fn, calls } = jsonFetch(futResponse({ k: futEntry() }));
    const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
    const map = await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: bad });
    assert.equal(calls.length, 0, `bad ref ${bad} must not fetch`);
    assert.equal(map.get("NSE_FO|RELI")!.status, "invalid_input");
  }
});

test("FU22. negative impossible numerics (price/volume/OI/quantities) → null; netChange stays signed", async () => {
  const { fn } = jsonFetch(
    futResponse({
      k: futEntry({
        last_price: -10,
        volume: -5,
        oi: -100,
        total_buy_quantity: -3,
        net_change: -7.5, // legitimately signed → preserved
      }),
    }),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI })).get("NSE_FO|RELI")!;
  assert.ok(isOk(r));
  if (isOk(r)) {
    assert.equal(r.value.lastPrice, null);
    assert.equal(r.value.volume, null);
    assert.equal(r.value.openInterest, null);
    assert.equal(r.value.totalBuyQuantity, null);
    assert.equal(r.value.netChange, -7.5);
  }
});

test("FU23. duplicate response entries for one token → first valid match wins", async () => {
  const { fn } = jsonFetch(
    futResponse({
      first: futEntry({ instrument_token: "NSE_FO|RELI", last_price: 111 }),
      second: futEntry({ instrument_token: "NSE_FO|RELI", last_price: 999 }),
    }),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchFuturesQuotes({ futures: [selFut()], referenceMs: REF_FRI })).get("NSE_FO|RELI")!;
  assert.ok(isOk(r));
  if (isOk(r)) assert.equal(r.value.lastPrice, 111); // later duplicate never overwrites
});

// ═══════════════════════════════════════════════════════════════════════════
// Option-chain adapter
// ═══════════════════════════════════════════════════════════════════════════
test("OC1. the exact selected ATM strike row is used", async () => {
  const { fn } = jsonFetch(
    chain([
      { strike_price: 1300, call_options: side("NSE_FO|C1300"), put_options: side("NSE_FO|P1300") },
      { strike_price: 1320, call_options: side("NSE_FO|C1320"), put_options: side("NSE_FO|P1320") },
      { strike_price: 1340, call_options: side("NSE_FO|C1340"), put_options: side("NSE_FO|P1340") },
    ]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call, put } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair(),
    referenceMs: REF_FRI,
  });
  assert.ok(isOk(call) && isOk(put));
  if (isOk(call)) assert.equal(call.value.strike, 1320);
});

test("OC2. adapter does NOT recompute ATM — it uses selection.atmStrike verbatim", async () => {
  // anchorPrice 1327 is nearer 1320, but the caller selected 1340; adapter must honour 1340.
  const { fn } = jsonFetch(
    chain([
      { strike_price: 1320, call_options: side("NSE_FO|C1320"), put_options: side("NSE_FO|P1320") },
      { strike_price: 1340, call_options: side("NSE_FO|C1340"), put_options: side("NSE_FO|P1340") },
    ]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call, put } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair({
      atmStrike: 1340,
      anchorPrice: 1327,
      call: optContract("NSE_FO|C1340", "CE", 1340),
      put: optContract("NSE_FO|P1340", "PE", 1340),
    }),
    referenceMs: REF_FRI,
  });
  assert.ok(isOk(call) && isOk(put));
  if (isOk(call)) assert.equal(call.value.strike, 1340);
});

test("OC3. both CE and PE normalize on a clean chain", async () => {
  const { fn } = jsonFetch(
    chain([{ strike_price: 1320, call_options: side("NSE_FO|C1320"), put_options: side("NSE_FO|P1320") }]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call, put } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair(),
    referenceMs: REF_FRI,
  });
  assert.ok(isOk(call));
  assert.ok(isOk(put));
  if (isOk(call)) {
    assert.equal(call.value.optionType, "CE");
    assert.equal(call.value.symbol, "RELIANCE");
    assert.equal(call.value.source, "upstox_option_chain");
  }
});

test("OC4. missing CALL selection → call unavailable (not a provider failure); put still resolves", async () => {
  const { fn } = jsonFetch(
    chain([{ strike_price: 1320, call_options: side("NSE_FO|C1320"), put_options: side("NSE_FO|P1320") }]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call, put } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair({ call: null }),
    referenceMs: REF_FRI,
  });
  assert.equal(call.status, "unavailable");
  assert.notEqual(call.status, "provider_error");
  assert.ok(isOk(put));
});

test("OC5. missing PUT selection → put unavailable; call still resolves", async () => {
  const { fn } = jsonFetch(
    chain([{ strike_price: 1320, call_options: side("NSE_FO|C1320"), put_options: side("NSE_FO|P1320") }]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call, put } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair({ put: null }),
    referenceMs: REF_FRI,
  });
  assert.equal(put.status, "unavailable");
  assert.ok(isOk(call));
});

test("OC6. the selected strike row is absent from the response → both unavailable", async () => {
  const { fn } = jsonFetch(
    chain([{ strike_price: 1300, call_options: side("NSE_FO|C1300"), put_options: side("NSE_FO|P1300") }]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call, put } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair(),
    referenceMs: REF_FRI,
  });
  assert.equal(call.status, "unavailable");
  assert.equal(put.status, "unavailable");
});

test("OC7. returned CALL leg missing on the matched row → call unavailable", async () => {
  const { fn } = jsonFetch(chain([{ strike_price: 1320, put_options: side("NSE_FO|P1320") }]));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call, put } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair(),
    referenceMs: REF_FRI,
  });
  assert.equal(call.status, "unavailable");
  assert.ok(isOk(put));
});

test("OC8. returned PUT leg missing on the matched row → put unavailable", async () => {
  const { fn } = jsonFetch(chain([{ strike_price: 1320, call_options: side("NSE_FO|C1320") }]));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call, put } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair(),
    referenceMs: REF_FRI,
  });
  assert.equal(put.status, "unavailable");
  assert.ok(isOk(call));
});

test("OC9. returned instrument-key mismatch is handled truthfully (not trusted)", async () => {
  const { fn } = jsonFetch(
    chain([{ strike_price: 1320, call_options: side("NSE_FO|WRONG"), put_options: side("NSE_FO|P1320") }]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair(),
    referenceMs: REF_FRI,
  });
  assert.equal(call.status, "unavailable");
  if (isFailure(call)) assert.match(call.reason, /mismatch/);
});

test("OC10. option OI change positive (oi - prev_oi)", async () => {
  const { fn } = jsonFetch(
    chain([
      {
        strike_price: 1320,
        call_options: side("NSE_FO|C1320", { oi: 1000, prev_oi: 900 }),
        put_options: side("NSE_FO|P1320"),
      },
    ]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair(),
    referenceMs: REF_FRI,
  });
  assert.ok(isOk(call));
  if (isOk(call)) assert.equal(call.value.openInterestChange, 100);
});

test("OC11. option OI change negative", async () => {
  const { fn } = jsonFetch(
    chain([
      {
        strike_price: 1320,
        call_options: side("NSE_FO|C1320", { oi: 800, prev_oi: 1000 }),
        put_options: side("NSE_FO|P1320"),
      },
    ]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair(),
    referenceMs: REF_FRI,
  });
  assert.ok(isOk(call));
  if (isOk(call)) assert.equal(call.value.openInterestChange, -200);
});

test("OC12. option OI change zero", async () => {
  const { fn } = jsonFetch(
    chain([
      {
        strike_price: 1320,
        call_options: side("NSE_FO|C1320", { oi: 1000, prev_oi: 1000 }),
        put_options: side("NSE_FO|P1320"),
      },
    ]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair(),
    referenceMs: REF_FRI,
  });
  assert.ok(isOk(call));
  if (isOk(call)) assert.equal(call.value.openInterestChange, 0);
});

test("OC13. missing previous OI → previousOpenInterest null and OI change null", async () => {
  const { fn } = jsonFetch(
    chain([
      {
        strike_price: 1320,
        call_options: side("NSE_FO|C1320", { oi: 1000, prev_oi: "n/a" }),
        put_options: side("NSE_FO|P1320"),
      },
    ]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair(),
    referenceMs: REF_FRI,
  });
  assert.ok(isOk(call));
  if (isOk(call)) {
    assert.equal(call.value.previousOpenInterest, null);
    assert.equal(call.value.openInterestChange, null);
  }
});

test("OC14. zero bid/ask are preserved as real values", async () => {
  const { fn } = jsonFetch(
    chain([
      {
        strike_price: 1320,
        call_options: side("NSE_FO|C1320", { bid_price: 0, ask_price: 0 }),
        put_options: side("NSE_FO|P1320"),
      },
    ]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair(),
    referenceMs: REF_FRI,
  });
  assert.ok(isOk(call));
  if (isOk(call)) {
    assert.equal(call.value.bidPrice, 0);
    assert.equal(call.value.askPrice, 0);
  }
});

test("OC15. negative delta/theta are preserved", async () => {
  const { fn } = jsonFetch(
    chain([
      {
        strike_price: 1320,
        call_options: side("NSE_FO|C1320", {}, { delta: -0.42, theta: -1.5 }),
        put_options: side("NSE_FO|P1320"),
      },
    ]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair(),
    referenceMs: REF_FRI,
  });
  assert.ok(isOk(call));
  if (isOk(call)) {
    assert.equal(call.value.delta, -0.42);
    assert.equal(call.value.theta, -1.5);
  }
});

test("OC16. option-chain IV passes through as canonical percent (26 → 26)", async () => {
  const { fn } = jsonFetch(
    chain([
      {
        strike_price: 1320,
        call_options: side("NSE_FO|C1320", {}, { iv: 26 }),
        put_options: side("NSE_FO|P1320"),
      },
    ]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair(),
    referenceMs: REF_FRI,
  });
  assert.ok(isOk(call));
  if (isOk(call)) assert.equal(call.value.impliedVolatilityPct, 26);
});

test("OC17. no market-data timestamp is fabricated (providerTimestampMs null)", async () => {
  const { fn } = jsonFetch(
    chain([{ strike_price: 1320, call_options: side("NSE_FO|C1320"), put_options: side("NSE_FO|P1320") }]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair(),
    referenceMs: REF_FRI,
  });
  assert.ok(isOk(call));
  if (isOk(call)) assert.equal(call.value.providerTimestampMs, null);
});

test("OC18. option sessionState is unknown when no truthful trade timestamp exists", async () => {
  const { fn } = jsonFetch(
    chain([{ strike_price: 1320, call_options: side("NSE_FO|C1320"), put_options: side("NSE_FO|P1320") }]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair(),
    referenceMs: REF_FRI,
  });
  assert.ok(isOk(call));
  if (isOk(call)) assert.equal(call.value.sessionState, "unknown");
});

test("OC19. invalid underlying key → invalid_input for both legs, no fetch", async () => {
  const { fn, calls } = jsonFetch(chain([]));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call, put } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "   ",
    selection: selPair(),
    referenceMs: REF_FRI,
  });
  assert.equal(call.status, "invalid_input");
  assert.equal(put.status, "invalid_input");
  assert.equal(calls.length, 0);
});

test("OC20. invalid expiry / invalid reference → invalid_input, no fetch", async () => {
  const { fn, calls } = jsonFetch(chain([]));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const badExpiry = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair({ expiryDateIst: "28-07-2026" }),
    referenceMs: REF_FRI,
  });
  const badRef = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair(),
    referenceMs: 0,
  });
  assert.equal(badExpiry.call.status, "invalid_input");
  assert.equal(badRef.put.status, "invalid_input");
  assert.equal(calls.length, 0);
});

test("OC21. selected CE contract wrongly typed PE → call invalid_input; valid put still resolves", async () => {
  const { fn } = jsonFetch(
    chain([{ strike_price: 1320, call_options: side("NSE_FO|C1320"), put_options: side("NSE_FO|P1320") }]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call, put } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair({ call: optContract("NSE_FO|C1320", "PE", 1320) }), // wrong type
    referenceMs: REF_FRI,
  });
  assert.equal(call.status, "invalid_input");
  assert.ok(isOk(put));
});

test("OC22. selected PE contract wrongly typed CE → put invalid_input", async () => {
  const { fn } = jsonFetch(
    chain([{ strike_price: 1320, call_options: side("NSE_FO|C1320"), put_options: side("NSE_FO|P1320") }]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { put } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair({ put: optContract("NSE_FO|P1320", "CE", 1320) }),
    referenceMs: REF_FRI,
  });
  assert.equal(put.status, "invalid_input");
});

test("OC23. selected leg strike does not match atmStrike → invalid_input", async () => {
  const { fn } = jsonFetch(
    chain([{ strike_price: 1320, call_options: side("NSE_FO|C1320"), put_options: side("NSE_FO|P1320") }]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair({ call: optContract("NSE_FO|C1300", "CE", 1300) }), // strike 1300 ≠ atm 1320
    referenceMs: REF_FRI,
  });
  assert.equal(call.status, "invalid_input");
});

test("OC24. selected leg expiry does not match selection expiry → invalid_input", async () => {
  const { fn } = jsonFetch(
    chain([{ strike_price: 1320, call_options: side("NSE_FO|C1320"), put_options: side("NSE_FO|P1320") }]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const wrongExpiry: OptionContract = {
    ...optContract("NSE_FO|C1320", "CE", 1320),
    expiry: istEpoch(2026, 8, 25),
    expiryDateIst: "2026-08-25",
  };
  const { call } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair({ call: wrongExpiry }),
    referenceMs: REF_FRI,
  });
  assert.equal(call.status, "invalid_input");
});

test("OC25. selected leg with blank instrument key → invalid_input, and if both blank no fetch", async () => {
  const { fn, calls } = jsonFetch(
    chain([{ strike_price: 1320, call_options: side("NSE_FO|C1320"), put_options: side("NSE_FO|P1320") }]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call, put } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair({
      call: optContract("   ", "CE", 1320),
      put: optContract("  ", "PE", 1320),
    }),
    referenceMs: REF_FRI,
  });
  assert.equal(call.status, "invalid_input");
  assert.equal(put.status, "invalid_input");
  assert.equal(calls.length, 0); // nothing fetchable → no HTTP
});

test("OC26. negative impossible option numerics → null; delta/theta stay signed", async () => {
  const { fn } = jsonFetch(
    chain([
      {
        strike_price: 1320,
        call_options: side(
          "NSE_FO|C1320",
          { bid_price: -1, ask_price: -2, oi: -5, volume: -3 },
          { gamma: -0.01, vega: -0.5, pop: -10, delta: -0.4, theta: -1.2 },
        ),
        put_options: side("NSE_FO|P1320"),
      },
    ]),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const { call } = await provider.fetchAtmOptionPair({
    underlyingInstrumentKey: "NSE_EQ|RELI",
    selection: selPair(),
    referenceMs: REF_FRI,
  });
  assert.ok(isOk(call));
  if (isOk(call)) {
    assert.equal(call.value.bidPrice, null);
    assert.equal(call.value.askPrice, null);
    assert.equal(call.value.openInterest, null);
    assert.equal(call.value.volume, null);
    assert.equal(call.value.gamma, null);
    assert.equal(call.value.vega, null);
    assert.equal(call.value.probabilityOfProfit, null);
    assert.equal(call.value.delta, -0.4); // signed preserved
    assert.equal(call.value.theta, -1.2); // signed preserved
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Timestamp parser strictness
// ═══════════════════════════════════════════════════════════════════════════
test("P2. epoch seconds are rejected (only plausible epoch ms accepted)", () => {
  assert.equal(parseUpstoxTimestampMs(1_785_000_000), null); // ~seconds, too small
  assert.equal(parseUpstoxTimestampMs("1785000000"), null);
  assert.equal(parseUpstoxTimestampMs(1_785_000_000_000), 1_785_000_000_000); // ms accepted
});

test("P3. ISO strings require a timezone; timezone-less/arbitrary text rejected", () => {
  assert.equal(parseUpstoxTimestampMs("2026-07-17T15:30:00Z"), Date.parse("2026-07-17T15:30:00Z"));
  assert.equal(parseUpstoxTimestampMs("2026-07-17T15:30:00+05:30"), Date.parse("2026-07-17T15:30:00+05:30"));
  assert.equal(parseUpstoxTimestampMs("2026-07-17T15:30:00"), null); // no tz → rejected
  assert.equal(parseUpstoxTimestampMs("2026-07-17"), null); // date only → rejected
  assert.equal(parseUpstoxTimestampMs("Fri Jul 17 2026"), null); // arbitrary → rejected
});

// ═══════════════════════════════════════════════════════════════════════════
// Option Greek V3 adapter
// ═══════════════════════════════════════════════════════════════════════════
test("GK1. empty contracts → empty map, zero fetch calls", async () => {
  const { fn, calls } = jsonFetch(greekResponse({}));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const map = await provider.fetchOptionGreeks({ contracts: [], referenceMs: REF_FRI });
  assert.equal(map.size, 0);
  assert.equal(calls.length, 0);
});

test("GK2. duplicate contract keys are deduplicated", async () => {
  const { fn, calls } = jsonFetch(greekResponse({ k: greekEntry() }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const req = greekReq("NSE_FO|C1320", "CE", 1320);
  const map = await provider.fetchOptionGreeks({ contracts: [req, req], referenceMs: REF_FRI });
  assert.equal(new URL(calls[0].url).searchParams.get("instrument_key"), "NSE_FO|C1320");
  assert.equal(map.size, 1);
});

test("GK3. multiple contracts use one batched request", async () => {
  const { fn, calls } = jsonFetch(
    greekResponse({ a: greekEntry({ instrument_token: "NSE_FO|C1320" }), b: greekEntry({ instrument_token: "NSE_FO|P1320" }) }),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  await provider.fetchOptionGreeks({
    contracts: [greekReq("NSE_FO|C1320", "CE", 1320), greekReq("NSE_FO|P1320", "PE", 1320)],
    referenceMs: REF_FRI,
  });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).searchParams.get("instrument_key"), "NSE_FO|C1320,NSE_FO|P1320");
});

test("GK4. exactly 50 unique keys are accepted (a request is made)", async () => {
  const { fn, calls } = jsonFetch(greekResponse({}));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const contracts = Array.from({ length: MAX_OPTION_GREEK_BATCH }, (_, i) => greekReq(`NSE_FO|C${i}`, "CE", 1000 + i));
  const map = await provider.fetchOptionGreeks({ contracts, referenceMs: REF_FRI });
  assert.equal(calls.length, 1);
  assert.equal(map.size, MAX_OPTION_GREEK_BATCH);
});

test("GK5. more than 50 unique keys → invalid_input for all, without a fetch", async () => {
  const { fn, calls } = jsonFetch(greekResponse({}));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const contracts = Array.from({ length: MAX_OPTION_GREEK_BATCH + 1 }, (_, i) => greekReq(`NSE_FO|C${i}`, "CE", 1000 + i));
  const map = await provider.fetchOptionGreeks({ contracts, referenceMs: REF_FRI });
  assert.equal(calls.length, 0);
  assert.equal(map.size, MAX_OPTION_GREEK_BATCH + 1);
  assert.equal(map.get("NSE_FO|C0")!.status, "invalid_input");
});

test("GK6. response matched by instrument_token, not object key", async () => {
  const { fn } = jsonFetch(greekResponse({ "NSE_FO:SOMEKEY": greekEntry({ instrument_token: "NSE_FO|C1320" }) }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const map = await provider.fetchOptionGreeks({ contracts: [greekReq("NSE_FO|C1320", "CE", 1320)], referenceMs: REF_FRI });
  assert.ok(isOk(map.get("NSE_FO|C1320")!));
});

test("GK7. Greek-V3 IV decimal 0.26 → canonical percent 26", async () => {
  const { fn } = jsonFetch(greekResponse({ k: greekEntry({ iv: 0.26 }) }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchOptionGreeks({ contracts: [greekReq("NSE_FO|C1320", "CE", 1320)], referenceMs: REF_FRI })).get(
    "NSE_FO|C1320",
  )!;
  assert.ok(isOk(r));
  if (isOk(r)) assert.equal(r.value.impliedVolatilityPct, 26);
});

test("GK8. LTP/close/volume/OI/Greeks normalized from verified fields", async () => {
  const { fn } = jsonFetch(greekResponse({ k: greekEntry() }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchOptionGreeks({ contracts: [greekReq("NSE_FO|C1320", "CE", 1320)], referenceMs: REF_FRI })).get(
    "NSE_FO|C1320",
  )!;
  assert.ok(isOk(r));
  if (isOk(r)) {
    assert.equal(r.value.lastPrice, 20);
    assert.equal(r.value.closePrice, 18);
    assert.equal(r.value.volume, 500);
    assert.equal(r.value.openInterest, 1000);
    assert.equal(r.value.delta, 0.5);
    assert.equal(r.value.theta, -1);
    assert.equal(r.value.source, "upstox_option_greek_v3");
  }
});

test("GK9/10/11. Greek V3 nulls: prev OI, OI change, bid/ask are always null", async () => {
  const { fn } = jsonFetch(greekResponse({ k: greekEntry() }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchOptionGreeks({ contracts: [greekReq("NSE_FO|C1320", "CE", 1320)], referenceMs: REF_FRI })).get(
    "NSE_FO|C1320",
  )!;
  assert.ok(isOk(r));
  if (isOk(r)) {
    assert.equal(r.value.previousOpenInterest, null);
    assert.equal(r.value.openInterestChange, null);
    assert.equal(r.value.bidPrice, null);
    assert.equal(r.value.bidQuantity, null);
    assert.equal(r.value.askPrice, null);
    assert.equal(r.value.askQuantity, null);
  }
});

test("GK12. missing response key → unavailable", async () => {
  const { fn } = jsonFetch(greekResponse({ other: greekEntry({ instrument_token: "NSE_FO|OTHER" }) }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchOptionGreeks({ contracts: [greekReq("NSE_FO|C1320", "CE", 1320)], referenceMs: REF_FRI })).get(
    "NSE_FO|C1320",
  )!;
  assert.equal(r.status, "unavailable");
});

test("GK13. no trustworthy trade timestamp → sessionState unknown", async () => {
  const { fn } = jsonFetch(greekResponse({ k: greekEntry() }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchOptionGreeks({ contracts: [greekReq("NSE_FO|C1320", "CE", 1320)], referenceMs: REF_FRI })).get(
    "NSE_FO|C1320",
  )!;
  assert.ok(isOk(r));
  if (isOk(r)) assert.equal(r.value.sessionState, "unknown");
});

test("GK14. blank key → invalid_input under '' and absent from the query; valid key proceeds", async () => {
  const { fn, calls } = jsonFetch(greekResponse({ k: greekEntry() }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const map = await provider.fetchOptionGreeks({
    contracts: [greekReq("   ", "CE", 1320), greekReq("NSE_FO|C1320", "CE", 1320)],
    referenceMs: REF_FRI,
  });
  assert.equal(new URL(calls[0].url).searchParams.get("instrument_key"), "NSE_FO|C1320");
  assert.equal(map.get("")!.status, "invalid_input");
  assert.ok(isOk(map.get("NSE_FO|C1320")!));
});

test("GK15. snapshot symbol is the UNDERLYING stock symbol, not the option trading symbol", async () => {
  const { fn } = jsonFetch(greekResponse({ k: greekEntry() }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (
    await provider.fetchOptionGreeks({
      contracts: [{ symbol: "reliance.NS", contract: optContract("NSE_FO|C1320", "CE", 1320) }],
      referenceMs: REF_FRI,
    })
  ).get("NSE_FO|C1320")!;
  assert.ok(isOk(r));
  if (isOk(r)) {
    assert.equal(r.value.symbol, "RELIANCE"); // normalized underlying, not "1320CE"
    assert.notEqual(r.value.symbol, r.value.instrumentKey);
  }
});

test("GK16. invalid underlying symbol → invalid_input (never derived from tradingSymbol)", async () => {
  const { fn, calls } = jsonFetch(greekResponse({ k: greekEntry() }));
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const map = await provider.fetchOptionGreeks({
    contracts: [{ symbol: "   ", contract: optContract("NSE_FO|C1320", "CE", 1320) }],
    referenceMs: REF_FRI,
  });
  assert.equal(map.get("NSE_FO|C1320")!.status, "invalid_input");
  assert.equal(calls.length, 0); // no fetchable key remained
});

test("GK17. invalid referenceMs → invalid_input for every fetchable key, no fetch", async () => {
  for (const bad of [0, -1, NaN, Infinity]) {
    const { fn, calls } = jsonFetch(greekResponse({ k: greekEntry() }));
    const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
    const map = await provider.fetchOptionGreeks({ contracts: [greekReq("NSE_FO|C1320", "CE", 1320)], referenceMs: bad });
    assert.equal(calls.length, 0, `bad ref ${bad} must not fetch`);
    assert.equal(map.get("NSE_FO|C1320")!.status, "invalid_input");
  }
});

test("GK18. duplicate response entries for one token → first valid match wins", async () => {
  const { fn } = jsonFetch(
    greekResponse({
      first: greekEntry({ instrument_token: "NSE_FO|C1320", last_price: 11 }),
      second: greekEntry({ instrument_token: "NSE_FO|C1320", last_price: 99 }),
    }),
  );
  const provider = createUpstoxDerivativesProvider({ fetchImpl: fn, getAccessToken: token });
  const r = (await provider.fetchOptionGreeks({ contracts: [greekReq("NSE_FO|C1320", "CE", 1320)], referenceMs: REF_FRI })).get(
    "NSE_FO|C1320",
  )!;
  assert.ok(isOk(r));
  if (isOk(r)) assert.equal(r.value.lastPrice, 11);
});
