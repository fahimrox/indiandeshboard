import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidCandleShape,
  candleRecordsEqual,
  dedupeSortStrict,
  aggregateCandles,
  isCanonicalMinuteStart,
  type Candle,
} from "./candles.ts";
import { isIntervalAlignedStart, isExpiryContractCurrent } from "./ist-time.ts";

const IST = 5.5 * 3600 * 1000;
const istMs = (y: number, mo: number, d: number, h: number, mi: number, s = 0) =>
  Date.UTC(y, mo - 1, d, h, mi, s) - IST;

function c1(
  h: number,
  mi: number,
  extra: Partial<Candle> & { sec?: number } = {},
): Candle {
  const { sec = 0, ...over } = extra;
  return {
    timestamp: istMs(2026, 7, 20, h, mi, sec),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
    source: "yahoo",
    interval: "1m",
    ...over,
  };
}

test("isValidCandleShape rejects malformed OHLC", () => {
  assert.equal(isValidCandleShape({ timestamp: 1, open: 1, high: 2, low: 0.5, close: 1.5 }), true);
  assert.equal(isValidCandleShape({ timestamp: 1, open: 1, high: 0.5, low: 2, close: 1 }), false); // high<low
  assert.equal(isValidCandleShape({ timestamp: 0, open: 1, high: 2, low: 1, close: 1 }), false); // ts<=0
  assert.equal(isValidCandleShape({ timestamp: 1, open: -1, high: 2, low: 1, close: 1 }), false);
});

test("isCanonicalMinuteStart rejects 09:15:30 and accepts 09:15:00", () => {
  assert.equal(isCanonicalMinuteStart(istMs(2026, 7, 20, 9, 15, 0)), true);
  assert.equal(isCanonicalMinuteStart(istMs(2026, 7, 20, 9, 15, 30)), false);
  assert.equal(isCanonicalMinuteStart(istMs(2026, 7, 20, 15, 30, 0)), false); // close boundary excluded
});

test("candleRecordsEqual + dedupeSortStrict collapse identical, remove conflicts", () => {
  const a = c1(9, 15);
  const aDup = c1(9, 15); // identical
  const aConf = c1(9, 16, { close: 105 });
  const aConf2 = c1(9, 16, { close: 999 }); // conflicting at same ts
  assert.equal(candleRecordsEqual(a, aDup), true);

  const dd = dedupeSortStrict([a, aDup, aConf, aConf2]);
  assert.equal(dd.duplicateIdentical, 1); // one identical collapsed
  assert.equal(dd.conflictingTimestamps.length, 1); // 09:16 conflict removed
  assert.equal(dd.candles.length, 1); // only 09:15 survives
  assert.equal(dd.candles[0].timestamp, a.timestamp);
});

test("3m bucket completes with identical duplicate collapsed", () => {
  const res = aggregateCandles([c1(9, 15), c1(9, 15), c1(9, 16), c1(9, 17)], 3);
  assert.equal(res.status, "available");
  assert.equal(res.candles.length, 1);
  assert.equal(res.counts.duplicateIdentical, 1);
  assert.equal(res.candles[0].volume, 3000);
});

test("conflicting duplicate rejects the whole 3m bucket", () => {
  const res = aggregateCandles(
    [c1(9, 15), c1(9, 16), c1(9, 16, { volume: 500 }), c1(9, 17)],
    3,
  );
  assert.equal(res.counts.duplicateConflict, 1);
  assert.equal(res.candles.length, 0); // 09:16 dropped -> incomplete coverage
  assert.equal(res.incomplete.length, 1);
});

test("09:15:30 misaligned candle is counted, not bucketed", () => {
  const res = aggregateCandles([c1(9, 15, { sec: 30 }), c1(9, 16), c1(9, 17)], 3);
  assert.equal(res.counts.misaligned, 1);
  assert.equal(res.candles.length, 0);
});

test("non-1m and invalid candles are counted; all-unusable -> invalid_input", () => {
  const nonOne: Candle = { ...c1(9, 15), interval: "5m" };
  const invalid: Candle = { ...c1(9, 16), high: 1 }; // high<low(99)
  const res = aggregateCandles([nonOne, invalid], 3);
  assert.equal(res.status, "invalid_input");
  assert.equal(res.counts.nonOneMinute, 1);
  assert.equal(res.counts.invalidShape, 1);
});

test("empty input -> invalid_input", () => {
  assert.equal(aggregateCandles([], 5).status, "invalid_input");
});

test("mixed-source bucket is rejected", () => {
  const res = aggregateCandles(
    [c1(9, 15), c1(9, 16, { source: "other" }), c1(9, 17)],
    3,
  );
  assert.equal(res.counts.mixedSourceBuckets, 1);
  assert.equal(res.candles.length, 0);
});

test("final 15:27-15:29 forms a valid 3m bucket; 15:30 excluded", () => {
  const res = aggregateCandles([c1(15, 27), c1(15, 28), c1(15, 29), c1(15, 30)], 3);
  assert.equal(res.candles.length, 1);
  assert.equal(res.counts.outOfSession, 1); // 15:30 excluded as a start
});

test("15:29:30 rejected as misaligned", () => {
  const res = aggregateCandles([c1(15, 27), c1(15, 28), c1(15, 29, { sec: 30 })], 3);
  assert.equal(res.counts.misaligned, 1);
  assert.equal(res.candles.length, 0);
});

test("5m bucket completes; missing volume yields null aggregate volume", () => {
  const mins = [15, 16, 17, 18, 19];
  const full = aggregateCandles(mins.map((mi) => c1(9, mi)), 5);
  assert.equal(full.candles.length, 1);
  assert.equal(full.candles[0].volume, 5000);

  const withNull = aggregateCandles(
    mins.map((mi) => c1(9, mi, mi === 17 ? { volume: null } : {})),
    5,
  );
  assert.equal(withNull.candles.length, 1);
  assert.equal(withNull.candles[0].volume, null); // never a partial sum
});

// ── Group H: aggregation + alignment input contracts ───────────────────────
test("aggregateCandles rejects an invalid factorMinutes at runtime", () => {
  const res = aggregateCandles([c1(9, 15), c1(9, 16), c1(9, 17)], 4 as unknown as 3);
  assert.equal(res.status, "invalid_input");
  assert.match(res.reason ?? "", /factorMinutes/);
});

test("empty/whitespace source disqualifies a bucket member", () => {
  const res = aggregateCandles([c1(9, 15, { source: "  " }), c1(9, 16), c1(9, 17)], 3);
  assert.equal(res.counts.invalidShape, 1);
  assert.equal(res.candles.length, 0);
});

test("isIntervalAlignedStart validates the interval argument", () => {
  const ts = istMs(2026, 7, 20, 9, 15);
  assert.equal(isIntervalAlignedStart(ts, 3), true);
  assert.equal(isIntervalAlignedStart(ts, 0), false);
  assert.equal(isIntervalAlignedStart(ts, -1), false);
  assert.equal(isIntervalAlignedStart(ts, 2.5), false);
});

test("isExpiryContractCurrent rejects non-canonical date strings", () => {
  assert.equal(isExpiryContractCurrent("2026-07-28", "2026-07-18", 600), true);
  assert.equal(isExpiryContractCurrent("bad", "2026-07-18", 600), false);
  assert.equal(isExpiryContractCurrent("2026-07-28", "20260718", 600), false);
});

test("aggregate rejects non-finite or negative volumes instead of emitting invalid totals", () => {
  const badVolumes = [
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ];

  for (const badVolume of badVolumes) {
    const res = aggregateCandles(
      [
        c1(9, 15, { volume: badVolume }),
        c1(9, 16),
        c1(9, 17),
      ],
      3,
    );

    assert.equal(
      res.status,
      "available",
      `remaining valid candles should still be classified`,
    );
    assert.equal(
      res.candles.length,
      0,
      `bad volume ${String(badVolume)} must never emit an aggregate candle`,
    );
    assert.equal(
      res.incomplete.length,
      1,
      `dropping bad volume ${String(badVolume)} must surface an incomplete bucket`,
    );
    assert.equal(
      res.counts.invalidShape,
      1,
      `bad volume ${String(badVolume)} must be counted as invalid input data`,
    );
  }
});