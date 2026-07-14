// ─── Supabase Server-Only Service ─────────────────────────────────────────────
// This file uses `@supabase/supabase-js` with the SERVICE ROLE KEY, which gives
// full DB access (bypasses RLS). It MUST only be imported from server-side code:
//   - *.server.ts  (services layer)
//   - *.functions.ts  (TanStack Start server functions)
//   - /api/* routes
//
// NEVER import this file from any client component / route component / features/*.
// The service role key must NEVER reach the browser bundle.
// ──────────────────────────────────────────────────────────────────────────────

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseMarketSnapshotRow } from "./historicalDataService.server";

// ── Types matching the Supabase tables ────────────────────────────────────────

export type SupabaseSystemLog = {
  service: string;
  level?: "INFO" | "WARN" | "ERROR";
  message: string;
  details?: string | null;
  created_at?: string; // auto-managed by Supabase
};

export type SupabaseMarketSnapshot = {
  trading_date: string;   // YYYY-MM-DD
  trading_time: string;   // HH:MM:SS
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
};

export type SupabaseOptionChainSnapshot = {
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
  support_levels: string;   // JSON string
  resistance_levels: string; // JSON string
};

export type SupabaseOiActivity = {
  snapshot_id: number;  // FK → option_chain_snapshots.id
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
};
export type SupabaseOptionChainHistoryRow =
  SupabaseOptionChainSnapshot & {
    id: number;
  };

export type SupabaseOiActivityHistoryRow = {
  id: number;
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
};

export type SupabaseMarketBreadthHistoryRow = SupabaseMarketBreadth & {
  id: number;
};

export type SupabaseSectorStrengthHistoryRow =
  SupabaseSectorStrength & {
    id: number;
  };

// ── Lazy singleton Supabase client ─────────────────────────────────────────────
// Initialised once on first use. Returns null if env vars are missing so the
// rest of the codebase can gracefully degrade without crashing.

let _client: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient | null {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.warn(
      "[supabase.server] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — Supabase disabled."
    );
    return null;
  }

  try {
    _client = createClient(url, key, {
      auth: {
        // Service-role client — no user sessions, no auto-refresh
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    return _client;
  } catch (err) {
    console.error("[supabase.server] Failed to create Supabase client:", err);
    return null;
  }
}

// ── Safe insert helpers ────────────────────────────────────────────────────────
// Each function is fire-and-forget safe: it logs errors to console but never
// throws so a Supabase failure never crashes the main data path.

/**
 * Insert a row into `public.system_logs`.
 * Returns true on success, false on any error (including unconfigured client).
 */
export async function insertSystemLog(
  log: SupabaseSystemLog
): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;

  try {
    const { error } = await supabase.from("system_logs").insert({
      service: log.service,
      level: log.level ?? "INFO",
      message: log.message,
      details: log.details ?? null,
    });

    if (error) {
      console.error("[supabase.server] insertSystemLog error:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[supabase.server] insertSystemLog exception:", err);
    return false;
  }
}

/**
 * Insert one or more rows into `public.market_snapshots`.
 * Uses `ignoreDuplicates: true` to mirror SQLite's INSERT OR IGNORE behaviour.
 */
export async function insertMarketSnapshot(
  snapshots: SupabaseMarketSnapshot | SupabaseMarketSnapshot[]
): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;

  const rows = Array.isArray(snapshots) ? snapshots : [snapshots];
  if (!rows.length) return true;

  try {
    const { error } = await supabase
      .from("market_snapshots")
      .upsert(rows, { ignoreDuplicates: true });

    if (error) {
      console.error("[supabase.server] insertMarketSnapshot error:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[supabase.server] insertMarketSnapshot exception:", err);
    return false;
  }
}

/**
 * Insert one row into `public.option_chain_snapshots`.
 * Returns the inserted row's `id` (needed to link oi_activity rows), or null on error.
 */
export async function insertOptionChainSnapshot(
  snapshot: SupabaseOptionChainSnapshot
): Promise<number | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    // 1. Perform upsert without .single() to handle zero returned rows safely
    const { data, error } = await supabase
      .from("option_chain_snapshots")
      .upsert(snapshot, { ignoreDuplicates: true })
      .select("id");

    if (error) {
      console.error(
        "[supabase.server] insertOptionChainSnapshot upsert error:",
        error.message
      );
      return null;
    }

    // 2. If row was inserted, return its ID
    if (data && data.length > 0) {
      return data[0].id;
    }

    // 3. Fallback: If returned data is empty (ignored duplicate), resolve the ID of the existing row
    const { data: existing, error: queryError } = await supabase
      .from("option_chain_snapshots")
      .select("id")
      .eq("trading_date", snapshot.trading_date)
      .eq("trading_time", snapshot.trading_time)
      .eq("symbol", snapshot.symbol)
      .eq("expiry", snapshot.expiry)
      .maybeSingle();

    if (queryError) {
      console.error(
        `[supabase.server] insertOptionChainSnapshot fallback lookup error: ${queryError.message}`
      );
      return null;
    }

    if (!existing) {
      console.error(
        `[supabase.server] insertOptionChainSnapshot parent-ID resolution error: No existing row found for key ${snapshot.trading_date} ${snapshot.trading_time} ${snapshot.symbol} ${snapshot.expiry}`
      );
      return null;
    }

    return existing.id;
  } catch (err) {
    console.error("[supabase.server] insertOptionChainSnapshot exception:", err);
    return null;
  }
}

/**
 * Insert one or more rows into `public.oi_activity`.
 * `snapshot_id` must reference an existing `option_chain_snapshots.id`.
 */
export async function insertOiActivity(
  rows: SupabaseOiActivity | SupabaseOiActivity[]
): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;

  const items = Array.isArray(rows) ? rows : [rows];
  if (!items.length) return true;

  try {
    const { error } = await supabase
      .from("oi_activity")
      .upsert(items, { ignoreDuplicates: true });

    if (error) {
      console.error("[supabase.server] insertOiActivity error:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[supabase.server] insertOiActivity exception:", err);
    return false;
  }
}

// ── Additional types for remaining scheduler tables ────────────────────────────

export type SupabaseMarketBreadth = {
  trading_date: string;   // YYYY-MM-DD
  trading_time: string;   // HH:MM:SS
  advance: number;
  decline: number;
  unchanged: number;
  adr: number;
  india_vix: number;
};

export type SupabaseSectorStrength = {
  trading_date: string;
  trading_time: string;
  symbol: string;
  name: string;
  price: number;
  change_pct: number;
};

export type SupabaseTradeSignal = {
  trading_date: string;
  trading_time: string;
  symbol: string;
  signal_type: string;   // "VERY STRONG" | "STRONG" | "WEAK"
  direction: string;     // "BULLISH" | "BEARISH" | "NEUTRAL"
  strike: number;
  entry: string;
  sl: string;
  t1: string;
  t2: string;
  rr: string;
  confidence: number;
};

// ── Feature flag ───────────────────────────────────────────────────────────────
// Set SUPABASE_DUAL_WRITE=true in .env to enable dual-write from the scheduler.
// Any other value (including missing) keeps the scheduler SQLite-only.

export function isDualWriteEnabled(): boolean {
  return process.env.SUPABASE_DUAL_WRITE === "true";
}

// ── Remaining table insert helpers ─────────────────────────────────────────────

/**
 * Insert one row into `public.market_breadth`.
 */
export async function insertMarketBreadth(
  row: SupabaseMarketBreadth
): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;

  try {
    const { error } = await supabase
      .from("market_breadth")
      .upsert(row, { ignoreDuplicates: true });

    if (error) {
      console.error("[supabase.server] insertMarketBreadth error:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[supabase.server] insertMarketBreadth exception:", err);
    return false;
  }
}

/**
 * Insert one or more rows into `public.sector_strength`.
 */
export async function insertSectorStrength(
  rows: SupabaseSectorStrength | SupabaseSectorStrength[]
): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;

  const items = Array.isArray(rows) ? rows : [rows];
  if (!items.length) return true;

  try {
    const { error } = await supabase
      .from("sector_strength")
      .upsert(items, { ignoreDuplicates: true });

    if (error) {
      console.error("[supabase.server] insertSectorStrength error:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[supabase.server] insertSectorStrength exception:", err);
    return false;
  }
}

/**
 * Insert one or more rows into `public.trade_signals`.
 */
export async function insertTradeSignal(
  rows: SupabaseTradeSignal | SupabaseTradeSignal[]
): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;

  const items = Array.isArray(rows) ? rows : [rows];
  if (!items.length) return true;

  try {
    const { error } = await supabase
      .from("trade_signals")
      .upsert(items, { ignoreDuplicates: true });

    if (error) {
      console.error("[supabase.server] insertTradeSignal error:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[supabase.server] insertTradeSignal exception:", err);
    return false;
  }
}

// ── Health/Debug Monitoring Helpers ───────────────────────────────────────────

export type SupabaseTableStats = {
  count: number | null;
  latestTimestamp: string | null;
  error: string | null;
};

export type SupabaseHealthReport = {
  ok: boolean;
  dualWriteEnabled: boolean;
  checkedAt: string;
  tables: Record<string, SupabaseTableStats>;
};

/**
 * Retrieve stats for a single table safely without throwing.
 */
async function getTableStats(tableName: string): Promise<SupabaseTableStats> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { count: null, latestTimestamp: null, error: "Supabase client not initialized" };
  }

  try {
    // 1. Get row count
    const { count, error: countError } = await supabase
      .from(tableName)
      .select("*", { count: "exact", head: true });

    if (countError) {
      return { count: null, latestTimestamp: null, error: countError.message };
    }

    // 2. Try to query the latest record to extract date/time
    let latestTimestamp: string | null = null;
    let data: any[] | null = null;
    let selectError: any = null;

    // Try ordering by created_at (common default)
    const resCreatedAt = await supabase
      .from(tableName)
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1);
    
    if (!resCreatedAt.error && resCreatedAt.data && resCreatedAt.data.length > 0) {
      data = resCreatedAt.data;
    } else {
      // Try ordering by trading_date + trading_time
      const resTradingDateTime = await supabase
        .from(tableName)
        .select("trading_date, trading_time")
        .order("trading_date", { ascending: false })
        .order("trading_time", { ascending: false })
        .limit(1);

      if (!resTradingDateTime.error && resTradingDateTime.data && resTradingDateTime.data.length > 0) {
        data = resTradingDateTime.data;
      } else {
        // Try ordering by id
        const resId = await supabase
          .from(tableName)
          .select("id")
          .order("id", { ascending: false })
          .limit(1);

        if (!resId.error && resId.data && resId.data.length > 0) {
          data = resId.data;
        } else {
          // Standard fetch limit 1 fallback
          const resBasic = await supabase.from(tableName).select("*").limit(1);
          data = resBasic.data;
          selectError = resBasic.error;
        }
      }
    }

    if (data && data.length > 0) {
      const first = data[0];
      if (first.created_at) {
        latestTimestamp = first.created_at;
      } else if (first.trading_date && first.trading_time) {
        latestTimestamp = `${first.trading_date} ${first.trading_time}`;
      } else if (first.timestamp) {
        latestTimestamp = new Date(first.timestamp).toISOString();
      } else if (first.id) {
        latestTimestamp = `ID: ${first.id}`;
      } else {
        latestTimestamp = "Record exists but no identifiable timestamp";
      }
    }

    return {
      count: count ?? 0,
      latestTimestamp,
      error: selectError ? selectError.message : null,
    };
  } catch (err: any) {
    return {
      count: null,
      latestTimestamp: null,
      error: err?.message || String(err),
    };
  }
}

/**
 * Generate a complete health report for all Supabase tables.
 */
export async function getSupabaseHealthReport(): Promise<SupabaseHealthReport> {
  const tables = [
    "system_logs",
    "market_snapshots",
    "option_chain_snapshots",
    "oi_activity",
    "market_breadth",
    "sector_strength",
    "trade_signals"
  ];

  const results: Record<string, SupabaseTableStats> = {};
  let overallOk = true;

  const supabase = getSupabaseClient();
  if (!supabase) {
    overallOk = false;
  } else {
    for (const table of tables) {
      const stats = await getTableStats(table);
      results[table] = stats;
      if (stats.error) {
        overallOk = false;
      }
    }
  }

  return {
    ok: overallOk,
    dualWriteEnabled: isDualWriteEnabled(),
    checkedAt: new Date().toISOString(),
    tables: results
  };
}

export class SupabaseHistoryPaginationCappedError extends Error {
  public readonly name = "SupabaseHistoryPaginationCappedError";
  constructor(
    public readonly maxRows: number,
    public readonly symbol: string,
    public readonly startDate: string,
    public readonly endDate: string,
    message?: string
  ) {
    super(
      message ||
        `Supabase history range query for symbol ${symbol} in range ${startDate} to ${endDate} was capped at ${maxRows} rows.`
    );
    Object.setPrototypeOf(this, SupabaseHistoryPaginationCappedError.prototype);
  }
}





export async function getSupabaseSectorStrengthHistoryRange(
  startDate: string,
  endDate: string,
  symbol?: string
): Promise<SupabaseSectorStrengthHistoryRow[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error(
      "Supabase read query failed: Supabase is not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)."
    );
  }

  const normalizedSymbol = symbol?.trim().toUpperCase();
  const pageSize = 1000;
  const maxRows = 50000;
  const maxPages = maxRows / pageSize;
  const allRows: SupabaseSectorStrengthHistoryRow[] = [];

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("sector_strength")
      .select(
        "id, trading_date, trading_time, symbol, name, price, change_pct"
      )
      .gte("trading_date", startDate)
      .lte("trading_date", endDate);

    if (normalizedSymbol) {
      query = query.eq("symbol", normalizedSymbol);
    }

    const { data, error } = await query
      .order("trading_date", { ascending: true })
      .order("trading_time", { ascending: true })
      .order("symbol", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(
        `Supabase sector-strength query failed in range ${startDate} to ${endDate} on page ${page + 1}: ${error.message}`
      );
    }

    if (!data || data.length === 0) {
      break;
    }

    allRows.push(...(data as SupabaseSectorStrengthHistoryRow[]));

    if (data.length < pageSize) {
      break;
    }

    if (page === maxPages - 1 && data.length === pageSize) {
      let probeQuery = supabase
        .from("sector_strength")
        .select("id")
        .gte("trading_date", startDate)
        .lte("trading_date", endDate);

      if (normalizedSymbol) {
        probeQuery = probeQuery.eq("symbol", normalizedSymbol);
      }

      const { data: probeData, error: probeError } = await probeQuery
        .order("trading_date", { ascending: true })
        .order("trading_time", { ascending: true })
        .order("symbol", { ascending: true })
        .order("id", { ascending: true })
        .range(maxRows, maxRows);

      if (probeError) {
        throw new Error(
          `Supabase sector-strength query failed in range ${startDate} to ${endDate} on page ${maxPages + 1} (probe): ${probeError.message}`
        );
      }

      if (probeData && probeData.length > 0) {
        throw new SupabaseHistoryPaginationCappedError(
          maxRows,
          normalizedSymbol || "ALL_SECTORS",
          startDate,
          endDate,
          `Supabase sector-strength range query in range ${startDate} to ${endDate} was capped at ${maxRows} rows.`
        );
      }
    }
  }

  return allRows;
}
export async function getSupabaseBreadthHistoryRange(
  startDate: string,
  endDate: string
): Promise<SupabaseMarketBreadthHistoryRow[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error(
      "Supabase read query failed: Supabase is not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)."
    );
  }

  const pageSize = 1000;
  const maxRows = 15000;
  const maxPages = maxRows / pageSize;
  const allRows: SupabaseMarketBreadthHistoryRow[] = [];

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("market_breadth")
      .select(
        "id, trading_date, trading_time, advance, decline, unchanged, adr, india_vix"
      )
      .gte("trading_date", startDate)
      .lte("trading_date", endDate)
      .order("trading_date", { ascending: true })
      .order("trading_time", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(
        `Supabase market-breadth query failed in range ${startDate} to ${endDate} on page ${page + 1}: ${error.message}`
      );
    }

    if (!data || data.length === 0) {
      break;
    }

    allRows.push(...(data as SupabaseMarketBreadthHistoryRow[]));

    if (data.length < pageSize) {
      break;
    }

    if (page === maxPages - 1 && data.length === pageSize) {
      const { data: probeData, error: probeError } = await supabase
        .from("market_breadth")
        .select("id")
        .gte("trading_date", startDate)
        .lte("trading_date", endDate)
        .order("trading_date", { ascending: true })
        .order("trading_time", { ascending: true })
        .order("id", { ascending: true })
        .range(maxRows, maxRows);

      if (probeError) {
        throw new Error(
          `Supabase market-breadth query failed in range ${startDate} to ${endDate} on page ${maxPages + 1} (probe): ${probeError.message}`
        );
      }

      if (probeData && probeData.length > 0) {
        throw new SupabaseHistoryPaginationCappedError(
          maxRows,
          "MARKET_BREADTH",
          startDate,
          endDate,
          `Supabase market-breadth range query in range ${startDate} to ${endDate} was capped at ${maxRows} rows.`
        );
      }
    }
  }

  return allRows;
}
export async function getSupabaseOiActivityHistoryRange(
  symbol: string,
  startDate: string,
  endDate: string,
  expiry?: string,
  intervalMinutes: 1 | 3 | 5 | 15 | 30 | 60 = 1
): Promise<SupabaseOiActivityHistoryRow[]> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error(
      "Supabase read query failed: Supabase is not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)."
    );
  }

  const normalizedSymbol =
    symbol.trim().toUpperCase();
  const normalizedExpiry = expiry?.trim();

  if (!normalizedSymbol) {
    throw new Error(
      "Supabase OI-activity query requires a non-empty symbol."
    );
  }

  const snapshotPageSize = 1000;
  const snapshotMaxRows = 15000;

  const snapshots: Array<{
    id: string;
    trading_date: string;
    trading_time: string;
    symbol: string;
    expiry: string;
  }> = [];

  /*
   * Phase 1:
   * Fetch lightweight option snapshot metadata first.
   */
  for (
    let from = 0;
    from < snapshotMaxRows;
    from += snapshotPageSize
  ) {
    const to = from + snapshotPageSize - 1;

    let query = supabase
      .from("option_chain_snapshots")
      .select(
        "id,trading_date,trading_time,symbol,expiry"
      )
      .eq("symbol", normalizedSymbol)
      .gte("trading_date", startDate)
      .lte("trading_date", endDate)
      .order("trading_date", {
        ascending: true,
      })
      .order("trading_time", {
        ascending: true,
      })
      .order("expiry", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (normalizedExpiry) {
      query = query.eq(
        "expiry",
        normalizedExpiry
      );
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(
        `Supabase option snapshot lookup failed for OI history, symbol ${normalizedSymbol}, range ${startDate} to ${endDate}: ${error.message}`
      );
    }

    if (!data || data.length === 0) {
      break;
    }

    for (const row of data as any[]) {
      snapshots.push({
        id: String(row.id),
        trading_date: String(
          row.trading_date
        ),
        trading_time: String(
          row.trading_time
        ),
        symbol: String(row.symbol),
        expiry: String(row.expiry),
      });
    }

    if (data.length < snapshotPageSize) {
      break;
    }

    if (
      from + snapshotPageSize >=
        snapshotMaxRows &&
      data.length === snapshotPageSize
    ) {
      throw new SupabaseHistoryPaginationCappedError(
        snapshotMaxRows,
        normalizedSymbol,
        startDate,
        endDate,
        `Supabase option snapshot lookup for OI history was capped at ${snapshotMaxRows} rows.`
      );
    }
  }

  if (snapshots.length === 0) {
    return [];
  }

  /*
   * Phase 2:
   * Select the latest parent snapshot in each interval bucket.
   */
  const anchorSeconds =
    9 * 3600 + 15 * 60;
  const intervalSeconds =
    intervalMinutes * 60;

  const selectedByBucket = new Map<
    string,
    (typeof snapshots)[number]
  >();

  for (const snapshot of snapshots) {
    if (
      !/^\d{2}:\d{2}:\d{2}$/.test(
        snapshot.trading_time
      )
    ) {
      continue;
    }

    const [
      hourText,
      minuteText,
      secondText,
    ] = snapshot.trading_time.split(":");

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
      hour * 3600 +
      minute * 60 +
      second;

    if (
      secondsFromMidnight <
      anchorSeconds
    ) {
      continue;
    }

    const bucketIndex = Math.floor(
      (secondsFromMidnight -
        anchorSeconds) /
        intervalSeconds
    );

    const bucketKey =
      `${snapshot.trading_date}_${snapshot.symbol}_${snapshot.expiry}_${bucketIndex}`;

    selectedByBucket.set(
      bucketKey,
      snapshot
    );
  }

  const selectedSnapshots = Array.from(
    selectedByBucket.values()
  ).sort((a, b) => {
    if (
      a.trading_date !== b.trading_date
    ) {
      return a.trading_date.localeCompare(
        b.trading_date
      );
    }

    if (
      a.trading_time !== b.trading_time
    ) {
      return a.trading_time.localeCompare(
        b.trading_time
      );
    }

    if (a.expiry !== b.expiry) {
      return a.expiry.localeCompare(
        b.expiry
      );
    }

    return a.id.localeCompare(
      b.id,
      undefined,
      {
        numeric: true,
        sensitivity: "base",
      }
    );
  });

  if (
    selectedSnapshots.length === 0
  ) {
    return [];
  }

  const snapshotById = new Map(
    selectedSnapshots.map(
      (snapshot) => [
        snapshot.id,
        snapshot,
      ]
    )
  );

  const selectedIds =
    selectedSnapshots.map(
      (snapshot) => snapshot.id
    );

  /*
   * Phase 3:
   * Fetch strike-level OI rows only for selected snapshots.
   */
  const idChunkSize = 100;
  const oiPageSize = 1000;
  const maxRows = 500000;

  const allRows:
    SupabaseOiActivityHistoryRow[] = [];

  for (
    let chunkStart = 0;
    chunkStart < selectedIds.length;
    chunkStart += idChunkSize
  ) {
    const idChunk = selectedIds.slice(
      chunkStart,
      chunkStart + idChunkSize
    );

    for (
      let from = 0;
      from < maxRows;
      from += oiPageSize
    ) {
      const to =
        from + oiPageSize - 1;

      const { data, error } =
        await supabase
          .from("oi_activity")
          .select(`
            id,
            snapshot_id,
            strike,
            ce_ltp,
            ce_oi,
            ce_oi_chg,
            ce_vol,
            ce_signal,
            pe_ltp,
            pe_oi,
            pe_oi_chg,
            pe_vol,
            pe_signal
          `)
          .in(
            "snapshot_id",
            idChunk
          )
          .order("snapshot_id", {
            ascending: true,
          })
          .order("strike", {
            ascending: true,
          })
          .order("id", {
            ascending: true,
          })
          .range(from, to);

      if (error) {
        throw new Error(
          `Supabase OI-activity query failed for symbol ${normalizedSymbol}, range ${startDate} to ${endDate}: ${error.message}`
        );
      }

      if (
        !data ||
        data.length === 0
      ) {
        break;
      }

      for (
        const rawRow of data as any[]
      ) {
        const snapshotId = String(
          rawRow.snapshot_id
        );

        const parent =
          snapshotById.get(snapshotId);

        if (!parent) {
          continue;
        }

        allRows.push({
          id: String(rawRow.id),
          snapshot_id: snapshotId,
          trading_date:
            parent.trading_date,
          trading_time:
            parent.trading_time,
          symbol: parent.symbol,
          expiry: parent.expiry,
          strike:
            Number(rawRow.strike) || 0,
          ce_ltp:
            Number(rawRow.ce_ltp) || 0,
          ce_oi:
            Number(rawRow.ce_oi) || 0,
          ce_oi_chg:
            Number(rawRow.ce_oi_chg) ||
            0,
          ce_vol:
            Number(rawRow.ce_vol) || 0,
          ce_signal: String(
            rawRow.ce_signal ?? ""
          ),
          pe_ltp:
            Number(rawRow.pe_ltp) || 0,
          pe_oi:
            Number(rawRow.pe_oi) || 0,
          pe_oi_chg:
            Number(rawRow.pe_oi_chg) ||
            0,
          pe_vol:
            Number(rawRow.pe_vol) || 0,
          pe_signal: String(
            rawRow.pe_signal ?? ""
          ),
        });
      }

      if (
        allRows.length > maxRows
      ) {
        throw new SupabaseHistoryPaginationCappedError(
          maxRows,
          normalizedSymbol,
          startDate,
          endDate,
          `Supabase OI-activity range query for symbol ${normalizedSymbol} in range ${startDate} to ${endDate} exceeded ${maxRows} rows.`
        );
      }

      if (
        data.length < oiPageSize
      ) {
        break;
      }
    }
  }

  allRows.sort((a, b) => {
    if (
      a.trading_date !== b.trading_date
    ) {
      return a.trading_date.localeCompare(
        b.trading_date
      );
    }

    if (
      a.trading_time !== b.trading_time
    ) {
      return a.trading_time.localeCompare(
        b.trading_time
      );
    }

    if (a.expiry !== b.expiry) {
      return a.expiry.localeCompare(
        b.expiry
      );
    }

    if (a.strike !== b.strike) {
      return a.strike - b.strike;
    }

    return String(
      a.id ?? ""
    ).localeCompare(
      String(b.id ?? ""),
      undefined,
      {
        numeric: true,
        sensitivity: "base",
      }
    );
  });

  return allRows;
}
export async function getSupabaseOptionHistoryRange(
  symbol: string,
  startDate: string,
  endDate: string,
  expiry?: string
): Promise<SupabaseOptionChainHistoryRow[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error(
      "Supabase read query failed: Supabase is not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)."
    );
  }

  const normalizedSymbol = symbol.trim().toUpperCase();
  const normalizedExpiry = expiry?.trim();
  const pageSize = 1000;
  const maxRows = 15000;
  const maxPages = maxRows / pageSize;
  const allRows: SupabaseOptionChainHistoryRow[] = [];

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("option_chain_snapshots")
      .select(
        "id, trading_date, trading_time, symbol, expiry, spot_price, pcr, max_pain, atm_strike, total_ce_oi, total_pe_oi, total_ce_oi_chg, total_pe_oi_chg, total_ce_vol, total_pe_vol, max_ce_oi_strike, max_pe_oi_strike, support_levels, resistance_levels"
      )
      .eq("symbol", normalizedSymbol)
      .gte("trading_date", startDate)
      .lte("trading_date", endDate);

    if (normalizedExpiry) {
      query = query.eq("expiry", normalizedExpiry);
    }

    const { data, error } = await query
      .order("trading_date", { ascending: true })
      .order("trading_time", { ascending: true })
      .order("expiry", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(
        `Supabase option-chain query failed for symbol ${normalizedSymbol} in range ${startDate} to ${endDate} on page ${page + 1}: ${error.message}`
      );
    }

    if (!data || data.length === 0) {
      break;
    }

    allRows.push(...(data as SupabaseOptionChainHistoryRow[]));

    if (data.length < pageSize) {
      break;
    }

    if (page === maxPages - 1 && data.length === pageSize) {
      let probeQuery = supabase
        .from("option_chain_snapshots")
        .select("id")
        .eq("symbol", normalizedSymbol)
        .gte("trading_date", startDate)
        .lte("trading_date", endDate);

      if (normalizedExpiry) {
        probeQuery = probeQuery.eq("expiry", normalizedExpiry);
      }

      const { data: probeData, error: probeError } = await probeQuery
        .order("trading_date", { ascending: true })
        .order("trading_time", { ascending: true })
        .order("expiry", { ascending: true })
        .order("id", { ascending: true })
        .range(maxRows, maxRows);

      if (probeError) {
        throw new Error(
          `Supabase option-chain query failed for symbol ${normalizedSymbol} in range ${startDate} to ${endDate} on page ${maxPages + 1} (probe): ${probeError.message}`
        );
      }

      if (probeData && probeData.length > 0) {
        throw new SupabaseHistoryPaginationCappedError(
          maxRows,
          normalizedSymbol,
          startDate,
          endDate,
          `Supabase option-chain range query for symbol ${normalizedSymbol} in range ${startDate} to ${endDate} was capped at ${maxRows} rows.`
        );
      }
    }
  }

  return allRows;
}
export async function getSupabaseMarketHistoryRange(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<SupabaseMarketSnapshotRow[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error(
      `Supabase read query failed: Supabase is not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).`
    );
  }

  const pageSize = 1000;
  const maxRows = 15000;
  const maxPages = maxRows / pageSize;
  const allRows: SupabaseMarketSnapshotRow[] = [];

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("market_snapshots")
      .select("id, trading_date, trading_time, symbol, exchange, open, high, low, close, ltp, prev_close, change_val, change_pct, volume, vwap")
      .eq("symbol", symbol)
      .gte("trading_date", startDate)
      .lte("trading_date", endDate)
      .order("trading_date", { ascending: true })
      .order("trading_time", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(
        `Supabase query failed for symbol ${symbol} in range ${startDate} to ${endDate} on page ${page + 1}: ${error.message}`
      );
    }

    if (!data || data.length === 0) {
      break;
    }

    allRows.push(...(data as SupabaseMarketSnapshotRow[]));

    if (data.length < pageSize) {
      break;
    }

    if (page === maxPages - 1 && data.length === pageSize) {
      // Execute a single-row probe query at index maxRows (the 15001st row)
      const { data: probeData, error: probeError } = await supabase
        .from("market_snapshots")
        .select("id")
        .eq("symbol", symbol)
        .gte("trading_date", startDate)
        .lte("trading_date", endDate)
        .order("trading_date", { ascending: true })
        .order("trading_time", { ascending: true })
        .order("id", { ascending: true })
        .range(maxRows, maxRows);

      if (probeError) {
        throw new Error(
          `Supabase query failed for symbol ${symbol} in range ${startDate} to ${endDate} on page ${maxPages + 1} (probe): ${probeError.message}`
        );
      }

      if (probeData && probeData.length > 0) {
        throw new SupabaseHistoryPaginationCappedError(
          maxRows,
          symbol,
          startDate,
          endDate
        );
      }
    }
  }

  return allRows;
}
