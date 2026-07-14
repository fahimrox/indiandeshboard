// ─── Historical Data Service Shared Utilities ──────────────────────────────────
// This file contains shared interfaces, timezone arithmetic utilities, date/interval
// validation helpers, and pure sampling/downsampling algorithms for historical range queries.
// It is strictly server-side and contains no active database or Supabase calls.
// ──────────────────────────────────────────────────────────────────────────────

import { dbService } from "./database.server";
import { getSupabaseMarketHistoryRange } from "./supabase.server";


export interface HistoricalMarketSnapshot {
  id?: number | string;
  timestamp: number;
  trading_date: string;
  trading_time: string;
  symbol: string;
  exchange: string;
  open: number;
  high: number;
  low: number;
  close: number;
  ltp: number;
  prev_close: number;
  change_val: number;
  change_pct: number;
  volume: number;
  vwap: number;
}

export type HistoricalDataSource = "supabase" | "sqlite";

export interface HistoricalSourceMetadata {
  source: HistoricalDataSource;
  requestedRange: {
    startDate: string;
    endDate: string;
  };
  actualDates: string[];
}

export type DateRangeValidationResult =
  | {
      ok: true;
      startDate: string;
      endDate: string;
      isSingleDate: boolean;
    }
  | {
      ok: false;
      error: string;
    };

export type IntervalValidationResult =
  | {
      ok: true;
      minutes: 1 | 3 | 5 | 15 | 30 | 60;
    }
  | {
      ok: false;
      error: string;
    };

export interface SQLiteMarketSnapshotRow {
  id: number;
  timestamp: number;
  trading_date: string;
  trading_time: string;
  symbol: string;
  exchange: string;
  open: number;
  high: number;
  low: number;
  close: number;
  ltp: number;
  prev_close: number;
  change_val: number;
  change_pct: number;
  volume: number;
  vwap: number;
}

export interface SupabaseMarketSnapshotRow {
  id?: number | string;
  trading_date: string;
  trading_time: string;
  symbol: string;
  exchange: string;
  open: number;
  high: number;
  low: number;
  close: number;
  ltp: number;
  prev_close: number;
  change_val: number;
  change_pct: number;
  volume: number;
  vwap: number;
}

/**
 * Returns today's YYYY-MM-DD string in IST timezone (Asia/Kolkata).
 * Uses Intl.DateTimeFormat to ensure it is independent of the host machine timezone.
 */
export function getTodayIstString(): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  let year = "";
  let month = "";
  let day = "";
  for (const part of parts) {
    if (part.type === "year") year = part.value;
    if (part.type === "month") month = part.value;
    if (part.type === "day") day = part.value;
  }
  return `${year}-${month}-${day}`;
}

/**
 * Verifies if a given string matches YYYY-MM-DD and is a valid calendar date.
 */
export function isValidIsoDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const parts = dateStr.split("-");
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [
    31,
    isLeap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return day <= daysInMonth[month - 1];
}

/**
 * Validates range constraints and parses fallback behaviors for range query parameters.
 */
export function validateDateRange(
  startDateParam: string | null | undefined,
  endDateParam: string | null | undefined,
  dateParam: string | null | undefined
): DateRangeValidationResult {
  if (dateParam && (startDateParam || endDateParam)) {
    return {
      ok: false,
      error: "Use either date or startDate/endDate, not both.",
    };
  }

  // If only one parameter is supplied, reject
  if ((startDateParam && !endDateParam) || (!startDateParam && endDateParam)) {
    return {
      ok: false,
      error: "Both startDate and endDate must be specified together for range queries.",
    };
  }

  let start: string;
  let end: string;
  let isSingle = false;

  if (startDateParam && endDateParam) {
    start = startDateParam.trim();
    end = endDateParam.trim();
  } else if (dateParam) {
    const trimmed = dateParam.trim();
    start = trimmed;
    end = trimmed;
    isSingle = true;
  } else {
    const today = getTodayIstString();
    start = today;
    end = today;
    isSingle = true;
  }

  if (!isValidIsoDate(start)) {
    return { ok: false, error: `Invalid start date format or value: ${start}` };
  }
  if (!isValidIsoDate(end)) {
    return { ok: false, error: `Invalid end date format or value: ${end}` };
  }

  const startMs = Date.parse(start);
  const endMs = Date.parse(end);

  if (isNaN(startMs) || isNaN(endMs)) {
    return { ok: false, error: "Failed to parse date strings." };
  }

  if (startMs > endMs) {
    return {
      ok: false,
      error: `startDate (${start}) cannot be greater than endDate (${end}).`,
    };
  }

  const diffDays = Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
  if (diffDays > 14) {
    return {
      ok: false,
      error: `Requested range (${diffDays} days) exceeds the maximum allowed limit of 14 calendar days.`,
    };
  }

  return {
    ok: true,
    startDate: start,
    endDate: end,
    isSingleDate: isSingle,
  };
}

/**
 * Validates and parses interval parameters, accepting suffixes.
 */
export function parseInterval(
  rawInterval: string | null | undefined
): IntervalValidationResult {
  if (rawInterval === null || rawInterval === undefined || rawInterval.trim() === "") {
    return { ok: true, minutes: 1 };
  }

  const trimmed = rawInterval.trim();
  const match = trimmed.match(/^(\d+)[mM]?$/);
  if (!match) {
    return {
      ok: false,
      error: `Invalid interval format: ${trimmed}. Supported values are: 1, 3, 5, 15, 30, 60 (optionally with 'm' or 'M').`,
    };
  }

  const val = parseInt(match[1], 10);
  if (val === 1 || val === 3 || val === 5 || val === 15 || val === 30 || val === 60) {
    return { ok: true, minutes: val as 1 | 3 | 5 | 15 | 30 | 60 };
  }

  return {
    ok: false,
    error: `Unsupported interval value: ${val}. Supported values are: 1, 3, 5, 15, 30, 60.`,
  };
}

/**
 * Computes Unix epoch milliseconds from IST date and time strings.
 * Explicitly performs timezone adjustments from IST to UTC without relying on local server zone.
 * Rejects invalid calendar dates using isValidIsoDate().
 */
export function parseIstToUtcEpoch(
  tradingDate: string,
  tradingTime: string
): number {
  if (!isValidIsoDate(tradingDate)) {
    throw new Error(`Invalid or malformed trading_date: ${tradingDate}`);
  }
  if (!/^\d{2}:\d{2}:\d{2}$/.test(tradingTime)) {
    throw new Error(`Malformed trading_time: ${tradingTime}`);
  }

  const dateParts = tradingDate.split("-");
  const year = parseInt(dateParts[0], 10);
  const month = parseInt(dateParts[1], 10);
  const day = parseInt(dateParts[2], 10);

  const timeParts = tradingTime.split(":");
  const hour = parseInt(timeParts[0], 10);
  const minute = parseInt(timeParts[1], 10);
  const second = parseInt(timeParts[2], 10);

  if (
    isNaN(hour) || isNaN(minute) || isNaN(second) ||
    hour < 0 || hour > 23 || minute < 0 || minute > 59 ||
    second < 0 || second > 59
  ) {
    throw new Error(`Invalid time values: ${tradingTime}`);
  }

  // Calculate standard UTC milliseconds for the absolute values
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  // Subtract 5.5 hours (330 minutes) to convert IST to UTC epoch milliseconds
  const istMs = utcMs - 330 * 60_000;

  if (isNaN(istMs)) {
    throw new Error(`Resulting timestamp is NaN for: ${tradingDate} ${tradingTime}`);
  }

  return istMs;
}

/**
 * Normalizes an SQLite database row to HistoricalMarketSnapshot, preserving its stored timestamp.
 * Note: Number(value) || 0 is used to coerce numeric fields safely to valid JavaScript numbers.
 * This is intentionally designed to preserve existing database/API behavior where any empty, null,
 * or malformed values default to 0 rather than NaN, preventing UI rendering and layout crashes.
 */
export function normalizeSQLiteRow(
  row: SQLiteMarketSnapshotRow
): HistoricalMarketSnapshot {
  return {
    id: row.id,
    timestamp: row.timestamp,
    trading_date: row.trading_date,
    trading_time: row.trading_time,
    symbol: row.symbol,
    exchange: row.exchange,
    open: Number(row.open) || 0,
    high: Number(row.high) || 0,
    low: Number(row.low) || 0,
    close: Number(row.close) || 0,
    ltp: Number(row.ltp) || 0,
    prev_close: Number(row.prev_close) || 0,
    change_val: Number(row.change_val) || 0,
    change_pct: Number(row.change_pct) || 0,
    volume: Number(row.volume) || 0,
    vwap: Number(row.vwap) || 0,
  };
}

/**
 * Normalizes a Supabase row to HistoricalMarketSnapshot, deriving its timestamp from trading_date + trading_time.
 * Note: Number(value) || 0 is used to coerce numeric fields safely to valid JavaScript numbers.
 * This is intentionally designed to preserve existing database/API behavior where any empty, null,
 * or malformed values default to 0 rather than NaN, preventing UI rendering and layout crashes.
 */
export function normalizeSupabaseRow(
  row: SupabaseMarketSnapshotRow
): HistoricalMarketSnapshot {
  const timestamp = parseIstToUtcEpoch(row.trading_date, row.trading_time);
  return {
    id: row.id,
    timestamp,
    trading_date: row.trading_date,
    trading_time: row.trading_time,
    symbol: row.symbol,
    exchange: row.exchange,
    open: Number(row.open) || 0,
    high: Number(row.high) || 0,
    low: Number(row.low) || 0,
    close: Number(row.close) || 0,
    ltp: Number(row.ltp) || 0,
    prev_close: Number(row.prev_close) || 0,
    change_val: Number(row.change_val) || 0,
    change_pct: Number(row.change_pct) || 0,
    volume: Number(row.volume) || 0,
    vwap: Number(row.vwap) || 0,
  };
}

/**
 * Downsamples market snapshots in application memory based on interval minutes.
 * Ensures rows are ordered chronologically, buckets reset per trading date, and rows before 09:15 IST are excluded.
 */
export function sampleMarketSnapshots(
  rows: HistoricalMarketSnapshot[],
  intervalMinutes: 1 | 3 | 5 | 15 | 30 | 60
): HistoricalMarketSnapshot[] {
  const validRows: HistoricalMarketSnapshot[] = [];
  const anchorSeconds = 9 * 3600 + 15 * 60; // 09:15 IST (33,300 seconds from midnight)
  const intervalSeconds = intervalMinutes * 60;

  // 1. Filter out malformed records and those occurring before 09:15 IST
  for (const row of rows) {
    if (!/^\d{2}:\d{2}:\d{2}$/.test(row.trading_time)) {
      continue;
    }
    const timeParts = row.trading_time.split(":");
    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);
    const seconds = parseInt(timeParts[2], 10);

    if (
      isNaN(hours) || isNaN(minutes) || isNaN(seconds) ||
      hours < 0 || hours > 23 || minutes < 0 || minutes > 59 ||
      seconds < 0 || seconds > 59
    ) {
      continue;
    }

    const secondsFromMidnight = hours * 3600 + minutes * 60 + seconds;
    if (secondsFromMidnight < anchorSeconds) {
      continue;
    }

    validRows.push(row);
  }

  // 2. Sort rows chronologically: trading_date ASC, trading_time ASC, id ASC
  validRows.sort((a, b) => {
    if (a.trading_date !== b.trading_date) {
      return a.trading_date.localeCompare(b.trading_date);
    }
    if (a.trading_time !== b.trading_time) {
      return a.trading_time.localeCompare(b.trading_time);
    }
    if (a.id !== undefined && b.id !== undefined) {
      const aId = String(a.id);
      const bId = String(b.id);
      return aId.localeCompare(bId, undefined, { numeric: true, sensitivity: "base" });
    }
    return 0;
  });

  // 3. Group and downsample, keeping the last row per bucket per date
  const buckets = new Map<string, HistoricalMarketSnapshot>();

  for (const row of validRows) {
    const timeParts = row.trading_time.split(":");
    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);
    const seconds = parseInt(timeParts[2], 10);
    const secondsFromMidnight = hours * 3600 + minutes * 60 + seconds;

    const bucketIndex = Math.floor((secondsFromMidnight - anchorSeconds) / intervalSeconds);
    const groupKey = `${row.trading_date}_${bucketIndex}`;

    // Overwrite the bucket index with the latest chronological tick
    buckets.set(groupKey, row);
  }

  // 4. Return sorted values to guarantee order
  return Array.from(buckets.values()).sort((a, b) => {
    if (a.trading_date !== b.trading_date) {
      return a.trading_date.localeCompare(b.trading_date);
    }
    if (a.trading_time !== b.trading_time) {
      return a.trading_time.localeCompare(b.trading_time);
    }
    if (a.id !== undefined && b.id !== undefined) {
      const aId = String(a.id);
      const bId = String(b.id);
      return aId.localeCompare(bId, undefined, { numeric: true, sensitivity: "base" });
    }
    return 0;
  });
}

export interface HistoricalMarketHistoryResult {
  data: HistoricalMarketSnapshot[];
  metadata: HistoricalSourceMetadata;
}

export async function getHistoricalMarketHistory(
  symbol: string,
  startDate: string,
  endDate: string,
  intervalMinutes: 1 | 3 | 5 | 15 | 30 | 60
): Promise<HistoricalMarketHistoryResult> {
  const normSymbol = symbol.trim().toUpperCase();
  if (!normSymbol) {
    throw new Error("Symbol parameter is required and cannot be empty.");
  }

  let rawRows: any[] = [];
  let source: HistoricalDataSource = "supabase";
  let supabaseFailed = false;
  let supabaseError: any = null;
  let supabaseRows: any[] = [];

  let timeoutId: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("Supabase range query timed out after 3000ms"));
      }, 3000);
    });
    const supabasePromise = getSupabaseMarketHistoryRange(normSymbol, startDate, endDate);
    // Prevent unhandled promise rejection if supabasePromise fails after timeout races
    supabasePromise.catch(() => {});

    supabaseRows = await Promise.race([supabasePromise, timeoutPromise]);
  } catch (err: any) {
    supabaseFailed = true;
    supabaseError = err;
    console.warn(
      `[historicalDataService] Supabase range query failed or timed out for symbol ${normSymbol} in range ${startDate} to ${endDate}. Falling back to SQLite. Error: ${err.message || err}`
    );
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  if (supabaseFailed) {
    // path 3: Supabase fails or times out -> query SQLite once
    try {
      rawRows = dbService.getMarketHistoryRangeRaw(normSymbol, startDate, endDate);
      source = "sqlite";
    } catch (sqliteErr: any) {
      throw new Error(
        `Historical range query failed on both Supabase and SQLite. Supabase error: ${supabaseError?.message || supabaseError}. SQLite error: ${sqliteErr.message || sqliteErr}`
      );
    }
  } else {
    // Supabase succeeded
    if (supabaseRows.length > 0) {
      // path 1: Supabase succeeds with rows
      rawRows = supabaseRows;
      source = "supabase";
    } else {
      // path 2: Supabase succeeds with zero rows -> query SQLite once
      try {
        rawRows = dbService.getMarketHistoryRangeRaw(normSymbol, startDate, endDate);
        source = "sqlite";
      } catch (sqliteErr: any) {
        throw new Error(
          `Supabase returned no matching rows. SQLite fallback failed: ${sqliteErr.message || sqliteErr}`
        );
      }
    }
  }

  // 1. Normalize rows depending on the resolved source
  let normalized: HistoricalMarketSnapshot[];
  if (source === "supabase") {
    normalized = rawRows.map((row) => normalizeSupabaseRow(row));
  } else {
    normalized = rawRows.map((row) => normalizeSQLiteRow(row));
  }

  // 2. Sort ascending chronologically using timestamp (or date/time/symbol fallbacks)
  normalized.sort((a, b) => {
    const aFin = Number.isFinite(a.timestamp);
    const bFin = Number.isFinite(b.timestamp);

    if (aFin && bFin) {
      if (a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
    } else if (aFin) {
      return -1;
    } else if (bFin) {
      return 1;
    }

    if (a.trading_date !== b.trading_date) {
      return a.trading_date.localeCompare(b.trading_date);
    }
    if (a.trading_time !== b.trading_time) {
      return a.trading_time.localeCompare(b.trading_time);
    }
    if (a.symbol !== b.symbol) {
      return a.symbol.localeCompare(b.symbol);
    }
    if (a.id !== undefined && b.id !== undefined) {
      const aId = String(a.id);
      const bId = String(b.id);
      return aId.localeCompare(bId, undefined, { numeric: true, sensitivity: "base" });
    }
    return 0;
  });

  // 3. Deduplicate second: keep the first chronological row for duplicate keys
  const seen = new Set<string>();
  const deduplicated: HistoricalMarketSnapshot[] = [];
  for (const row of normalized) {
    const key = `${row.trading_date}_${row.trading_time}_${row.symbol}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(row);
    }
  }

  // 4. Downsample third based on the validated interval in minutes
  const sampled = sampleMarketSnapshots(deduplicated, intervalMinutes);

  // 5. Extract unique sorted trading dates from the sampled records
  const dateSet = new Set<string>();
  for (const row of sampled) {
    dateSet.add(row.trading_date);
  }
  const actualDates = Array.from(dateSet).sort();

  return {
    data: sampled,
    metadata: {
      source,
      requestedRange: {
        startDate,
        endDate,
      },
      actualDates,
    },
  };
}
