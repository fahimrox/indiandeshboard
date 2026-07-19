// Screener V3 Phase 2B Part 1 — derivatives enrichment CONTRACTS (types only).
// No IO, no formulas, no provider calls. Mirrors the truthful-availability
// vocabulary of DataResult<T> (types.ts). Every provider-sourced numeric field
// is `number | null` so "missing" is NEVER coerced to 0, and every leg is a
// DataResult so unavailable/stale/invalid states stay explicit.
//
// Deliberately NOT modelled here (verified unavailable in the Part 0 spike):
//   - futures `previousOpenInterest` / futures `openInterestChange`
//     (the Upstox full-market-quote futures payload carries no previous OI).
import type { DataResult } from "./types.ts";
// Single source of truth for the CE/PE union — reused, never duplicated.
export type { OptionType } from "./instrument-types.ts";
import type { OptionType } from "./instrument-types.ts";

// ── Provenance / freshness ─────────────────────────────────────────────────

/** Which verified Upstox endpoint a normalized snapshot came from. */
export type DerivativesSource =
  | "upstox_full_market_quote"
  | "upstox_option_chain"
  | "upstox_option_greek_v3";

/**
 * Market-data freshness classification, derived from the truthful last-trade
 * time vs an explicit reference — NEVER from HTTP response time.
 *   live    — market open, same trading session, within the freshness window
 *   eod     — market closed, last trade from the most recent completed session
 *   stale   — market open but the quote is lagging / from a prior session, OR
 *             market closed and the last trade is older than the EOD window
 *   unknown — no/invalid reference, no/invalid last-trade time, or a future trade
 * See classifyDerivativesSessionState (derivatives-selectors.ts) for the rules.
 */
export type DerivativesSessionState = "live" | "eod" | "stale" | "unknown";

// ── Market depth ────────────────────────────────────────────────────────────

/**
 * One level of the order book. INVARIANT (a valid level): `price` and
 * `quantity` are finite and non-negative (0 is a valid level value); `orders`
 * is null when the provider supplies no order count. This interface does NOT
 * itself enforce those bounds — the invariant is established at runtime by the
 * pure `normalizeDepthLevel` constructor (derivatives-selectors.ts). Depth
 * levels are never fabricated.
 */
export interface DerivativesDepthLevel {
  price: number;
  quantity: number;
  orders: number | null;
}

// ── Futures snapshot ─────────────────────────────────────────────────────────

/**
 * Normalized near-month stock-futures market snapshot.
 * No previousOpenInterest / openInterestChange fields exist here on purpose:
 * the verified futures endpoint does not supply previous OI, so a truthful
 * futures OI change cannot be computed and must never be fabricated.
 */
export interface FuturesMarketSnapshot {
  symbol: string;
  tradingSymbol: string;
  instrumentKey: string;

  expiryMs: number;
  expiryDateIst: string;
  lotSize: number;

  lastPrice: number | null;

  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;

  volume: number | null;
  averagePrice: number | null;

  openInterest: number | null;
  openInterestDayHigh: number | null;
  openInterestDayLow: number | null;

  netChange: number | null;

  totalBuyQuantity: number | null;
  totalSellQuantity: number | null;

  bestBid: number | null;
  bestAsk: number | null;

  buyDepth: readonly DerivativesDepthLevel[];
  sellDepth: readonly DerivativesDepthLevel[];

  /** Provider publish time — NOT necessarily market/exchange update time. */
  providerTimestampMs: number | null;
  /** Truthful last-trade/data time for the contract (epoch ms). */
  lastTradeTimeMs: number | null;
  /** The explicit reference time this snapshot was normalized against (fetch time). */
  receivedAtMs: number;

  sessionState: DerivativesSessionState;
  source: "upstox_full_market_quote";
}

// ── Option leg snapshot ──────────────────────────────────────────────────────

/**
 * Normalized ATM/near-ATM option-leg market snapshot.
 * `openInterestChange` is populated ONLY from finite provider OI and previous
 * OI (may be positive, negative, or zero); otherwise null. IV is canonical
 * PERCENT (option-chain values pass through; Greek-V3 decimals are scaled ×100).
 * Delta/theta may be legitimately negative and are never clamped. A bid/ask of
 * exactly 0 is a real value, distinct from a missing (null) quote.
 */
export interface OptionMarketSnapshot {
  symbol: string;
  optionType: OptionType;

  strike: number;
  expiryMs: number;
  expiryDateIst: string;
  instrumentKey: string;

  lastPrice: number | null;
  closePrice: number | null;
  volume: number | null;

  openInterest: number | null;
  previousOpenInterest: number | null;
  openInterestChange: number | null;

  bidPrice: number | null;
  bidQuantity: number | null;
  askPrice: number | null;
  askQuantity: number | null;

  /** Canonical percent (e.g. 26.0), never a decimal fraction. */
  impliedVolatilityPct: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  probabilityOfProfit: number | null;

  providerTimestampMs: number | null;
  receivedAtMs: number;

  sessionState: DerivativesSessionState;
  source: "upstox_option_chain" | "upstox_option_greek_v3";
}

// ── Selection identity ───────────────────────────────────────────────────────

/**
 * Deterministic contract discovery result (identity only — no market data).
 * Resolved purely from the instrument master / universe helpers.
 */
export interface DerivativesSelection {
  futureInstrumentKey: string | null;
  futureExpiryMs: number | null;
  optionExpiryMs: number | null;
  anchorPrice: number | null;
  atmStrike: number | null;
  callInstrumentKey: string | null;
  putInstrumentKey: string | null;
  resolvedFrom: "instrument_master";
}

// ── Health ───────────────────────────────────────────────────────────────────

export type DerivativesHealthStatus = "complete" | "partial" | "degraded" | "unavailable";

export interface DerivativesHealth {
  status: DerivativesHealthStatus;
  /** available + stale legs. */
  usableLegs: number;
  /** stale-only legs. */
  staleLegs: number;
  /** failure-status legs. */
  failedLegs: number;
  /** Deterministic, deduplicated contributing reasons (future → call → put). */
  reasons: readonly string[];
}

// ── Combined enrichment (not yet attached to ScreenerV3Row) ──────────────────

export interface ScreenerV3Derivatives {
  selection: DerivativesSelection;
  future: DataResult<FuturesMarketSnapshot>;
  call: DataResult<OptionMarketSnapshot>;
  put: DataResult<OptionMarketSnapshot>;
  health: DerivativesHealth;
  /** Explicit reference time the enrichment was assembled against. */
  referenceMs: number;
}
