// ─── Historical Query Factories (Phase 2B-A1) ─────────────────────────────────
// Client-safe TanStack Query option factories for the Phase 2A history APIs.
// These call the existing `/api/*-history` routes via the browser `fetch()` and
// return typed data + parsed lineage metadata. They do NOT import any server-only
// module (historicalDataService.server / database.server / supabase.server) and
// never talk to Supabase directly from the browser.
//
// Behaviour contract:
//  - Query keys are deterministic and never contain `undefined`.
//  - Historical queries NEVER poll (refetchInterval + refetchOnWindowFocus off).
//  - Requests are disabled unless a valid, complete date selection is present.
//  - Invalid mixed `date` + `startDate`/`endDate` (or a half range) disables the
//    query rather than issuing a request the backend would reject.

import { queryOptions, keepPreviousData } from "@tanstack/react-query";
import type {
  HistoricalDataSource,
  HistoryInterval,
  HistoryMetadata,
  HistoryResult,
  MarketHistoryData,
  OptionSummaryHistoryData,
  OiActivityHistoryData,
  MarketBreadthHistoryData,
  SectorStrengthHistoryData,
} from "./history-types";

const STALE_TIME_MS = 5 * 60_000; // 5 minutes
const GC_TIME_MS = 30 * 60_000; // 30 minutes

const DEFAULT_MARKET_SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX", "INDIAVIX"];

/** Default request identity token used in query keys where a value is absent. */
const NONE = "-";

// ─── Date-range normalization ─────────────────────────────────────────────────

export interface HistoryRangeInput {
  /** Single trading date YYYY-MM-DD (mutually exclusive with startDate/endDate). */
  date?: string;
  /** Range start YYYY-MM-DD (requires endDate). */
  startDate?: string;
  /** Range end YYYY-MM-DD (requires startDate). */
  endDate?: string;
}

interface NormalizedRange {
  /** True when the selection is a valid, complete single-date or range request. */
  ok: boolean;
  /** URL param pairs to send (empty when !ok). */
  params: Array<[string, string]>;
  /** Stable, undefined-free fragment for query keys. */
  keyPart: string;
}

/**
 * Validates a range input the same way the backend does:
 *  - `date` and `startDate`/`endDate` are mutually exclusive
 *  - `startDate` and `endDate` must be supplied together
 *  - an empty selection is treated as incomplete (query stays disabled) rather
 *    than defaulting to "today" implicitly.
 */
function normalizeRange(input: HistoryRangeInput): NormalizedRange {
  const date = input.date?.trim() || undefined;
  const startDate = input.startDate?.trim() || undefined;
  const endDate = input.endDate?.trim() || undefined;

  // Invalid: single date combined with a range.
  if (date && (startDate || endDate)) {
    return { ok: false, params: [], keyPart: "invalid" };
  }
  // Invalid: half a range.
  if ((startDate && !endDate) || (!startDate && endDate)) {
    return { ok: false, params: [], keyPart: "invalid" };
  }
  if (date) {
    return { ok: true, params: [["date", date]], keyPart: `d:${date}` };
  }
  if (startDate && endDate) {
    return {
      ok: true,
      params: [
        ["startDate", startDate],
        ["endDate", endDate],
      ],
      keyPart: `r:${startDate}:${endDate}`,
    };
  }
  // Nothing selected → incomplete.
  return { ok: false, params: [], keyPart: NONE };
}

// ─── Header / response parsing ────────────────────────────────────────────────

function normalizeSource(raw: string | null): HistoricalDataSource | null {
  if (raw === "supabase" || raw === "sqlite" || raw === "mixed") return raw;
  return null;
}

function parseMeta(headers: Headers): HistoryMetadata {
  const actualRaw = headers.get("X-Actual-Dates");
  const actualDates = actualRaw
    ? actualRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return {
    source: normalizeSource(headers.get("X-Data-Source")),
    requestedStartDate: headers.get("X-Requested-Start-Date"),
    requestedEndDate: headers.get("X-Requested-End-Date"),
    actualDates,
  };
}

/**
 * Shared fetch helper. Sends a GET to a history endpoint, parses the JSON body
 * and the lineage headers, and preserves backend error messages. Returns a
 * normalized {@link HistoryResult}.
 */
async function fetchHistory<TData>(
  endpoint: string,
  params: Array<[string, string]>,
  fallbackInterval: HistoryInterval,
): Promise<HistoryResult<TData>> {
  const search = new URLSearchParams(params).toString();
  const url = search ? `${endpoint}?${search}` : endpoint;

  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    throw new Error(
      err instanceof Error ? `Network error: ${err.message}` : "Network error while fetching history.",
    );
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON / empty body handled below */
  }

  const bodyObj = (body ?? {}) as Record<string, unknown>;

  if (!res.ok || bodyObj.success === false || bodyObj.data === undefined) {
    const serverMsg = typeof bodyObj.error === "string" ? bodyObj.error : null;
    throw new Error(serverMsg || `History request failed (HTTP ${res.status}).`);
  }

  const meta = parseMeta(res.headers);
  const interval = (bodyObj.interval as HistoryInterval) ?? fallbackInterval;

  return {
    data: bodyObj.data as TData,
    meta,
    interval,
    date: bodyObj.date as string | undefined,
    startDate: bodyObj.startDate as string | undefined,
    endDate: bodyObj.endDate as string | undefined,
    sources: bodyObj.sources as Record<string, HistoricalDataSource> | undefined,
  };
}

// ─── Shared factory args ──────────────────────────────────────────────────────

interface BaseHistoryArgs extends HistoryRangeInput {
  interval?: HistoryInterval;
  /** Extra opt-out gate the caller controls (default true). */
  enabled?: boolean;
}

const commonQueryConfig = {
  staleTime: STALE_TIME_MS,
  gcTime: GC_TIME_MS,
  placeholderData: keepPreviousData,
  retry: 1,
  refetchInterval: false as const,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
};

// ─── Market history ───────────────────────────────────────────────────────────

export interface MarketHistoryArgs extends BaseHistoryArgs {
  /** Defaults to NIFTY, BANKNIFTY, SENSEX, INDIAVIX. */
  symbols?: string[];
}

export function marketHistoryQuery(args: MarketHistoryArgs) {
  const interval = args.interval ?? 1;
  // Single normalized list — trimmed, uppercased, empties removed, deduplicated,
  // sorted deterministically — used for BOTH the query key and the request param
  // so the cache identity always matches what is actually sent.
  const symbols = Array.from(
    new Set(
      (args.symbols?.length ? args.symbols : DEFAULT_MARKET_SYMBOLS)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ).sort();
  const symbolsCsv = symbols.join(",");
  const symbolsKey = symbolsCsv || NONE;
  const range = normalizeRange(args);
  const enabled = (args.enabled ?? true) && range.ok && symbols.length > 0;

  return queryOptions({
    queryKey: ["history", "market", symbolsKey, range.keyPart, interval] as const,
    queryFn: () =>
      fetchHistory<MarketHistoryData>(
        "/api/market-history",
        [...range.params, ["symbols", symbolsCsv], ["interval", String(interval)]],
        interval,
      ),
    enabled,
    ...commonQueryConfig,
  });
}

// ─── Option summary history ───────────────────────────────────────────────────

export interface OptionHistoryArgs extends BaseHistoryArgs {
  /** Defaults to NIFTY. */
  symbol?: string;
  expiry?: string;
}

export function optionHistoryQuery(args: OptionHistoryArgs) {
  const interval = args.interval ?? 1;
  const symbol = (args.symbol?.trim().toUpperCase() || "NIFTY");
  const expiry = args.expiry?.trim() || undefined;
  const range = normalizeRange(args);
  const enabled = (args.enabled ?? true) && range.ok;

  const params: Array<[string, string]> = [
    ...range.params,
    ["symbol", symbol],
    ["interval", String(interval)],
  ];
  if (expiry) params.push(["expiry", expiry]);

  return queryOptions({
    queryKey: ["history", "option", symbol, range.keyPart, interval, expiry ?? NONE] as const,
    queryFn: () => fetchHistory<OptionSummaryHistoryData>("/api/option-history", params, interval),
    enabled,
    ...commonQueryConfig,
  });
}

// ─── OI activity history ──────────────────────────────────────────────────────

export interface OiHistoryArgs extends BaseHistoryArgs {
  /** Defaults to NIFTY. */
  symbol?: string;
  expiry?: string;
}

export function oiHistoryQuery(args: OiHistoryArgs) {
  const interval = args.interval ?? 1;
  const symbol = (args.symbol?.trim().toUpperCase() || "NIFTY");
  const expiry = args.expiry?.trim() || undefined;
  const range = normalizeRange(args);
  const enabled = (args.enabled ?? true) && range.ok;

  const params: Array<[string, string]> = [
    ...range.params,
    ["symbol", symbol],
    ["interval", String(interval)],
  ];
  if (expiry) params.push(["expiry", expiry]);

  return queryOptions({
    queryKey: ["history", "oi", symbol, range.keyPart, interval, expiry ?? NONE] as const,
    queryFn: () => fetchHistory<OiActivityHistoryData>("/api/oi-history", params, interval),
    enabled,
    ...commonQueryConfig,
  });
}

// ─── Market breadth history ───────────────────────────────────────────────────

export type BreadthHistoryArgs = BaseHistoryArgs;

export function breadthHistoryQuery(args: BreadthHistoryArgs) {
  const interval = args.interval ?? 1;
  const range = normalizeRange(args);
  const enabled = (args.enabled ?? true) && range.ok;

  return queryOptions({
    queryKey: ["history", "breadth", range.keyPart, interval] as const,
    queryFn: () =>
      fetchHistory<MarketBreadthHistoryData>(
        "/api/breadth-history",
        [...range.params, ["interval", String(interval)]],
        interval,
      ),
    enabled,
    ...commonQueryConfig,
  });
}

// ─── Sector strength history ──────────────────────────────────────────────────

export interface SectorHistoryArgs extends BaseHistoryArgs {
  /** Optional single sector symbol filter. */
  symbol?: string;
}

export function sectorHistoryQuery(args: SectorHistoryArgs) {
  const interval = args.interval ?? 1;
  const symbol = args.symbol?.trim().toUpperCase() || undefined;
  const range = normalizeRange(args);
  const enabled = (args.enabled ?? true) && range.ok;

  const params: Array<[string, string]> = [...range.params, ["interval", String(interval)]];
  if (symbol) params.push(["symbol", symbol]);

  return queryOptions({
    queryKey: ["history", "sector", symbol ?? NONE, range.keyPart, interval] as const,
    queryFn: () =>
      fetchHistory<SectorStrengthHistoryData>("/api/sector-history", params, interval),
    enabled,
    ...commonQueryConfig,
  });
}
