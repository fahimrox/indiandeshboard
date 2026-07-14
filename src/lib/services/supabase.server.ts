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

