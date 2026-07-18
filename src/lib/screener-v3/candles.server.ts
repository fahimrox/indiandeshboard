// Real spot candle retrieval for NSE stock instruments (Yahoo v8 chart).
// Reuses the existing yahooService.getHistory implementation and normalizes to
// the typed Candle model. Real data only — malformed rows rejected, provider
// hygiene (alignment, duplicates, conflicts, cadence, clock-skew) is REPORTED.
import { yahooService } from "../services/yahooService.ts";
import { dedupeSortStrict, isValidCandleShape, type Candle, type CandleInterval } from "./candles.ts";
import {
  SESSION_OPEN_MIN,
  istDateStr,
  isExactMinuteBoundary,
  isSessionStart,
  istMinuteInt,
} from "./ist-time.ts";
import { invalidInput, ok, providerError, unavailable, type DataResult } from "./types.ts";

export type SpotInterval = "1m" | "5m" | "1d";

export interface CandleHygiene {
  alignedCount: number; // exact-boundary, in-session, interval-aligned (intraday); all valid (daily)
  misalignedCount: number; // intraday candles not on an exact minute boundary / not interval-aligned
  outOfSessionCount: number; // aligned but outside 09:15..15:29 (intraday)
  duplicateIdentical: number; // identical duplicate timestamps collapsed
  conflictingTimestamps: number; // same timestamp, conflicting data (dropped)
  cadenceGaps: number; // count of MISSING interval bars between consecutive aligned in-session bars
  duplicateTradingDates: number; // daily: candles dropped for sharing a trading date
  lastCandleForming: boolean | null; // intraday: last USABLE aligned bar's interval not yet elapsed
  futureTimestamp: boolean; // any candle timestamp is in the future (clock skew)
}

export interface CandleSeries {
  symbol: string;
  yahooSymbol: string;
  interval: CandleInterval;
  range: string;
  candles: Candle[];
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  count: number;
  source: string;
  requestedAt: number;
  responseTimestamp: number; // reference time used for freshness/forming (opts.nowMs or Date.now())
  ageMs: number | null; // responseTimestamp - lastTimestamp; null if in the future
  sessionDateIst: string | null;
  hygiene: CandleHygiene;
  notes: string[];
}

export interface NormalizedNseSymbol {
  symbol: string;
  yahooSymbol: string;
}

// Real NSE symbols use letters, digits, `&` and `-` (e.g. M&M, BAJAJ-AUTO).
// Everything else (whitespace, `/`, `?`, `#`, `|`, `.`) is rejected.
const NSE_SYMBOL_RE = /^[A-Z0-9&-]+$/;

export function normalizeNseSymbol(input: string): NormalizedNseSymbol | null {
  const raw = (input ?? "").trim().toUpperCase();
  if (!raw) return null;
  if (raw.endsWith(".BO")) return null; // BSE not supported here
  const base = raw.replace(/\.NS$/i, "").trim();
  if (!NSE_SYMBOL_RE.test(base)) return null;
  return { symbol: base, yahooSymbol: `${base}.NS` };
}

// Allowed interval/range combinations. Only VERIFIED-supported ranges are kept.
const ALLOWED_RANGES: Record<SpotInterval, string[]> = {
  "1m": ["1d", "5d"],
  "5m": ["1d", "5d", "1mo"],
  "1d": ["1mo", "3mo", "6mo", "1y", "2y", "5y"],
};

function defaultRange(interval: SpotInterval): string {
  if (interval === "1m") return "5d";
  if (interval === "5m") return "1mo";
  return "1y";
}
function intervalMs(interval: SpotInterval): number | null {
  return interval === "1m" ? 60_000 : interval === "5m" ? 300_000 : null;
}
export function isSupportedIntervalRange(interval: SpotInterval, range: string): boolean {
  return ALLOWED_RANGES[interval]?.includes(range) ?? false;
}

/** A usable intraday bar: exact minute boundary, in-session, interval-aligned. */
function isUsableAligned(c: Candle, ivMin: number): boolean {
  return isExactMinuteBoundary(c.timestamp) && isSessionStart(c.timestamp) && (istMinuteInt(c.timestamp) - SESSION_OPEN_MIN) % ivMin === 0;
}

function computeHygiene(candles: Candle[], interval: SpotInterval, now: number): CandleHygiene {
  const ivMs = intervalMs(interval);
  const ivMin = ivMs ? ivMs / 60_000 : null;
  let alignedCount = 0;
  let misalignedCount = 0;
  let outOfSessionCount = 0;
  const alignedInSession: Candle[] = [];

  if (ivMin === null) {
    alignedCount = candles.length; // daily: no intraday alignment concept
  } else {
    for (const c of candles) {
      if (!isExactMinuteBoundary(c.timestamp)) {
        misalignedCount++;
        continue;
      }
      if (!isSessionStart(c.timestamp)) {
        outOfSessionCount++;
        continue;
      }
      if ((istMinuteInt(c.timestamp) - SESSION_OPEN_MIN) % ivMin === 0) {
        alignedCount++;
        alignedInSession.push(c);
      } else {
        misalignedCount++;
      }
    }
  }

  // Cadence: count MISSING interval bars between consecutive aligned in-session
  // bars on the same date (diff/ivMs - 1). Negative/duplicate movement ignored.
  let cadenceGaps = 0;
  if (ivMs !== null) {
    for (let i = 1; i < alignedInSession.length; i++) {
      if (istDateStr(alignedInSession[i].timestamp) !== istDateStr(alignedInSession[i - 1].timestamp)) continue;
      const diff = alignedInSession[i].timestamp - alignedInSession[i - 1].timestamp;
      if (diff > ivMs) cadenceGaps += diff / ivMs - 1;
    }
  }

  const futureTimestamp = candles.some((c) => c.timestamp > now);
  // Forming state is derived from the last USABLE aligned bar (not an arbitrary row).
  const lastAligned = alignedInSession[alignedInSession.length - 1];
  const lastCandleForming = ivMs === null || !lastAligned ? null : lastAligned.timestamp + ivMs > now;

  return {
    alignedCount,
    misalignedCount,
    outOfSessionCount,
    duplicateIdentical: 0, // filled by caller
    conflictingTimestamps: 0, // filled by caller
    cadenceGaps,
    duplicateTradingDates: 0, // filled by caller (daily)
    lastCandleForming,
    futureTimestamp,
  };
}

/**
 * Fetch real spot candles for one NSE stock. Returns an explicit availability
 * envelope; never fabricates candles or volume. Invalid symbol/range requests
 * fail fast (invalid_input) with a clear reason BEFORE any provider call.
 * An optional `nowMs` makes freshness/forming deterministic for tests.
 */
export async function fetchSpotCandles(
  symbol: string,
  interval: SpotInterval,
  opts: { range?: string; nowMs?: number } = {},
): Promise<DataResult<CandleSeries>> {
  const requestedAt = Date.now();

  if (opts.nowMs !== undefined && (!Number.isFinite(opts.nowMs) || opts.nowMs <= 0)) {
    return invalidInput("invalid_request: nowMs must be a finite positive epoch ms", { source: "candles" });
  }

  const norm = normalizeNseSymbol(symbol);
  if (!norm) {
    return invalidInput(
      `invalid_request: unsupported symbol "${symbol}" (NSE-only; letters/digits/&/- ; .BO rejected)`,
      { source: "candles" },
    );
  }

  const range = opts.range ?? defaultRange(interval);
  if (!isSupportedIntervalRange(interval, range)) {
    return invalidInput(
      `invalid_request: unsupported interval/range combination (${interval} + ${range})`,
      { source: "candles" },
    );
  }

  const notes: string[] = [];
  if (interval === "1m") {
    notes.push(
      "Yahoo limitation: 1-minute history is only ~8 days per request; longer 1m history is NOT obtainable in a single call.",
    );
  }

  try {
    const h = await yahooService.getHistory(norm.yahooSymbol, range, interval);

    // Validate rows to candles (no dedupe yet) so provider duplicates/conflicts surface.
    const rawValid: Candle[] = [];
    const ts = h.timestamps ?? [];
    for (let i = 0; i < ts.length; i++) {
      const tsSec = ts[i];
      const o = h.open?.[i];
      const hi = h.high?.[i];
      const lo = h.low?.[i];
      const cl = h.close?.[i];
      if (!Number.isInteger(tsSec)) continue; // strict integer epoch SECONDS (reject fractional)
      if (![o, hi, lo, cl].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
      const timestamp = (tsSec as number) * 1000;
      if (!isValidCandleShape({ timestamp, open: o as number, high: hi as number, low: lo as number, close: cl as number })) continue;
      const vRaw = h.volume?.[i];
      const volume = typeof vRaw === "number" && Number.isFinite(vRaw) && vRaw >= 0 ? vRaw : null;
      rawValid.push({ timestamp, open: o as number, high: hi as number, low: lo as number, close: cl as number, volume, source: "yahoo", interval });
    }

    const dd = dedupeSortStrict(rawValid);
    let candles = dd.candles;
    if (candles.length === 0) {
      return unavailable("Yahoo returned no valid candles", { source: "yahoo" });
    }

    // Daily: quarantine ALL candles sharing a duplicated trading date (ambiguous).
    let duplicateTradingDates = 0;
    if (interval === "1d") {
      const perDate = new Map<string, number>();
      for (const c of candles) perDate.set(istDateStr(c.timestamp), (perDate.get(istDateStr(c.timestamp)) ?? 0) + 1);
      const dupDates = new Set([...perDate].filter(([, n]) => n > 1).map(([d]) => d));
      if (dupDates.size > 0) {
        const before = candles.length;
        candles = candles.filter((c) => !dupDates.has(istDateStr(c.timestamp)));
        duplicateTradingDates = before - candles.length;
        notes.push(`Quarantined ${duplicateTradingDates} daily candle(s) across ${dupDates.size} ambiguous duplicate trading date(s).`);
      }
      if (candles.length === 0) {
        return unavailable("all daily candles were ambiguous duplicate trading dates", { source: "yahoo" });
      }
    }

    const now = opts.nowMs ?? Date.now();
    const hygiene = computeHygiene(candles, interval, now);
    hygiene.duplicateIdentical = dd.duplicateIdentical;
    hygiene.conflictingTimestamps = dd.conflictingTimestamps.length;
    hygiene.duplicateTradingDates = duplicateTradingDates;

    // Intraday: zero usable aligned in-session candles is NOT an available series.
    if (intervalMs(interval) !== null && hygiene.alignedCount === 0) {
      return unavailable(
        `no usable aligned in-session ${interval} candles (misaligned=${hygiene.misalignedCount}, outOfSession=${hygiene.outOfSessionCount})`,
        { source: "yahoo" },
      );
    }

    const first = candles[0].timestamp;
    const last = candles[candles.length - 1].timestamp;
    if (dd.conflictingTimestamps.length > 0) {
      notes.push(`Dropped ${dd.conflictingTimestamps.length} conflicting duplicate timestamp(s) from provider.`);
    }
    if (hygiene.futureTimestamp) {
      notes.push("Clock skew: a provider timestamp is in the future; ageMs reported as null.");
    }

    return ok<CandleSeries>(
      {
        symbol: norm.symbol,
        yahooSymbol: norm.yahooSymbol,
        interval,
        range,
        candles,
        firstTimestamp: first,
        lastTimestamp: last,
        count: candles.length,
        source: "yahoo",
        requestedAt,
        responseTimestamp: now,
        ageMs: last > now ? null : now - last,
        sessionDateIst: istDateStr(last),
        hygiene,
        notes,
      },
      { source: "yahoo", timestamp: last },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return providerError(`Yahoo candle fetch failed for ${norm.yahooSymbol}: ${reason}`);
  }
}
