import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeNseSymbolKey,
  findUnderlying,
  isParsedFnoUnderlying,
  isListedFnoUnderlying,
  getMappingStatus,
  resolveAtmContracts,
  resolveSpotInstrumentKey,
  pairedStrikes,
} from "./fno-universe.ts";
import { istDateStr } from "./ist-time.ts";
import type {
  FnoInstrumentUniverse,
  FnoUnderlyingInstrument,
  FuturesContract,
  OptionContract,
  SpotMappingStatus,
} from "./instrument-types.ts";

const IST = 5.5 * 3600 * 1000;
const istMs = (y: number, mo: number, d: number) => Date.UTC(y, mo - 1, d, 15, 30) - IST;
const NOW = Date.UTC(2026, 6, 18, 4, 30); // 2026-07-18 10:00 IST
const NEAR = istMs(2026, 7, 28);
const EXPIRED = istMs(2026, 6, 24);

function mkFut(expiry: number): FuturesContract {
  return { instrumentKey: `FUT|${expiry}`, tradingSymbol: "FUT", expiry, expiryDateIst: istDateStr(expiry), lotSize: 100, weekly: false, exchangeToken: "1" };
}
function mkOpt(expiry: number, strike: number, type: "CE" | "PE"): OptionContract {
  return { instrumentKey: `${type}|${strike}`, tradingSymbol: `${strike}${type}`, expiry, expiryDateIst: istDateStr(expiry), strike, optionType: type, lotSize: 100 };
}
function mkU(over: Partial<FnoUnderlyingInstrument> & { symbol: string }): FnoUnderlyingInstrument {
  return {
    normalizedSymbol: over.symbol,
    name: over.symbol,
    spotInstrumentKey: "NSE_EQ|INE001",
    spotMappingStatus: "resolved" as SpotMappingStatus,
    spotResolved: true,
    diagnosticSpotKey: "NSE_EQ|INE001",
    conflictingSpotKeys: [],
    spotTradingSymbol: over.symbol,
    isin: "INE001",
    futures: [mkFut(NEAR)],
    options: [],
    nearMonthFutures: mkFut(NEAR),
    futuresExpiries: [NEAR],
    optionExpiries: [NEAR],
    lotSize: 100,
    ...over,
  };
}
function uni(unders: FnoUnderlyingInstrument[]): FnoInstrumentUniverse {
  const bySymbol: Record<string, FnoUnderlyingInstrument> = {};
  for (const u of unders) bySymbol[u.normalizedSymbol] = u;
  return { underlyings: unders, bySymbol, metadata: {} as FnoInstrumentUniverse["metadata"] };
}

test("normalizeNseSymbolKey", () => {
  assert.equal(normalizeNseSymbolKey("reliance.ns"), "RELIANCE");
  assert.equal(normalizeNseSymbolKey("M&M"), "M&M");
  assert.equal(normalizeNseSymbolKey("BAJAJ-AUTO"), "BAJAJ-AUTO");
  assert.equal(normalizeNseSymbolKey("TCS.BO"), null);
  assert.equal(normalizeNseSymbolKey("AB CD"), null);
});

test("pairedStrikes finds only same-strike CE/PE", () => {
  const paired = pairedStrikes([mkOpt(NEAR, 2800, "CE"), mkOpt(NEAR, 2800, "PE"), mkOpt(NEAR, 2900, "CE")]);
  assert.deepEqual(paired, [2800]);
});

test("CE & PE at different strikes -> not option-structure-ready", () => {
  const u = uni([mkU({ symbol: "X", options: [mkOpt(NEAR, 2800, "CE"), mkOpt(NEAR, 2900, "PE")] })]);
  const st = getMappingStatus(u, "X", { nowMs: NOW })!;
  assert.equal(st.fullyMapped, true);
  assert.equal(st.pairedStrikeCount, 0);
  assert.equal(st.optionStructureReady, false);
});

test("same-strike CE/PE -> option-structure-ready", () => {
  const u = uni([mkU({ symbol: "X", options: [mkOpt(NEAR, 2800, "CE"), mkOpt(NEAR, 2800, "PE")] })]);
  const st = getMappingStatus(u, "X", { nowMs: NOW })!;
  assert.equal(st.optionStructureReady, true);
});

test("conflicting spot mapping disqualifies full mapping", () => {
  const u = uni([
    mkU({
      symbol: "X",
      spotMappingStatus: "conflicting_keys",
      spotResolved: false,
      spotInstrumentKey: null,
      options: [mkOpt(NEAR, 2800, "CE"), mkOpt(NEAR, 2800, "PE")],
    }),
  ]);
  const st = getMappingStatus(u, "X", { nowMs: NOW })!;
  assert.equal(st.fullyMapped, false);
  assert.equal(st.optionStructureReady, false);
});

test("fully-expired underlying is parsed but not currently listed", () => {
  const u = uni([mkU({ symbol: "X", futures: [mkFut(EXPIRED)], nearMonthFutures: mkFut(EXPIRED), futuresExpiries: [EXPIRED] })]);
  assert.equal(isParsedFnoUnderlying(u, "X"), true);
  assert.equal(isListedFnoUnderlying(u, "X", { nowMs: NOW }), false);
  assert.ok(findUnderlying(u, "X"));
});

test("current future without options is not option-structure-ready", () => {
  const u = uni([mkU({ symbol: "X", options: [], optionExpiries: [] })]);
  const st = getMappingStatus(u, "X", { nowMs: NOW })!;
  assert.equal(st.listed, true);
  assert.equal(st.fullyMapped, false);
  assert.equal(st.optionStructureReady, false);
});

test("ATM both-availability requires a same-strike pair at the ATM", () => {
  // CE@2800 and PE@2900 only -> ATM (2800) has no PE.
  const u = uni([mkU({ symbol: "X", options: [mkOpt(NEAR, 2800, "CE"), mkOpt(NEAR, 2900, "PE")] })]);
  const atm = resolveAtmContracts(u, "X", 2805, { nearby: 1, nowMs: NOW })!;
  assert.equal(atm.atmStrike, 2800);
  assert.equal(atm.atmCeAvailable, true);
  assert.equal(atm.atmPeAvailable, false);
  assert.equal(atm.atmBothAvailable, false);
  assert.equal(atm.anyPairedStrikeInWindow, false);
});

test("ATM both-availability true for a genuine same-strike pair", () => {
  const u = uni([mkU({ symbol: "X", options: [mkOpt(NEAR, 2800, "CE"), mkOpt(NEAR, 2800, "PE")] })]);
  const atm = resolveAtmContracts(u, "X", 2801, { nearby: 1, nowMs: NOW })!;
  assert.equal(atm.atmBothAvailable, true);
  assert.deepEqual(atm.pairedStrikesInWindow, [2800]);
});

test("nowMs validation throws", () => {
  const u = uni([mkU({ symbol: "X" })]);
  assert.throws(() => getMappingStatus(u, "X", { nowMs: -1 }));
  assert.throws(() => resolveAtmContracts(u, "X", 100, { nowMs: 0 }));
});

// ── Group E: coherence guards against contradictory manually-built objects ──
test("contradictory resolved+null-key mapping is not fully mapped or key-resolvable", () => {
  const u = uni([
    mkU({
      symbol: "X",
      spotMappingStatus: "resolved",
      spotResolved: true,
      spotInstrumentKey: null, // contradictory
      options: [mkOpt(NEAR, 2800, "CE"), mkOpt(NEAR, 2800, "PE")],
    }),
  ]);
  const st = getMappingStatus(u, "X", { nowMs: NOW })!;
  assert.equal(st.fullyMapped, false);
  assert.equal(st.optionStructureReady, false);
  assert.equal(resolveSpotInstrumentKey(u, "X"), null);
});

test("empty/whitespace trading symbol disqualifies full mapping", () => {
  const u = uni([
    mkU({
      symbol: "X",
      spotTradingSymbol: "   ",
      options: [mkOpt(NEAR, 2800, "CE"), mkOpt(NEAR, 2800, "PE")],
    }),
  ]);
  const st = getMappingStatus(u, "X", { nowMs: NOW })!;
  assert.equal(st.fullyMapped, false);
  assert.equal(resolveSpotInstrumentKey(u, "X"), null);
});

test("spotResolved=true with conflicting status is not coherent", () => {
  const u = uni([
    mkU({
      symbol: "X",
      spotMappingStatus: "conflicting_keys",
      spotResolved: true, // contradictory flag
      options: [mkOpt(NEAR, 2800, "CE"), mkOpt(NEAR, 2800, "PE")],
    }),
  ]);
  assert.equal(getMappingStatus(u, "X", { nowMs: NOW })!.fullyMapped, false);
  assert.equal(resolveSpotInstrumentKey(u, "X"), null);
});
