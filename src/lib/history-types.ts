// ─── Shared Historical Data Types (Phase 2B-A1) ───────────────────────────────
// Strict, frontend-only type definitions that mirror the ACTUAL Phase 2A history
// API contracts (commit ddb92ac). Raw row types keep the backend snake_case field
// names verbatim — page-specific adapters (later phases) are responsible for any
// camelCase mapping, JSON parsing, or derived fields.
//
// These types NEVER invent data the backend does not store: there is no IV,
// delta, theta, time value, buildup, or candle field here.

/** Data lineage reported by the backend via the `X-Data-Source` header. */
export type HistoricalDataSource = "supabase" | "sqlite" | "mixed";

/** Supported downsampling intervals (minutes) accepted by every history API. */
export type HistoryInterval = 1 | 3 | 5 | 15 | 30 | 60;

/**
 * Parsed lineage metadata derived from response headers
 * (`X-Data-Source`, `X-Requested-Start-Date`, `X-Requested-End-Date`,
 * `X-Actual-Dates`). Values are null when a header is absent.
 */
export interface HistoryMetadata {
  source: HistoricalDataSource | null;
  requestedStartDate: string | null;
  requestedEndDate: string | null;
  /** Sorted list of trading dates actually present in the returned data. */
  actualDates: string[];
}

/**
 * Generic success envelope loosely mirroring the backend JSON body. The backend
 * always returns `success: true` plus `interval` and `data`, and echoes either a
 * single `date` or a `startDate`/`endDate` pair. Endpoint-specific extras
 * (`symbol`, `symbols`, `sources`, `expiry`) are optional.
 */
export interface HistorySuccessResponse<TData> {
  success: true;
  interval: HistoryInterval;
  data: TData;
  date?: string;
  startDate?: string;
  endDate?: string;
  symbol?: string;
  symbols?: string[];
  sources?: Record<string, HistoricalDataSource>;
  expiry?: string;
}

/** Backend error envelope (HTTP 4xx/5xx). */
export interface HistoryErrorResponse {
  success: false;
  error: string;
}

export type HistoryResponse<TData> =
  | HistorySuccessResponse<TData>
  | HistoryErrorResponse;

// ─── Raw row types (snake_case — matches backend exactly) ─────────────────────

/** `/api/market-history` — one intraday snapshot row per symbol. */
export interface MarketHistoryRow {
  /** SQLite integer id or Supabase id (may be string/UUID). */
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

/**
 * `/api/option-history` — option-chain SUMMARY snapshot row (aggregates only).
 * `support_levels` / `resistance_levels` are stored as raw JSON strings and must
 * remain strings here; a page adapter parses them when needed.
 */
export interface OptionSummaryHistoryRow {
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
  /** Raw JSON string — parse in a page adapter, never trust as pre-parsed. */
  support_levels: string;
  /** Raw JSON string — parse in a page adapter, never trust as pre-parsed. */
  resistance_levels: string;
}

/**
 * `/api/oi-history` — per-strike OI activity row.
 * `snapshot_id` may be a SQLite integer or a Supabase string/UUID.
 */
export interface OiActivityHistoryRow {
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

/** `/api/breadth-history` — market breadth snapshot row. */
export interface MarketBreadthHistoryRow {
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

/** `/api/sector-history` — sector strength snapshot row. */
export interface SectorStrengthHistoryRow {
  id?: number | string;
  timestamp: number;
  trading_date: string;
  trading_time: string;
  symbol: string;
  name: string;
  price: number;
  change_pct: number;
}

// ─── Per-domain `data` payload shapes ─────────────────────────────────────────

/** market-history returns `data` keyed by symbol. */
export type MarketHistoryData = Record<string, MarketHistoryRow[]>;
export type OptionSummaryHistoryData = OptionSummaryHistoryRow[];
export type OiActivityHistoryData = OiActivityHistoryRow[];
export type MarketBreadthHistoryData = MarketBreadthHistoryRow[];
export type SectorStrengthHistoryData = SectorStrengthHistoryRow[];

/**
 * Normalized result the query layer resolves to: typed `data` plus parsed
 * lineage `meta`, the resolved `interval`, and any range identifiers echoed by
 * the backend. `sources` is present only for market-history (per-symbol lineage).
 */
export interface HistoryResult<TData> {
  data: TData;
  meta: HistoryMetadata;
  interval: HistoryInterval;
  date?: string;
  startDate?: string;
  endDate?: string;
  sources?: Record<string, HistoricalDataSource>;
}
