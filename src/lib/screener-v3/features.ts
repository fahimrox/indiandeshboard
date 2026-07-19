// PURE, deterministic feature calculations over real candles.
// Enforces: valid shape, exact alignment, consistent interval, in-session
// timestamps, contiguity, conflict-free dedupe, and no forming-candle-as-complete.
// Foundational calculations ONLY — no signals, scoring, BOS/CHoCH, or advice.
import {
  dedupeSortStrict,
  isValidCandleShape,
  isValidCandleVolume,
  type Candle,
  type CandleInterval,
} from "./candles.ts";
import {
  SESSION_OPEN_MIN,
  istDateStr,
  istMidnightMs,
  istMinuteInt,
  isExactMinuteBoundary,
  isSessionStart,
} from "./ist-time.ts";
import {
  insufficient,
  invalidInput,
  ok,
  unavailable,
  isFailure,
  type DataResult,
  type FailureResult,
} from "./types.ts";

function isPosInt(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

/**
 * Forming-candle policy: functions whose correctness depends on candle
 * completion REQUIRE an explicit finite-positive `referenceMs`. Pure feature
 * math must never read the machine clock. Returns a failure to propagate, or
 * null when the reference is valid.
 */
function refOrInvalid(referenceMs: number | undefined): FailureResult | null {
  if (referenceMs === undefined || !Number.isFinite(referenceMs) || referenceMs <= 0) {
    return invalidInput("referenceMs (finite positive epoch ms) is required for completion-sensitive features", {
      source: "candles",
    });
  }
  return null;
}
function intervalMinutes(iv: CandleInterval): number | null {
  return iv === "1m" ? 1 : iv === "3m" ? 3 : iv === "5m" ? 5 : null; // 1d -> null
}

interface CleanIntraday {
  candles: Candle[]; // sorted, deduped, structurally valid, interval-aligned
  interval: CandleInterval;
  ivMin: number;
}

/**
 * Structural cleaning for intraday features: reject conflicts, mixed intervals,
 * daily inputs, invalid shape, and misaligned timestamps. Does NOT filter by
 * session membership (functions do that explicitly so pre/post-market is
 * *excluded*, not treated as a hard error).
 */
function cleanIntraday(candles: Candle[]): DataResult<CleanIntraday> {
  if (candles.length === 0) return insufficient("no candles", { source: "candles" });
  const dd = dedupeSortStrict(candles);
  if (dd.conflictingTimestamps.length > 0) {
    return invalidInput(`conflicting duplicate timestamps (${dd.conflictingTimestamps.length})`, { source: "candles" });
  }
  const series = dd.candles;
  const iv = series[0].interval;
  if (!series.every((c) => c.interval === iv)) return invalidInput("mixed candle intervals", { source: "candles" });
  const ivMin = intervalMinutes(iv);
  if (ivMin === null) return invalidInput("intraday feature requires intraday candles (got 1d)", { source: "candles" });
  for (const c of series) {
    if (!isValidCandleShape(c)) {
      return invalidInput("invalid candle shape", { source: "candles" });
    }
    if (!isValidCandleVolume(c.volume)) {
      return invalidInput("invalid candle volume", { source: "candles" });
    }
    if (!isExactMinuteBoundary(c.timestamp)) return invalidInput("misaligned candle timestamp", { source: "candles" });
    if ((istMinuteInt(c.timestamp) - SESSION_OPEN_MIN) % ivMin !== 0) {
      return invalidInput("interval-misaligned candle", { source: "candles" });
    }
  }
  return ok({ candles: series, interval: iv, ivMin }, { source: "candles" });
}

/**
 * Keep only bars whose full interval has elapsed at `referenceMs` (a bar whose
 * close time is after the reference is still forming and is excluded).
 * `referenceMs` is always validated by the caller before this point.
 */
function completedOnly(candles: Candle[], ivMin: number, referenceMs: number): Candle[] {
  return candles.filter((c) => c.timestamp + ivMin * 60_000 <= referenceMs);
}

// ── 1. Session VWAP with coverage/gap metadata ──────────────────────────────
export interface VwapResult {
  vwap: number;
  sessionDateIst: string;
  firstTimestamp: number;
  lastTimestamp: number;
  observedCount: number;
  expectedCount: number; // canonical intervals from open through last completed candle
  missingCount: number;
  coverageRatio: number;
}

export function sessionVwap(
  candles: Candle[],
  opts: { sessionDateIst?: string; referenceMs?: number } = {},
): DataResult<VwapResult> {
  const badRef = refOrInvalid(opts.referenceMs);
  if (badRef) return badRef;
  const cleaned = cleanIntraday(candles);
  if (isFailure(cleaned)) return cleaned;
  const { candles: all, ivMin } = cleaned.value;

  const sessionDateIst = opts.sessionDateIst ?? istDateStr(all[all.length - 1].timestamp);
  let session = all.filter((c) => istDateStr(c.timestamp) === sessionDateIst && isSessionStart(c.timestamp));
  session = completedOnly(session, ivMin, opts.referenceMs!);
  if (session.length === 0) return unavailable(`no completed in-session candles for ${sessionDateIst}`, { source: "candles" });
  if (session.some((c) => c.volume === null)) return unavailable("missing volume within session (VWAP unavailable)", { source: "candles" });

  // Coverage: every canonical interval from open through the last observed must exist.
  const lastMin = istMinuteInt(session[session.length - 1].timestamp);
  const expectedMinutes: number[] = [];
  for (let m = SESSION_OPEN_MIN; m <= lastMin; m += ivMin) expectedMinutes.push(m);
  const observed = new Set(session.map((c) => istMinuteInt(c.timestamp)));
  const presentExpected = expectedMinutes.filter((m) => observed.has(m)).length;
  const missingCount = expectedMinutes.length - presentExpected;
  if (missingCount !== 0 || session.length !== expectedMinutes.length) {
    return unavailable(
      `session has gaps (coverage ${presentExpected}/${expectedMinutes.length})`,
      { source: "candles" },
    );
  }

  let cumPv = 0;
  let cumVol = 0;
  for (const c of session) {
    const typical = (c.high + c.low + c.close) / 3;
    cumPv += typical * (c.volume as number);
    cumVol += c.volume as number;
  }
  if (cumVol <= 0) return unavailable("zero cumulative volume", { source: "candles" });

  return ok(
    {
      vwap: cumPv / cumVol,
      sessionDateIst,
      firstTimestamp: session[0].timestamp,
      lastTimestamp: session[session.length - 1].timestamp,
      observedCount: session.length,
      expectedCount: expectedMinutes.length,
      missingCount,
      coverageRatio: session.length / expectedMinutes.length,
    },
    { source: "candles", timestamp: session[session.length - 1].timestamp },
  );
}

// ── 2. True Range & ATR ─────────────────────────────────────────────────────
export function trueRange(high: number, low: number, prevClose: number): number {
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

export function atr(candles: Candle[], period = 14): DataResult<number> {
  if (!isPosInt(period)) return invalidInput("period must be a positive integer", { source: "candles" });
  const dd = dedupeSortStrict(candles);
  if (dd.conflictingTimestamps.length > 0) return invalidInput("conflicting duplicate timestamps", { source: "candles" });
  const series = dd.candles;
  if (series.length < period + 1) {
    return insufficient(`need ${period + 1} candles, have ${series.length}`, { source: "candles" });
  }
  const iv = series[0].interval;
  if (!series.every((c) => c.interval === iv)) return invalidInput("mixed candle intervals", { source: "candles" });
  if (!series.every(isValidCandleShape)) return invalidInput("invalid OHLC in ATR input", { source: "candles" });
  const trs: number[] = [];
  for (let i = 1; i < series.length; i++) trs.push(trueRange(series[i].high, series[i].low, series[i - 1].close));
  const window = trs.slice(-period);
  return ok(window.reduce((s, v) => s + v, 0) / window.length, { source: "candles" });
}

// ── 3. Previous completed session OHLC (daily only) ─────────────────────────
export interface SessionOhlc {
  dateIst: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export function previousSessionOhlc(
  dailyCandles: Candle[],
  referenceMs: number,
): DataResult<SessionOhlc> {
  const badRef = refOrInvalid(referenceMs);
  if (badRef) return badRef;
  if (dailyCandles.length === 0) return insufficient("no candles", { source: "candles" });
  if (!dailyCandles.every((c) => c.interval === "1d")) {
    return invalidInput("previous-session OHLC requires 1d candles", { source: "candles" });
  }
  const dd = dedupeSortStrict(dailyCandles);
  if (dd.conflictingTimestamps.length > 0) return invalidInput("conflicting duplicate timestamps", { source: "candles" });
  const series = dd.candles;
  const dates = series.map((c) => istDateStr(c.timestamp));
  if (new Set(dates).size !== dates.length) {
    return invalidInput("duplicate trading dates in daily input", { source: "candles" });
  }
  const todayIst = istDateStr(referenceMs);
  const prior = series.filter((c) => istDateStr(c.timestamp) < todayIst);
  const last = prior[prior.length - 1];
  if (!last) return insufficient("no completed prior session", { source: "candles" });
  if (!isValidCandleShape(last)) return invalidInput("invalid prior-session OHLC", { source: "candles" });
  return ok(
    { dateIst: istDateStr(last.timestamp), open: last.open, high: last.high, low: last.low, close: last.close, volume: last.volume },
    { source: "candles", timestamp: last.timestamp },
  );
}

// ── 4. Opening range (5/15/30) — wall-clock gated, full 1m coverage ─────────
export interface OpeningRange {
  sessionDateIst: string;
  windowMinutes: number;
  high: number;
  low: number;
  startTs: number;
  endTs: number;
  coverage: number;
  expected: number;
}

export function openingRange(
  candles: Candle[],
  windowMinutes: 5 | 15 | 30,
  opts: { sessionDateIst?: string; referenceMs?: number } = {},
): DataResult<OpeningRange> {
  const badRef = refOrInvalid(opts.referenceMs);
  if (badRef) return badRef;
  const cleaned = cleanIntraday(candles);
  if (isFailure(cleaned)) return cleaned;
  const { candles: all, interval } = cleaned.value;
  if (interval !== "1m") return invalidInput("opening range requires 1-minute candles", { source: "candles" });

  const sessionDateIst = opts.sessionDateIst ?? istDateStr(all[all.length - 1].timestamp);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDateIst)) {
    return invalidInput("sessionDateIst must be a canonical YYYY-MM-DD string", { source: "candles" });
  }
  // Anchor midnight to a candle that ACTUALLY belongs to the requested session
  // date — never derive it from an unrelated session.
  const anchor = all.find((c) => istDateStr(c.timestamp) === sessionDateIst);
  if (!anchor) {
    return unavailable(`no candles for requested session date ${sessionDateIst}`, { source: "candles" });
  }
  const midnight = istMidnightMs(anchor.timestamp);
  const windowEndMin = SESSION_OPEN_MIN + windowMinutes;
  const startTs = midnight + SESSION_OPEN_MIN * 60_000;
  const endTs = midnight + windowEndMin * 60_000;

  // Wall-clock gate: the window must have fully elapsed at the reference time.
  const referenceMs = opts.referenceMs!;
  if (referenceMs < endTs) {
    return insufficient(`opening-range window not elapsed (5m>=09:20, 15m>=09:30, 30m>=09:45 IST)`, { source: "candles" });
  }

  const inWindow = all.filter((c) => {
    if (istDateStr(c.timestamp) !== sessionDateIst) return false;
    const m = istMinuteInt(c.timestamp);
    return m >= SESSION_OPEN_MIN && m < windowEndMin;
  });
  const expectedMinutes: number[] = [];
  for (let m = SESSION_OPEN_MIN; m < windowEndMin; m++) expectedMinutes.push(m);
  const minuteSet = new Set(inWindow.map((c) => istMinuteInt(c.timestamp)));
  if (minuteSet.size !== inWindow.length) {
    return invalidInput("duplicate-minute bars in opening-range window", { source: "candles" });
  }
  const coverage = expectedMinutes.filter((m) => minuteSet.has(m)).length;
  if (coverage < expectedMinutes.length || inWindow.length !== expectedMinutes.length) {
    return insufficient(`opening-range incomplete (${coverage}/${expectedMinutes.length} minutes)`, { source: "candles" });
  }
  if (!inWindow.every(isValidCandleShape)) return invalidInput("invalid OHLC in opening-range window", { source: "candles" });

  return ok(
    {
      sessionDateIst,
      windowMinutes,
      high: Math.max(...inWindow.map((c) => c.high)),
      low: Math.min(...inWindow.map((c) => c.low)),
      startTs,
      endTs,
      coverage,
      expected: expectedMinutes.length,
    },
    { source: "candles" },
  );
}

// ── 5. Intraday return windows (same-session, EXACT target, full contiguity) ─
export function returnWindow(
  candles: Candle[],
  minutes: number,
  opts: { referenceMs?: number } = {},
): DataResult<number> {
  if (!isPosInt(minutes)) return invalidInput("minutes must be a positive integer", { source: "candles" });
  const badRef = refOrInvalid(opts.referenceMs);
  if (badRef) return badRef;
  const cleaned = cleanIntraday(candles);
  if (isFailure(cleaned)) return cleaned;
  const { candles: all, ivMin } = cleaned.value;

  // The requested span must be exactly representable by the candle interval.
  if (minutes % ivMin !== 0) {
    return invalidInput(`minutes (${minutes}) is not a multiple of the candle interval (${ivMin}m)`, { source: "candles" });
  }

  const completed = completedOnly(all, ivMin, opts.referenceMs!).filter((c) => isSessionStart(c.timestamp));
  if (completed.length < 2) return insufficient("need >= 2 completed in-session candles", { source: "candles" });
  const last = completed[completed.length - 1];
  const lastDate = istDateStr(last.timestamp);
  const targetTs = last.timestamp - minutes * 60_000;

  // Target must land at/after session open on the SAME trading date.
  if (targetTs < istMidnightMs(last.timestamp) + SESSION_OPEN_MIN * 60_000) {
    return insufficient("return target is before session open", { source: "candles" });
  }

  // EXACT baseline required at targetTs, plus full contiguity through `last`
  // (every expected interval present exactly once — no nearest/tolerance).
  const byTs = new Map<number, Candle>();
  for (const c of completed) {
    if (istDateStr(c.timestamp) === lastDate) byTs.set(c.timestamp, c);
  }
  const step = ivMin * 60_000;
  for (let t = targetTs; t <= last.timestamp; t += step) {
    if (!byTs.has(t)) {
      return unavailable(`missing candle at ${t} in the baseline→latest path (no substitution)`, { source: "candles" });
    }
  }
  const baseline = byTs.get(targetTs)!;
  if (baseline.close <= 0) return unavailable("invalid baseline close", { source: "candles" });
  return ok(((last.close - baseline.close) / baseline.close) * 100, { source: "candles" });
}

export function returnWindows(
  candles: Candle[],
  minutesList: number[] = [1, 3, 5, 15],
  opts: { referenceMs?: number } = {},
): Record<string, DataResult<number>> {
  const out: Record<string, DataResult<number>> = {};
  for (const m of minutesList) out[`${m}m`] = returnWindow(candles, m, opts);
  return out;
}

// ── 6. Volume windows (single session, contiguous, complete) ────────────────
function contiguousInSessionWindow(
  candles: Candle[],
  need: number,
  ivMin: number,
  referenceMs: number,
): DataResult<Candle[]> {
  const completed = completedOnly(candles, ivMin, referenceMs);
  if (completed.length < need) return insufficient(`need ${need} candles, have ${completed.length}`, { source: "candles" });
  const window = completed.slice(-need);
  if (!window.every((c) => isSessionStart(c.timestamp))) return unavailable("window contains out-of-session bars", { source: "candles" });
  const dates = new Set(window.map((c) => istDateStr(c.timestamp)));
  if (dates.size > 1) return unavailable("volume window crosses a session/day boundary", { source: "candles" });
  const step = ivMin * 60_000;
  for (let i = 1; i < window.length; i++) {
    if (window[i].timestamp - window[i - 1].timestamp !== step) {
      return unavailable("non-contiguous candles in volume window (gap)", { source: "candles" });
    }
  }
  if (window.some((c) => c.volume === null)) return unavailable("missing volume in window", { source: "candles" });
  return ok(window, { source: "candles" });
}

export function rollingVolumeSum(candles: Candle[], n: number, opts: { referenceMs?: number } = {}): DataResult<number> {
  if (!isPosInt(n)) return invalidInput("window n must be a positive integer", { source: "candles" });
  const badRef = refOrInvalid(opts.referenceMs);
  if (badRef) return badRef;
  const cleaned = cleanIntraday(candles);
  if (isFailure(cleaned)) return cleaned;
  const g = contiguousInSessionWindow(cleaned.value.candles, n, cleaned.value.ivMin, opts.referenceMs!);
  if (isFailure(g)) return g;
  return ok(g.value.reduce((s, c) => s + (c.volume as number), 0), { source: "candles" });
}

export function rollingAvgVolume(candles: Candle[], n: number, opts: { referenceMs?: number } = {}): DataResult<number> {
  if (!isPosInt(n)) return invalidInput("window n must be a positive integer", { source: "candles" });
  const sum = rollingVolumeSum(candles, n, opts);
  if (isFailure(sum)) return sum;
  return ok(sum.value / n, { source: "candles" });
}

export interface VolumeAcceleration {
  recentAvg: number;
  priorAvg: number;
  ratio: number | null;
  delta: number;
}

export function volumeAcceleration(
  candles: Candle[],
  windowN: number,
  opts: { referenceMs?: number } = {},
): DataResult<VolumeAcceleration> {
  if (!isPosInt(windowN)) return invalidInput("windowN must be a positive integer", { source: "candles" });
  const badRef = refOrInvalid(opts.referenceMs);
  if (badRef) return badRef;
  const cleaned = cleanIntraday(candles);
  if (isFailure(cleaned)) return cleaned;
  const g = contiguousInSessionWindow(cleaned.value.candles, windowN * 2, cleaned.value.ivMin, opts.referenceMs!);
  if (isFailure(g)) return g;
  const win = g.value;
  const prior = win.slice(0, windowN);
  const recent = win.slice(windowN);
  const priorAvg = prior.reduce((s, c) => s + (c.volume as number), 0) / windowN;
  const recentAvg = recent.reduce((s, c) => s + (c.volume as number), 0) / windowN;
  return ok(
    { recentAvg, priorAvg, ratio: priorAvg > 0 ? recentAvg / priorAvg : null, delta: recentAvg - priorAvg },
    { source: "candles" },
  );
}
