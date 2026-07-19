// Screener V3 Phase 2B Part 1 — PURE derivatives selectors + normalization.
// No IO, no provider calls, no `Date.now()`, no env access, no mutable global
// state. Every completion/freshness decision is driven by an explicit caller
// `referenceMs`. Contract discovery reuses the Phase 1 universe helpers rather
// than re-implementing selection.
import {
  invalidInput,
  ok,
  propagateFailure,
  unavailable,
  isFailure,
  type DataResult,
} from "./types.ts";
import {
  normalizeNseSymbolKey,
  resolveNearestFuture,
  resolveAtmContracts,
} from "./fno-universe.ts";
import type { FnoInstrumentUniverse, OptionContract } from "./instrument-types.ts";
import { isFinitePositiveTs, istDateStr, isWithinSession } from "./ist-time.ts";
import type { DerivativesDepthLevel, DerivativesSessionState } from "./derivatives-types.ts";

const SOURCE = "derivatives-selectors";

// ── Freshness windows (explicit constants) ──────────────────────────────────
/** Max age (ms) of the last trade, during an open session, to count as "live". */
export const LIVE_FRESHNESS_MS = 5 * 60_000; // 5 minutes
/**
 * Max age (ms) of the last trade to still count as the most recent completed
 * session ("eod"). 4 days covers a normal Fri→Tue weekend gap. NOTE (Part 1
 * limitation): no NSE holiday calendar is modelled, so a long holiday gap can
 * legitimately exceed this window and be classified "stale". Documented in tests.
 */
export const MAX_EOD_AGE_MS = 4 * 24 * 60 * 60_000; // 4 days

// ── Pure numeric normalization ───────────────────────────────────────────────

/**
 * Finite number pass-through, else null. Zero and negatives are preserved.
 * Numeric strings are NOT silently converted (the verified provider schema
 * returns numbers). NaN / Infinity / null / undefined / non-numbers → null.
 */
export function normalizeNullableFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Canonical option IV in PERCENT.
 *   upstox_option_chain    — already percent (e.g. 26.0) → pass through
 *   upstox_option_greek_v3 — decimal (e.g. 0.26) → ×100
 * Zero stays zero; negative IV → null; non-finite → null.
 */
export function normalizeOptionIvPct(
  value: unknown,
  source: "upstox_option_chain" | "upstox_option_greek_v3",
): number | null {
  const v = normalizeNullableFiniteNumber(value);
  if (v === null) return null;
  if (v < 0) return null; // negative IV is never valid
  return source === "upstox_option_greek_v3" ? v * 100 : v;
}

/**
 * Option OI change = openInterest − previousOpenInterest, ONLY when both are
 * finite. Result may be positive, negative, or zero. Either missing → null.
 * Never fabricated or inferred from price/volume.
 */
export function deriveOptionOpenInterestChange(
  openInterest: number | null,
  previousOpenInterest: number | null,
): number | null {
  const oi = normalizeNullableFiniteNumber(openInterest);
  const prev = normalizeNullableFiniteNumber(previousOpenInterest);
  if (oi === null || prev === null) return null;
  return oi - prev;
}

/**
 * Pure constructor that ENFORCES the `DerivativesDepthLevel` invariant at a
 * real runtime boundary (the interface alone guarantees nothing). Returns a
 * valid level or null — never a partially-invalid level.
 *   - price and quantity must each be finite and NON-NEGATIVE (0 is valid);
 *     a missing/invalid/negative price OR quantity invalidates the whole level.
 *   - orders: finite non-negative → value; missing/invalid/negative → null.
 *   - numeric strings are NOT silently converted.
 */
export function normalizeDepthLevel(input: {
  price: unknown;
  quantity: unknown;
  orders: unknown;
}): DerivativesDepthLevel | null {
  const price = normalizeNullableFiniteNumber(input.price);
  if (price === null || price < 0) return null;
  const quantity = normalizeNullableFiniteNumber(input.quantity);
  if (quantity === null || quantity < 0) return null;
  const ordersRaw = normalizeNullableFiniteNumber(input.orders);
  const orders = ordersRaw !== null && ordersRaw >= 0 ? ordersRaw : null;
  return { price, quantity, orders };
}

// ── Session-state classification (pure; last-trade time, never response time) ─

/** IST weekday (0=Sun … 6=Sat) for the calendar day containing `ms`. */
function istWeekday(ms: number): number {
  return new Date(istDateStr(ms) + "T00:00:00Z").getUTCDay();
}

/**
 * Classify market-data freshness from the truthful last-trade time relative to
 * an explicit reference. The provider's response/publish timestamp is
 * intentionally NOT an input — only the last-trade time is trusted.
 *
 * Semantics (open-market vs closed-market are handled separately so that a
 * lagging quote during live hours is never mislabelled "eod"):
 *   - invalid reference / missing/invalid last trade / future last trade → unknown
 *   - MARKET OPEN (IST weekday, within 09:15–15:30):
 *       - same IST trading date AND age ≤ LIVE_FRESHNESS_MS → live
 *       - otherwise (prior-session trade, or same-day but not fresh)  → stale
 *   - MARKET CLOSED (weekend or weekday outside hours):
 *       - last trade within the accepted EOD window (age ≤ MAX_EOD_AGE_MS) → eod
 *       - older than that window → stale
 *
 * Part 1 limitation: no NSE holiday calendar is modelled, so the closed-market
 * EOD window is an age proxy rather than a true trading-day count; a long
 * holiday gap can therefore be classified "stale". Documented in tests.
 */
export function classifyDerivativesSessionState(input: {
  referenceMs: number;
  lastTradeTimeMs: number | null;
}): DerivativesSessionState {
  const { referenceMs, lastTradeTimeMs } = input;
  if (!isFinitePositiveTs(referenceMs)) return "unknown";
  if (lastTradeTimeMs === null || !isFinitePositiveTs(lastTradeTimeMs)) return "unknown";

  const ageMs = referenceMs - lastTradeTimeMs;
  if (ageMs < 0) return "unknown"; // last trade after reference — not truthful

  const wd = istWeekday(referenceMs);
  const marketOpen = wd >= 1 && wd <= 5 && isWithinSession(referenceMs);

  if (marketOpen) {
    // While the market is open, only a same-session, sufficiently-recent trade
    // is "live"; anything else (a prior-session trade or a same-day but lagging
    // quote) is stale — it must NOT be relabelled as an EOD snapshot.
    const sameSession = istDateStr(referenceMs) === istDateStr(lastTradeTimeMs);
    if (sameSession && ageMs <= LIVE_FRESHNESS_MS) return "live";
    return "stale";
  }

  // Market closed: a last trade from the most recent completed session (within
  // the accepted age window) is a truthful EOD snapshot; older data is stale.
  if (ageMs <= MAX_EOD_AGE_MS) return "eod";
  return "stale";
}

// ── Deterministic contract discovery (wrappers over Phase 1 universe helpers) ─

export interface SelectedFuture {
  symbol: string;
  instrumentKey: string;
  tradingSymbol: string;
  expiryMs: number;
  expiryDateIst: string;
  lotSize: number;
}

/**
 * Resolve the near-month CURRENT future for a symbol. Reuses
 * `resolveNearestFuture` (earliest non-expired at referenceMs, deterministic).
 * Never selects an expired contract; never guesses a missing future.
 */
export function selectDerivativesFuture(input: {
  universe: DataResult<FnoInstrumentUniverse>;
  symbol: string;
  referenceMs: number;
}): DataResult<SelectedFuture> {
  const { universe, symbol, referenceMs } = input;
  const key = normalizeNseSymbolKey(symbol);
  if (!key) return invalidInput(`invalid NSE symbol: "${symbol}"`, { source: SOURCE });
  if (!isFinitePositiveTs(referenceMs)) {
    return invalidInput("referenceMs must be a finite positive epoch ms", { source: SOURCE });
  }
  if (isFailure(universe)) return propagateFailure(universe);

  const fut = resolveNearestFuture(universe.value, key, { nowMs: referenceMs });
  if (!fut) {
    return unavailable(`no current near-month future for ${key}`, {
      source: SOURCE,
      timestamp: referenceMs,
    });
  }
  return ok(
    {
      symbol: key,
      instrumentKey: fut.instrumentKey,
      tradingSymbol: fut.tradingSymbol,
      expiryMs: fut.expiry,
      expiryDateIst: fut.expiryDateIst,
      lotSize: fut.lotSize,
    },
    { source: SOURCE, timestamp: referenceMs },
  );
}

export interface SelectedAtmPair {
  symbol: string;
  expiryMs: number;
  expiryDateIst: string;
  anchorPrice: number;
  atmStrike: number;
  /** CE contract at the ATM strike, or null if that leg is not listed. */
  call: OptionContract | null;
  /** PE contract at the ATM strike, or null if that leg is not listed. */
  put: OptionContract | null;
}

/**
 * Resolve the ATM CE/PE pair from REAL listed strikes at the nearest current
 * option expiry. Reuses `resolveAtmContracts` (nearest strike, lower-strike
 * tie-break). Legs are returned independently — a missing leg is null, never
 * fabricated. A finite positive anchor price is required.
 */
export function selectDerivativesAtmPair(input: {
  universe: DataResult<FnoInstrumentUniverse>;
  symbol: string;
  anchorPrice: number;
  referenceMs: number;
  expiryMs?: number;
}): DataResult<SelectedAtmPair> {
  const { universe, symbol, anchorPrice, referenceMs, expiryMs } = input;
  const key = normalizeNseSymbolKey(symbol);
  if (!key) return invalidInput(`invalid NSE symbol: "${symbol}"`, { source: SOURCE });
  if (!Number.isFinite(anchorPrice) || anchorPrice <= 0) {
    return invalidInput("anchorPrice must be a finite positive number", { source: SOURCE });
  }
  if (!isFinitePositiveTs(referenceMs)) {
    return invalidInput("referenceMs must be a finite positive epoch ms", { source: SOURCE });
  }
  if (isFailure(universe)) return propagateFailure(universe);

  const slice = resolveAtmContracts(universe.value, key, anchorPrice, {
    nowMs: referenceMs,
    nearby: 0, // ATM strike only
    ...(expiryMs !== undefined ? { expiryMs } : {}),
  });
  if (!slice) {
    return unavailable(
      `no ATM option pair for ${key} (no underlying, no current option expiry, or no listed strikes)`,
      { source: SOURCE, timestamp: referenceMs },
    );
  }

  const call = slice.calls.find((o) => o.strike === slice.atmStrike) ?? null;
  const put = slice.puts.find((o) => o.strike === slice.atmStrike) ?? null;

  return ok(
    {
      symbol: key,
      expiryMs: slice.expiry,
      expiryDateIst: slice.expiryDateIst,
      anchorPrice,
      atmStrike: slice.atmStrike,
      call,
      put,
    },
    { source: SOURCE, timestamp: referenceMs },
  );
}
