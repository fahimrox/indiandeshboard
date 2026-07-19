// Typed domain model for the NSE stock-F&O instrument universe (Upstox master).
import type { DataStatus } from "./types.ts";

/** Raw Upstox NSE instrument record (subset of fields we consume). */
export interface UpstoxInstrumentRecord {
  segment?: string; // e.g. "NSE_EQ" | "NSE_FO" | "NSE_INDEX"
  name?: string;
  exchange?: string;
  isin?: string;
  instrument_type?: string; // "EQ" | "FUT" | "CE" | "PE" | ...
  instrument_key?: string;
  trading_symbol?: string;
  underlying_symbol?: string;
  asset_symbol?: string;
  underlying_key?: string; // spot key for FO rows, e.g. "NSE_EQ|INE002A01018"
  asset_key?: string;
  underlying_type?: string; // "EQUITY" | "INDEX"
  asset_type?: string;
  expiry?: number; // epoch ms
  strike_price?: number;
  lot_size?: number;
  weekly?: boolean;
  exchange_token?: string;
}

export interface FuturesContract {
  instrumentKey: string;
  tradingSymbol: string;
  expiry: number; // epoch ms
  expiryDateIst: string; // YYYY-MM-DD (IST)
  lotSize: number;
  weekly: boolean;
  exchangeToken: string;
}

export type OptionType = "CE" | "PE";

export interface OptionContract {
  instrumentKey: string;
  tradingSymbol: string;
  expiry: number;
  expiryDateIst: string;
  strike: number;
  optionType: OptionType;
  lotSize: number;
}

/** Explicit spot-mapping semantics — only `resolved` is signal-eligible. */
export type SpotMappingStatus =
  | "resolved" // valid NSE_EQ| key that resolves to a real equity record
  | "missing_key" // no underlying_key on any valid current contract
  | "invalid_key" // key(s) present but none match ^NSE_EQ\|[^|\s]+$
  | "unresolved_record" // syntactically valid key with no matching NSE_EQ record
  | "conflicting_keys"; // >1 distinct valid key -> usable mapping is null

export interface FnoUnderlyingInstrument {
  symbol: string;
  normalizedSymbol: string;
  name: string;
  /** Usable spot key — non-null ONLY when spotMappingStatus === "resolved". */
  spotInstrumentKey: string | null;
  spotMappingStatus: SpotMappingStatus;
  spotResolved: boolean; // convenience: status === "resolved"
  /** Diagnostics only: a deterministically-chosen key even when unusable. */
  diagnosticSpotKey: string | null;
  conflictingSpotKeys: string[]; // all distinct valid keys when >1 (surfaced)
  spotTradingSymbol: string | null;
  isin: string | null;
  futures: FuturesContract[]; // current (non-expired at ref time), sorted asc
  options: OptionContract[]; // current (non-expired at ref time), sorted
  nearMonthFutures: FuturesContract | null;
  futuresExpiries: number[];
  optionExpiries: number[];
  lotSize: number | null;
}

export interface InstrumentMasterMetadata {
  source: string;
  fetchedAt: number;
  effectiveDateIst: string;
  effectiveMinuteOfDay: number;
  totalRawInstruments: number;
  totalNseEquity: number;
  totalStockFutures: number; // valid FUT rows parsed
  totalStockOptions: number; // valid option rows parsed
  totalActiveStockOptions: number; // current option rows in the universe
  // Underlying counts — named for exactly what they measure:
  currentFuturesUnderlyings: number; // have a current near-month future
  fullyResolvedMappings: number; // + resolved spot + >=1 current option expiry
  optionStructureReadyUnderlyings: number; // + >=1 same-strike CE/PE pair (nearest expiry)
  // Spot-mapping status breakdown:
  spotResolvedCount: number;
  spotMissingKeyCount: number;
  spotInvalidKeyCount: number;
  spotUnresolvedRecordCount: number;
  spotConflictingCount: number;
  // Contract hygiene:
  invalidRecordsSkipped: number;
  malformedRecordsSkipped: number; // non-object rows (null/number/string) skipped safely
  duplicateContractsCollapsed: number; // identical duplicate instrument keys collapsed
  conflictingDuplicateContracts: number; // total = sameKeyConflicts + coordinateConflicts
  sameKeyConflicts: number; // one instrument key with inconsistent rows (quarantined)
  coordinateConflicts: number; // >1 distinct key at one expiry|strike|type coord (quarantined)
  equityDuplicatesCollapsed: number; // identical duplicate NSE_EQ rows collapsed
  equityConflictingKeys: number; // NSE_EQ keys with inconsistent rows (quarantined)
  status: DataStatus;
  reason?: string;
}

export interface FnoInstrumentUniverse {
  underlyings: FnoUnderlyingInstrument[];
  bySymbol: Record<string, FnoUnderlyingInstrument>;
  metadata: InstrumentMasterMetadata;
}

/** Index underlyings that must never appear in the stock-F&O universe. */
export const EXCLUDED_INDEX_SYMBOLS: ReadonlySet<string> = new Set<string>([
  "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50",
  "SENSEX", "BANKEX", "SENSEX50", "NIFTYIT", "NIFTY50",
]);

/** Strict usable spot-key form: NSE_EQ| followed by a non-empty, no-pipe/no-space token. */
export const NSE_EQ_KEY_RE = /^NSE_EQ\|[^|\s]+$/;
