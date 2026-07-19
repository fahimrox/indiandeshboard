// PURE parser: raw Upstox NSE instrument records -> stock-F&O universe.
// No IO, no node imports — fully unit-testable and deterministic.
//
// Conflict policy (real-data-only, never guess):
//  - identical duplicate rows (same instrument key AND every field) are collapsed
//  - a single instrument key with INCONSISTENT rows is quarantined (removed)
//  - >1 distinct instrument key at the same coordinate (expiry|FUT or
//    expiry|strike|type) is a coordinate conflict — ALL involved contracts are
//    quarantined (we never pick one by key ordering)
//  - quarantined/rejected rows can never contribute a spot key
//  - NSE_EQ keys with inconsistent rows are quarantined and cannot resolve a spot
import { istDateStr, istMinutesOfDay, isExpiryContractCurrent, isFinitePositiveTs } from "./ist-time.ts";
import {
  EXCLUDED_INDEX_SYMBOLS,
  NSE_EQ_KEY_RE,
  type FnoInstrumentUniverse,
  type FnoUnderlyingInstrument,
  type FuturesContract,
  type OptionContract,
  type SpotMappingStatus,
  type UpstoxInstrumentRecord,
} from "./instrument-types.ts";

function isRecordObject(r: unknown): r is UpstoxInstrumentRecord {
  return typeof r === "object" && r !== null && !Array.isArray(r);
}
function normSym(s: string | undefined): string {
  return (s ?? "").trim().toUpperCase();
}
function cleanKey(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}
function isStockFoRow(r: UpstoxInstrumentRecord): boolean {
  if (r.segment !== "NSE_FO") return false;
  if (r.underlying_type !== "EQUITY") return false;
  const u = normSym(r.underlying_symbol);
  if (!u || EXCLUDED_INDEX_SYMBOLS.has(u)) return false;
  return true;
}
/** Finite positive integer epoch ms. */
function isValidExpiryInt(ms: unknown): ms is number {
  return typeof ms === "number" && Number.isInteger(ms) && ms > 0;
}
/** Finite positive integer lot size. */
function isValidLotInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}
/** Finite positive strike (NSE strikes may be decimal, e.g. 0.5-step). */
function isValidStrike(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

export interface ParseOptions {
  nowMs?: number; // reference time controlling current-contract validity
  fetchedAt?: number; // actual IO fetch time (defaults to nowMs)
}

interface Cand<T> {
  c: T;
  underlyingKey: string | null;
}
interface SymbolBucket {
  futByKey: Map<string, Cand<FuturesContract>[]>;
  optByKey: Map<string, Cand<OptionContract>[]>;
}
function emptyBucket(): SymbolBucket {
  return { futByKey: new Map(), optByKey: new Map() };
}

function futEqual(a: FuturesContract, b: FuturesContract): boolean {
  return a.expiry === b.expiry && a.lotSize === b.lotSize && a.tradingSymbol === b.tradingSymbol && a.weekly === b.weekly && a.exchangeToken === b.exchangeToken;
}
function optEqual(a: OptionContract, b: OptionContract): boolean {
  return a.expiry === b.expiry && a.strike === b.strike && a.optionType === b.optionType && a.lotSize === b.lotSize && a.tradingSymbol === b.tradingSymbol;
}
function eqRecEqual(a: UpstoxInstrumentRecord, b: UpstoxInstrumentRecord): boolean {
  return (a.name ?? "") === (b.name ?? "") && (a.trading_symbol ?? "") === (b.trading_symbol ?? "") && (a.isin ?? "") === (b.isin ?? "");
}

interface ResolveResult<T> {
  accepted: Cand<T>[];
  dupCollapsed: number;
  sameKeyConflicts: number;
  coordinateConflicts: number;
}

/**
 * Two-stage conflict resolution:
 *  1. per instrument-key: collapse identical, quarantine inconsistent
 *  2. per coordinate: quarantine ALL contracts when >1 distinct key claims it
 */
function resolveContracts<T extends { instrumentKey: string }>(
  byKey: Map<string, Cand<T>[]>,
  coordOf: (c: T) => string,
  eq: (a: Cand<T>, b: Cand<T>) => boolean,
): ResolveResult<T> {
  let dupCollapsed = 0;
  let sameKeyConflicts = 0;
  let coordinateConflicts = 0;

  const keyAccepted: Cand<T>[] = [];
  for (const [, rows] of byKey) {
    if (rows.length === 1) {
      keyAccepted.push(rows[0]);
      continue;
    }
    if (rows.every((r) => eq(r, rows[0]))) {
      keyAccepted.push(rows[0]);
      dupCollapsed += rows.length - 1;
    } else {
      sameKeyConflicts++; // quarantine: accept none for this key
    }
  }

  const byCoord = new Map<string, Cand<T>[]>();
  for (const cand of keyAccepted) {
    const co = coordOf(cand.c);
    const arr = byCoord.get(co) ?? [];
    arr.push(cand);
    byCoord.set(co, arr);
  }
  const accepted: Cand<T>[] = [];
  for (const [, group] of byCoord) {
    const distinctKeys = new Set(group.map((g) => g.c.instrumentKey));
    if (distinctKeys.size > 1) coordinateConflicts++; // quarantine all in this coord
    else accepted.push(...group);
  }
  return { accepted, dupCollapsed, sameKeyConflicts, coordinateConflicts };
}

export function parseUpstoxInstruments(
  records: UpstoxInstrumentRecord[],
  options: ParseOptions = {},
): FnoInstrumentUniverse {
  const nowMs = options.nowMs ?? Date.now();
  const fetchedAt = options.fetchedAt ?? nowMs;
  if (!isFinitePositiveTs(nowMs)) throw new Error("parseUpstoxInstruments: nowMs must be a finite positive timestamp");
  if (!isFinitePositiveTs(fetchedAt)) throw new Error("parseUpstoxInstruments: fetchedAt must be a finite positive timestamp");

  const effectiveDateIst = istDateStr(nowMs);
  const effectiveMinuteOfDay = istMinutesOfDay(nowMs);
  const isCurrent = (expiryDateIst: string) => isExpiryContractCurrent(expiryDateIst, effectiveDateIst, effectiveMinuteOfDay);

  const rawLength = Array.isArray(records) ? records.length : 0;
  let malformedRecordsSkipped = 0;
  let totalNseEquity = 0;
  let totalStockFutures = 0;
  let totalStockOptions = 0;
  let invalidRecordsSkipped = 0;
  let equityDuplicatesCollapsed = 0;

  // ── Equity pass: dedupe identical, quarantine inconsistent duplicate keys ──
  const eqByKey = new Map<string, UpstoxInstrumentRecord>();
  const eqConflictKeys = new Set<string>();
  for (const r of Array.isArray(records) ? records : []) {
    if (!isRecordObject(r)) {
      malformedRecordsSkipped++;
      continue;
    }
    if (r.segment !== "NSE_EQ") continue;
    totalNseEquity++;
    const key = cleanKey(r.instrument_key);
    if (!key) {
      invalidRecordsSkipped++;
      continue;
    }
    const existing = eqByKey.get(key);
    if (!existing) eqByKey.set(key, r);
    else if (eqConflictKeys.has(key)) continue; // already quarantined
    else if (eqRecEqual(existing, r)) equityDuplicatesCollapsed++;
    else eqConflictKeys.add(key); // inconsistent equity rows -> quarantine key
  }

  // ── Derivative pass: collect candidates keyed by instrument key ────────────
  const bySym = new Map<string, SymbolBucket>();
  const bucket = (sym: string) => bySym.get(sym) ?? bySym.set(sym, emptyBucket()).get(sym)!;

  for (const r of Array.isArray(records) ? records : []) {
    if (!isRecordObject(r)) continue; // already counted in equity pass
    if (!isStockFoRow(r)) continue;
    const sym = normSym(r.underlying_symbol);
    const key = cleanKey(r.instrument_key);
    const underlyingKey = cleanKey(r.underlying_key);

    if (r.instrument_type === "FUT") {
      if (!key || !isValidExpiryInt(r.expiry) || !isValidLotInt(r.lot_size)) {
        invalidRecordsSkipped++;
        continue;
      }
      totalStockFutures++;
      const c: FuturesContract = {
        instrumentKey: key,
        tradingSymbol: (r.trading_symbol ?? "").trim(),
        expiry: r.expiry,
        expiryDateIst: istDateStr(r.expiry),
        lotSize: r.lot_size,
        weekly: r.weekly === true, // strict: only boolean true
        exchangeToken: (r.exchange_token ?? "").trim(),
      };
      const b = bucket(sym);
      const arr = b.futByKey.get(key) ?? [];
      arr.push({ c, underlyingKey });
      b.futByKey.set(key, arr);
    } else if (r.instrument_type === "CE" || r.instrument_type === "PE") {
      if (!key || !isValidExpiryInt(r.expiry) || !isValidStrike(r.strike_price) || !isValidLotInt(r.lot_size)) {
        invalidRecordsSkipped++;
        continue;
      }
      totalStockOptions++;
      const c: OptionContract = {
        instrumentKey: key,
        tradingSymbol: (r.trading_symbol ?? "").trim(),
        expiry: r.expiry,
        expiryDateIst: istDateStr(r.expiry),
        strike: r.strike_price,
        optionType: r.instrument_type,
        lotSize: r.lot_size,
      };
      const b = bucket(sym);
      const arr = b.optByKey.get(key) ?? [];
      arr.push({ c, underlyingKey });
      b.optByKey.set(key, arr);
    }
  }

  const underlyings: FnoUnderlyingInstrument[] = [];
  let totalActiveStockOptions = 0;
  const counts = {
    fullyResolvedMappings: 0,
    optionStructureReadyUnderlyings: 0,
    spotResolvedCount: 0,
    spotMissingKeyCount: 0,
    spotInvalidKeyCount: 0,
    spotUnresolvedRecordCount: 0,
    spotConflictingCount: 0,
    duplicateContractsCollapsed: 0,
    sameKeyConflicts: 0,
    coordinateConflicts: 0,
  };

  for (const [sym, b] of bySym) {
    const futRes = resolveContracts(
      b.futByKey,
      (c) => `${c.expiry}|FUT`,
      (a, z) => futEqual(a.c, z.c) && a.underlyingKey === z.underlyingKey,
    );
    const optRes = resolveContracts(
      b.optByKey,
      (c) => `${c.expiry}|${c.strike}|${c.optionType}`,
      (a, z) => optEqual(a.c, z.c) && a.underlyingKey === z.underlyingKey,
    );
    counts.duplicateContractsCollapsed += futRes.dupCollapsed + optRes.dupCollapsed;
    counts.sameKeyConflicts += futRes.sameKeyConflicts + optRes.sameKeyConflicts;
    counts.coordinateConflicts += futRes.coordinateConflicts + optRes.coordinateConflicts;

    const futures = futRes.accepted
      .map((a) => a.c)
      .filter((f) => isCurrent(f.expiryDateIst))
      .sort((a, c) => a.expiry - c.expiry || a.instrumentKey.localeCompare(c.instrumentKey));
    const nearMonthFutures = futures[0] ?? null;
    if (!nearMonthFutures) continue; // no current, conflict-free future -> not current-futures

    const optionsAll = optRes.accepted
      .map((a) => a.c)
      .filter((o) => isCurrent(o.expiryDateIst))
      .sort((a, c) => a.expiry - c.expiry || a.strike - c.strike || a.optionType.localeCompare(c.optionType));
    totalActiveStockOptions += optionsAll.length;

    // Spot keys collected ONLY from accepted (conflict-free) + current contracts.
    const spotKeySet = new Set<string>();
    for (const a of futRes.accepted) if (a.underlyingKey && isCurrent(a.c.expiryDateIst)) spotKeySet.add(a.underlyingKey);
    for (const a of optRes.accepted) if (a.underlyingKey && isCurrent(a.c.expiryDateIst)) spotKeySet.add(a.underlyingKey);

    const rawKeys = [...spotKeySet];
    const validSyntax = rawKeys.filter((k) => NSE_EQ_KEY_RE.test(k));
    const distinctValid = [...new Set(validSyntax)].sort();
    let spotMappingStatus: SpotMappingStatus;
    let spotInstrumentKey: string | null = null;
    let eq: UpstoxInstrumentRecord | undefined;
    const diagnosticSpotKey = distinctValid[0] ?? rawKeys.slice().sort()[0] ?? null;
    const conflictingSpotKeys = distinctValid.length > 1 ? distinctValid : [];

    if (rawKeys.length === 0) spotMappingStatus = "missing_key";
    else if (distinctValid.length === 0) spotMappingStatus = "invalid_key";
    else if (distinctValid.length > 1) spotMappingStatus = "conflicting_keys";
    else {
      const k = distinctValid[0];
      if (eqConflictKeys.has(k)) {
        spotMappingStatus = "unresolved_record"; // equity-side conflict -> not usable
      } else {
        eq = eqByKey.get(k);
        if (!eq) spotMappingStatus = "unresolved_record";
        else {
          spotMappingStatus = "resolved";
          spotInstrumentKey = k;
        }
      }
    }
    const spotResolved = spotMappingStatus === "resolved";
    const spotTradingSymbol = spotResolved ? ((eq?.trading_symbol ?? "").trim() || null) : null;

    switch (spotMappingStatus) {
      case "resolved": counts.spotResolvedCount++; break;
      case "missing_key": counts.spotMissingKeyCount++; break;
      case "invalid_key": counts.spotInvalidKeyCount++; break;
      case "unresolved_record": counts.spotUnresolvedRecordCount++; break;
      case "conflicting_keys": counts.spotConflictingCount++; break;
    }

    // Snapshot mapping/structure counts (query-time recomputed in fno-universe).
    const nearestOptExpiry = optionsAll[0]?.expiry;
    const nearestOpts = nearestOptExpiry ? optionsAll.filter((o) => o.expiry === nearestOptExpiry) : [];
    const ceStrikes = new Set(nearestOpts.filter((o) => o.optionType === "CE").map((o) => o.strike));
    const peStrikes = new Set(nearestOpts.filter((o) => o.optionType === "PE").map((o) => o.strike));
    const pairedCount = [...ceStrikes].filter((s) => peStrikes.has(s)).length;
    const fullyResolved = spotResolved && spotTradingSymbol !== null && nearestOptExpiry !== undefined;
    if (fullyResolved) counts.fullyResolvedMappings++;
    if (fullyResolved && pairedCount >= 1) counts.optionStructureReadyUnderlyings++;

    underlyings.push({
      symbol: sym,
      normalizedSymbol: sym,
      name: eq?.name ?? sym,
      spotInstrumentKey,
      spotMappingStatus,
      spotResolved,
      diagnosticSpotKey,
      conflictingSpotKeys,
      spotTradingSymbol,
      isin: eq?.isin ?? (spotInstrumentKey ? spotInstrumentKey.split("|")[1] : null),
      futures,
      options: optionsAll,
      nearMonthFutures,
      futuresExpiries: [...new Set(futures.map((f) => f.expiry))].sort((a, c) => a - c),
      optionExpiries: [...new Set(optionsAll.map((o) => o.expiry))].sort((a, c) => a - c),
      lotSize: nearMonthFutures.lotSize || null,
    });
  }

  underlyings.sort((a, b) => a.symbol.localeCompare(b.symbol));
  const bySymbol: Record<string, FnoUnderlyingInstrument> = Object.create(null);
  for (const u of underlyings) bySymbol[u.normalizedSymbol] = u;

  const conflictingDuplicateContracts = counts.sameKeyConflicts + counts.coordinateConflicts;

  return {
    underlyings,
    bySymbol,
    metadata: {
      source: "upstox",
      fetchedAt,
      effectiveDateIst,
      effectiveMinuteOfDay,
      totalRawInstruments: rawLength,
      totalNseEquity,
      totalStockFutures,
      totalStockOptions,
      totalActiveStockOptions,
      currentFuturesUnderlyings: underlyings.length,
      fullyResolvedMappings: counts.fullyResolvedMappings,
      optionStructureReadyUnderlyings: counts.optionStructureReadyUnderlyings,
      spotResolvedCount: counts.spotResolvedCount,
      spotMissingKeyCount: counts.spotMissingKeyCount,
      spotInvalidKeyCount: counts.spotInvalidKeyCount,
      spotUnresolvedRecordCount: counts.spotUnresolvedRecordCount,
      spotConflictingCount: counts.spotConflictingCount,
      invalidRecordsSkipped,
      malformedRecordsSkipped,
      duplicateContractsCollapsed: counts.duplicateContractsCollapsed,
      conflictingDuplicateContracts,
      sameKeyConflicts: counts.sameKeyConflicts,
      coordinateConflicts: counts.coordinateConflicts,
      equityDuplicatesCollapsed,
      equityConflictingKeys: eqConflictKeys.size,
      status: underlyings.length > 0 ? "available" : "unavailable",
      reason: underlyings.length > 0 ? undefined : "No current stock-F&O underlyings parsed",
    },
  };
}
