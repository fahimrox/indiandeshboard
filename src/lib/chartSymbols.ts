// ─── Chart Lab symbol universe (client-safe) ──────────────────────────────────
// Indices (from the shared index registry) + a broad NSE F&O/cash stock list.
// Any other NSE cash symbol can be typed into the search box (resolved as .NS).

import { INDEX_REGISTRY } from "./services/indexRegistry";

export type ChartSymbol = {
  label: string; // display
  yahoo: string; // Yahoo chart symbol
  kind: "index" | "stock";
  // Option-chain underlying (for the OI overlay). Only where our chain supports it.
  optSym?: "NIFTY" | "BANKNIFTY" | "SENSEX";
};

// Broad indices + all sectoral indices from the registry
export const CHART_INDICES: ChartSymbol[] = INDEX_REGISTRY.filter((d) => d.yahoo).map((d) => ({
  label: d.key === "NIFTY" ? "NIFTY 50" : d.key === "BANKNIFTY" ? "BANK NIFTY" : d.label,
  yahoo: d.yahoo as string,
  kind: "index" as const,
  optSym:
    d.key === "NIFTY" ? "NIFTY" : d.key === "BANKNIFTY" ? "BANKNIFTY" : d.key === "SENSEX" ? "SENSEX" : undefined,
}));

const FNO_STOCKS = [
  "RELIANCE","HDFCBANK","ICICIBANK","INFY","TCS","BHARTIARTL","ITC","LT","KOTAKBANK","AXISBANK",
  "SBIN","HINDUNILVR","BAJFINANCE","MARUTI","ASIANPAINT","M&M","SUNPHARMA","HCLTECH","ULTRACEMCO","TITAN",
  "NTPC","POWERGRID","WIPRO","NESTLEIND","TATAMOTORS","TECHM","TATASTEEL","JSWSTEEL","ADANIPORTS","INDUSINDBK",
  "BAJAJFINSV","BAJAJ-AUTO","HDFCLIFE","GRASIM","CIPLA","DRREDDY","EICHERMOT","COALINDIA","BPCL","BRITANNIA",
  "HEROMOTOCO","APOLLOHOSP","TATACONSUM","SBILIFE","ADANIENT","HINDALCO","SHRIRAMFIN","LTIM","TRENT","ONGC",
  "JIOFIN","BEL","DIVISLAB","LUPIN","AUROPHARMA","ZYDUSLIFE","TORNTPHARM","BIOCON","ALKEM","LAURUSLABS",
  "TVSMOTOR","ASHOKLEY","BOSCHLTD","MRF","BALKRISIND","MOTHERSON","BHARATFORG","TIINDIA","EXIDEIND","BANKBARODA",
  "PNB","CANBK","UNIONBANK","IDFCFIRSTB","FEDERALBNK","AUBANK","BANDHANBNK","RBLBANK","PFC","RECLTD",
  "HDFCAMC","ICICIPRULI","ICICIGI","SBICARD","CHOLAFIN","MUTHOOTFIN","LICHSGFIN","MFSL","DLF","GODREJPROP",
  "LODHA","OBEROIRLTY","PRESTIGE","PHOENIXLTD","VEDL","JINDALSTEL","SAIL","NMDC","HINDZINC","NATIONALUM",
  "APLAPOLLO","TATAPOWER","ADANIGREEN","ADANIENSOL","IOC","GAIL","HINDPETRO","PETRONET","IGL","MGL",
  "DABUR","GODREJCP","MARICO","COLPAL","VBL","UNITDSPR","PIDILITIND","SRF","PIIND","DEEPAKNTR",
  "AARTIIND","ATUL","NAVINFLUOR","TATACHEM","UPL","COROMANDEL","HAVELLS","DIXON","VOLTAS","POLYCAB",
  "PERSISTENT","COFORGE","MPHASIS","OFSS","LTTS","INDUSTOWER","TATACOMM","CONCOR","CUMMINSIND","PAGEIND",
  "SIEMENS","ABB","BHEL","HAL","BDL","MAZDOCK","CGPOWER","ZOMATO","PAYTM","NYKAA",
  "DMART","INDHOTEL","IRCTC","NAUKRI","ZEEL","SUNTV","PVRINOX","MAXHEALTH","FORTIS","SYNGENE",
];

export const CHART_STOCKS: ChartSymbol[] = FNO_STOCKS.map((s) => ({
  label: s,
  yahoo: `${s}.NS`,
  kind: "stock" as const,
}));

export const ALL_CHART_SYMBOLS: ChartSymbol[] = [...CHART_INDICES, ...CHART_STOCKS];

// Free-typed symbol → a stock ChartSymbol (Yahoo .NS). Uppercased, .NS appended
// unless the user already gave an exchange suffix or an index (^) symbol.
export function resolveTypedSymbol(input: string): ChartSymbol {
  const raw = input.trim().toUpperCase();
  const yahoo = raw.startsWith("^") || raw.includes(".") ? raw : `${raw}.NS`;
  return { label: raw.replace(/\.NS$/, ""), yahoo, kind: raw.startsWith("^") ? "index" : "stock" };
}
