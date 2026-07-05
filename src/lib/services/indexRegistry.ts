// ─── SECTOR / BROAD INDEX REGISTRY ────────────────────────────────────────────
// Single source of truth mapping a canonical index key to its per-provider
// symbols. Used by the sector-indices data layer (FYERS primary → NSE allIndices
// → Yahoo → EOD cache). Every FYERS symbol here was live-verified against the
// FYERS `/data/quotes` endpoint (returned a valid `lp`). Providers that don't
// carry a given index simply omit that field, so the fallback chain degrades
// gracefully per-index (no fabricated values).

export type IndexQuote = {
  key: string;
  price: number;
  changePct: number;
  prevClose: number;
};

export type IndexDef = {
  key: string; // canonical key
  label: string; // display label (strip / group header)
  isIndex: boolean; // true = broad index, false = sectoral
  fyers?: string; // FYERS quotes symbol (primary)
  nse?: string; // NSE /api/allIndices "index" name (fallback 1)
  yahoo?: string; // Yahoo spark symbol (fallback 2)
};

export const INDEX_REGISTRY: IndexDef[] = [
  // ── Broad indices ──
  { key: "NIFTY", label: "NIFTY", isIndex: true, fyers: "NSE:NIFTY50-INDEX", nse: "NIFTY 50", yahoo: "^NSEI" },
  { key: "BANKNIFTY", label: "BANKNIFTY", isIndex: true, fyers: "NSE:NIFTYBANK-INDEX", nse: "NIFTY BANK", yahoo: "^NSEBANK" },
  { key: "FINNIFTY", label: "FINNIFTY", isIndex: true, fyers: "NSE:FINNIFTY-INDEX", nse: "NIFTY FINANCIAL SERVICES", yahoo: "NIFTY_FIN_SERVICE.NS" },
  { key: "SENSEX", label: "SENSEX", isIndex: true, fyers: "BSE:SENSEX-INDEX", yahoo: "^BSESN" }, // BSE — not on NSE allIndices
  { key: "MIDCAP", label: "MIDCAP", isIndex: true, fyers: "NSE:NIFTYMIDCAP100-INDEX", nse: "NIFTY MIDCAP 100", yahoo: "^CNXMIDCAP" },

  // ── Sectoral / thematic indices ──
  { key: "IT", label: "IT", isIndex: false, fyers: "NSE:NIFTYIT-INDEX", nse: "NIFTY IT", yahoo: "^CNXIT" },
  { key: "PHARMA", label: "PHARMA", isIndex: false, fyers: "NSE:NIFTYPHARMA-INDEX", nse: "NIFTY PHARMA", yahoo: "^CNXPHARMA" },
  { key: "AUTO", label: "AUTO", isIndex: false, fyers: "NSE:NIFTYAUTO-INDEX", nse: "NIFTY AUTO", yahoo: "^CNXAUTO" },
  { key: "ENERGY", label: "ENERGY", isIndex: false, fyers: "NSE:NIFTYENERGY-INDEX", nse: "NIFTY ENERGY", yahoo: "^CNXENERGY" },
  { key: "FMCG", label: "FMCG", isIndex: false, fyers: "NSE:NIFTYFMCG-INDEX", nse: "NIFTY FMCG", yahoo: "^CNXFMCG" },
  { key: "METAL", label: "METAL", isIndex: false, fyers: "NSE:NIFTYMETAL-INDEX", nse: "NIFTY METAL", yahoo: "^CNXMETAL" },
  { key: "REALTY", label: "REALTY", isIndex: false, fyers: "NSE:NIFTYREALTY-INDEX", nse: "NIFTY REALTY", yahoo: "^CNXREALTY" },
  { key: "MEDIA", label: "MEDIA", isIndex: false, fyers: "NSE:NIFTYMEDIA-INDEX", nse: "NIFTY MEDIA", yahoo: "^CNXMEDIA" },
  { key: "PSUBANK", label: "PSU BANK", isIndex: false, fyers: "NSE:NIFTYPSUBANK-INDEX", nse: "NIFTY PSU BANK", yahoo: "^CNXPSUBANK" },
  { key: "PVTBANK", label: "PVT BANK", isIndex: false, fyers: "NSE:NIFTYPVTBANK-INDEX", nse: "NIFTY PRIVATE BANK", yahoo: "NIFTY_PVT_BANK.NS" },
  { key: "INFRA", label: "INFRA", isIndex: false, fyers: "NSE:NIFTYINFRA-INDEX", nse: "NIFTY INFRASTRUCTURE", yahoo: "^CNXINFRA" },
  { key: "HEALTHCARE", label: "HEALTHCARE", isIndex: false, fyers: "NSE:NIFTYHEALTHCARE-INDEX", nse: "NIFTY HEALTHCARE INDEX", yahoo: "NIFTY_HEALTHCARE.NS" },
  { key: "CONSUMPTION", label: "CONSUMPTION", isIndex: false, fyers: "NSE:NIFTYCONSUMPTION-INDEX", nse: "NIFTY INDIA CONSUMPTION", yahoo: "^CNXCONSUM" },
  { key: "CONSRDURBL", label: "CONSR DURBL", isIndex: false, fyers: "NSE:NIFTYCONSRDURBL-INDEX", nse: "NIFTY CONSUMER DURABLES", yahoo: "NIFTY_CONSR_DURBL.NS" },
  { key: "SERVICES", label: "SERVICES", isIndex: false, fyers: "NSE:NIFTYSERVSECTOR-INDEX", nse: "NIFTY SERVICES SECTOR", yahoo: "^CNXSERVICE" },
  { key: "COMMODITIES", label: "COMMODITIES", isIndex: false, fyers: "NSE:NIFTYCOMMODITIES-INDEX", nse: "NIFTY COMMODITIES", yahoo: "^CNXCMDT" },
  { key: "OILGAS", label: "OIL & GAS", isIndex: false, fyers: "NSE:NIFTYOILANDGAS-INDEX", nse: "NIFTY OIL & GAS", yahoo: "NIFTY_OIL_AND_GAS.NS" },
  // Newer indices — FYERS-verified. Yahoo has no reliable ticker; NSE names are
  // best-effort (only used if FYERS is down).
  { key: "DEFENCE", label: "DEFENCE", isIndex: false, fyers: "NSE:NIFTYINDDEFENCE-INDEX", nse: "NIFTY INDIA DEFENCE" },
  { key: "CHEMICALS", label: "CHEMICALS", isIndex: false, fyers: "NSE:NIFTYCHEMICALS-INDEX", nse: "NIFTY CHEMICALS" },
  { key: "CAPITALMKT", label: "CAPITAL MKT", isIndex: false, fyers: "NSE:NIFTYCAPITALMKT-INDEX", nse: "NIFTY CAPITAL MARKETS" },
];

const byKey = new Map(INDEX_REGISTRY.map((d) => [d.key, d]));
export function getIndexDef(key: string): IndexDef | undefined {
  return byKey.get(key);
}

export const ALL_INDEX_KEYS: string[] = INDEX_REGISTRY.map((d) => d.key);

// key → provider symbol lookups (only keys the provider actually carries)
export const FYERS_INDEX_SYMBOL: Record<string, string> = Object.fromEntries(
  INDEX_REGISTRY.filter((d) => d.fyers).map((d) => [d.key, d.fyers as string])
);
export const NSE_INDEX_NAME: Record<string, string> = Object.fromEntries(
  INDEX_REGISTRY.filter((d) => d.nse).map((d) => [d.key, d.nse as string])
);
export const YAHOO_INDEX_SYMBOL: Record<string, string> = Object.fromEntries(
  INDEX_REGISTRY.filter((d) => d.yahoo).map((d) => [d.key, d.yahoo as string])
);
