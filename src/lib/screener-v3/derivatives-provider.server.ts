// Screener V3 Phase 2B Part 2 — READ-ONLY Upstox derivatives provider adapter.
//
// Boundary-only: this module turns three verified read-only Upstox endpoints
// into truthful, normalized Part 1 snapshots. It contains NO cache, NO batch
// orchestration across Screener rows, NO fallback, NO retry, NO rate limiting,
// NO persistence, NO scheduler wiring, NO ScreenerV3Row/API/UI integration, and
// NO order calls. Those belong to later parts.
//
// Design invariants (see the task spec):
//   - Nothing network-touching runs at import time.
//   - The access token is resolved at REQUEST time via an injectable resolver
//     and is NEVER placed in a reason, thrown error, or log. No console output.
//   - Response objects are matched by their `instrument_token`, never by the
//     (trading-symbol-style) response object key.
//   - Every numeric field flows through the Part 1 pure normalizers so "missing"
//     is null (never 0) and NaN/Infinity/strings never leak in as numbers.
//   - `DataResult.status` describes TRANSPORT/availability; `sessionState`
//     describes the MARKET SNAPSHOT. They are kept strictly separate — the
//     adapter never emits a `stale` DataResult just because a snapshot's
//     sessionState is "eod"/"stale" (cache-driven stale is a Part 3 concern).
//   - Futures previous-OI / OI-change are NOT modelled (verified unavailable).
//   - ATM strike selection is NOT recomputed here; the caller's SelectedAtmPair
//     is authoritative. No strike/instrument is ever fabricated.
import {
  ok,
  unavailable,
  invalidInput,
  providerError,
  isFailure,
  propagateFailure,
  type DataResult,
} from "./types.ts";
import {
  normalizeNullableFiniteNumber,
  normalizeOptionIvPct,
  deriveOptionOpenInterestChange,
  normalizeDepthLevel,
  classifyDerivativesSessionState,
  type SelectedFuture,
  type SelectedAtmPair,
} from "./derivatives-selectors.ts";
import type {
  FuturesMarketSnapshot,
  OptionMarketSnapshot,
  DerivativesDepthLevel,
} from "./derivatives-types.ts";
import type { OptionContract, OptionType } from "./instrument-types.ts";
import { normalizeNseSymbolKey } from "./fno-universe.ts";
import { isCanonicalDateStr, isFinitePositiveTs } from "./ist-time.ts";

const SOURCE = "derivatives-provider";
const UPSTOX_API_BASE = "https://api.upstox.com";

/** One batched full-market-quote request carries at most this many unique keys. */
export const MAX_FUTURES_BATCH = 500;
/** One batched option-greek request carries at most this many unique keys. */
export const MAX_OPTION_GREEK_BATCH = 50;

// ── Injectable dependencies ──────────────────────────────────────────────────
export interface DerivativesProviderDependencies {
  /** HTTP transport (injected in tests; defaults to global fetch). */
  fetchImpl: typeof fetch;
  /** Access-token resolver, called at REQUEST time (never at import). */
  getAccessToken: () => string | null | undefined;
}

/**
 * Default dependencies. Neither field performs IO or reads credentials until
 * actually invoked, so importing this module is side-effect free.
 */
const defaultDependencies: DerivativesProviderDependencies = {
  fetchImpl: (input, init) => globalThis.fetch(input, init),
  getAccessToken: () => process.env.UPSTOX_ACCESS_TOKEN,
};

// ── Provider surface ─────────────────────────────────────────────────────────
export interface UpstoxDerivativesProvider {
  /**
   * Batched near-month futures full-market-quote enrichment. Returns a map keyed
   * by the REQUESTED instrumentKey. Empty valid input → empty map, no HTTP call.
   */
  fetchFuturesQuotes(input: {
    futures: readonly SelectedFuture[];
    referenceMs: number;
  }): Promise<ReadonlyMap<string, DataResult<FuturesMarketSnapshot>>>;

  /**
   * ATM CE/PE enrichment from the option chain at the caller-selected strike.
   * CE and PE are resolved independently; a leg not selected/returned is
   * `unavailable` (not a provider failure).
   */
  fetchAtmOptionPair(input: {
    underlyingInstrumentKey: string;
    selection: SelectedAtmPair;
    referenceMs: number;
  }): Promise<{
    call: DataResult<OptionMarketSnapshot>;
    put: DataResult<OptionMarketSnapshot>;
  }>;

  /**
   * Batched Greek-V3 enrichment. Returns a map keyed by the requested
   * instrumentKey. Empty valid input → empty map, no HTTP call. Fields not
   * supplied by Greek V3 (prev OI, OI change, bid/ask) are always null.
   *
   * Each request carries the underlying stock symbol explicitly (an
   * OptionContract has no underlying symbol), so the resulting
   * OptionMarketSnapshot.symbol is always the underlying (e.g. "RELIANCE"),
   * never an option trading symbol.
   */
  fetchOptionGreeks(input: {
    contracts: readonly OptionGreekRequest[];
    referenceMs: number;
  }): Promise<ReadonlyMap<string, DataResult<OptionMarketSnapshot>>>;
}

/**
 * Greek-V3 request identity. Part-2-local pairing of an option contract with
 * its explicit, validated underlying stock symbol so the normalized snapshot's
 * `symbol` is truthfully the underlying — not the option's trading symbol.
 */
export interface OptionGreekRequest {
  /** Underlying NSE stock symbol (e.g. "RELIANCE"); normalized + validated. */
  symbol: string;
  contract: OptionContract;
}

// ── Raw provider shapes (all fields untrusted → typed as unknown) ────────────
interface UpstoxEnvelope {
  status?: unknown;
  data?: unknown;
}

interface RawOhlc {
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
}

interface RawDepth {
  buy?: unknown;
  sell?: unknown;
}

interface RawQuoteEntry {
  instrument_token?: unknown;
  last_price?: unknown;
  ohlc?: unknown;
  volume?: unknown;
  average_price?: unknown;
  oi?: unknown;
  oi_day_high?: unknown;
  oi_day_low?: unknown;
  net_change?: unknown;
  total_buy_quantity?: unknown;
  total_sell_quantity?: unknown;
  depth?: unknown;
  timestamp?: unknown;
  last_trade_time?: unknown;
}

interface RawChainMarketData {
  ltp?: unknown;
  close_price?: unknown;
  volume?: unknown;
  oi?: unknown;
  prev_oi?: unknown;
  bid_price?: unknown;
  bid_qty?: unknown;
  ask_price?: unknown;
  ask_qty?: unknown;
}

interface RawChainGreeks {
  iv?: unknown;
  delta?: unknown;
  gamma?: unknown;
  theta?: unknown;
  vega?: unknown;
  pop?: unknown;
}

interface RawChainSide {
  instrument_key?: unknown;
  market_data?: unknown;
  option_greeks?: unknown;
}

interface RawChainRow {
  strike_price?: unknown;
  call_options?: unknown;
  put_options?: unknown;
}

interface RawGreekEntry {
  instrument_token?: unknown;
  last_price?: unknown;
  cp?: unknown;
  volume?: unknown;
  oi?: unknown;
  iv?: unknown;
  delta?: unknown;
  gamma?: unknown;
  theta?: unknown;
  vega?: unknown;
  pop?: unknown;
  timestamp?: unknown;
}

// ── Pure numeric normalization (Part-2-local, non-negative) ──────────────────
/**
 * Non-negative finite number, else null. Wraps the Part 1 finite-number helper
 * (unchanged) and additionally rejects negatives for fields where a negative
 * value is physically impossible (prices, volumes, OI, quantities, gamma, vega,
 * POP). Zero is preserved. Signed fields (netChange, delta, theta, OI change)
 * must continue to use `normalizeNullableFiniteNumber` directly.
 */
function normalizeNonNegativeNumber(value: unknown): number | null {
  const n = normalizeNullableFiniteNumber(value);
  return n !== null && n >= 0 ? n : null;
}

// ── Pure timestamp parsing ────────────────────────────────────────────────────
/** Plausible epoch-ms window [2000-01-01, 2100-01-01) — rejects epoch seconds. */
const MIN_PLAUSIBLE_MS = Date.UTC(2000, 0, 1);
const MAX_PLAUSIBLE_MS = Date.UTC(2100, 0, 1);
/** Timezone-qualified ISO-8601: date+time ending in `Z` or an explicit offset. */
const ISO_TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

function inPlausibleMsRange(n: number): boolean {
  return n >= MIN_PLAUSIBLE_MS && n < MAX_PLAUSIBLE_MS;
}

/**
 * Parse a provider timestamp into epoch ms, or null — strictly. Timestamps are
 * the ONE place numeric-string parsing is allowed (a verified provider field
 * requires it). Accepted:
 *   - a finite number of epoch MILLISECONDS in the plausible range
 *   - an all-digits string of epoch MILLISECONDS in the plausible range
 *   - a timezone-qualified ISO-8601 string (must end in `Z` or an offset)
 * Rejected: empty/whitespace, arbitrary date-like text, timezone-less ISO,
 * epoch SECONDS (out of the ms range), zero/negative, NaN/Infinity, malformed.
 * `Date.parse` is only ever applied to a string that already matches ISO_TZ_RE.
 * Deterministic: no clock read.
 */
export function parseUpstoxTimestampMs(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && inPlausibleMsRange(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return Number.isFinite(n) && inPlausibleMsRange(n) ? n : null;
    }
    if (!ISO_TZ_RE.test(trimmed)) return null;
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) && inPlausibleMsRange(parsed) ? parsed : null;
  }
  return null;
}

// ── Depth normalization (≤5 valid levels, provider order preserved) ──────────
function normalizeDepthSide(raw: unknown): DerivativesDepthLevel[] {
  if (!Array.isArray(raw)) return [];
  const out: DerivativesDepthLevel[] = [];
  for (const lvl of raw) {
    if (!lvl || typeof lvl !== "object") continue;
    const level = lvl as { price?: unknown; quantity?: unknown; orders?: unknown };
    const norm = normalizeDepthLevel({
      price: level.price,
      quantity: level.quantity,
      orders: level.orders,
    });
    if (norm === null) continue; // invalid level discarded, never fabricated
    out.push(norm);
    if (out.length >= 5) break;
  }
  return out;
}

// ── Normalizers (verified fields only) ───────────────────────────────────────
function normalizeFuture(
  entry: RawQuoteEntry,
  selected: SelectedFuture,
  referenceMs: number,
): FuturesMarketSnapshot {
  const ohlc =
    entry.ohlc && typeof entry.ohlc === "object" ? (entry.ohlc as RawOhlc) : {};
  const depth =
    entry.depth && typeof entry.depth === "object" ? (entry.depth as RawDepth) : {};
  const buyDepth = normalizeDepthSide(depth.buy);
  const sellDepth = normalizeDepthSide(depth.sell);
  const lastTradeTimeMs = parseUpstoxTimestampMs(entry.last_trade_time);
  return {
    // Identity comes from the caller's SelectedFuture — never re-derived here.
    symbol: selected.symbol,
    tradingSymbol: selected.tradingSymbol,
    instrumentKey: selected.instrumentKey,
    expiryMs: selected.expiryMs,
    expiryDateIst: selected.expiryDateIst,
    lotSize: selected.lotSize,
    // Prices / volumes / OI / quantities cannot be negative → non-negative.
    lastPrice: normalizeNonNegativeNumber(entry.last_price),
    open: normalizeNonNegativeNumber(ohlc.open),
    high: normalizeNonNegativeNumber(ohlc.high),
    low: normalizeNonNegativeNumber(ohlc.low),
    close: normalizeNonNegativeNumber(ohlc.close),
    volume: normalizeNonNegativeNumber(entry.volume),
    averagePrice: normalizeNonNegativeNumber(entry.average_price),
    openInterest: normalizeNonNegativeNumber(entry.oi),
    openInterestDayHigh: normalizeNonNegativeNumber(entry.oi_day_high),
    openInterestDayLow: normalizeNonNegativeNumber(entry.oi_day_low),
    // netChange is legitimately signed.
    netChange: normalizeNullableFiniteNumber(entry.net_change),
    totalBuyQuantity: normalizeNonNegativeNumber(entry.total_buy_quantity),
    totalSellQuantity: normalizeNonNegativeNumber(entry.total_sell_quantity),
    // Best bid/ask are the first VALID depth level prices, or null.
    bestBid: buyDepth.length > 0 ? buyDepth[0].price : null,
    bestAsk: sellDepth.length > 0 ? sellDepth[0].price : null,
    buyDepth,
    sellDepth,
    // Provider publish time is parsed but NEVER used for freshness.
    providerTimestampMs: parseUpstoxTimestampMs(entry.timestamp),
    lastTradeTimeMs,
    receivedAtMs: referenceMs,
    // Freshness derives ONLY from referenceMs + the truthful last-trade time.
    sessionState: classifyDerivativesSessionState({ referenceMs, lastTradeTimeMs }),
    source: "upstox_full_market_quote",
  };
}

/**
 * Verify a caller-selected ATM leg is internally consistent BEFORE it is
 * trusted or normalized. Returns an error reason (→ invalid_input) or null.
 * Never fabricates a corrected identity.
 */
function validateSelectedOptionLeg(
  contract: OptionContract,
  expectedType: OptionType,
  selection: SelectedAtmPair,
): string | null {
  if (contract.optionType !== expectedType) {
    return `selected ${expectedType} leg is not a ${expectedType} contract`;
  }
  if (contract.strike !== selection.atmStrike) {
    return `selected ${expectedType} strike does not match the selected ATM strike`;
  }
  if (contract.expiry !== selection.expiryMs) {
    return `selected ${expectedType} expiry does not match the selection expiry`;
  }
  if (contract.expiryDateIst !== selection.expiryDateIst) {
    return `selected ${expectedType} expiry date does not match the selection expiry date`;
  }
  if (typeof contract.instrumentKey !== "string" || contract.instrumentKey.trim() === "") {
    return `selected ${expectedType} instrument key is blank`;
  }
  return null;
}

function normalizeChainOption(
  side: RawChainSide,
  contract: OptionContract,
  underlyingSymbol: string,
  referenceMs: number,
): OptionMarketSnapshot {
  const md =
    side.market_data && typeof side.market_data === "object"
      ? (side.market_data as RawChainMarketData)
      : {};
  const greeks =
    side.option_greeks && typeof side.option_greeks === "object"
      ? (side.option_greeks as RawChainGreeks)
      : {};
  const openInterest = normalizeNonNegativeNumber(md.oi);
  const previousOpenInterest = normalizeNonNegativeNumber(md.prev_oi);
  return {
    symbol: underlyingSymbol,
    optionType: contract.optionType,
    strike: contract.strike,
    expiryMs: contract.expiry,
    expiryDateIst: contract.expiryDateIst,
    instrumentKey: contract.instrumentKey,
    lastPrice: normalizeNonNegativeNumber(md.ltp),
    closePrice: normalizeNonNegativeNumber(md.close_price),
    volume: normalizeNonNegativeNumber(md.volume),
    openInterest,
    previousOpenInterest,
    openInterestChange: deriveOptionOpenInterestChange(openInterest, previousOpenInterest),
    bidPrice: normalizeNonNegativeNumber(md.bid_price),
    bidQuantity: normalizeNonNegativeNumber(md.bid_qty),
    askPrice: normalizeNonNegativeNumber(md.ask_price),
    askQuantity: normalizeNonNegativeNumber(md.ask_qty),
    // Option-chain IV is already percent → pass through as canonical percent.
    impliedVolatilityPct: normalizeOptionIvPct(greeks.iv, "upstox_option_chain"),
    // delta/theta are legitimately signed; gamma/vega/POP are non-negative.
    delta: normalizeNullableFiniteNumber(greeks.delta),
    gamma: normalizeNonNegativeNumber(greeks.gamma),
    theta: normalizeNullableFiniteNumber(greeks.theta),
    vega: normalizeNonNegativeNumber(greeks.vega),
    probabilityOfProfit: normalizeNonNegativeNumber(greeks.pop),
    // No verified truthful per-leg trade timestamp → null, and sessionState
    // stays "unknown". Local fetch/reference time is NEVER market-data time.
    providerTimestampMs: null,
    receivedAtMs: referenceMs,
    sessionState: "unknown",
    source: "upstox_option_chain",
  };
}

function normalizeGreekOption(
  entry: RawGreekEntry,
  contract: OptionContract,
  underlyingSymbol: string,
  referenceMs: number,
): OptionMarketSnapshot {
  return {
    // symbol is the explicit, validated UNDERLYING stock symbol (e.g.
    // "RELIANCE") supplied by the caller — never the option trading symbol.
    symbol: underlyingSymbol,
    optionType: contract.optionType,
    strike: contract.strike,
    expiryMs: contract.expiry,
    expiryDateIst: contract.expiryDateIst,
    instrumentKey: contract.instrumentKey,
    lastPrice: normalizeNonNegativeNumber(entry.last_price),
    closePrice: normalizeNonNegativeNumber(entry.cp),
    volume: normalizeNonNegativeNumber(entry.volume),
    openInterest: normalizeNonNegativeNumber(entry.oi),
    // Greek V3 does not supply these — always null, never fabricated.
    previousOpenInterest: null,
    openInterestChange: null,
    bidPrice: null,
    bidQuantity: null,
    askPrice: null,
    askQuantity: null,
    // Greek V3 IV is decimal (0.26) → scaled to canonical percent (26).
    impliedVolatilityPct: normalizeOptionIvPct(entry.iv, "upstox_option_greek_v3"),
    // delta/theta are legitimately signed; gamma/vega/POP are non-negative.
    delta: normalizeNullableFiniteNumber(entry.delta),
    gamma: normalizeNonNegativeNumber(entry.gamma),
    theta: normalizeNullableFiniteNumber(entry.theta),
    vega: normalizeNonNegativeNumber(entry.vega),
    // POP only if directly returned; otherwise null.
    probabilityOfProfit: normalizeNonNegativeNumber(entry.pop),
    // Preserve a real provider timestamp only if present/parseable.
    providerTimestampMs: parseUpstoxTimestampMs(entry.timestamp),
    receivedAtMs: referenceMs,
    // No truthful last-trade time exists → unknown.
    sessionState: "unknown",
    source: "upstox_option_greek_v3",
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────
export function createUpstoxDerivativesProvider(
  deps: Partial<DerivativesProviderDependencies> = {},
): UpstoxDerivativesProvider {
  const fetchImpl = deps.fetchImpl ?? defaultDependencies.fetchImpl;
  const getAccessToken = deps.getAccessToken ?? defaultDependencies.getAccessToken;

  /**
   * Private read-only GET. Resolves the token at call time, sends it only as a
   * Bearer header, and returns a truthful DataResult. It NEVER puts the token in
   * a reason, never logs, never retries, and never returns a raw thrown error.
   */
  async function requestJson(opts: {
    path: string;
    endpointName: string;
    query?: Record<string, string>;
  }): Promise<DataResult<UpstoxEnvelope>> {
    const rawToken = getAccessToken();
    const token = typeof rawToken === "string" ? rawToken.trim() : "";
    if (token === "") {
      return providerError(`${opts.endpointName}: missing Upstox access token`, {
        source: SOURCE,
      });
    }

    const url = new URL(UPSTOX_API_BASE + opts.path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
    }

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
    } catch {
      // Deliberately opaque: never surface the thrown error (may embed context).
      return providerError(`${opts.endpointName}: network request failed`, {
        source: SOURCE,
      });
    }

    if (!response.ok) {
      return providerError(
        `${opts.endpointName}: provider responded HTTP ${response.status}`,
        { source: SOURCE },
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return providerError(`${opts.endpointName}: invalid JSON in provider response`, {
        source: SOURCE,
      });
    }

    if (!json || typeof json !== "object") {
      return providerError(`${opts.endpointName}: unexpected provider response shape`, {
        source: SOURCE,
      });
    }

    const env = json as UpstoxEnvelope;
    if (env.status === "error") {
      return providerError(`${opts.endpointName}: provider returned an error envelope`, {
        source: SOURCE,
      });
    }
    return ok(env, { source: SOURCE });
  }

  /** Build an instrument_token → entry lookup; first valid entry wins. */
  function indexByToken<T extends { instrument_token?: unknown }>(
    data: unknown,
  ): Map<string, T> {
    const byToken = new Map<string, T>();
    if (!data || typeof data !== "object") return byToken;
    for (const raw of Object.values(data as Record<string, unknown>)) {
      if (!raw || typeof raw !== "object") continue;
      const token = (raw as T).instrument_token;
      if (typeof token !== "string" || token.trim() === "") continue;
      if (byToken.has(token)) continue; // never overwrite a valid first match
      byToken.set(token, raw as T);
    }
    return byToken;
  }

  async function fetchFuturesQuotes(input: {
    futures: readonly SelectedFuture[];
    referenceMs: number;
  }): Promise<ReadonlyMap<string, DataResult<FuturesMarketSnapshot>>> {
    const { futures, referenceMs } = input;
    const result = new Map<string, DataResult<FuturesMarketSnapshot>>();

    // Dedupe by instrumentKey (first-seen order). A blank/whitespace-only key is
    // never sent, but the caller is told truthfully via a single invalid_input
    // recorded under the empty-string key (no requested item disappears).
    const seen = new Set<string>();
    const valid: Array<{ key: string; future: SelectedFuture }> = [];
    for (const f of futures) {
      const key = typeof f?.instrumentKey === "string" ? f.instrumentKey.trim() : "";
      if (key === "") {
        if (!result.has("")) {
          result.set("", invalidInput("blank/invalid futures instrument key", { source: SOURCE }));
        }
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      valid.push({ key, future: f });
    }

    // Invalid caller reference → invalid_input for every fetchable key, no HTTP.
    if (!isFinitePositiveTs(referenceMs)) {
      for (const { key } of valid) {
        result.set(key, invalidInput("referenceMs must be a finite positive epoch ms", { source: SOURCE }));
      }
      return result;
    }

    if (valid.length === 0) return result; // nothing fetchable, no HTTP

    if (valid.length > MAX_FUTURES_BATCH) {
      for (const { key } of valid) {
        result.set(
          key,
          invalidInput(`futures batch exceeds ${MAX_FUTURES_BATCH} unique keys`, { source: SOURCE }),
        );
      }
      return result; // no HTTP call
    }

    const env = await requestJson({
      path: "/v2/market-quote/quotes",
      endpointName: "market-quote/quotes",
      query: { instrument_key: valid.map((v) => v.key).join(",") },
    });
    if (isFailure(env)) {
      for (const { key } of valid) result.set(key, propagateFailure(env));
      return result;
    }

    const byToken = indexByToken<RawQuoteEntry>(env.value.data);
    for (const { key, future } of valid) {
      const entry = byToken.get(key);
      if (!entry) {
        result.set(
          key,
          unavailable(`no full-market-quote entry for ${key}`, {
            source: SOURCE,
            timestamp: referenceMs,
          }),
        );
        continue;
      }
      result.set(
        key,
        ok(normalizeFuture(entry, future, referenceMs), {
          source: SOURCE,
          timestamp: referenceMs,
        }),
      );
    }
    return result;
  }

  function resolveChainLeg(
    contract: OptionContract | null,
    identityError: string | null,
    rowFound: boolean,
    side: unknown,
    optionType: OptionType,
    atmStrike: number,
    underlyingSymbol: string,
    referenceMs: number,
  ): DataResult<OptionMarketSnapshot> {
    if (contract === null) {
      // Leg was not selected — a truthful absence, NOT a provider failure.
      return unavailable(`no ${optionType} leg selected at ATM strike`, {
        source: SOURCE,
        timestamp: referenceMs,
      });
    }
    if (identityError !== null) {
      // Caller-selected identity is internally inconsistent — never trusted.
      return invalidInput(identityError, { source: SOURCE });
    }
    if (!rowFound) {
      return unavailable(`no option row at strike ${atmStrike}`, {
        source: SOURCE,
        timestamp: referenceMs,
      });
    }
    if (!side || typeof side !== "object") {
      return unavailable(`no ${optionType} leg returned at strike ${atmStrike}`, {
        source: SOURCE,
        timestamp: referenceMs,
      });
    }
    const s = side as RawChainSide;
    const returnedKey = typeof s.instrument_key === "string" ? s.instrument_key : "";
    if (returnedKey !== contract.instrumentKey) {
      // Provider returned a different contract than selected — do not trust it.
      return unavailable(`${optionType} instrument key mismatch at ATM strike`, {
        source: SOURCE,
        timestamp: referenceMs,
      });
    }
    return ok(normalizeChainOption(s, contract, underlyingSymbol, referenceMs), {
      source: SOURCE,
      timestamp: referenceMs,
    });
  }

  async function fetchAtmOptionPair(input: {
    underlyingInstrumentKey: string;
    selection: SelectedAtmPair;
    referenceMs: number;
  }): Promise<{
    call: DataResult<OptionMarketSnapshot>;
    put: DataResult<OptionMarketSnapshot>;
  }> {
    const { underlyingInstrumentKey, selection, referenceMs } = input;

    const bothInvalid = (reason: string) => {
      const r = invalidInput(reason, { source: SOURCE });
      return { call: r, put: r };
    };

    if (
      typeof underlyingInstrumentKey !== "string" ||
      underlyingInstrumentKey.trim() === ""
    ) {
      return bothInvalid("underlyingInstrumentKey must be a non-empty string");
    }
    if (!isFinitePositiveTs(referenceMs)) {
      return bothInvalid("referenceMs must be a finite positive epoch ms");
    }
    if (!isCanonicalDateStr(selection.expiryDateIst)) {
      return bothInvalid(`invalid selection.expiryDateIst: "${selection.expiryDateIst}"`);
    }
    if (!Number.isFinite(selection.atmStrike) || selection.atmStrike <= 0) {
      return bothInvalid("selection.atmStrike must be a finite positive number");
    }

    // Validate each selected leg's identity independently (invalid_input, not
    // trusted). A leg is fetchable only if it was selected AND self-consistent.
    const callError = selection.call === null ? null : validateSelectedOptionLeg(selection.call, "CE", selection);
    const putError = selection.put === null ? null : validateSelectedOptionLeg(selection.put, "PE", selection);
    const callFetchable = selection.call !== null && callError === null;
    const putFetchable = selection.put !== null && putError === null;

    // Nothing fetchable (both legs unselected and/or inconsistent) — no HTTP.
    if (!callFetchable && !putFetchable) {
      return {
        call: resolveChainLeg(selection.call, callError, false, undefined, "CE", selection.atmStrike, selection.symbol, referenceMs),
        put: resolveChainLeg(selection.put, putError, false, undefined, "PE", selection.atmStrike, selection.symbol, referenceMs),
      };
    }

    const env = await requestJson({
      path: "/v2/option/chain",
      endpointName: "option/chain",
      query: {
        instrument_key: underlyingInstrumentKey,
        expiry_date: selection.expiryDateIst,
      },
    });
    if (isFailure(env)) {
      // Fetchable legs carry the transport failure; non-fetchable legs keep
      // their truthful not-selected / invalid_input state.
      return {
        call: callFetchable
          ? propagateFailure(env)
          : resolveChainLeg(selection.call, callError, false, undefined, "CE", selection.atmStrike, selection.symbol, referenceMs),
        put: putFetchable
          ? propagateFailure(env)
          : resolveChainLeg(selection.put, putError, false, undefined, "PE", selection.atmStrike, selection.symbol, referenceMs),
      };
    }

    const rows = Array.isArray(env.value.data) ? (env.value.data as unknown[]) : [];
    // Match the EXACT caller-selected strike; never recompute ATM.
    const row = rows.find(
      (r): r is RawChainRow =>
        !!r &&
        typeof r === "object" &&
        normalizeNullableFiniteNumber((r as RawChainRow).strike_price) ===
          selection.atmStrike,
    );
    const rowFound = row !== undefined;

    return {
      call: resolveChainLeg(
        selection.call,
        callError,
        rowFound,
        row?.call_options,
        "CE",
        selection.atmStrike,
        selection.symbol,
        referenceMs,
      ),
      put: resolveChainLeg(
        selection.put,
        putError,
        rowFound,
        row?.put_options,
        "PE",
        selection.atmStrike,
        selection.symbol,
        referenceMs,
      ),
    };
  }

  async function fetchOptionGreeks(input: {
    contracts: readonly OptionGreekRequest[];
    referenceMs: number;
  }): Promise<ReadonlyMap<string, DataResult<OptionMarketSnapshot>>> {
    const { contracts, referenceMs } = input;
    const result = new Map<string, DataResult<OptionMarketSnapshot>>();

    // Dedupe by contract.instrumentKey (first-seen order). Blank key → single
    // invalid_input under "". Invalid/blank underlying symbol → invalid_input
    // under the contract key (never derived from the option trading symbol).
    const seen = new Set<string>();
    const valid: Array<{ key: string; symbol: string; contract: OptionContract }> = [];
    for (const req of contracts) {
      const contract = req?.contract;
      const key = typeof contract?.instrumentKey === "string" ? contract.instrumentKey.trim() : "";
      if (key === "") {
        if (!result.has("")) {
          result.set("", invalidInput("blank/invalid option instrument key", { source: SOURCE }));
        }
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      const symbol = normalizeNseSymbolKey(typeof req?.symbol === "string" ? req.symbol : "");
      if (!symbol) {
        result.set(key, invalidInput(`invalid underlying symbol for ${key}`, { source: SOURCE }));
        continue;
      }
      valid.push({ key, symbol, contract });
    }

    // Invalid caller reference → invalid_input for every fetchable key, no HTTP.
    if (!isFinitePositiveTs(referenceMs)) {
      for (const { key } of valid) {
        result.set(key, invalidInput("referenceMs must be a finite positive epoch ms", { source: SOURCE }));
      }
      return result;
    }

    if (valid.length === 0) return result; // nothing fetchable, no HTTP

    if (valid.length > MAX_OPTION_GREEK_BATCH) {
      for (const { key } of valid) {
        result.set(
          key,
          invalidInput(`option-greek batch exceeds ${MAX_OPTION_GREEK_BATCH} unique keys`, { source: SOURCE }),
        );
      }
      return result; // no HTTP call
    }

    const env = await requestJson({
      path: "/v3/market-quote/option-greek",
      endpointName: "market-quote/option-greek",
      query: { instrument_key: valid.map((v) => v.key).join(",") },
    });
    if (isFailure(env)) {
      for (const { key } of valid) result.set(key, propagateFailure(env));
      return result;
    }

    const byToken = indexByToken<RawGreekEntry>(env.value.data);
    for (const { key, symbol, contract } of valid) {
      const entry = byToken.get(key);
      if (!entry) {
        result.set(
          key,
          unavailable(`no option-greek entry for ${key}`, {
            source: SOURCE,
            timestamp: referenceMs,
          }),
        );
        continue;
      }
      result.set(
        key,
        ok(normalizeGreekOption(entry, contract, symbol, referenceMs), {
          source: SOURCE,
          timestamp: referenceMs,
        }),
      );
    }
    return result;
  }

  return { fetchFuturesQuotes, fetchAtmOptionPair, fetchOptionGreeks };
}
