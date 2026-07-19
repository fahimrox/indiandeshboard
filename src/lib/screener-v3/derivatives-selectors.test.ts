import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeNullableFiniteNumber,
  normalizeOptionIvPct,
  deriveOptionOpenInterestChange,
  normalizeDepthLevel,
  classifyDerivativesSessionState,
  selectDerivativesFuture,
  selectDerivativesAtmPair,
} from "./derivatives-selectors.ts";
import { ok, providerError, isFailure, isOk, type DataResult } from "./types.ts";
import type {
  FnoInstrumentUniverse,
  FnoUnderlyingInstrument,
  FuturesContract,
  OptionContract,
  OptionType,
} from "./instrument-types.ts";

// ── Fixtures ────────────────────────────────────────────────────────────────
/** Epoch ms whose IST wall-clock is the given calendar/time. */
function istEpoch(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi, s) - 5.5 * 3_600_000;
}
const REF_FRI = istEpoch(2026, 7, 17, 10, 0, 0); // Friday, in-session
const EXP_CURRENT = istEpoch(2026, 7, 28, 0, 0, 0);
const EXP_LATER = istEpoch(2026, 8, 25, 0, 0, 0);

function fut(key: string, expiryDateIst: string, expiryMs: number): FuturesContract {
  return { instrumentKey: key, tradingSymbol: `FUT ${key}`, expiry: expiryMs, expiryDateIst, lotSize: 500, weekly: false, exchangeToken: "" };
}
function opt(key: string, strike: number, type: OptionType, expiryDateIst: string, expiryMs: number): OptionContract {
  return { instrumentKey: key, tradingSymbol: `${strike}${type}`, expiry: expiryMs, expiryDateIst, strike, optionType: type, lotSize: 500 };
}
function underlying(sym: string, opts: { futures?: FuturesContract[]; options?: OptionContract[]; resolved?: boolean }): FnoUnderlyingInstrument {
  const resolved = opts.resolved ?? true;
  const futures = opts.futures ?? [];
  const options = opts.options ?? [];
  return {
    symbol: sym,
    normalizedSymbol: sym,
    name: sym,
    spotInstrumentKey: resolved ? `NSE_EQ|${sym}` : null,
    spotMappingStatus: resolved ? "resolved" : "missing_key",
    spotResolved: resolved,
    diagnosticSpotKey: resolved ? `NSE_EQ|${sym}` : null,
    conflictingSpotKeys: [],
    spotTradingSymbol: resolved ? sym : null,
    isin: resolved ? sym : null,
    futures,
    options,
    nearMonthFutures: futures[0] ?? null,
    futuresExpiries: [...new Set(futures.map((f) => f.expiry))].sort((a, b) => a - b),
    optionExpiries: [...new Set(options.map((o) => o.expiry))].sort((a, b) => a - b),
    lotSize: futures[0]?.lotSize ?? null,
  };
}
function universe(underlyings: FnoUnderlyingInstrument[]): DataResult<FnoInstrumentUniverse> {
  const bySymbol: Record<string, FnoUnderlyingInstrument> = Object.create(null);
  for (const u of underlyings) bySymbol[u.normalizedSymbol] = u;
  // Cast avoids constructing the large metadata literal the selectors never read.
  return ok({ underlyings, bySymbol } as unknown as FnoInstrumentUniverse, { source: "test" });
}

// ── normalizeNullableFiniteNumber ───────────────────────────────────────────
test("N1. finite numbers pass through; zero and negatives preserved", () => {
  assert.equal(normalizeNullableFiniteNumber(0), 0);
  assert.equal(normalizeNullableFiniteNumber(-5), -5);
  assert.equal(normalizeNullableFiniteNumber(3.14), 3.14);
});
test("N2. non-finite / non-number → null (no silent string coercion)", () => {
  assert.equal(normalizeNullableFiniteNumber(NaN), null);
  assert.equal(normalizeNullableFiniteNumber(Infinity), null);
  assert.equal(normalizeNullableFiniteNumber(-Infinity), null);
  assert.equal(normalizeNullableFiniteNumber(undefined), null);
  assert.equal(normalizeNullableFiniteNumber(null), null);
  assert.equal(normalizeNullableFiniteNumber("5"), null);
  assert.equal(normalizeNullableFiniteNumber({}), null);
});

// ── normalizeOptionIvPct ─────────────────────────────────────────────────────
test("N3. option-chain IV is already percent (26 → 26)", () => {
  assert.equal(normalizeOptionIvPct(26.0, "upstox_option_chain"), 26.0);
});
test("N4. greek-v3 IV is decimal → scaled ×100 (0.26 → 26)", () => {
  assert.equal(normalizeOptionIvPct(0.26, "upstox_option_greek_v3"), 26);
});
test("N5. zero IV stays zero for both sources", () => {
  assert.equal(normalizeOptionIvPct(0, "upstox_option_chain"), 0);
  assert.equal(normalizeOptionIvPct(0, "upstox_option_greek_v3"), 0);
});
test("N6. negative / non-finite IV → null", () => {
  assert.equal(normalizeOptionIvPct(-1, "upstox_option_chain"), null);
  assert.equal(normalizeOptionIvPct(NaN, "upstox_option_chain"), null);
  assert.equal(normalizeOptionIvPct(Infinity, "upstox_option_greek_v3"), null);
  assert.equal(normalizeOptionIvPct("26", "upstox_option_chain"), null);
  assert.equal(normalizeOptionIvPct(null, "upstox_option_chain"), null);
});

// ── deriveOptionOpenInterestChange ───────────────────────────────────────────
test("O1. OI change positive / negative / zero", () => {
  assert.equal(deriveOptionOpenInterestChange(100, 80), 20);
  assert.equal(deriveOptionOpenInterestChange(80, 100), -20);
  assert.equal(deriveOptionOpenInterestChange(100, 100), 0);
});
test("O2. missing current or previous → null", () => {
  assert.equal(deriveOptionOpenInterestChange(100, null), null);
  assert.equal(deriveOptionOpenInterestChange(null, 80), null);
  assert.equal(deriveOptionOpenInterestChange(NaN, 80), null);
});

// ── classifyDerivativesSessionState ──────────────────────────────────────────
test("S1. current open session + fresh last trade → live", () => {
  assert.equal(
    classifyDerivativesSessionState({ referenceMs: REF_FRI, lastTradeTimeMs: istEpoch(2026, 7, 17, 9, 58, 0) }),
    "live",
  );
});
test("S2. Friday last trade with Sunday reference → eod", () => {
  assert.equal(
    classifyDerivativesSessionState({
      referenceMs: istEpoch(2026, 7, 19, 12, 0, 0), // Sunday
      lastTradeTimeMs: istEpoch(2026, 7, 17, 15, 29, 0), // Friday close
    }),
    "eod",
  );
});
test("S3. last trade older than EOD window → stale", () => {
  assert.equal(
    classifyDerivativesSessionState({ referenceMs: REF_FRI, lastTradeTimeMs: istEpoch(2026, 7, 1, 10, 0, 0) }),
    "stale",
  );
});
test("S4. null last trade → unknown", () => {
  assert.equal(classifyDerivativesSessionState({ referenceMs: REF_FRI, lastTradeTimeMs: null }), "unknown");
});
test("S5. invalid reference → unknown", () => {
  assert.equal(classifyDerivativesSessionState({ referenceMs: 0, lastTradeTimeMs: REF_FRI }), "unknown");
  assert.equal(classifyDerivativesSessionState({ referenceMs: NaN, lastTradeTimeMs: REF_FRI }), "unknown");
  assert.equal(classifyDerivativesSessionState({ referenceMs: -1, lastTradeTimeMs: REF_FRI }), "unknown");
});
test("S6. last trade after reference (future) → unknown", () => {
  assert.equal(
    classifyDerivativesSessionState({ referenceMs: REF_FRI, lastTradeTimeMs: REF_FRI + 60_000 }),
    "unknown",
  );
});
test("S7. market OPEN + same-session but stale (20 min old) → stale (never eod)", () => {
  // In-session on 2026-07-17, last trade same day 09:40 → age 20 min > freshness.
  assert.equal(
    classifyDerivativesSessionState({ referenceMs: REF_FRI, lastTradeTimeMs: istEpoch(2026, 7, 17, 9, 40, 0) }),
    "stale",
  );
});
test("S8. market OPEN + previous-day last trade → stale (not live, not eod)", () => {
  // Friday 10:00 in-session reference, last trade Thursday close → different session.
  assert.equal(
    classifyDerivativesSessionState({ referenceMs: REF_FRI, lastTradeTimeMs: istEpoch(2026, 7, 16, 15, 29, 0) }),
    "stale",
  );
});
test("S9. Monday pre-open reference + Friday close last trade → eod", () => {
  // 2026-07-20 is Monday; 08:00 IST is before the 09:15 open → market closed.
  assert.equal(
    classifyDerivativesSessionState({
      referenceMs: istEpoch(2026, 7, 20, 8, 0, 0),
      lastTradeTimeMs: istEpoch(2026, 7, 17, 15, 29, 0),
    }),
    "eod",
  );
});
test("S10. weekday AFTER close + same-day last trade → eod (market closed path)", () => {
  // Friday 16:00 IST is after the 15:30 close → market closed; today's close → eod.
  assert.equal(
    classifyDerivativesSessionState({
      referenceMs: istEpoch(2026, 7, 17, 16, 0, 0),
      lastTradeTimeMs: istEpoch(2026, 7, 17, 15, 29, 0),
    }),
    "eod",
  );
});
test("S11. LIMITATION: a long holiday gap beyond MAX_EOD_AGE_MS is classified stale (no holiday calendar in Part 1)", () => {
  // Closed-market reference, last trade > 4 days earlier → stale (documented proxy).
  assert.equal(
    classifyDerivativesSessionState({
      referenceMs: istEpoch(2026, 7, 19, 12, 0, 0), // Sunday
      lastTradeTimeMs: istEpoch(2026, 7, 10, 15, 29, 0), // 9 days earlier
    }),
    "stale",
  );
});

// ── selectDerivativesFuture ──────────────────────────────────────────────────
test("F1. selects the nearest non-expired future deterministically", () => {
  const u = universe([
    underlying("RELIANCE", { futures: [fut("NSE_FO|1", "2026-07-28", EXP_CURRENT), fut("NSE_FO|2", "2026-08-25", EXP_LATER)] }),
  ]);
  const r = selectDerivativesFuture({ universe: u, symbol: "RELIANCE", referenceMs: REF_FRI });
  assert.ok(isOk(r));
  if (isOk(r)) {
    assert.equal(r.value.instrumentKey, "NSE_FO|1");
    assert.equal(r.value.expiryDateIst, "2026-07-28");
    assert.equal(r.value.lotSize, 500);
  }
});
test("F2. accepts `.NS` suffix and normalizes", () => {
  const u = universe([underlying("SBIN", { futures: [fut("NSE_FO|9", "2026-07-28", EXP_CURRENT)] })]);
  const r = selectDerivativesFuture({ universe: u, symbol: "sbin.NS", referenceMs: REF_FRI });
  assert.ok(isOk(r));
});
test("F3. expired-only future → unavailable", () => {
  const u = universe([underlying("RELIANCE", { futures: [fut("NSE_FO|3", "2026-06-25", istEpoch(2026, 6, 25))] })]);
  const r = selectDerivativesFuture({ universe: u, symbol: "RELIANCE", referenceMs: REF_FRI });
  assert.equal(r.status, "unavailable");
});
test("F4. underlying present but no futures → unavailable", () => {
  const u = universe([underlying("RELIANCE", { futures: [] })]);
  assert.equal(selectDerivativesFuture({ universe: u, symbol: "RELIANCE", referenceMs: REF_FRI }).status, "unavailable");
});
test("F5. symbol not in universe → unavailable", () => {
  const u = universe([underlying("RELIANCE", { futures: [fut("NSE_FO|1", "2026-07-28", EXP_CURRENT)] })]);
  assert.equal(selectDerivativesFuture({ universe: u, symbol: "ZZZZ", referenceMs: REF_FRI }).status, "unavailable");
});
test("F6. invalid symbol (.BO) → invalid_input", () => {
  const u = universe([]);
  assert.equal(selectDerivativesFuture({ universe: u, symbol: "REL.BO", referenceMs: REF_FRI }).status, "invalid_input");
});
test("F7. invalid referenceMs → invalid_input", () => {
  const u = universe([underlying("RELIANCE", { futures: [fut("NSE_FO|1", "2026-07-28", EXP_CURRENT)] })]);
  assert.equal(selectDerivativesFuture({ universe: u, symbol: "RELIANCE", referenceMs: 0 }).status, "invalid_input");
});
test("F8. universe failure propagates truthfully (not relabeled)", () => {
  const u = providerError("master down") as DataResult<FnoInstrumentUniverse>;
  const r = selectDerivativesFuture({ universe: u, symbol: "RELIANCE", referenceMs: REF_FRI });
  assert.ok(isFailure(r));
  assert.equal(r.status, "provider_error");
});

// ── selectDerivativesAtmPair ─────────────────────────────────────────────────
function optChainUnderlying(sym: string, strikes: number[], legs: (s: number) => OptionType[]): FnoUnderlyingInstrument {
  const options: OptionContract[] = [];
  for (const s of strikes) for (const t of legs(s)) options.push(opt(`NSE_FO|${sym}${s}${t}`, s, t, "2026-07-28", EXP_CURRENT));
  return underlying(sym, { futures: [fut(`NSE_FO|${sym}F`, "2026-07-28", EXP_CURRENT)], options });
}
test("A1. exact strike anchor selects that strike with both legs", () => {
  const u = universe([optChainUnderlying("RELIANCE", [1300, 1320, 1340], () => ["CE", "PE"])]);
  const r = selectDerivativesAtmPair({ universe: u, symbol: "RELIANCE", anchorPrice: 1320, referenceMs: REF_FRI });
  assert.ok(isOk(r));
  if (isOk(r)) {
    assert.equal(r.value.atmStrike, 1320);
    assert.ok(r.value.call && r.value.put);
  }
});
test("A2. nearest strike chosen when anchor is between strikes", () => {
  const u = universe([optChainUnderlying("RELIANCE", [1300, 1320, 1340], () => ["CE", "PE"])]);
  const r = selectDerivativesAtmPair({ universe: u, symbol: "RELIANCE", anchorPrice: 1327, referenceMs: REF_FRI });
  assert.ok(isOk(r));
  if (isOk(r)) assert.equal(r.value.atmStrike, 1320); // |1320-1327|=7 < |1340-1327|=13
});
test("A3. equal-distance tie resolves to the LOWER strike", () => {
  const u = universe([optChainUnderlying("RELIANCE", [1320, 1340], () => ["CE", "PE"])]);
  const r = selectDerivativesAtmPair({ universe: u, symbol: "RELIANCE", anchorPrice: 1330, referenceMs: REF_FRI });
  assert.ok(isOk(r));
  if (isOk(r)) assert.equal(r.value.atmStrike, 1320); // tie → lower
});
test("A4. missing CALL leg at ATM → call null, put present, still available", () => {
  const u = universe([optChainUnderlying("RELIANCE", [1320], () => ["PE"])]);
  const r = selectDerivativesAtmPair({ universe: u, symbol: "RELIANCE", anchorPrice: 1320, referenceMs: REF_FRI });
  assert.ok(isOk(r));
  if (isOk(r)) {
    assert.equal(r.value.atmStrike, 1320);
    assert.equal(r.value.call, null);
    assert.ok(r.value.put);
  }
});
test("A5. missing PUT leg at ATM → put null, call present", () => {
  const u = universe([optChainUnderlying("RELIANCE", [1320], () => ["CE"])]);
  const r = selectDerivativesAtmPair({ universe: u, symbol: "RELIANCE", anchorPrice: 1320, referenceMs: REF_FRI });
  assert.ok(isOk(r));
  if (isOk(r)) {
    assert.equal(r.value.put, null);
    assert.ok(r.value.call);
  }
});
test("A6. empty strike set (no options) → unavailable", () => {
  const u = universe([underlying("RELIANCE", { futures: [fut("NSE_FO|1", "2026-07-28", EXP_CURRENT)], options: [] })]);
  assert.equal(selectDerivativesAtmPair({ universe: u, symbol: "RELIANCE", anchorPrice: 1320, referenceMs: REF_FRI }).status, "unavailable");
});
test("A7. invalid anchor price → invalid_input", () => {
  const u = universe([optChainUnderlying("RELIANCE", [1320], () => ["CE", "PE"])]);
  assert.equal(selectDerivativesAtmPair({ universe: u, symbol: "RELIANCE", anchorPrice: 0, referenceMs: REF_FRI }).status, "invalid_input");
  assert.equal(selectDerivativesAtmPair({ universe: u, symbol: "RELIANCE", anchorPrice: -5, referenceMs: REF_FRI }).status, "invalid_input");
  assert.equal(selectDerivativesAtmPair({ universe: u, symbol: "RELIANCE", anchorPrice: NaN, referenceMs: REF_FRI }).status, "invalid_input");
});
test("A8. never fabricates a strike — atmStrike is always a listed strike", () => {
  const strikes = [1300, 1320, 1340];
  const u = universe([optChainUnderlying("RELIANCE", strikes, () => ["CE", "PE"])]);
  const r = selectDerivativesAtmPair({ universe: u, symbol: "RELIANCE", anchorPrice: 1333, referenceMs: REF_FRI });
  assert.ok(isOk(r));
  if (isOk(r)) assert.ok(strikes.includes(r.value.atmStrike));
});
test("A9. universe failure propagates", () => {
  const u = providerError("master down") as DataResult<FnoInstrumentUniverse>;
  assert.ok(isFailure(selectDerivativesAtmPair({ universe: u, symbol: "RELIANCE", anchorPrice: 1320, referenceMs: REF_FRI })));
});

// ── normalizeDepthLevel ──────────────────────────────────────────────────────
test("D1. valid finite non-negative level is constructed (positive values)", () => {
  assert.deepEqual(normalizeDepthLevel({ price: 1328.1, quantity: 1500, orders: 3 }), {
    price: 1328.1,
    quantity: 1500,
    orders: 3,
  });
});
test("D2. zero price and zero quantity are valid; zero orders preserved", () => {
  assert.deepEqual(normalizeDepthLevel({ price: 0, quantity: 0, orders: 0 }), {
    price: 0,
    quantity: 0,
    orders: 0,
  });
});
test("D3. missing/invalid orders → null orders, level still valid", () => {
  assert.deepEqual(normalizeDepthLevel({ price: 10, quantity: 5, orders: null }), { price: 10, quantity: 5, orders: null });
  assert.deepEqual(normalizeDepthLevel({ price: 10, quantity: 5, orders: undefined }), { price: 10, quantity: 5, orders: null });
  assert.deepEqual(normalizeDepthLevel({ price: 10, quantity: 5, orders: NaN }), { price: 10, quantity: 5, orders: null });
  assert.deepEqual(normalizeDepthLevel({ price: 10, quantity: 5, orders: -1 }), { price: 10, quantity: 5, orders: null });
});
test("D4. missing/invalid/negative price → whole level null", () => {
  assert.equal(normalizeDepthLevel({ price: null, quantity: 5, orders: 1 }), null);
  assert.equal(normalizeDepthLevel({ price: NaN, quantity: 5, orders: 1 }), null);
  assert.equal(normalizeDepthLevel({ price: -1, quantity: 5, orders: 1 }), null);
  assert.equal(normalizeDepthLevel({ price: Infinity, quantity: 5, orders: 1 }), null);
});
test("D5. missing/invalid/negative quantity → whole level null", () => {
  assert.equal(normalizeDepthLevel({ price: 10, quantity: null, orders: 1 }), null);
  assert.equal(normalizeDepthLevel({ price: 10, quantity: -5, orders: 1 }), null);
  assert.equal(normalizeDepthLevel({ price: 10, quantity: NaN, orders: 1 }), null);
});
test("D6. numeric strings are NOT silently converted → null level", () => {
  assert.equal(normalizeDepthLevel({ price: "10", quantity: "5", orders: "1" }), null);
});
