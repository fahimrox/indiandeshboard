// ─── Historical Data Service Shared Utilities ──────────────────────────────────
// This file contains shared interfaces, timezone arithmetic utilities, date/interval
// validation helpers, and pure sampling/downsampling algorithms for historical range queries.
// It is strictly server-side and contains no active database or Supabase calls.
// ──────────────────────────────────────────────────────────────────────────────

import { dbService } from "./database.server";
import {
  getSupabaseMarketHistoryRange,
  getSupabaseOptionHistoryRange,
  getSupabaseOiActivityHistoryRange,
  getSupabaseBreadthHistoryRange,
  getSupabaseSectorStrengthHistoryRange,
} from "./supabase.server";


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





export interface HistoricalSectorStrengthRow {
  id?: number | string;
  timestamp: number;
  trading_date: string;
  trading_time: string;
  symbol: string;
  name: string;
  price: number;
  change_pct: number;
}

export interface SQLiteSectorStrengthHistoryRow {
  id: number;
  timestamp: number;
  trading_date: string;
  trading_time: string;
  symbol: string;
  name: string;
  price: number;
  change_pct: number;
}

export interface SupabaseSectorStrengthHistorySourceRow {
  id?: number | string;
  trading_date: string;
  trading_time: string;
  symbol: string;
  name: string;
  price: number;
  change_pct: number;
}

export interface HistoricalSectorStrengthHistoryResult {
  data: HistoricalSectorStrengthRow[];
  metadata: HistoricalSourceMetadata;
}
export interface HistoricalMarketBreadthRow {
  id?: number | string;
  timestamp: number;
  trading_date: string;
  trading_time: string;
  advance: number;
  decline: number;
  unchanged: number;
  adr: number;
  india_vix: number;
}

export interface SQLiteMarketBreadthHistoryRow {
  id: number;
  timestamp: number;
  trading_date: string;
  trading_time: string;
  advance: number;
  decline: number;
  unchanged: number;
  adr: number;
  india_vix: number;
}

export interface SupabaseMarketBreadthHistorySourceRow {
  id?: number | string;
  trading_date: string;
  trading_time: string;
  advance: number;
  decline: number;
  unchanged: number;
  adr: number;
  india_vix: number;
}

export interface HistoricalMarketBreadthHistoryResult {
  data: HistoricalMarketBreadthRow[];
  metadata: HistoricalSourceMetadata;
}
export interface HistoricalOiActivityRow {
  id?: number | string;
  snapshot_id: number | string;
  timestamp: number;
  trading_date: string;
  trading_time: string;
  symbol: string;
  expiry: string;
  strike: number;
  ce_ltp: number;
  ce_oi: number;
  ce_oi_chg: number;
  ce_vol: number;
  ce_signal: string;
  pe_ltp: number;
  pe_oi: number;
  pe_oi_chg: number;
  pe_vol: number;
  pe_signal: string;
}

export interface SQLiteOiActivityHistoryRow {
  id: number;
  snapshot_id: number;
  timestamp: number;
  trading_date: string;
  trading_time: string;
  symbol: string;
  expiry: string;
  strike: number;
  ce_ltp: number;
  ce_oi: number;
  ce_oi_chg: number;
  ce_vol: number;
  ce_signal: string;
  pe_ltp: number;
  pe_oi: number;
  pe_oi_chg: number;
  pe_vol: number;
  pe_signal: string;
}

export interface SupabaseOiActivityHistorySourceRow {
  id?: number | string;
  snapshot_id: number | string;
  trading_date: string;
  trading_time: string;
  symbol: string;
  expiry: string;
  strike: number;
  ce_ltp: number;
  ce_oi: number;
  ce_oi_chg: number;
  ce_vol: number;
  ce_signal: string;
  pe_ltp: number;
  pe_oi: number;
  pe_oi_chg: number;
  pe_vol: number;
  pe_signal: string;
}

export interface HistoricalOiActivityHistoryResult {
  data: HistoricalOiActivityRow[];
  metadata: HistoricalSourceMetadata;
}
export interface HistoricalOptionChainSnapshot {
  id?: number | string;
  timestamp: number;
  trading_date: string;
  trading_time: string;
  symbol: string;
  expiry: string;
  spot_price: number;
  pcr: number;
  max_pain: number;
  atm_strike: number;
  total_ce_oi: number;
  total_pe_oi: number;
  total_ce_oi_chg: number;
  total_pe_oi_chg: number;
  total_ce_vol: number;
  total_pe_vol: number;
  max_ce_oi_strike: number;
  max_pe_oi_strike: number;
  support_levels: string;
  resistance_levels: string;
}

export interface SQLiteOptionChainSnapshotRow {
  id: number;
  timestamp: number;
  trading_date: string;
  trading_time: string;
  symbol: string;
  expiry: string;
  spot_price: number;
  pcr: number;
  max_pain: number;
  atm_strike: number;
  total_ce_oi: number;
  total_pe_oi: number;
  total_ce_oi_chg: number;
  total_pe_oi_chg: number;
  total_ce_vol: number;
  total_pe_vol: number;
  max_ce_oi_strike: number;
  max_pe_oi_strike: number;
  support_levels: string;
  resistance_levels: string;
}

export interface SupabaseOptionChainSnapshotRow {
  id?: number | string;
  trading_date: string;
  trading_time: string;
  symbol: string;
  expiry: string;
  spot_price: number;
  pcr: number;
  max_pain: number;
  atm_strike: number;
  total_ce_oi: number;
  total_pe_oi: number;
  total_ce_oi_chg: number;
  total_pe_oi_chg: number;
  total_ce_vol: number;
  total_pe_vol: number;
  max_ce_oi_strike: number;
  max_pe_oi_strike: number;
  support_levels: string;
  resistance_levels: string;
}

export interface HistoricalOptionHistoryResult {
  data: HistoricalOptionChainSnapshot[];
  metadata: HistoricalSourceMetadata;
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





export function normalizeSQLiteSectorStrengthRow(
  row: SQLiteSectorStrengthHistoryRow
): HistoricalSectorStrengthRow {
  return {
    id: row.id,
    timestamp: Number(row.timestamp),
    trading_date: row.trading_date,
    trading_time: row.trading_time,
    symbol: row.symbol,
    name: String(row.name ?? ""),
    price: Number(row.price) || 0,
    change_pct: Number(row.change_pct) || 0,
  };
}

export function normalizeSupabaseSectorStrengthRow(
  row: SupabaseSectorStrengthHistorySourceRow
): HistoricalSectorStrengthRow {
  return {
    id: row.id,
    timestamp: parseIstToUtcEpoch(
      row.trading_date,
      row.trading_time
    ),
    trading_date: row.trading_date,
    trading_time: row.trading_time,
    symbol: row.symbol,
    name: String(row.name ?? ""),
    price: Number(row.price) || 0,
    change_pct: Number(row.change_pct) || 0,
  };
}

export function sampleSectorStrengthSnapshots(
  rows: HistoricalSectorStrengthRow[],
  intervalMinutes: 1 | 3 | 5 | 15 | 30 | 60
): HistoricalSectorStrengthRow[] {
  const anchorSeconds = 9 * 3600 + 15 * 60;
  const intervalSeconds = intervalMinutes * 60;
  const validRows: HistoricalSectorStrengthRow[] = [];

  for (const row of rows) {
    if (!/^\d{2}:\d{2}:\d{2}$/.test(row.trading_time)) {
      continue;
    }

    const [hourText, minuteText, secondText] =
      row.trading_time.split(":");

    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);

    if (
      !Number.isInteger(hour) ||
      !Number.isInteger(minute) ||
      !Number.isInteger(second) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59 ||
      second < 0 ||
      second > 59
    ) {
      continue;
    }

    const secondsFromMidnight =
      hour * 3600 + minute * 60 + second;

    if (secondsFromMidnight < anchorSeconds) {
      continue;
    }

    validRows.push(row);
  }

  validRows.sort((a, b) => {
    if (a.trading_date !== b.trading_date) {
      return a.trading_date.localeCompare(b.trading_date);
    }
    if (a.trading_time !== b.trading_time) {
      return a.trading_time.localeCompare(b.trading_time);
    }
    if (a.symbol !== b.symbol) {
      return a.symbol.localeCompare(b.symbol);
    }

    const aId = String(a.id ?? "");
    const bId = String(b.id ?? "");

    return aId.localeCompare(
      bId,
      undefined,
      { numeric: true, sensitivity: "base" }
    );
  });

  const buckets =
    new Map<string, HistoricalSectorStrengthRow>();

  for (const row of validRows) {
    const [hourText, minuteText, secondText] =
      row.trading_time.split(":");

    const secondsFromMidnight =
      Number(hourText) * 3600 +
      Number(minuteText) * 60 +
      Number(secondText);

    const bucketIndex = Math.floor(
      (secondsFromMidnight - anchorSeconds) / intervalSeconds
    );

    const key =
      `${row.trading_date}_${row.symbol}_${bucketIndex}`;

    buckets.set(key, row);
  }

  return Array.from(buckets.values()).sort((a, b) => {
    if (a.trading_date !== b.trading_date) {
      return a.trading_date.localeCompare(b.trading_date);
    }
    if (a.trading_time !== b.trading_time) {
      return a.trading_time.localeCompare(b.trading_time);
    }
    if (a.symbol !== b.symbol) {
      return a.symbol.localeCompare(b.symbol);
    }

    const aId = String(a.id ?? "");
    const bId = String(b.id ?? "");

    return aId.localeCompare(
      bId,
      undefined,
      { numeric: true, sensitivity: "base" }
    );
  });
}
export function normalizeSQLiteBreadthRow(
  row: SQLiteMarketBreadthHistoryRow
): HistoricalMarketBreadthRow {
  return {
    id: row.id,
    timestamp: Number(row.timestamp),
    trading_date: row.trading_date,
    trading_time: row.trading_time,
    advance: Number(row.advance) || 0,
    decline: Number(row.decline) || 0,
    unchanged: Number(row.unchanged) || 0,
    adr: Number(row.adr) || 0,
    india_vix: Number(row.india_vix) || 0,
  };
}

export function normalizeSupabaseBreadthRow(
  row: SupabaseMarketBreadthHistorySourceRow
): HistoricalMarketBreadthRow {
  return {
    id: row.id,
    timestamp: parseIstToUtcEpoch(
      row.trading_date,
      row.trading_time
    ),
    trading_date: row.trading_date,
    trading_time: row.trading_time,
    advance: Number(row.advance) || 0,
    decline: Number(row.decline) || 0,
    unchanged: Number(row.unchanged) || 0,
    adr: Number(row.adr) || 0,
    india_vix: Number(row.india_vix) || 0,
  };
}

export function sampleBreadthSnapshots(
  rows: HistoricalMarketBreadthRow[],
  intervalMinutes: 1 | 3 | 5 | 15 | 30 | 60
): HistoricalMarketBreadthRow[] {
  const anchorSeconds = 9 * 3600 + 15 * 60;
  const intervalSeconds = intervalMinutes * 60;
  const validRows: HistoricalMarketBreadthRow[] = [];

  for (const row of rows) {
    if (!/^\d{2}:\d{2}:\d{2}$/.test(row.trading_time)) {
      continue;
    }

    const [hourText, minuteText, secondText] =
      row.trading_time.split(":");

    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);

    if (
      !Number.isInteger(hour) ||
      !Number.isInteger(minute) ||
      !Number.isInteger(second) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59 ||
      second < 0 ||
      second > 59
    ) {
      continue;
    }

    const secondsFromMidnight =
      hour * 3600 + minute * 60 + second;

    if (secondsFromMidnight < anchorSeconds) {
      continue;
    }

    validRows.push(row);
  }

  validRows.sort((a, b) => {
    if (a.trading_date !== b.trading_date) {
      return a.trading_date.localeCompare(b.trading_date);
    }
    if (a.trading_time !== b.trading_time) {
      return a.trading_time.localeCompare(b.trading_time);
    }

    const aId = String(a.id ?? "");
    const bId = String(b.id ?? "");

    return aId.localeCompare(
      bId,
      undefined,
      { numeric: true, sensitivity: "base" }
    );
  });

  const buckets =
    new Map<string, HistoricalMarketBreadthRow>();

  for (const row of validRows) {
    const [hourText, minuteText, secondText] =
      row.trading_time.split(":");

    const secondsFromMidnight =
      Number(hourText) * 3600 +
      Number(minuteText) * 60 +
      Number(secondText);

    const bucketIndex = Math.floor(
      (secondsFromMidnight - anchorSeconds) / intervalSeconds
    );

    const key = `${row.trading_date}_${bucketIndex}`;

    buckets.set(key, row);
  }

  return Array.from(buckets.values()).sort((a, b) => {
    if (a.trading_date !== b.trading_date) {
      return a.trading_date.localeCompare(b.trading_date);
    }
    if (a.trading_time !== b.trading_time) {
      return a.trading_time.localeCompare(b.trading_time);
    }

    const aId = String(a.id ?? "");
    const bId = String(b.id ?? "");

    return aId.localeCompare(
      bId,
      undefined,
      { numeric: true, sensitivity: "base" }
    );
  });
}
export function normalizeSQLiteOiActivityRow(
  row: SQLiteOiActivityHistoryRow
): HistoricalOiActivityRow {
  return {
    id: row.id,
    snapshot_id: Number(row.snapshot_id),
    timestamp: Number(row.timestamp),
    trading_date: row.trading_date,
    trading_time: row.trading_time,
    symbol: row.symbol,
    expiry: row.expiry,
    strike: Number(row.strike) || 0,
    ce_ltp: Number(row.ce_ltp) || 0,
    ce_oi: Number(row.ce_oi) || 0,
    ce_oi_chg: Number(row.ce_oi_chg) || 0,
    ce_vol: Number(row.ce_vol) || 0,
    ce_signal: String(row.ce_signal ?? ""),
    pe_ltp: Number(row.pe_ltp) || 0,
    pe_oi: Number(row.pe_oi) || 0,
    pe_oi_chg: Number(row.pe_oi_chg) || 0,
    pe_vol: Number(row.pe_vol) || 0,
    pe_signal: String(row.pe_signal ?? ""),
  };
}

export function normalizeSupabaseOiActivityRow(
  row: SupabaseOiActivityHistorySourceRow
): HistoricalOiActivityRow {
  return {
    id: row.id,
    snapshot_id: row.snapshot_id,
    timestamp: parseIstToUtcEpoch(
      row.trading_date,
      row.trading_time
    ),
    trading_date: row.trading_date,
    trading_time: row.trading_time,
    symbol: row.symbol,
    expiry: row.expiry,
    strike: Number(row.strike) || 0,
    ce_ltp: Number(row.ce_ltp) || 0,
    ce_oi: Number(row.ce_oi) || 0,
    ce_oi_chg: Number(row.ce_oi_chg) || 0,
    ce_vol: Number(row.ce_vol) || 0,
    ce_signal: String(row.ce_signal ?? ""),
    pe_ltp: Number(row.pe_ltp) || 0,
    pe_oi: Number(row.pe_oi) || 0,
    pe_oi_chg: Number(row.pe_oi_chg) || 0,
    pe_vol: Number(row.pe_vol) || 0,
    pe_signal: String(row.pe_signal ?? ""),
  };
}

export function sampleOiActivitySnapshots(
  rows: HistoricalOiActivityRow[],
  intervalMinutes: 1 | 3 | 5 | 15 | 30 | 60
): HistoricalOiActivityRow[] {
  const anchorSeconds = 9 * 3600 + 15 * 60;
  const intervalSeconds = intervalMinutes * 60;

  const orderedRows = rows
    .filter((row) => {
      if (!/^\d{2}:\d{2}:\d{2}$/.test(row.trading_time)) {
        return false;
      }

      const [hourText, minuteText, secondText] =
        row.trading_time.split(":");

      const hour = Number(hourText);
      const minute = Number(minuteText);
      const second = Number(secondText);

      if (
        !Number.isInteger(hour) ||
        !Number.isInteger(minute) ||
        !Number.isInteger(second) ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59 ||
        second < 0 ||
        second > 59
      ) {
        return false;
      }

      const secondsFromMidnight =
        hour * 3600 + minute * 60 + second;

      return secondsFromMidnight >= anchorSeconds;
    })
    .sort((a, b) => {
      if (a.trading_date !== b.trading_date) {
        return a.trading_date.localeCompare(b.trading_date);
      }
      if (a.trading_time !== b.trading_time) {
        return a.trading_time.localeCompare(b.trading_time);
      }
      if (a.expiry !== b.expiry) {
        return a.expiry.localeCompare(b.expiry);
      }
      if (a.strike !== b.strike) {
        return a.strike - b.strike;
      }

      const aId = String(a.id ?? "");
      const bId = String(b.id ?? "");

      return aId.localeCompare(
        bId,
        undefined,
        { numeric: true, sensitivity: "base" }
      );
    });

  const selectedSnapshotKeys = new Map<string, string>();

  for (const row of orderedRows) {
    const [hourText, minuteText, secondText] =
      row.trading_time.split(":");

    const secondsFromMidnight =
      Number(hourText) * 3600 +
      Number(minuteText) * 60 +
      Number(secondText);

    const bucketIndex = Math.floor(
      (secondsFromMidnight - anchorSeconds) / intervalSeconds
    );

    const bucketKey =
      `${row.trading_date}_${row.symbol}_${row.expiry}_${bucketIndex}`;

    const snapshotKey =
      `${row.trading_date}_${row.trading_time}_${row.symbol}_${row.expiry}`;

    selectedSnapshotKeys.set(bucketKey, snapshotKey);
  }

  const selectedSnapshots =
    new Set(selectedSnapshotKeys.values());

  return orderedRows.filter((row) => {
    const snapshotKey =
      `${row.trading_date}_${row.trading_time}_${row.symbol}_${row.expiry}`;

    return selectedSnapshots.has(snapshotKey);
  });
}
export function normalizeSQLiteOptionRow(
  row: SQLiteOptionChainSnapshotRow
): HistoricalOptionChainSnapshot {
  return {
    id: row.id,
    timestamp: Number(row.timestamp),
    trading_date: row.trading_date,
    trading_time: row.trading_time,
    symbol: row.symbol,
    expiry: row.expiry,
    spot_price: Number(row.spot_price) || 0,
    pcr: Number(row.pcr) || 0,
    max_pain: Number(row.max_pain) || 0,
    atm_strike: Number(row.atm_strike) || 0,
    total_ce_oi: Number(row.total_ce_oi) || 0,
    total_pe_oi: Number(row.total_pe_oi) || 0,
    total_ce_oi_chg: Number(row.total_ce_oi_chg) || 0,
    total_pe_oi_chg: Number(row.total_pe_oi_chg) || 0,
    total_ce_vol: Number(row.total_ce_vol) || 0,
    total_pe_vol: Number(row.total_pe_vol) || 0,
    max_ce_oi_strike: Number(row.max_ce_oi_strike) || 0,
    max_pe_oi_strike: Number(row.max_pe_oi_strike) || 0,
    support_levels: String(row.support_levels ?? "[]"),
    resistance_levels: String(row.resistance_levels ?? "[]"),
  };
}

export function normalizeSupabaseOptionRow(
  row: SupabaseOptionChainSnapshotRow
): HistoricalOptionChainSnapshot {
  return {
    id: row.id,
    timestamp: parseIstToUtcEpoch(row.trading_date, row.trading_time),
    trading_date: row.trading_date,
    trading_time: row.trading_time,
    symbol: row.symbol,
    expiry: row.expiry,
    spot_price: Number(row.spot_price) || 0,
    pcr: Number(row.pcr) || 0,
    max_pain: Number(row.max_pain) || 0,
    atm_strike: Number(row.atm_strike) || 0,
    total_ce_oi: Number(row.total_ce_oi) || 0,
    total_pe_oi: Number(row.total_pe_oi) || 0,
    total_ce_oi_chg: Number(row.total_ce_oi_chg) || 0,
    total_pe_oi_chg: Number(row.total_pe_oi_chg) || 0,
    total_ce_vol: Number(row.total_ce_vol) || 0,
    total_pe_vol: Number(row.total_pe_vol) || 0,
    max_ce_oi_strike: Number(row.max_ce_oi_strike) || 0,
    max_pe_oi_strike: Number(row.max_pe_oi_strike) || 0,
    support_levels: String(row.support_levels ?? "[]"),
    resistance_levels: String(row.resistance_levels ?? "[]"),
  };
}

export function sampleOptionChainSnapshots(
  rows: HistoricalOptionChainSnapshot[],
  intervalMinutes: 1 | 3 | 5 | 15 | 30 | 60
): HistoricalOptionChainSnapshot[] {
  const anchorSeconds = 9 * 3600 + 15 * 60;
  const intervalSeconds = intervalMinutes * 60;
  const validRows: HistoricalOptionChainSnapshot[] = [];

  for (const row of rows) {
    if (!/^\d{2}:\d{2}:\d{2}$/.test(row.trading_time)) {
      continue;
    }

    const [hourText, minuteText, secondText] =
      row.trading_time.split(":");

    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);

    if (
      !Number.isInteger(hour) ||
      !Number.isInteger(minute) ||
      !Number.isInteger(second) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59 ||
      second < 0 ||
      second > 59
    ) {
      continue;
    }

    const secondsFromMidnight =
      hour * 3600 + minute * 60 + second;

    if (secondsFromMidnight < anchorSeconds) {
      continue;
    }

    validRows.push(row);
  }

  validRows.sort((a, b) => {
    if (a.trading_date !== b.trading_date) {
      return a.trading_date.localeCompare(b.trading_date);
    }
    if (a.trading_time !== b.trading_time) {
      return a.trading_time.localeCompare(b.trading_time);
    }
    if (a.expiry !== b.expiry) {
      return a.expiry.localeCompare(b.expiry);
    }

    const aId = String(a.id ?? "");
    const bId = String(b.id ?? "");

    return aId.localeCompare(
      bId,
      undefined,
      { numeric: true, sensitivity: "base" }
    );
  });

  const buckets =
    new Map<string, HistoricalOptionChainSnapshot>();

  for (const row of validRows) {
    const [hourText, minuteText, secondText] =
      row.trading_time.split(":");

    const secondsFromMidnight =
      Number(hourText) * 3600 +
      Number(minuteText) * 60 +
      Number(secondText);

    const bucketIndex = Math.floor(
      (secondsFromMidnight - anchorSeconds) / intervalSeconds
    );

    const key =
      `${row.trading_date}_${row.symbol}_${row.expiry}_${bucketIndex}`;

    buckets.set(key, row);
  }

  return Array.from(buckets.values()).sort((a, b) => {
    if (a.trading_date !== b.trading_date) {
      return a.trading_date.localeCompare(b.trading_date);
    }
    if (a.trading_time !== b.trading_time) {
      return a.trading_time.localeCompare(b.trading_time);
    }
    if (a.expiry !== b.expiry) {
      return a.expiry.localeCompare(b.expiry);
    }

    const aId = String(a.id ?? "");
    const bId = String(b.id ?? "");

    return aId.localeCompare(
      bId,
      undefined,
      { numeric: true, sensitivity: "base" }
    );
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
export async function getHistoricalOptionHistory(
  symbol: string,
  startDate: string,
  endDate: string,
  intervalMinutes: 1 | 3 | 5 | 15 | 30 | 60,
  expiry?: string
): Promise<HistoricalOptionHistoryResult> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const normalizedExpiry = expiry?.trim();

  if (!normalizedSymbol) {
    throw new Error(
      "Symbol parameter is required and cannot be empty."
    );
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
        reject(
          new Error(
            "Supabase option-chain range query timed out after 3000ms"
          )
        );
      }, 3000);
    });

    const supabasePromise = getSupabaseOptionHistoryRange(
      normalizedSymbol,
      startDate,
      endDate,
      normalizedExpiry
    );

    supabasePromise.catch(() => {});

    supabaseRows = await Promise.race([
      supabasePromise,
      timeoutPromise,
    ]);
  } catch (err: any) {
    supabaseFailed = true;
    supabaseError = err;

    console.warn(
      `[historicalDataService] Supabase option-chain range query failed or timed out for symbol ${normalizedSymbol} in range ${startDate} to ${endDate}. Falling back to SQLite. Error: ${err.message || err}`
    );
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  const readSQLiteRows = (): any[] => {
    const rows = dbService.getOptionHistoryRangeRaw(
      normalizedSymbol,
      startDate,
      endDate
    );

    if (!normalizedExpiry) {
      return rows;
    }

    return rows.filter(
      (row) => String(row.expiry) === normalizedExpiry
    );
  };

  if (supabaseFailed) {
    try {
      rawRows = readSQLiteRows();
      source = "sqlite";
    } catch (sqliteErr: any) {
      throw new Error(
        `Historical option-chain range query failed on both Supabase and SQLite. Supabase error: ${supabaseError?.message || supabaseError}. SQLite error: ${sqliteErr.message || sqliteErr}`
      );
    }
  } else if (supabaseRows.length > 0) {
    rawRows = supabaseRows;
    source = "supabase";
  } else {
    try {
      rawRows = readSQLiteRows();
      source = "sqlite";
    } catch (sqliteErr: any) {
      throw new Error(
        `Supabase returned no matching option-chain rows. SQLite fallback failed: ${sqliteErr.message || sqliteErr}`
      );
    }
  }

  let normalized: HistoricalOptionChainSnapshot[];

  if (source === "supabase") {
    normalized = rawRows.map((row) =>
      normalizeSupabaseOptionRow(row)
    );
  } else {
    normalized = rawRows.map((row) =>
      normalizeSQLiteOptionRow(row)
    );
  }

  normalized.sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    if (a.trading_date !== b.trading_date) {
      return a.trading_date.localeCompare(b.trading_date);
    }
    if (a.trading_time !== b.trading_time) {
      return a.trading_time.localeCompare(b.trading_time);
    }
    if (a.expiry !== b.expiry) {
      return a.expiry.localeCompare(b.expiry);
    }

    const aId = String(a.id ?? "");
    const bId = String(b.id ?? "");

    return aId.localeCompare(
      bId,
      undefined,
      { numeric: true, sensitivity: "base" }
    );
  });

  const seen = new Set<string>();
  const deduplicated: HistoricalOptionChainSnapshot[] = [];

  for (const row of normalized) {
    const key =
      `${row.trading_date}_${row.trading_time}_${row.symbol}_${row.expiry}`;

    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(row);
    }
  }

  const sampled = sampleOptionChainSnapshots(
    deduplicated,
    intervalMinutes
  );

  const actualDates = Array.from(
    new Set(sampled.map((row) => row.trading_date))
  ).sort();

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
export async function getHistoricalOiActivityHistory(
  symbol: string,
  startDate: string,
  endDate: string,
  intervalMinutes: 1 | 3 | 5 | 15 | 30 | 60,
  expiry?: string
): Promise<HistoricalOiActivityHistoryResult> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const normalizedExpiry = expiry?.trim();

  if (!normalizedSymbol) {
    throw new Error(
      "Symbol parameter is required and cannot be empty."
    );
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
        reject(
          new Error(
            "Supabase OI-activity range query timed out after 10000ms"
          )
        );
      }, 10000);
    });

    const supabasePromise =
      getSupabaseOiActivityHistoryRange(
        normalizedSymbol,
        startDate,
        endDate,
        normalizedExpiry,
        intervalMinutes
      );

    supabasePromise.catch(() => {});

    supabaseRows = await Promise.race([
      supabasePromise,
      timeoutPromise,
    ]);
  } catch (err: any) {
    supabaseFailed = true;
    supabaseError = err;

    console.warn(
      `[historicalDataService] Supabase OI-activity range query failed or timed out for symbol ${normalizedSymbol} in range ${startDate} to ${endDate}. Falling back to SQLite. Error: ${err.message || err}`
    );
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  const readSQLiteRows = (): any[] =>
    dbService.getOiActivityHistoryRangeRaw(
      normalizedSymbol,
      startDate,
      endDate,
      normalizedExpiry
    );

  if (supabaseFailed) {
    try {
      rawRows = readSQLiteRows();
      source = "sqlite";
    } catch (sqliteErr: any) {
      throw new Error(
        `Historical OI-activity range query failed on both Supabase and SQLite. Supabase error: ${supabaseError?.message || supabaseError}. SQLite error: ${sqliteErr.message || sqliteErr}`
      );
    }
  } else if (supabaseRows.length > 0) {
    rawRows = supabaseRows;
    source = "supabase";
  } else {
    try {
      rawRows = readSQLiteRows();
      source = "sqlite";
    } catch (sqliteErr: any) {
      throw new Error(
        `Supabase returned no matching OI-activity rows. SQLite fallback failed: ${sqliteErr.message || sqliteErr}`
      );
    }
  }

  let normalized: HistoricalOiActivityRow[];

  if (source === "supabase") {
    normalized = rawRows.map((row) =>
      normalizeSupabaseOiActivityRow(row)
    );
  } else {
    normalized = rawRows.map((row) =>
      normalizeSQLiteOiActivityRow(row)
    );
  }

  normalized.sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    if (a.trading_date !== b.trading_date) {
      return a.trading_date.localeCompare(b.trading_date);
    }
    if (a.trading_time !== b.trading_time) {
      return a.trading_time.localeCompare(b.trading_time);
    }
    if (a.expiry !== b.expiry) {
      return a.expiry.localeCompare(b.expiry);
    }
    if (a.strike !== b.strike) {
      return a.strike - b.strike;
    }

    const aId = String(a.id ?? "");
    const bId = String(b.id ?? "");

    return aId.localeCompare(
      bId,
      undefined,
      { numeric: true, sensitivity: "base" }
    );
  });

  const seen = new Set<string>();
  const deduplicated: HistoricalOiActivityRow[] = [];

  for (const row of normalized) {
    const key =
      `${row.trading_date}_${row.trading_time}_${row.symbol}_${row.expiry}_${row.strike}`;

    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(row);
    }
  }

  const sampled = sampleOiActivitySnapshots(
    deduplicated,
    intervalMinutes
  );

  const actualDates = Array.from(
    new Set(sampled.map((row) => row.trading_date))
  ).sort();

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
export async function getHistoricalBreadthHistory(
  startDate: string,
  endDate: string,
  intervalMinutes: 1 | 3 | 5 | 15 | 30 | 60
): Promise<HistoricalMarketBreadthHistoryResult> {
  let rawRows: any[] = [];
  let source: HistoricalDataSource = "supabase";
  let supabaseFailed = false;
  let supabaseError: any = null;
  let supabaseRows: any[] = [];

  let timeoutId: NodeJS.Timeout | null = null;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(
            "Supabase market-breadth range query timed out after 3000ms"
          )
        );
      }, 3000);
    });

    const supabasePromise =
      getSupabaseBreadthHistoryRange(
        startDate,
        endDate
      );

    supabasePromise.catch(() => {});

    supabaseRows = await Promise.race([
      supabasePromise,
      timeoutPromise,
    ]);
  } catch (err: any) {
    supabaseFailed = true;
    supabaseError = err;

    console.warn(
      `[historicalDataService] Supabase market-breadth range query failed or timed out in range ${startDate} to ${endDate}. Falling back to SQLite. Error: ${err.message || err}`
    );
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  const readSQLiteRows = (): any[] =>
    dbService.getBreadthHistoryRangeRaw(
      startDate,
      endDate
    );

  if (supabaseFailed) {
    try {
      rawRows = readSQLiteRows();
      source = "sqlite";
    } catch (sqliteErr: any) {
      throw new Error(
        `Historical market-breadth range query failed on both Supabase and SQLite. Supabase error: ${supabaseError?.message || supabaseError}. SQLite error: ${sqliteErr.message || sqliteErr}`
      );
    }
  } else if (supabaseRows.length > 0) {
    rawRows = supabaseRows;
    source = "supabase";
  } else {
    try {
      rawRows = readSQLiteRows();
      source = "sqlite";
    } catch (sqliteErr: any) {
      throw new Error(
        `Supabase returned no matching market-breadth rows. SQLite fallback failed: ${sqliteErr.message || sqliteErr}`
      );
    }
  }

  let normalized: HistoricalMarketBreadthRow[];

  if (source === "supabase") {
    normalized = rawRows.map((row) =>
      normalizeSupabaseBreadthRow(row)
    );
  } else {
    normalized = rawRows.map((row) =>
      normalizeSQLiteBreadthRow(row)
    );
  }

  normalized.sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    if (a.trading_date !== b.trading_date) {
      return a.trading_date.localeCompare(b.trading_date);
    }
    if (a.trading_time !== b.trading_time) {
      return a.trading_time.localeCompare(b.trading_time);
    }

    const aId = String(a.id ?? "");
    const bId = String(b.id ?? "");

    return aId.localeCompare(
      bId,
      undefined,
      { numeric: true, sensitivity: "base" }
    );
  });

  const seen = new Set<string>();
  const deduplicated: HistoricalMarketBreadthRow[] = [];

  for (const row of normalized) {
    const key =
      `${row.trading_date}_${row.trading_time}`;

    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(row);
    }
  }

  const sampled = sampleBreadthSnapshots(
    deduplicated,
    intervalMinutes
  );

  const actualDates = Array.from(
    new Set(sampled.map((row) => row.trading_date))
  ).sort();

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
export async function getHistoricalSectorStrengthHistory(
  startDate: string,
  endDate: string,
  intervalMinutes: 1 | 3 | 5 | 15 | 30 | 60,
  symbol?: string
): Promise<HistoricalSectorStrengthHistoryResult> {
  const normalizedSymbol = symbol?.trim().toUpperCase();

  let rawRows: any[] = [];
  let source: HistoricalDataSource = "supabase";
  let supabaseFailed = false;
  let supabaseError: any = null;
  let supabaseRows: any[] = [];

  let timeoutId: NodeJS.Timeout | null = null;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(
            "Supabase sector-strength range query timed out after 3000ms"
          )
        );
      }, 3000);
    });

    const supabasePromise =
      getSupabaseSectorStrengthHistoryRange(
        startDate,
        endDate,
        normalizedSymbol
      );

    supabasePromise.catch(() => {});

    supabaseRows = await Promise.race([
      supabasePromise,
      timeoutPromise,
    ]);
  } catch (err: any) {
    supabaseFailed = true;
    supabaseError = err;

    console.warn(
      `[historicalDataService] Supabase sector-strength range query failed or timed out in range ${startDate} to ${endDate}. Falling back to SQLite. Error: ${err.message || err}`
    );
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  const readSQLiteRows = (): any[] =>
    dbService.getSectorStrengthHistoryRangeRaw(
      startDate,
      endDate,
      normalizedSymbol
    );

  if (supabaseFailed) {
    try {
      rawRows = readSQLiteRows();
      source = "sqlite";
    } catch (sqliteErr: any) {
      throw new Error(
        `Historical sector-strength range query failed on both Supabase and SQLite. Supabase error: ${supabaseError?.message || supabaseError}. SQLite error: ${sqliteErr.message || sqliteErr}`
      );
    }
  } else if (supabaseRows.length > 0) {
    rawRows = supabaseRows;
    source = "supabase";
  } else {
    try {
      rawRows = readSQLiteRows();
      source = "sqlite";
    } catch (sqliteErr: any) {
      throw new Error(
        `Supabase returned no matching sector-strength rows. SQLite fallback failed: ${sqliteErr.message || sqliteErr}`
      );
    }
  }

  let normalized: HistoricalSectorStrengthRow[];

  if (source === "supabase") {
    normalized = rawRows.map((row) =>
      normalizeSupabaseSectorStrengthRow(row)
    );
  } else {
    normalized = rawRows.map((row) =>
      normalizeSQLiteSectorStrengthRow(row)
    );
  }

  normalized.sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
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

    const aId = String(a.id ?? "");
    const bId = String(b.id ?? "");

    return aId.localeCompare(
      bId,
      undefined,
      { numeric: true, sensitivity: "base" }
    );
  });

  const seen = new Set<string>();
  const deduplicated: HistoricalSectorStrengthRow[] = [];

  for (const row of normalized) {
    const key =
      `${row.trading_date}_${row.trading_time}_${row.symbol}`;

    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(row);
    }
  }

  const sampled = sampleSectorStrengthSnapshots(
    deduplicated,
    intervalMinutes
  );

  const actualDates = Array.from(
    new Set(sampled.map((row) => row.trading_date))
  ).sort();

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
