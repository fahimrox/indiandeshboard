import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { yahooService } from "../services/yahooService.ts";
import { fetchSpotCandles, normalizeNseSymbol, isSupportedIntervalRange } from "./candles.server.ts";

const IST = 5.5 * 3600 * 1000;
const secAt = (y: number, mo: number, d: number, h: number, mi: number, s = 0) =>
  (Date.UTC(y, mo - 1, d, h, mi, s) - IST) / 1000;
const msAt = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => secAt(y, mo, d, h, mi, s) * 1000;

type Hist = Awaited<ReturnType<typeof yahooService.getHistory>>;
const original = yahooService.getHistory;
let calls = 0;

function setProvider(fn: (symbol: string, range: string, interval: string) => Hist) {
  calls = 0;
  yahooService.getHistory = async (symbol: string, range = "1mo", interval = "1d") => {
    calls++;
    return fn(symbol, range, interval);
  };
}
function rows(tsSec: number[]): Hist {
  return {
    timestamps: tsSec,
    open: tsSec.map(() => 100),
    high: tsSec.map(() => 101),
    low: tsSec.map(() => 99),
    close: tsSec.map(() => 100),
    volume: tsSec.map(() => 1000),
  };
}

beforeEach(() => {
  calls = 0;
  yahooService.getHistory = original;
});
afterEach(() => {
  yahooService.getHistory = original;
});

test("normalizeNseSymbol rejects unsafe/free-form symbols", () => {
  assert.equal(normalizeNseSymbol("RELIANCE")?.yahooSymbol, "RELIANCE.NS");
  assert.equal(normalizeNseSymbol("reliance.ns")?.symbol, "RELIANCE");
  assert.equal(normalizeNseSymbol("M&M")?.symbol, "M&M");
  assert.equal(normalizeNseSymbol("TCS.BO"), null);
  assert.equal(normalizeNseSymbol("A B"), null);
  assert.equal(normalizeNseSymbol("../etc"), null);
  assert.equal(normalizeNseSymbol("x?y=1"), null);
});

test("only verified interval/range combos accepted (1m+7d removed)", () => {
  assert.equal(isSupportedIntervalRange("1m", "5d"), true);
  assert.equal(isSupportedIntervalRange("1m", "7d"), false);
  assert.equal(isSupportedIntervalRange("1d", "1y"), true);
  assert.equal(isSupportedIntervalRange("5m", "3mo"), false);
});

test("invalid symbol -> invalid_input with ZERO provider calls", async () => {
  setProvider(() => rows([]));
  const r = await fetchSpotCandles("../secret", "1d");
  assert.equal(r.status, "invalid_input");
  assert.equal(calls, 0);
});

test("invalid interval/range -> invalid_input with ZERO provider calls", async () => {
  setProvider(() => rows([]));
  const r = await fetchSpotCandles("RELIANCE", "1m", { range: "7d" });
  assert.equal(r.status, "invalid_input");
  assert.equal(calls, 0);
});

test("invalid nowMs -> invalid_input with ZERO provider calls", async () => {
  setProvider(() => rows([]));
  const r = await fetchSpotCandles("RELIANCE", "1d", { nowMs: -5 });
  assert.equal(r.status, "invalid_input");
  assert.equal(calls, 0);
});

test("valid 1m fetch reports alignment hygiene", async () => {
  setProvider(() => rows([secAt(2026, 7, 20, 9, 15), secAt(2026, 7, 20, 9, 16), secAt(2026, 7, 20, 9, 17)]));
  const r = await fetchSpotCandles("RELIANCE", "1m", { range: "5d", nowMs: msAt(2026, 7, 20, 16, 0) });
  assert.equal(r.status, "available");
  assert.equal(calls, 1);
  assert.equal(r.value!.hygiene.alignedCount, 3);
  assert.equal(r.value!.hygiene.misalignedCount, 0);
});

test("misaligned provider timestamp is reported and excluded from aligned", async () => {
  setProvider(() => rows([secAt(2026, 7, 20, 9, 15), secAt(2026, 7, 20, 9, 15, 30), secAt(2026, 7, 20, 9, 16)]));
  const r = await fetchSpotCandles("RELIANCE", "1m", { range: "5d", nowMs: msAt(2026, 7, 20, 16, 0) });
  assert.equal(r.status, "available");
  assert.equal(r.value!.hygiene.alignedCount, 2);
  assert.equal(r.value!.hygiene.misalignedCount, 1);
});

// ── G2: cadence counts MISSING interval bars, only among aligned in-session ──
test("cadence reports two missing 5m bars for 09:15 -> 09:30", async () => {
  setProvider(() => rows([secAt(2026, 7, 20, 9, 15), secAt(2026, 7, 20, 9, 30)]));
  const r = await fetchSpotCandles("RELIANCE", "5m", { range: "1d", nowMs: msAt(2026, 7, 20, 16, 0) });
  assert.equal(r.status, "available");
  assert.equal(r.value!.hygiene.alignedCount, 2);
  assert.equal(r.value!.hygiene.cadenceGaps, 2); // 09:20 and 09:25 missing
});

test("cadence ignores an interval-misaligned bar (5m at 09:16)", async () => {
  setProvider(() => rows([secAt(2026, 7, 20, 9, 15), secAt(2026, 7, 20, 9, 16), secAt(2026, 7, 20, 9, 20)]));
  const r = await fetchSpotCandles("RELIANCE", "5m", { range: "1d", nowMs: msAt(2026, 7, 20, 16, 0) });
  assert.equal(r.status, "available");
  assert.equal(r.value!.hygiene.alignedCount, 2); // 09:15, 09:20
  assert.equal(r.value!.hygiene.misalignedCount, 1); // 09:16
  assert.equal(r.value!.hygiene.cadenceGaps, 0);
});

// ── G3: forming derived from the last USABLE aligned bar ────────────────────
test("lastCandleForming is derived from the last aligned in-session bar", async () => {
  // 5m 15:25 (aligned, completes 15:30) + out-of-session 15:30; reference 15:31.
  setProvider(() => rows([secAt(2026, 7, 20, 15, 25), secAt(2026, 7, 20, 15, 30)]));
  const r = await fetchSpotCandles("RELIANCE", "5m", { range: "1d", nowMs: msAt(2026, 7, 20, 15, 31) });
  assert.equal(r.status, "available");
  assert.equal(r.value!.hygiene.alignedCount, 1);
  assert.equal(r.value!.hygiene.outOfSessionCount, 1);
  assert.equal(r.value!.hygiene.lastCandleForming, false);
});

// ── G4: fractional provider timestamps rejected ─────────────────────────────
test("fractional timestamp seconds are rejected", async () => {
  setProvider(() => rows([secAt(2026, 7, 20, 9, 15) + 0.5]));
  const r = await fetchSpotCandles("RELIANCE", "1d", { range: "1mo", nowMs: msAt(2026, 7, 20, 16, 0) });
  assert.equal(r.status, "unavailable"); // no valid candles remained
});

// ── G5: zero usable aligned intraday candles -> unavailable ─────────────────
test("intraday with only out-of-session bars is unavailable", async () => {
  setProvider(() => rows([secAt(2026, 7, 20, 8, 0), secAt(2026, 7, 20, 8, 1)])); // pre-market
  const r = await fetchSpotCandles("RELIANCE", "1m", { range: "1d", nowMs: msAt(2026, 7, 20, 16, 0) });
  assert.equal(r.status, "unavailable");
});

// ── G6: daily duplicate trading dates quarantined ───────────────────────────
test("daily duplicate trading dates are quarantined", async () => {
  setProvider(() =>
    rows([secAt(2026, 7, 16, 9, 15), secAt(2026, 7, 17, 9, 15), secAt(2026, 7, 17, 12, 0)]),
  );
  const r = await fetchSpotCandles("RELIANCE", "1d", { range: "1mo", nowMs: msAt(2026, 7, 20, 16, 0) });
  assert.equal(r.status, "available");
  assert.equal(r.value!.hygiene.duplicateTradingDates, 2); // both 07-17 candles dropped
  assert.equal(r.value!.count, 1); // only 07-16 remains
});

test("future timestamp -> ageMs null, futureTimestamp flagged", async () => {
  setProvider(() => rows([secAt(2026, 7, 20, 9, 15)]));
  const r = await fetchSpotCandles("RELIANCE", "1d", { range: "1mo", nowMs: msAt(2026, 7, 19, 10, 0) });
  assert.equal(r.status, "available");
  assert.equal(r.value!.ageMs, null);
  assert.equal(r.value!.hygiene.futureTimestamp, true);
});
