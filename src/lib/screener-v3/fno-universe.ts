// Canonical NSE stock-F&O universe helpers (PURE — operate on a parsed universe).
// No IO. The server accessor lives in instrument-master.server.ts.
// Query-time helpers REVALIDATE expiry against a reference time so a cached
// universe never returns an expired contract as currently valid.
import type {
  FnoInstrumentUniverse,
  FnoUnderlyingInstrument,
  FuturesContract,
  OptionContract,
} from "./instrument-types.ts";
import { istDateStr, istMinutesOfDay, isExpiryContractCurrent, isFinitePositiveTs } from "./ist-time.ts";

/** NSE-only normalization: accept plain or `.NS`; reject `.BO`/free-form (null). */
export function normalizeNseSymbolKey(symbol: string): string | null {
  const raw = (symbol ?? "").trim().toUpperCase();
  if (!raw) return null;
  if (raw.endsWith(".BO")) return null; // BSE explicitly rejected
  const base = raw.replace(/\.NS$/i, "").trim();
  if (!base || base.includes(".")) return null;
  // Real NSE symbols use letters, digits, `&`, `-` (e.g. M&M, BAJAJ-AUTO).
  if (!/^[A-Z0-9&-]+$/.test(base)) return null;
  return base;
}

function assertNowMs(nowMs: number | undefined): number {
  const now = nowMs ?? Date.now();
  if (!isFinitePositiveTs(now)) throw new Error("fno-universe: nowMs must be a finite positive timestamp");
  return now;
}

function currentFilter(nowMs?: number): (expiryDateIst: string) => boolean {
  const now = assertNowMs(nowMs);
  const dateIst = istDateStr(now);
  const minute = istMinutesOfDay(now);
  return (expiryDateIst: string) => isExpiryContractCurrent(expiryDateIst, dateIst, minute);
}

/**
 * Structural presence in the PARSED universe (does not re-check "current at
 * nowMs"). This is NOT the same as being currently listed for trading — use
 * `isListedFnoUnderlying` for that. Kept distinct on purpose.
 */
export function findUnderlying(
  universe: FnoInstrumentUniverse,
  symbol: string,
): FnoUnderlyingInstrument | null {
  const key = normalizeNseSymbolKey(symbol);
  return key ? (universe.bySymbol[key] ?? null) : null;
}

/** Structural parsed presence only (see findUnderlying doc). */
export function isParsedFnoUnderlying(universe: FnoInstrumentUniverse, symbol: string): boolean {
  return findUnderlying(universe, symbol) !== null;
}
/** @deprecated ambiguous name — alias of {@link isParsedFnoUnderlying} (structural, not current-listed). */
export const isFnoUnderlying = isParsedFnoUnderlying;

/** A spot mapping is COHERENT only when every resolved-state field agrees. */
export function isCoherentResolvedSpot(u: FnoUnderlyingInstrument): boolean {
  return (
    u.spotMappingStatus === "resolved" &&
    u.spotResolved === true &&
    typeof u.spotInstrumentKey === "string" &&
    u.spotInstrumentKey.length > 0 &&
    typeof u.spotTradingSymbol === "string" &&
    u.spotTradingSymbol.trim().length > 0
  );
}

/**
 * Usable spot key — returned ONLY when the mapping is coherently resolved.
 * Guards against contradictory manually-built objects (resolved+null key, etc.).
 */
export function resolveSpotInstrumentKey(
  universe: FnoInstrumentUniverse,
  symbol: string,
): string | null {
  const u = findUnderlying(universe, symbol);
  if (!u || !isCoherentResolvedSpot(u)) return null;
  return u.spotInstrumentKey;
}

export function resolveNearestFuture(
  universe: FnoInstrumentUniverse,
  symbol: string,
  opts: { nowMs?: number } = {},
): FuturesContract | null {
  const u = findUnderlying(universe, symbol);
  if (!u) return null;
  const isCurrent = currentFilter(opts.nowMs);
  return u.futures.find((f) => isCurrent(f.expiryDateIst)) ?? null;
}

export function listFuturesExpiries(
  universe: FnoInstrumentUniverse,
  symbol: string,
  opts: { nowMs?: number } = {},
): number[] {
  const u = findUnderlying(universe, symbol);
  if (!u) return [];
  const isCurrent = currentFilter(opts.nowMs);
  return [...new Set(u.futures.filter((f) => isCurrent(f.expiryDateIst)).map((f) => f.expiry))].sort(
    (a, b) => a - b,
  );
}

export function listOptionExpiries(
  universe: FnoInstrumentUniverse,
  symbol: string,
  opts: { nowMs?: number } = {},
): number[] {
  const u = findUnderlying(universe, symbol);
  if (!u) return [];
  const isCurrent = currentFilter(opts.nowMs);
  return [...new Set(u.options.filter((o) => isCurrent(o.expiryDateIst)).map((o) => o.expiry))].sort(
    (a, b) => a - b,
  );
}

export function resolveOptionsForExpiry(
  universe: FnoInstrumentUniverse,
  symbol: string,
  expiryMs: number,
  opts: { nowMs?: number } = {},
): OptionContract[] {
  const u = findUnderlying(universe, symbol);
  if (!u) return [];
  const isCurrent = currentFilter(opts.nowMs);
  return u.options
    .filter((o) => o.expiry === expiryMs && isCurrent(o.expiryDateIst))
    .sort((a, b) => a.strike - b.strike || a.optionType.localeCompare(b.optionType));
}

/** Strikes where BOTH a CE and a PE exist at the exact same strike. */
export function pairedStrikes(contracts: OptionContract[]): number[] {
  const ce = new Set(contracts.filter((o) => o.optionType === "CE").map((o) => o.strike));
  const pe = new Set(contracts.filter((o) => o.optionType === "PE").map((o) => o.strike));
  return [...ce].filter((s) => pe.has(s)).sort((a, b) => a - b);
}

// ── Eligibility tiers (distinct meanings; not one boolean) ──────────────────
export interface MappingStatus {
  symbol: string;
  listed: boolean; // current near-month future exists
  fullyMapped: boolean; // + resolved spot + resolvable equity record + >=1 current option expiry
  optionStructureReady: boolean; // + >=1 SAME-STRIKE CE/PE pair in the nearest option expiry
  nearestFutureExpiry: number | null;
  nearestOptionExpiry: number | null;
  ceAvailable: boolean; // any CE in nearest expiry
  peAvailable: boolean; // any PE in nearest expiry
  distinctStrikes: number;
  pairedStrikeCount: number; // same-strike CE/PE pairs in nearest expiry
  pairedStrikes: number[];
  spotMappingStatus: FnoUnderlyingInstrument["spotMappingStatus"];
  reasons: string[];
}

export function getMappingStatus(
  universe: FnoInstrumentUniverse,
  symbol: string,
  opts: { nowMs?: number } = {},
): MappingStatus | null {
  const u = findUnderlying(universe, symbol);
  if (!u) return null;
  const isCurrent = currentFilter(opts.nowMs);
  const reasons: string[] = [];

  const nearFut = u.futures.find((f) => isCurrent(f.expiryDateIst)) ?? null;
  const listed = nearFut !== null;
  if (!listed) reasons.push("no current near-month future");

  const optExpiries = [
    ...new Set(u.options.filter((o) => isCurrent(o.expiryDateIst)).map((o) => o.expiry)),
  ].sort((a, b) => a - b);
  const nearestOptionExpiry = optExpiries[0] ?? null;

  // Spot must be COHERENTLY resolved (status/flag/key/trading-symbol all agree).
  const spotOk = isCoherentResolvedSpot(u);
  if (!u.spotResolved || u.spotMappingStatus !== "resolved") {
    reasons.push(`spot mapping not resolved (${u.spotMappingStatus})`);
  } else if (u.spotInstrumentKey === null || u.spotInstrumentKey.length === 0) {
    reasons.push("resolved status but missing spot instrument key");
  } else if (u.spotTradingSymbol === null || u.spotTradingSymbol.trim().length === 0) {
    reasons.push("resolved spot key but empty equity trading symbol");
  }
  if (nearestOptionExpiry === null) reasons.push("no current option expiry");

  const fullyMapped = listed && spotOk && nearestOptionExpiry !== null;

  let ceAvailable = false;
  let peAvailable = false;
  let distinctStrikes = 0;
  let paired: number[] = [];
  if (nearestOptionExpiry !== null) {
    const contracts = u.options.filter((o) => o.expiry === nearestOptionExpiry);
    ceAvailable = contracts.some((o) => o.optionType === "CE");
    peAvailable = contracts.some((o) => o.optionType === "PE");
    distinctStrikes = new Set(contracts.map((o) => o.strike)).size;
    paired = pairedStrikes(contracts);
  }
  if (!ceAvailable) reasons.push("no CE contract in nearest option expiry");
  if (!peAvailable) reasons.push("no PE contract in nearest option expiry");
  if (paired.length === 0) reasons.push("no same-strike CE/PE pair in nearest option expiry");

  // Readiness REQUIRES at least one genuine same-strike pair (conflict spot -> false).
  const optionStructureReady = fullyMapped && paired.length >= 1;

  return {
    symbol: u.symbol,
    listed,
    fullyMapped,
    optionStructureReady,
    nearestFutureExpiry: nearFut?.expiry ?? null,
    nearestOptionExpiry,
    ceAvailable,
    peAvailable,
    distinctStrikes,
    pairedStrikeCount: paired.length,
    pairedStrikes: paired,
    spotMappingStatus: u.spotMappingStatus,
    reasons,
  };
}

export function isListedFnoUnderlying(u: FnoInstrumentUniverse, s: string, o: { nowMs?: number } = {}): boolean {
  return getMappingStatus(u, s, o)?.listed ?? false;
}
export function isFullyMappedFnoUnderlying(u: FnoInstrumentUniverse, s: string, o: { nowMs?: number } = {}): boolean {
  return getMappingStatus(u, s, o)?.fullyMapped ?? false;
}
export function isOptionStructureReady(u: FnoInstrumentUniverse, s: string, o: { nowMs?: number } = {}): boolean {
  return getMappingStatus(u, s, o)?.optionStructureReady ?? false;
}

// ── ATM resolver ────────────────────────────────────────────────────────────
export interface AtmOptionSlice {
  symbol: string;
  expiry: number;
  expiryDateIst: string;
  spot: number;
  atmStrike: number;
  strikes: number[]; // selected window (ATM ± nearby), sorted asc
  calls: OptionContract[];
  puts: OptionContract[];
  atmCeAvailable: boolean; // CE exists AT the ATM strike
  atmPeAvailable: boolean; // PE exists AT the ATM strike
  atmBothAvailable: boolean; // CE AND PE both at the SAME ATM strike
  pairedStrikesInWindow: number[]; // strikes in window with both CE & PE
  anyPairedStrikeInWindow: boolean;
}

const MAX_NEARBY = 50;

/**
 * Resolve ATM + nearby strikes from REAL strikes of a CURRENT expiry. Never
 * fabricates a strike. `nearby` is finite/non-negative/integer/bounded. An
 * explicit `expiryMs` must be one of the real current option expiries.
 * ATM both-availability means a genuine SAME-STRIKE CE/PE pair at the ATM.
 */
export function resolveAtmContracts(
  universe: FnoInstrumentUniverse,
  symbol: string,
  spotPrice: number,
  opts: { expiryMs?: number; nearby?: number; nowMs?: number } = {},
): AtmOptionSlice | null {
  const u = findUnderlying(universe, symbol);
  if (!u) return null;
  if (!Number.isFinite(spotPrice) || spotPrice <= 0) return null;

  const isCurrent = currentFilter(opts.nowMs);
  const currentExpiries = [
    ...new Set(u.options.filter((o) => isCurrent(o.expiryDateIst)).map((o) => o.expiry)),
  ].sort((a, b) => a - b);
  if (currentExpiries.length === 0) return null;

  let expiry: number;
  if (opts.expiryMs !== undefined) {
    if (!currentExpiries.includes(opts.expiryMs)) return null; // explicit expiry must be real+current
    expiry = opts.expiryMs;
  } else {
    expiry = currentExpiries[0];
  }

  const contracts = u.options.filter((o) => o.expiry === expiry);
  if (contracts.length === 0) return null;

  const strikes = [...new Set(contracts.map((o) => o.strike))].sort((a, b) => a - b);
  if (strikes.length === 0) return null;

  let nearby = opts.nearby ?? 3;
  if (!Number.isFinite(nearby)) nearby = 3;
  nearby = Math.max(0, Math.min(MAX_NEARBY, Math.floor(nearby)));

  // Mathematically nearest strike; deterministic tie-break to the lower strike.
  let atmStrike = strikes[0];
  let bestDist = Math.abs(strikes[0] - spotPrice);
  for (const s of strikes) {
    const d = Math.abs(s - spotPrice);
    if (d < bestDist || (d === bestDist && s < atmStrike)) {
      bestDist = d;
      atmStrike = s;
    }
  }

  const atmIdx = strikes.indexOf(atmStrike);
  const lo = Math.max(0, atmIdx - nearby);
  const hi = Math.min(strikes.length - 1, atmIdx + nearby);
  const windowStrikes = strikes.slice(lo, hi + 1);
  const windowSet = new Set(windowStrikes);

  const inWindow = contracts.filter((o) => windowSet.has(o.strike));
  const calls = inWindow.filter((o) => o.optionType === "CE").sort((a, b) => a.strike - b.strike);
  const puts = inWindow.filter((o) => o.optionType === "PE").sort((a, b) => a.strike - b.strike);

  const atmCeAvailable = calls.some((o) => o.strike === atmStrike);
  const atmPeAvailable = puts.some((o) => o.strike === atmStrike);
  const paired = pairedStrikes(inWindow);

  return {
    symbol: u.symbol,
    expiry,
    expiryDateIst: istDateStr(expiry),
    spot: spotPrice,
    atmStrike,
    strikes: windowStrikes,
    calls,
    puts,
    atmCeAvailable,
    atmPeAvailable,
    atmBothAvailable: atmCeAvailable && atmPeAvailable, // same-strike pair at ATM
    pairedStrikesInWindow: paired,
    anyPairedStrikeInWindow: paired.length > 0,
  };
}
