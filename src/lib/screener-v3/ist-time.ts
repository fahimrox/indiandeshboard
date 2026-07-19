// Deterministic Asia/Kolkata (IST, UTC+5:30) helpers for Screener V3.
// Pure — no Date-locale dependence: we shift the epoch by +5:30 and read UTC
// getters so results are identical on any host timezone.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** NSE cash-session open = 09:15 IST, expressed as minutes-of-day. */
export const SESSION_OPEN_MIN = 9 * 60 + 15; // 555
/** NSE cash-session close = 15:30 IST, expressed as minutes-of-day. */
export const SESSION_CLOSE_MIN = 15 * 60 + 30; // 930

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export interface IstParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Break an epoch-ms timestamp into IST wall-clock parts. */
export function istParts(ms: number): IstParts {
  const d = new Date(ms + IST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

/** IST calendar date as a lexicographically-sortable YYYY-MM-DD string. */
export function istDateStr(ms: number): string {
  const p = istParts(ms);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Fractional minutes since IST midnight (seconds included). */
export function istMinutesOfDay(ms: number): number {
  const p = istParts(ms);
  return p.hour * 60 + p.minute + p.second / 60;
}

/** Epoch-ms of IST midnight for the day containing `ms` (millisecond-exact). */
export function istMidnightMs(ms: number): number {
  const p = istParts(ms);
  const sinceMidnightMs = ((p.hour * 60 + p.minute) * 60 + p.second) * 1000 + (ms % 1000);
  return ms - sinceMidnightMs;
}

/** True if `ms` falls within the NSE cash session (09:15–15:30 IST inclusive). */
export function isWithinSession(ms: number): boolean {
  const m = istMinutesOfDay(ms);
  return m >= SESSION_OPEN_MIN && m <= SESSION_CLOSE_MIN;
}

/**
 * True if `ms` is a VALID candle START time within the cash session.
 * Candle timestamps are START times, so the last valid start is 15:29 — a
 * candle starting at 15:30 or later belongs to no intraday session bucket.
 */
export function isSessionStart(ms: number): boolean {
  const m = istMinutesOfDay(ms);
  return m >= SESSION_OPEN_MIN && m < SESSION_CLOSE_MIN;
}

/** Integer IST minute-of-day (floored) — stable bucket key for 1-minute bars. */
export function istMinuteInt(ms: number): number {
  return Math.floor(istMinutesOfDay(ms));
}

/** Finite, strictly-positive epoch-ms. */
export function isFinitePositiveTs(ms: number): boolean {
  return Number.isFinite(ms) && ms > 0;
}

/** Exact minute boundary: `ms % 60_000 === 0` (rejects e.g. 09:15:30). */
export function isExactMinuteBoundary(ms: number): boolean {
  return isFinitePositiveTs(ms) && ms % 60_000 === 0;
}

/**
 * Canonical 1-minute NSE session start: an exact minute boundary whose IST
 * minute falls in [09:15, 15:30). A 09:15:30 timestamp is NOT canonical.
 */
export function isCanonicalMinuteStart(ms: number): boolean {
  if (!isExactMinuteBoundary(ms)) return false;
  return isSessionStart(ms);
}

/**
 * Interval-aligned session start: exact minute boundary, in-session, and offset
 * from 09:15 by a whole multiple of `intervalMinutes` (e.g. 3m -> :15,:18,:21).
 */
export function isIntervalAlignedStart(ms: number, intervalMinutes: number): boolean {
  if (!Number.isInteger(intervalMinutes) || intervalMinutes <= 0) return false; // invalid interval
  if (!isExactMinuteBoundary(ms)) return false;
  const m = istMinuteInt(ms);
  if (m < SESSION_OPEN_MIN || m >= SESSION_CLOSE_MIN) return false;
  return (m - SESSION_OPEN_MIN) % intervalMinutes === 0;
}

/** Canonical IST date string: strictly `YYYY-MM-DD`. */
export function isCanonicalDateStr(s: string): boolean {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Session-aware contract validity. A contract expiring TODAY (IST) is only
 * "current" before the 15:30 IST close; at/after close it must roll to the next
 * expiry. Future-dated contracts are always current; past-dated never are.
 * All comparisons use IST YYYY-MM-DD strings + IST minute-of-day.
 */
export function isExpiryContractCurrent(
  expiryDateIst: string,
  effectiveDateIst: string,
  nowMinuteOfDay: number,
): boolean {
  // Non-canonical date strings are never treated as current (never guess).
  if (!isCanonicalDateStr(expiryDateIst) || !isCanonicalDateStr(effectiveDateIst)) return false;
  if (expiryDateIst > effectiveDateIst) return true;
  if (expiryDateIst === effectiveDateIst) return nowMinuteOfDay < SESSION_CLOSE_MIN;
  return false;
}
