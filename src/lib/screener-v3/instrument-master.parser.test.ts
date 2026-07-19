import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUpstoxInstruments } from "./instrument-master.parser.ts";
import type { UpstoxInstrumentRecord } from "./instrument-types.ts";

const IST = 5.5 * 3600 * 1000;
const istMs = (y: number, mo: number, d: number, h = 15, mi = 30) => Date.UTC(y, mo - 1, d, h, mi) - IST;

const NOW = istMs(2026, 7, 18, 10, 0); // reference: 2026-07-18 10:00 IST
const NEAR = istMs(2026, 7, 28); // current
const LATER = istMs(2026, 8, 25); // current
const EXPIRED = istMs(2026, 6, 24); // past

function eq(key: string, sym: string, isin = "INE001"): UpstoxInstrumentRecord {
  return { segment: "NSE_EQ", instrument_key: key, trading_symbol: sym, name: sym, isin };
}
function fut(sym: string, expiry: number, o: Partial<UpstoxInstrumentRecord> = {}): UpstoxInstrumentRecord {
  return {
    segment: "NSE_FO", underlying_type: "EQUITY", underlying_symbol: sym, instrument_type: "FUT",
    instrument_key: o.instrument_key ?? `FUT|${sym}|${expiry}`, trading_symbol: `${sym}FUT`,
    expiry, lot_size: 100, weekly: false, underlying_key: "NSE_EQ|INE001", exchange_token: "1", ...o,
  };
}
function opt(sym: string, expiry: number, strike: number, type: "CE" | "PE", o: Partial<UpstoxInstrumentRecord> = {}): UpstoxInstrumentRecord {
  return {
    segment: "NSE_FO", underlying_type: "EQUITY", underlying_symbol: sym, instrument_type: type,
    instrument_key: o.instrument_key ?? `${type}|${sym}|${expiry}|${strike}`, trading_symbol: `${sym}${strike}${type}`,
    expiry, strike_price: strike, lot_size: 100, underlying_key: "NSE_EQ|INE001", ...o,
  };
}
const parse = (recs: UpstoxInstrumentRecord[]) => parseUpstoxInstruments(recs, { nowMs: NOW, fetchedAt: NOW });

test("EQUITY F&O included; index F&O excluded", () => {
  const u = parse([
    eq("NSE_EQ|INE001", "RELIANCE"),
    fut("RELIANCE", NEAR),
    fut("NIFTY", NEAR, { underlying_type: "INDEX", underlying_key: undefined }),
  ]);
  assert.ok(u.bySymbol["RELIANCE"]);
  assert.equal(u.bySymbol["NIFTY"], undefined);
});

test("nearest future selected; later preserved; expired excluded", () => {
  const u = parse([eq("NSE_EQ|INE001", "RELIANCE"), fut("RELIANCE", EXPIRED), fut("RELIANCE", NEAR), fut("RELIANCE", LATER)]);
  const r = u.bySymbol["RELIANCE"];
  assert.equal(r.nearMonthFutures?.expiry, NEAR);
  assert.deepEqual(r.futuresExpiries, [NEAR, LATER]);
});

test("expired options excluded; option expiries sorted", () => {
  const u = parse([
    eq("NSE_EQ|INE001", "RELIANCE"), fut("RELIANCE", NEAR),
    opt("RELIANCE", EXPIRED, 2800, "CE"), opt("RELIANCE", LATER, 2800, "CE"), opt("RELIANCE", NEAR, 2800, "CE"),
  ]);
  assert.deepEqual(u.bySymbol["RELIANCE"].optionExpiries, [NEAR, LATER]);
});

test("missing spot key -> missing_key status, null usable key, counted", () => {
  const u = parse([fut("RELIANCE", NEAR, { underlying_key: undefined })]);
  const r = u.bySymbol["RELIANCE"];
  assert.equal(r.spotMappingStatus, "missing_key");
  assert.equal(r.spotInstrumentKey, null);
  assert.equal(u.metadata.spotMissingKeyCount, 1);
});

test("malformed spot key rejected as invalid_key", () => {
  const u = parse([fut("RELIANCE", NEAR, { underlying_key: "NSE_EQ|AB CD" })]);
  assert.equal(u.bySymbol["RELIANCE"].spotMappingStatus, "invalid_key");
});

test("valid-looking key with no equity record -> unresolved_record", () => {
  const u = parse([fut("RELIANCE", NEAR, { underlying_key: "NSE_EQ|INEZZZ" })]);
  const r = u.bySymbol["RELIANCE"];
  assert.equal(r.spotMappingStatus, "unresolved_record");
  assert.equal(r.spotInstrumentKey, null);
  assert.equal(u.metadata.spotUnresolvedRecordCount, 1);
});

test("expired/invalid contract cannot create a current spot conflict", () => {
  const u = parse([
    eq("NSE_EQ|INE001", "RELIANCE"), eq("NSE_EQ|INE999", "OTHER"),
    fut("RELIANCE", NEAR, { underlying_key: "NSE_EQ|INE001" }), // current
    fut("RELIANCE", EXPIRED, { instrument_key: "FUT|R|old", underlying_key: "NSE_EQ|INE999" }), // expired, diff key
  ]);
  const r = u.bySymbol["RELIANCE"];
  assert.equal(r.spotMappingStatus, "resolved");
  assert.equal(r.spotInstrumentKey, "NSE_EQ|INE001");
});

test("two current futures (distinct expiries) with distinct valid keys -> conflicting_keys", () => {
  const u = parse([
    eq("NSE_EQ|INE001", "RELIANCE"), eq("NSE_EQ|INE999", "RELIANCE2"),
    fut("RELIANCE", NEAR, { instrument_key: "FUT|A", underlying_key: "NSE_EQ|INE001" }),
    fut("RELIANCE", LATER, { instrument_key: "FUT|B", underlying_key: "NSE_EQ|INE999" }),
  ]);
  const r = u.bySymbol["RELIANCE"];
  assert.equal(r.spotMappingStatus, "conflicting_keys");
  assert.equal(r.spotInstrumentKey, null);
  assert.equal(r.conflictingSpotKeys.length, 2);
  assert.equal(u.metadata.spotConflictingCount, 1);
});

// ── D1: coordinate conflict quarantine ──────────────────────────────────────
test("D1: two FUT keys at the same expiry are BOTH quarantined (coordinate conflict)", () => {
  const u = parse([
    eq("NSE_EQ|INE001", "RELIANCE"),
    fut("RELIANCE", NEAR, { instrument_key: "FUT|A" }),
    fut("RELIANCE", NEAR, { instrument_key: "FUT|B" }),
  ]);
  assert.equal(u.bySymbol["RELIANCE"], undefined); // no conflict-free current future left
  assert.equal(u.metadata.coordinateConflicts, 1);
});

test("D1: two CE keys at same expiry/strike quarantined; PE at that strike gives no readiness", () => {
  const u = parse([
    eq("NSE_EQ|INE001", "RELIANCE"),
    fut("RELIANCE", NEAR, { instrument_key: "FUT|A" }),
    opt("RELIANCE", NEAR, 2800, "CE", { instrument_key: "CE|1" }),
    opt("RELIANCE", NEAR, 2800, "CE", { instrument_key: "CE|2" }), // coordinate conflict
    opt("RELIANCE", NEAR, 2800, "PE", { instrument_key: "PE|1" }),
  ]);
  const r = u.bySymbol["RELIANCE"];
  assert.ok(r);
  assert.equal(r.options.length, 1); // only the PE survives
  assert.equal(r.options[0].optionType, "PE");
  assert.equal(u.metadata.coordinateConflicts, 1);
  assert.equal(u.metadata.optionStructureReadyUnderlyings, 0); // no CE/PE pair
});

// ── D2: rejected duplicate rows must not pollute spot mapping ────────────────
test("D2: a conflicting same-key contract's underlying_key does not make spot conflicting", () => {
  const u = parse([
    eq("NSE_EQ|INE001", "RELIANCE"), eq("NSE_EQ|INE999", "OTHER"),
    fut("RELIANCE", NEAR, { instrument_key: "FUT|A", underlying_key: "NSE_EQ|INE001" }),
    // Same option key with inconsistent rows -> quarantined; its INE999 must NOT leak.
    opt("RELIANCE", NEAR, 2800, "CE", { instrument_key: "OPT|X", underlying_key: "NSE_EQ|INE001" }),
    opt("RELIANCE", NEAR, 2900, "CE", { instrument_key: "OPT|X", underlying_key: "NSE_EQ|INE999" }),
  ]);
  const r = u.bySymbol["RELIANCE"];
  assert.equal(r.spotMappingStatus, "resolved");
  assert.equal(r.spotInstrumentKey, "NSE_EQ|INE001");
  assert.equal(u.metadata.sameKeyConflicts, 1);
});

// ── D3: duplicate NSE equity keys ───────────────────────────────────────────
test("D3: identical duplicate equity rows collapsed", () => {
  const u = parse([eq("NSE_EQ|INE001", "RELIANCE"), eq("NSE_EQ|INE001", "RELIANCE"), fut("RELIANCE", NEAR)]);
  assert.equal(u.metadata.equityDuplicatesCollapsed, 1);
  assert.equal(u.bySymbol["RELIANCE"].spotMappingStatus, "resolved");
});

test("D3: inconsistent duplicate equity key is quarantined and cannot resolve spot", () => {
  const u = parse([
    eq("NSE_EQ|INE001", "RELIANCE"),
    { segment: "NSE_EQ", instrument_key: "NSE_EQ|INE001", trading_symbol: "OTHER", name: "OTHER", isin: "ZZZ" },
    fut("RELIANCE", NEAR, { underlying_key: "NSE_EQ|INE001" }),
  ]);
  const r = u.bySymbol["RELIANCE"];
  assert.equal(u.metadata.equityConflictingKeys, 1);
  assert.equal(r.spotMappingStatus, "unresolved_record");
  assert.equal(r.spotInstrumentKey, null);
});

// ── D1/collapse: identical duplicate contracts + same-key conflict ──────────
test("identical duplicate contract rows collapsed (contract retained)", () => {
  const dup = fut("RELIANCE", NEAR, { instrument_key: "FUT|R" });
  const u = parse([eq("NSE_EQ|INE001", "RELIANCE"), dup, { ...dup }]);
  assert.equal(u.metadata.duplicateContractsCollapsed, 1);
  assert.equal(u.bySymbol["RELIANCE"].futures.length, 1);
});

test("same instrument key with inconsistent rows is quarantined", () => {
  const a = fut("RELIANCE", NEAR, { instrument_key: "FUT|R" });
  const b = fut("RELIANCE", LATER, { instrument_key: "FUT|R" }); // same key, different expiry
  const u = parse([eq("NSE_EQ|INE001", "RELIANCE"), a, b]);
  assert.equal(u.metadata.sameKeyConflicts, 1);
  assert.equal(u.bySymbol["RELIANCE"], undefined); // the only future key was quarantined
});

// ── D4: runtime field validation ────────────────────────────────────────────
test("D4: invalid FUT record skipped (invalid expiry)", () => {
  const u = parse([eq("NSE_EQ|INE001", "RELIANCE"), fut("RELIANCE", NEAR), fut("RELIANCE", 0, { instrument_key: "FUT|bad" })]);
  assert.equal(u.metadata.invalidRecordsSkipped, 1);
});

test("D4: non-integer lot / non-integer expiry / whitespace key rejected", () => {
  const u = parse([
    eq("NSE_EQ|INE001", "RELIANCE"), fut("RELIANCE", NEAR),
    fut("RELIANCE", NEAR + 0.5, { instrument_key: "FUT|frac-exp" }),
    fut("RELIANCE", NEAR, { instrument_key: "FUT|frac-lot", lot_size: 100.5 }),
    fut("RELIANCE", NEAR, { instrument_key: "   " }),
  ]);
  assert.equal(u.metadata.invalidRecordsSkipped, 3);
});

test("D4: weekly is only true for a boolean true", () => {
  const truthy = parse([eq("NSE_EQ|INE001", "RELIANCE"), fut("RELIANCE", NEAR, { weekly: 1 as unknown as boolean })]);
  assert.equal(truthy.bySymbol["RELIANCE"].nearMonthFutures?.weekly, false);
  const real = parse([eq("NSE_EQ|INE001", "RELIANCE"), fut("RELIANCE", NEAR, { weekly: true })]);
  assert.equal(real.bySymbol["RELIANCE"].nearMonthFutures?.weekly, true);
});

test("D4: malformed non-object rows never crash the parser", () => {
  const recs = [null, 42, "junk", eq("NSE_EQ|INE001", "RELIANCE"), fut("RELIANCE", NEAR)] as unknown as UpstoxInstrumentRecord[];
  const u = parse(recs);
  assert.equal(u.metadata.malformedRecordsSkipped, 3);
  assert.ok(u.bySymbol["RELIANCE"]);
});

test("same underlying links spot, futures and options", () => {
  const u = parse([
    eq("NSE_EQ|INE001", "RELIANCE"), fut("RELIANCE", NEAR),
    opt("RELIANCE", NEAR, 2800, "CE"), opt("RELIANCE", NEAR, 2800, "PE"),
  ]);
  const r = u.bySymbol["RELIANCE"];
  assert.equal(r.spotResolved, true);
  assert.equal(r.futures.length, 1);
  assert.equal(r.options.length, 2);
  assert.equal(u.metadata.optionStructureReadyUnderlyings, 1); // same-strike pair present
});

test("invalid nowMs / fetchedAt throw", () => {
  assert.throws(() => parseUpstoxInstruments([], { nowMs: 0 }));
  assert.throws(() => parseUpstoxInstruments([], { nowMs: NOW, fetchedAt: Number.NaN }));
});
