import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sessionVwap,
  trueRange,
  atr,
  previousSessionOhlc,
  openingRange,
  returnWindow,
  rollingVolumeSum,
  volumeAcceleration,
} from "./features.ts";
import type { Candle, CandleInterval } from "./candles.ts";

const IST = 5.5 * 3600 * 1000;
const istMs = (y: number, mo: number, d: number, h: number, mi: number, s = 0) =>
  Date.UTC(y, mo - 1, d, h, mi, s) - IST;

// A reference time well after the trading day: every bar is completed.
const REF = istMs(2026, 7, 20, 16, 0);

function bar(min: number, over: Partial<Candle> & { sec?: number } = {}): Candle {
  const { sec = 0, ...rest } = over;
  return {
    timestamp: istMs(2026, 7, 20, Math.floor(min / 60), min % 60, sec),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
    source: "yahoo",
    interval: "1m",
    ...rest,
  };
}
function barIv(min: number, ivMin: 1 | 3 | 5, over: Partial<Candle> = {}): Candle {
  const interval: CandleInterval = ivMin === 1 ? "1m" : ivMin === 3 ? "3m" : "5m";
  return { ...bar(min, over), interval };
}
function run(startMin: number, count: number, over: Partial<Candle> = {}): Candle[] {
  return Array.from({ length: count }, (_, i) => bar(startMin + i, over));
}

test("sessionVwap computes over a fully-covered session", () => {
  const r = sessionVwap(run(555, 3), { referenceMs: REF });
  assert.equal(r.status, "available");
  assert.ok(r.value);
  assert.equal(r.value!.observedCount, 3);
  assert.equal(r.value!.expectedCount, 3);
  assert.equal(r.value!.missingCount, 0);
});

test("sessionVwap requires an explicit referenceMs", () => {
  assert.equal(sessionVwap(run(555, 3)).status, "invalid_input");
  assert.equal(sessionVwap(run(555, 3), { referenceMs: Number.NaN }).status, "invalid_input");
});

test("sessionVwap rejects missing volume", () => {
  const bars = run(555, 3);
  bars[1].volume = null;
  assert.equal(sessionVwap(bars, { referenceMs: REF }).status, "unavailable");
});

test("sessionVwap detects a gap instead of reporting complete", () => {
  const r = sessionVwap([bar(555), bar(557)], { referenceMs: REF }); // 556 missing
  assert.equal(r.status, "unavailable");
  assert.match(r.reason ?? "", /gap|coverage/i);
});

test("sessionVwap rejects misaligned candle as invalid_input", () => {
  const r = sessionVwap([bar(555), bar(556, { sec: 30 }), bar(557)], { referenceMs: REF });
  assert.equal(r.status, "invalid_input");
});

test("sessionVwap rejects mixed interval as invalid_input", () => {
  const bars = run(555, 3);
  bars[1].interval = "5m";
  assert.equal(sessionVwap(bars, { referenceMs: REF }).status, "invalid_input");
});

test("trueRange + ATR sufficiency", () => {
  assert.equal(trueRange(10, 5, 8), 5);
  const daily: Candle[] = Array.from({ length: 20 }, (_, i) => ({
    timestamp: istMs(2026, 7, 1 + i, 9, 15),
    open: 100,
    high: 105,
    low: 95,
    close: 100,
    volume: 1000,
    source: "yahoo",
    interval: "1d",
  }));
  assert.equal(atr(daily, 14).status, "available");
  assert.equal(atr(daily.slice(0, 3), 14).status, "insufficient_history");
  assert.equal(atr(daily, 0).status, "invalid_input");
  assert.equal(atr(daily, 2.5).status, "invalid_input");
});

test("previousSessionOhlc: daily only, rejects intraday + duplicate dates", () => {
  const d1: Candle = { timestamp: istMs(2026, 7, 16, 9, 15), open: 10, high: 12, low: 9, close: 11, volume: 5, source: "y", interval: "1d" };
  const d2: Candle = { timestamp: istMs(2026, 7, 17, 9, 15), open: 11, high: 13, low: 10, close: 12, volume: 6, source: "y", interval: "1d" };
  const r = previousSessionOhlc([d1, d2], istMs(2026, 7, 20, 12, 0));
  assert.equal(r.status, "available");
  assert.equal(r.value!.dateIst, "2026-07-17");

  assert.equal(previousSessionOhlc([d1, d2], Number.NaN).status, "invalid_input"); // referenceMs required

  const intraday: Candle = { ...d2, interval: "1m" };
  assert.equal(previousSessionOhlc([intraday], REF).status, "invalid_input");

  const dupDate: Candle = { ...d2, timestamp: istMs(2026, 7, 17, 15, 30), close: 99 };
  assert.equal(previousSessionOhlc([d2, dupDate], REF).status, "invalid_input");
});

test("openingRange gated by wall clock + full coverage", () => {
  const bars = run(555, 15); // 09:15..09:29
  const before = openingRange(bars, 15, { referenceMs: istMs(2026, 7, 20, 9, 29) });
  assert.equal(before.status, "insufficient_history"); // window not elapsed

  const done = openingRange(bars, 15, { referenceMs: istMs(2026, 7, 20, 9, 30) });
  assert.equal(done.status, "available");
  assert.equal(done.value!.coverage, 15);

  const gapped = openingRange(bars.filter((_, i) => i !== 5), 15, { referenceMs: istMs(2026, 7, 20, 9, 30) });
  assert.equal(gapped.status, "insufficient_history");
});

test("openingRange requires referenceMs", () => {
  assert.equal(openingRange(run(555, 15), 15).status, "invalid_input");
});

// ── Group C: opening range must not borrow another session's midnight ───────
test("openingRange for a date absent from the series is unavailable", () => {
  const bars = run(555, 15); // all 2026-07-20
  const r = openingRange(bars, 15, { sessionDateIst: "2026-07-21", referenceMs: istMs(2026, 7, 21, 10, 0) });
  assert.equal(r.status, "unavailable");
  assert.match(r.reason ?? "", /no candles for requested session date/i);
});

// ── Group A: truthful return-window semantics ───────────────────────────────
test("returnWindow: valid exact contiguous window returns correct percentage", () => {
  const bars = run(555, 6).map((b, i) => ({ ...b, high: 200, low: 50, close: 100 + i }));
  const r = returnWindow(bars, 5, { referenceMs: REF });
  assert.equal(r.status, "available");
  assert.ok(Math.abs(r.value! - 5) < 1e-9); // (105-100)/100 * 100
});

test("returnWindow: valid exact contiguous 5m window", () => {
  const bars = [
    barIv(555, 5, { high: 200, low: 50, close: 100 }),
    barIv(560, 5, { high: 200, low: 50, close: 105 }),
    barIv(565, 5, { high: 200, low: 50, close: 107 }),
    barIv(570, 5, { high: 200, low: 50, close: 110 }),
  ];
  const r = returnWindow(bars, 15, { referenceMs: REF });
  assert.equal(r.status, "available");
  assert.ok(Math.abs(r.value! - 10) < 1e-9); // (110-100)/100 * 100
});

test("returnWindow: requested span not a multiple of interval -> invalid_input", () => {
  const threeMin = [barIv(555, 3), barIv(558, 3), barIv(561, 3)];
  assert.equal(returnWindow(threeMin, 1, { referenceMs: REF }).status, "invalid_input");
  const fiveMin = [barIv(555, 5), barIv(560, 5), barIv(565, 5)];
  assert.equal(returnWindow(fiveMin, 3, { referenceMs: REF }).status, "invalid_input");
});

test("returnWindow: exact baseline missing (nearby exists) -> unavailable, no substitution", () => {
  // last=09:20 (min 560), 5m back target=09:15 (555) is absent; 556 is nearby.
  const bars = [bar(556), bar(557), bar(558), bar(559), bar(560)];
  const r = returnWindow(bars, 5, { referenceMs: REF });
  assert.equal(r.status, "unavailable");
});

test("returnWindow: missing intermediate candle -> unavailable", () => {
  const bars = run(555, 6).filter((b, i) => i !== 2); // drop 09:17
  const r = returnWindow(bars, 5, { referenceMs: REF });
  assert.equal(r.status, "unavailable");
});

test("returnWindow: non-integer minutes + missing ref", () => {
  const bars = run(555, 6);
  assert.equal(returnWindow(bars, 2.5, { referenceMs: REF }).status, "invalid_input");
  assert.equal(returnWindow(bars, 5).status, "invalid_input"); // ref required
  assert.equal(returnWindow(run(555, 2), 5, { referenceMs: REF }).status, "insufficient_history"); // target before open
});

// ── Group B: forming-candle exclusion via explicit referenceMs ──────────────
test("rollingVolumeSum excludes a still-forming 1m bar", () => {
  const b = [bar(560, { volume: 100 })]; // 09:20
  assert.equal(rollingVolumeSum(b, 1, { referenceMs: istMs(2026, 7, 20, 9, 20, 30) }).status, "insufficient_history");
  assert.equal(rollingVolumeSum(b, 1, { referenceMs: istMs(2026, 7, 20, 9, 21, 0) }).value, 100);
});

test("rollingVolumeSum excludes a still-forming 5m bar", () => {
  const b = [barIv(560, 5, { volume: 100 })]; // 09:20 5m bar closes 09:25
  assert.equal(rollingVolumeSum(b, 1, { referenceMs: istMs(2026, 7, 20, 9, 24, 59) }).status, "insufficient_history");
});

test("rollingVolumeSum rejects an intraday gap; validates window + ref", () => {
  const contiguous = run(555, 3, { volume: 100 });
  assert.equal(rollingVolumeSum(contiguous, 3, { referenceMs: REF }).value, 300);
  assert.equal(rollingVolumeSum(contiguous, 0, { referenceMs: REF }).status, "invalid_input");
  assert.equal(rollingVolumeSum(contiguous, 3).status, "invalid_input"); // ref required

  const gap = [bar(556, { volume: 10 }), bar(630, { volume: 20 })]; // 09:16 -> 10:30
  assert.equal(rollingVolumeSum(gap, 2, { referenceMs: REF }).status, "unavailable");
});

test("volumeAcceleration compares contiguous halves", () => {
  const bars = [
    bar(555, { volume: 100 }),
    bar(556, { volume: 100 }),
    bar(557, { volume: 200 }),
    bar(558, { volume: 200 }),
  ];
  const r = volumeAcceleration(bars, 2, { referenceMs: REF });
  assert.equal(r.status, "available");
  assert.equal(r.value!.priorAvg, 100);
  assert.equal(r.value!.recentAvg, 200);
  assert.equal(r.value!.ratio, 2);
  assert.equal(volumeAcceleration(bars, 2).status, "invalid_input"); // ref required
});

test("feature calculations reject non-finite or negative volumes", () => {
  const badVolumes = [-1, Number.NaN, Number.POSITIVE_INFINITY];
  for (const badVolume of badVolumes) {
    const bars = run(555, 3);
    bars[1].volume = badVolume;
    assert.equal(sessionVwap(bars, { referenceMs: REF }).status, "invalid_input", `VWAP must reject volume ${String(badVolume)}`);
    assert.equal(rollingVolumeSum(bars, 3, { referenceMs: REF }).status, "invalid_input", `rolling volume must reject volume ${String(badVolume)}`);
  }
});
