// PURE candle model: strict validation, conflict-aware dedupe, and deterministic
// IST-session-aligned aggregation with exact 1-minute timing. No IO. Real data
// only — never fabricates candles or fills gaps; missing volume stays null.
import {
  SESSION_OPEN_MIN,
  SESSION_CLOSE_MIN,
  istDateStr,
  istMidnightMs,
  istMinuteInt,
  isCanonicalMinuteStart,
  isExactMinuteBoundary,
  isSessionStart,
} from "./ist-time.ts";

export type CandleInterval = "1m" | "3m" | "5m" | "1d";

export interface Candle {
  timestamp: number; // epoch ms — candle START
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null; // null = missing; 0 = genuine zero
  source: string;
  interval: CandleInterval;
}

/** Raw Yahoo v8 chart shape (timestamps are in SECONDS). */
export interface YahooChartArrays {
  timestamps: number[];
  open: Array<number | null>;
  high: Array<number | null>;
  low: Array<number | null>;
  close: Array<number | null>;
  volume: Array<number | null>;
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Valid candle volume: null means missing; otherwise finite and non-negative. */
export function isValidCandleVolume(
  volume: unknown,
): volume is number | null {
  return volume === null || (finite(volume) && volume >= 0);
}

/**
 * Strict OHLC validity. Rejects (never repairs) any candle where timestamp is
 * not positive-finite, any OHLC is non-finite or non-positive, or the
 * high/low/open/close relationships are violated.
 */
export function isValidCandleShape(c: {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}): boolean {
  if (!finite(c.timestamp) || c.timestamp <= 0) return false;
  if (!finite(c.open) || !finite(c.high) || !finite(c.low) || !finite(c.close)) return false;
  if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) return false;
  if (c.high < c.low) return false;
  if (c.high < c.open || c.high < c.close) return false;
  if (c.low > c.open || c.low > c.close) return false;
  return true;
}

/** True volume equality treating null as a distinct value. */
function volEq(a: number | null, b: number | null): boolean {
  return a === b;
}

/** Two candle records are IDENTICAL (safe to collapse) iff every field matches. */
export function candleRecordsEqual(a: Candle, b: Candle): boolean {
  return (
    a.timestamp === b.timestamp &&
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    volEq(a.volume, b.volume) &&
    a.source === b.source &&
    a.interval === b.interval
  );
}

export interface DedupeResult {
  candles: Candle[]; // sorted asc; identical duplicates collapsed; conflicts REMOVED
  duplicateIdentical: number; // extra identical rows collapsed
  conflictingTimestamps: number[]; // timestamps with conflicting duplicate data (removed)
}

/**
 * Sort + de-duplicate WITH conflict detection (no blind last-wins):
 *  - identical duplicate records are collapsed and counted
 *  - conflicting records at the same timestamp are REMOVED and the timestamp is
 *    surfaced (a provider conflict must never be silently overwritten)
 */
export function dedupeSortStrict(candles: Candle[]): DedupeResult {
  const byTs = new Map<number, Candle[]>();
  for (const c of candles) {
    const arr = byTs.get(c.timestamp) ?? [];
    arr.push(c);
    byTs.set(c.timestamp, arr);
  }
  const out: Candle[] = [];
  const conflicts: number[] = [];
  let duplicateIdentical = 0;
  for (const [ts, rows] of byTs) {
    if (rows.length === 1) {
      out.push(rows[0]);
      continue;
    }
    const allIdentical = rows.every((r) => candleRecordsEqual(r, rows[0]));
    if (allIdentical) {
      out.push(rows[0]);
      duplicateIdentical += rows.length - 1;
    } else {
      conflicts.push(ts); // remove all; surface the conflict
    }
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  conflicts.sort((a, b) => a - b);
  return { candles: out, duplicateIdentical, conflictingTimestamps: conflicts };
}

/** Back-compat: sorted, identical-deduped candles (conflicts dropped). */
export function dedupeAndSort(candles: Candle[]): Candle[] {
  return dedupeSortStrict(candles).candles;
}

/** Validate + normalize Yahoo arrays into strictly-valid, sorted, deduped candles. */
export function normalizeYahooCandles(
  raw: YahooChartArrays,
  interval: CandleInterval,
  source = "yahoo",
): Candle[] {
  const out: Candle[] = [];
  const n = raw.timestamps?.length ?? 0;
  for (let i = 0; i < n; i++) {
    const tsSec = raw.timestamps[i];
    const o = raw.open?.[i];
    const h = raw.high?.[i];
    const l = raw.low?.[i];
    const c = raw.close?.[i];
    if (!Number.isInteger(tsSec)) continue; // require integer epoch SECONDS (no rounding)
    if (!finite(o) || !finite(h) || !finite(l) || !finite(c)) continue;
    const timestamp = tsSec * 1000;
    if (!isValidCandleShape({ timestamp, open: o, high: h, low: l, close: c })) continue;
    const vRaw = raw.volume?.[i];
    const volume = finite(vRaw) && vRaw >= 0 ? vRaw : null; // distinguish 0 from missing
    out.push({ timestamp, open: o, high: h, low: l, close: c, volume, source, interval });
  }
  return dedupeSortStrict(out).candles;
}

// ── Aggregation (1m -> 3m / 5m) ─────────────────────────────────────────────

export type IncompleteReason =
  | "incomplete_coverage"
  | "mixed_source"
  | "duplicate_minute_slot"
  | "member_count_mismatch";

export interface IncompleteBucketInfo {
  timestamp: number; // session-aligned bucket start
  sessionDateIst: string;
  interval: "3m" | "5m";
  expected: number;
  coverage: number;
  reason: IncompleteReason;
}

export interface AggregateCounts {
  inputTotal: number;
  nonOneMinute: number;
  invalidShape: number;
  misaligned: number; // not an exact minute boundary
  outOfSession: number; // aligned but outside 09:15..15:29 start window
  duplicateIdentical: number;
  duplicateConflict: number; // timestamps with conflicting duplicate data (removed)
  duplicateMinuteSlot: number; // >1 member claiming the same minute in a bucket
  mixedSourceBuckets: number;
  usableCandles: number; // canonical 1m candles that entered bucketing
}

export interface AggregateResult {
  status: "available" | "invalid_input";
  interval: "3m" | "5m";
  candles: Candle[]; // COMPLETE buckets only
  incomplete: IncompleteBucketInfo[]; // metadata only — never candle-shaped
  counts: AggregateCounts;
  reason?: string;
}

/**
 * Aggregate genuine, exactly-aligned 1-minute candles into 3m/5m buckets.
 * A bucket is COMPLETE only when it contains exactly `factor` members, one for
 * every expected canonical minute, from a single source. Missing volume in any
 * member yields aggregate `volume: null` (never a partial sum). A non-empty
 * input with no usable canonical 1-minute candle returns `invalid_input`.
 */
export function aggregateCandles(candles: Candle[], factorMinutes: 3 | 5): AggregateResult {
  // Runtime guard: only 3 or 5 are valid factors (never label a 4m bucket "5m").
  if (factorMinutes !== 3 && factorMinutes !== 5) {
    return {
      status: "invalid_input",
      interval: "5m",
      candles: [],
      incomplete: [],
      counts: {
        inputTotal: Array.isArray(candles) ? candles.length : 0,
        nonOneMinute: 0, invalidShape: 0, misaligned: 0, outOfSession: 0,
        duplicateIdentical: 0, duplicateConflict: 0, duplicateMinuteSlot: 0,
        mixedSourceBuckets: 0, usableCandles: 0,
      },
      reason: `invalid factorMinutes ${String(factorMinutes)} (only 3 or 5 supported)`,
    };
  }
  const interval: "3m" | "5m" = factorMinutes === 3 ? "3m" : "5m";
  const counts: AggregateCounts = {
    inputTotal: candles.length,
    nonOneMinute: 0,
    invalidShape: 0,
    misaligned: 0,
    outOfSession: 0,
    duplicateIdentical: 0,
    duplicateConflict: 0,
    duplicateMinuteSlot: 0,
    mixedSourceBuckets: 0,
    usableCandles: 0,
  };

  // Classify to canonical 1-minute candidates.
  const candidates: Candle[] = [];
  for (const c of candles) {
    if (c.interval !== "1m") {
      counts.nonOneMinute++;
      continue;
    }
    if (!isValidCandleShape(c) || !isValidCandleVolume(c.volume) || typeof c.source !== "string" || c.source.trim() === "") {
      counts.invalidShape++;
      continue;
    }
    if (!isExactMinuteBoundary(c.timestamp)) {
      counts.misaligned++;
      continue;
    }
    if (!isSessionStart(c.timestamp)) {
      counts.outOfSession++;
      continue;
    }
    candidates.push(c);
  }

  // Conflict-aware dedupe of exact timestamps.
  const dd = dedupeSortStrict(candidates);
  counts.duplicateIdentical = dd.duplicateIdentical;
  counts.duplicateConflict = dd.conflictingTimestamps.length;
  const usable = dd.candles;
  counts.usableCandles = usable.length;

  const emptyReturn = (reason: string): AggregateResult => ({
    status: "invalid_input",
    interval,
    candles: [],
    incomplete: [],
    counts,
    reason,
  });
  if (candles.length === 0) return emptyReturn("no input candles");
  if (usable.length === 0) return emptyReturn("no usable canonical 1-minute candles in input");

  // Group by (IST date + session-aligned bucket index).
  const groups = new Map<string, Candle[]>();
  for (const c of usable) {
    const minute = istMinuteInt(c.timestamp);
    const bucketIdx = Math.floor((minute - SESSION_OPEN_MIN) / factorMinutes);
    const key = `${istDateStr(c.timestamp)}#${bucketIdx}`;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }

  const out: Candle[] = [];
  const incomplete: IncompleteBucketInfo[] = [];

  for (const [key, members] of groups) {
    const inOrder = members.slice().sort((a, b) => a.timestamp - b.timestamp);
    const sessionDateIst = key.slice(0, key.indexOf("#"));
    const bucketIdx = Number(key.slice(key.indexOf("#") + 1));
    const startMin = SESSION_OPEN_MIN + bucketIdx * factorMinutes;
    const bucketStart = istMidnightMs(inOrder[0].timestamp) + startMin * 60_000;

    const expectedMinutes: number[] = [];
    for (let k = 0; k < factorMinutes; k++) {
      const mm = startMin + k;
      if (mm < SESSION_CLOSE_MIN) expectedMinutes.push(mm);
    }
    const minuteSet = new Set(inOrder.map((c) => istMinuteInt(c.timestamp)));
    const coverage = expectedMinutes.filter((mm) => minuteSet.has(mm)).length;
    const pushIncomplete = (reason: IncompleteReason) =>
      incomplete.push({ timestamp: bucketStart, sessionDateIst, interval, expected: expectedMinutes.length, coverage, reason });

    // Duplicate minute slot (two members claiming the same minute — defensive).
    if (minuteSet.size !== inOrder.length) {
      counts.duplicateMinuteSlot++;
      pushIncomplete("duplicate_minute_slot");
      continue;
    }
    // One non-empty source per bucket; reject mixed.
    if (new Set(inOrder.map((c) => c.source)).size > 1) {
      counts.mixedSourceBuckets++;
      pushIncomplete("mixed_source");
      continue;
    }
    // Exact member count == factor AND full canonical coverage.
    if (inOrder.length !== factorMinutes || coverage !== expectedMinutes.length || expectedMinutes.length !== factorMinutes) {
      pushIncomplete(inOrder.length !== factorMinutes ? "member_count_mismatch" : "incomplete_coverage");
      continue;
    }

    const anyMissing = inOrder.some((c) => c.volume === null);
    const volume = anyMissing ? null : inOrder.reduce((s, c) => s + (c.volume as number), 0);

    out.push({
      timestamp: bucketStart,
      open: inOrder[0].open,
      high: Math.max(...inOrder.map((c) => c.high)),
      low: Math.min(...inOrder.map((c) => c.low)),
      close: inOrder[inOrder.length - 1].close,
      volume,
      source: inOrder[0].source,
      interval,
    });
  }

  out.sort((a, b) => a.timestamp - b.timestamp);
  incomplete.sort((a, b) => a.timestamp - b.timestamp);
  return { status: "available", interval, candles: out, incomplete, counts };
}

// Re-export alignment predicate used by callers.
export { isCanonicalMinuteStart };
