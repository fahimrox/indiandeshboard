import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Yahoo Finance public spark endpoint — no token required.

export type Quote = {
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  open: number;
  marketState: string;
  currency: string;
  exchange: string;
};

const INDICES = ["^NSEI", "^BSESN", "^NSEBANK", "^INDIAVIX"];

// `ik` = canonical index key in indexRegistry (FYERS-primary sector-index layer).
export const SECTORS = [
  { key: "it", symbol: "^CNXIT", name: "IT", ik: "IT" },
  { key: "pharma", symbol: "^CNXPHARMA", name: "Pharma", ik: "PHARMA" },
  { key: "auto", symbol: "^CNXAUTO", name: "Auto", ik: "AUTO" },
  { key: "energy", symbol: "^CNXENERGY", name: "Energy", ik: "ENERGY" },
  { key: "fmcg", symbol: "^CNXFMCG", name: "FMCG", ik: "FMCG" },
  { key: "metal", symbol: "^CNXMETAL", name: "Metal", ik: "METAL" },
  { key: "realty", symbol: "^CNXREALTY", name: "Realty", ik: "REALTY" },
  { key: "media", symbol: "^CNXMEDIA", name: "Media", ik: "MEDIA" },
  { key: "psubank", symbol: "^CNXPSUBANK", name: "PSU Bank", ik: "PSUBANK" },
  { key: "finance", symbol: "NIFTY_FIN_SERVICE.NS", name: "Finance", ik: "FINNIFTY" },
  { key: "banking", symbol: "^NSEBANK", name: "Banking", ik: "BANKNIFTY" },
  { key: "infra", symbol: "^CNXINFRA", name: "Infra", ik: "INFRA" },
];

export const SECTOR_STOCKS: Record<string, string[]> = {
  it: ["TCS.NS","INFY.NS","HCLTECH.NS","WIPRO.NS","TECHM.NS","LTIM.NS","PERSISTENT.NS","COFORGE.NS","MPHASIS.NS","OFSS.NS"],
  pharma: ["SUNPHARMA.NS","DIVISLAB.NS","CIPLA.NS","DRREDDY.NS","LUPIN.NS","AUROPHARMA.NS","TORNTPHARM.NS","ZYDUSLIFE.NS","BIOCON.NS","ALKEM.NS"],
  auto: ["MARUTI.NS","TATAMOTORS.NS","M&M.NS","BAJAJ-AUTO.NS","EICHERMOT.NS","HEROMOTOCO.NS","TVSMOTOR.NS","ASHOKLEY.NS","BOSCHLTD.NS","MRF.NS"],
  energy: ["RELIANCE.NS","ONGC.NS","NTPC.NS","POWERGRID.NS","COALINDIA.NS","BPCL.NS","IOC.NS","GAIL.NS","ADANIGREEN.NS","TATAPOWER.NS"],
  fmcg: ["HINDUNILVR.NS","ITC.NS","NESTLEIND.NS","BRITANNIA.NS","TATACONSUM.NS","DABUR.NS","GODREJCP.NS","MARICO.NS","COLPAL.NS","VBL.NS"],
  metal: ["TATASTEEL.NS","JSWSTEEL.NS","HINDALCO.NS","VEDL.NS","JINDALSTEL.NS","SAIL.NS","NMDC.NS","HINDZINC.NS","NATIONALUM.NS","APLAPOLLO.NS"],
  realty: ["DLF.NS","GODREJPROP.NS","LODHA.NS","OBEROIRLTY.NS","PRESTIGE.NS","PHOENIXLTD.NS","BRIGADE.NS","SOBHA.NS"],
  media: ["ZEEL.NS","SUNTV.NS","PVRINOX.NS","NETWORK18.NS","TV18BRDCST.NS","SAREGAMA.NS"],
  psubank: ["SBIN.NS","BANKBARODA.NS","PNB.NS","CANBK.NS","UNIONBANK.NS","INDIANB.NS","BANKINDIA.NS","CENTRALBK.NS"],
  finance: ["BAJFINANCE.NS","BAJAJFINSV.NS","HDFCLIFE.NS","SBILIFE.NS","ICICIPRULI.NS","CHOLAFIN.NS","SBICARD.NS","MUTHOOTFIN.NS","RECLTD.NS","PFC.NS"],
  banking: ["HDFCBANK.NS","ICICIBANK.NS","KOTAKBANK.NS","AXISBANK.NS","SBIN.NS","INDUSINDBK.NS","AUBANK.NS","FEDERALBNK.NS","IDFCFIRSTB.NS","BANDHANBNK.NS"],
  infra: ["LT.NS","ADANIPORTS.NS","GMRINFRA.NS","IRB.NS","NCC.NS","KEC.NS","HGINFRA.NS","PNCINFRA.NS"],
};

export const NIFTY_STOCKS = [
  "RELIANCE.NS","HDFCBANK.NS","ICICIBANK.NS","INFY.NS","TCS.NS",
  "BHARTIARTL.NS","ITC.NS","LT.NS","KOTAKBANK.NS","AXISBANK.NS",
  "SBIN.NS","HINDUNILVR.NS","BAJFINANCE.NS","MARUTI.NS","ASIANPAINT.NS",
  "M&M.NS","SUNPHARMA.NS","HCLTECH.NS","ULTRACEMCO.NS","TITAN.NS",
  "NTPC.NS","POWERGRID.NS","WIPRO.NS","NESTLEIND.NS","TATAMOTORS.NS",
];

export const BANKNIFTY_STOCKS = [
  "HDFCBANK.NS","ICICIBANK.NS","KOTAKBANK.NS","AXISBANK.NS","SBIN.NS",
  "INDUSINDBK.NS","AUBANK.NS","FEDERALBNK.NS","IDFCFIRSTB.NS","BANDHANBNK.NS",
  "PNB.NS","BANKBARODA.NS",
];

export const SENSEX_STOCKS = [
  "RELIANCE.NS","HDFCBANK.NS","ICICIBANK.NS","INFY.NS","TCS.NS",
  "BHARTIARTL.NS","ITC.NS","LT.NS","KOTAKBANK.NS","AXISBANK.NS",
  "SBIN.NS","HINDUNILVR.NS","BAJFINANCE.NS","MARUTI.NS","ASIANPAINT.NS",
  "M&M.NS","SUNPHARMA.NS","HCLTECH.NS","ULTRACEMCO.NS","TITAN.NS",
  "NTPC.NS","POWERGRID.NS","WIPRO.NS","NESTLEIND.NS","TATAMOTORS.NS",
  "TECHM.NS","TATASTEEL.NS","JSWSTEEL.NS","ADANIPORTS.NS","INDUSINDBK.NS",
];

import { marketDataLayer } from "./services/marketDataLayer";
import { getIndexDef, type IndexQuote } from "./services/indexRegistry";

const cache = new Map<string, { at: number; data: Quote[] }>();
const TTL_MS = 25_000;

async function cachedQuotes(symbols: string[]): Promise<Quote[]> {
  const key = [...symbols].sort().join(",");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  try {
    const data = await marketDataLayer.getQuotes(symbols);
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (err) {
    if (hit) return hit.data;
    throw err;
  }
}

export const getQuotes = createServerFn({ method: "GET" })
  .validator(z.object({ symbols: z.array(z.string()).min(1).max(60) }))
  .handler(async ({ data }) => cachedQuotes(data.symbols));

function statsFor(stocks: Quote[]) {
  const advance = stocks.filter((s) => s.changePct > 0).length;
  const decline = stocks.filter((s) => s.changePct < 0).length;
  const unchanged = stocks.length - advance - decline;
  const avgChange = stocks.reduce((a, s) => a + s.changePct, 0) / (stocks.length || 1);
  const sorted = [...stocks].sort((a, b) => b.changePct - a.changePct);
  return {
    stocks,
    advance,
    decline,
    unchanged,
    avgChange,
    gainers: sorted.filter((s) => s.changePct > 0).slice(0, 5),
    losers: sorted.filter((s) => s.changePct < 0).slice(-5).reverse(),
  };
}

type IndexBias = "Bullish" | "Bearish" | "Neutral";

function biasOf(pct: number): IndexBias {
  if (pct >= 0.25) return "Bullish";
  if (pct <= -0.25) return "Bearish";
  return "Neutral";
}

function reversalChance(pct: number, breadthPct: number, vixChg: number): number {
  // Heuristic 0..100: divergence between price direction and breadth + VIX spike
  const divergence = Math.abs(Math.sign(pct) * 50 - (breadthPct - 50));
  const vixBoost = Math.max(0, vixChg) * 4;
  return Math.min(99, Math.round(divergence + vixBoost));
}

function indexNote(label: string, q: Quote | null | undefined, bullsPct: number, vixChg: number) {
  if (!q) return null;
  const bias = biasOf(q.changePct);
  const rev = reversalChance(q.changePct, bullsPct, vixChg);
  const reason =
    bias === "Bullish"
      ? `holding above prior close with breadth at ${bullsPct.toFixed(0)}% bulls — momentum favors longs`
      : bias === "Bearish"
        ? `losing prior close with breadth at ${bullsPct.toFixed(0)}% bulls — sellers in control`
        : `coiling near prior close, breadth ${bullsPct.toFixed(0)}% bulls — waiting for trigger`;
  return { label, bias, changePct: q.changePct, reason, reversalChance: rev };
}

function buildPulse(opts: {
  nifty?: Quote | null;
  bank?: Quote | null;
  sensex?: Quote | null;
  vix?: Quote | null;
  bullsPct: number;
  advance: number;
  decline: number;
  topSector?: { label: string; changePct: number };
  bottomSector?: { label: string; changePct: number };
  topGainer?: Quote;
  topLoser?: Quote;
  pcr: number;
}) {
  const { nifty, bank, sensex, vix, bullsPct, advance, decline, topSector, bottomSector, topGainer, topLoser, pcr } = opts;
  const vixChg = vix?.changePct ?? 0;
  const vixLvl = vix?.price ?? 0;
  const overallTone: IndexBias = bullsPct >= 55 ? "Bullish" : bullsPct <= 45 ? "Bearish" : "Neutral";
  const indices = [
    indexNote("NIFTY 50", nifty, bullsPct, vixChg),
    indexNote("BANK NIFTY", bank, bullsPct, vixChg),
    indexNote("SENSEX", sensex, bullsPct, vixChg),
  ].filter(Boolean) as Array<{ label: string; bias: IndexBias; changePct: number; reason: string; reversalChance: number }>;

  const vixStatus =
    vixLvl === 0
      ? "VIX unavailable"
      : vixLvl < 12
        ? `India VIX at ${vixLvl.toFixed(2)} — extreme complacency, options cheap`
        : vixLvl < 15
          ? `India VIX at ${vixLvl.toFixed(2)} — low fear, trending environment`
          : vixLvl < 18
            ? `India VIX at ${vixLvl.toFixed(2)} — balanced volatility`
            : vixLvl < 22
              ? `India VIX at ${vixLvl.toFixed(2)} — elevated fear, expect wider ranges`
              : `India VIX at ${vixLvl.toFixed(2)} — high fear, defensive bias`;
  const vixDir = vixChg >= 0 ? `up ${vixChg.toFixed(2)}%` : `down ${Math.abs(vixChg).toFixed(2)}%`;

  const pcrStatus =
    pcr === 0
      ? ""
      : pcr > 1.3
        ? `PCR at ${pcr.toFixed(2)} — heavy put writing, supportive for bulls`
        : pcr < 0.8
          ? `PCR at ${pcr.toFixed(2)} — heavy call writing, bearish overhang`
          : `PCR at ${pcr.toFixed(2)} — balanced positioning`;

  const lines: string[] = [];
  lines.push(
    `Overall market is ${overallTone.toLowerCase()} — ${advance} advances vs ${decline} declines, bulls control ${bullsPct.toFixed(0)}% of breadth.`,
  );
  for (const i of indices) {
    lines.push(
      `${i.label}: ${i.bias} (${i.changePct >= 0 ? "+" : ""}${i.changePct.toFixed(2)}%) — ${i.reason}. Reversal odds: ${i.reversalChance}%.`,
    );
  }
  lines.push(`${vixStatus}, VIX ${vixDir} — ${vixChg > 3 ? "risk-off creeping in, hedge longs" : vixChg < -3 ? "fear easing, risk-on continuation likely" : "volatility steady, follow trend"}.`);
  if (pcrStatus) lines.push(pcrStatus + ".");
  if (topSector && bottomSector) {
    lines.push(
      `Sector flow: ${topSector.label} leads at ${topSector.changePct >= 0 ? "+" : ""}${topSector.changePct.toFixed(2)}%, ${bottomSector.label} drags at ${bottomSector.changePct.toFixed(2)}% — rotation favors ${topSector.changePct >= 0 ? "risk-on" : "defensive"} names.`,
    );
  }
  if (topGainer && topLoser) {
    const tg = topGainer.symbol.replace(".NS", "").replace(".BO", "");
    const tl = topLoser.symbol.replace(".NS", "").replace(".BO", "");
    lines.push(
      `Stock impact: ${tg} (${topGainer.changePct >= 0 ? "+" : ""}${topGainer.changePct.toFixed(2)}%) powering up; ${tl} (${topLoser.changePct.toFixed(2)}%) dragging down — intraday flows skewed ${topGainer.changePct + topLoser.changePct >= 0 ? "positive" : "negative"}.`,
    );
  }
  const trendChange = indices.filter((i) => i.reversalChance >= 55);
  if (trendChange.length) {
    lines.push(
      `Trend watch: ${trendChange.map((i) => `${i.label} (${i.reversalChance}%)`).join(", ")} showing reversal potential — divergence between price and breadth.`,
    );
  } else {
    lines.push(`Trend watch: no major reversal signals across indices — current direction likely persists into close.`);
  }

  return { tone: overallTone, lines, indices, vixStatus, pcrStatus };
}

import { dashboardService } from "./services/dashboardService.server";

export const getDashboard = createServerFn({ method: "GET" }).handler(async () => {
  return await dashboardService.getDashboardData();
});

export const getIndexConstituents = createServerFn({ method: "GET" })
  .validator(z.object({ index: z.enum(["nifty", "banknifty", "sensex"]) }))
  .handler(async ({ data }) => {
    const map = { nifty: NIFTY_STOCKS, banknifty: BANKNIFTY_STOCKS, sensex: SENSEX_STOCKS };
    const stocks = await cachedQuotes(map[data.index]);
    const metadataTimestamp = (stocks as any)._metadata?.timestamp;
    return { ...statsFor(stocks), updatedAt: metadataTimestamp || Date.now() };
  });

export type ContributorRow = {
  rank: number;
  symbol: string;
  price: number;
  changePct: number;
  change: number;
  contributionPct: number;
  contributionPoints: number;
};

export const getIndexContributions = createServerFn({ method: "GET" })
  .validator(z.object({ index: z.enum(["nifty", "banknifty", "sensex"]) }))
  .handler(async ({ data }) => {
    const map = { nifty: NIFTY_STOCKS, banknifty: BANKNIFTY_STOCKS, sensex: SENSEX_STOCKS };
    const indexSymbolMap = { nifty: "^NSEI", banknifty: "^NSEBANK", sensex: "^BSESN" } as const;
    const [allStocks, indexQuotes] = await Promise.all([
      cachedQuotes(map[data.index]),
      cachedQuotes([indexSymbolMap[data.index]]),
    ]);
    const indexQuote = indexQuotes[0] ?? null;
    const indexChange = indexQuote?.change ?? 0;
    const totalAbsChange = allStocks.reduce((sum, s) => sum + Math.abs(s.changePct), 0) || 1;
    const totalNetChange = allStocks.reduce((sum, s) => sum + s.changePct, 0);
    const pointFactor = Math.abs(totalNetChange) > 0.01
      ? indexChange / totalNetChange
      : indexChange / totalAbsChange;
    const rows: ContributorRow[] = allStocks
      .map((s) => ({
        rank: 0,
        symbol: s.symbol.replace(".NS", "").replace(".BO", ""),
        price: s.price,
        changePct: s.changePct,
        change: s.change,
        contributionPct: (s.changePct / totalAbsChange) * 100,
        contributionPoints: s.changePct * pointFactor,
      }))
      .sort((a, b) => b.contributionPct - a.contributionPct)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    const positive = rows.filter((r) => r.contributionPct >= 0);
    const negative = rows.filter((r) => r.contributionPct < 0);

    const metadataTimestamp = (allStocks as any)._metadata?.timestamp;
    return {
      index: data.index,
      rows,
      positive,
      negative,
      indexQuote,
      indexChange,
      updatedAt: metadataTimestamp || Date.now(),
    };
  });

export const getSectorDetail = createServerFn({ method: "GET" })
  .validator(z.object({ key: z.string() }))
  .handler(async ({ data }) => {
    const sector = SECTORS.find((s) => s.key === data.key);
    if (!sector) throw new Error("Unknown sector");
    const list = SECTOR_STOCKS[data.key] ?? [];
    const [idxArr, stocks] = await Promise.all([
      cachedQuotes([sector.symbol]),
      list.length ? cachedQuotes(list) : Promise.resolve([]),
    ]);
    const metadataTimestamp = (idxArr as any)._metadata?.timestamp || (stocks as any)._metadata?.timestamp;
    return {
      sector: { ...sector, quote: idxArr[0] ?? null },
      ...statsFor(stocks),
      updatedAt: metadataTimestamp || Date.now(),
    };
  });

// ─── INTRADAY BOOSTER ─────────────────────────────────────────────────────────
// Real data only. One aggregated payload: index groups + all sector groups, each
// with its constituent stocks. Powers the top sector-strength strip and the
// index/sector constituent tables. F&O inflow/outflow is computed client-side
// from fnoStocksQuery (which carries volume/OI/buildup/signalTime).

export type BoosterStock = { symbol: string; name: string; ltp: number; changePct: number };
export type BoosterGroup = {
  key: string;
  name: string;
  isIndex: boolean;
  changePct: number;
  price: number;
  stocks: BoosterStock[];
};
export type StripItem = { key: string; label: string; changePct: number; price: number; isIndex: boolean };

const cleanSym = (s: string) => s.replace(".NS", "").replace(".BO", "");

// Real constituent members per canonical index key (indexRegistry `ik`). Powers
// one table per top-strip index/sector. All real NSE stocks (Yahoo `.NS`); any
// ticker the quotes layer can't resolve is simply dropped (no fabrication).
const N = (arr: string[]) => arr.map((s) => `${s}.NS`);
const INDEX_CONSTITUENTS: Record<string, string[]> = {
  NIFTY: N([
    "RELIANCE","HDFCBANK","ICICIBANK","INFY","TCS","BHARTIARTL","ITC","LT","KOTAKBANK","AXISBANK",
    "SBIN","HINDUNILVR","BAJFINANCE","MARUTI","ASIANPAINT","M&M","SUNPHARMA","HCLTECH","ULTRACEMCO","TITAN",
    "NTPC","POWERGRID","WIPRO","NESTLEIND","TATAMOTORS","TECHM","TATASTEEL","JSWSTEEL","ADANIPORTS","INDUSINDBK",
    "BAJAJFINSV","BAJAJ-AUTO","HDFCLIFE","GRASIM","CIPLA","DRREDDY","EICHERMOT","COALINDIA","BPCL","BRITANNIA",
    "HEROMOTOCO","APOLLOHOSP","TATACONSUM","SBILIFE","ADANIENT","HINDALCO","SHRIRAMFIN","LTIM","TRENT","ONGC",
    "JIOFIN","BEL",
  ]),
  BANKNIFTY: N([
    "HDFCBANK","ICICIBANK","KOTAKBANK","AXISBANK","SBIN","INDUSINDBK","AUBANK","FEDERALBNK","IDFCFIRSTB","BANDHANBNK",
    "PNB","BANKBARODA",
  ]),
  SENSEX: N([
    "RELIANCE","HDFCBANK","ICICIBANK","INFY","TCS","BHARTIARTL","ITC","LT","KOTAKBANK","AXISBANK",
    "SBIN","HINDUNILVR","BAJFINANCE","MARUTI","ASIANPAINT","M&M","SUNPHARMA","HCLTECH","ULTRACEMCO","TITAN",
    "NTPC","POWERGRID","NESTLEIND","TATAMOTORS","TECHM","TATASTEEL","ADANIPORTS","INDUSINDBK","BAJAJFINSV","TATACONSUM",
  ]),
  FINNIFTY: N([
    "HDFCBANK","ICICIBANK","AXISBANK","KOTAKBANK","SBIN","BAJFINANCE","BAJAJFINSV","SHRIRAMFIN","HDFCLIFE","SBILIFE",
    "ICICIPRULI","ICICIGI","HDFCAMC","CHOLAFIN","MUTHOOTFIN","SBICARD","PFC","RECLTD","JIOFIN","LICI",
  ]),
  MIDCAP: N([
    "LUPIN","AUROPHARMA","ZYDUSLIFE","PERSISTENT","COFORGE","MPHASIS","GODREJPROP","OBEROIRLTY","PHOENIXLTD","ASHOKLEY",
    "TVSMOTOR","MRF","BALKRISIND","PIIND","SRF","DEEPAKNTR","TATACOMM","INDUSTOWER","CONCOR","CUMMINSIND",
    "PAGEIND","VOLTAS","DIXON","POLYCAB","ASTRAL","MAXHEALTH","FORTIS","PETRONET","MFSL","IDFCFIRSTB",
    "AUBANK","FEDERALBNK","HINDPETRO","SAIL","NMDC",
  ]),
  IT: N(["TCS","INFY","HCLTECH","WIPRO","TECHM","LTIM","PERSISTENT","COFORGE","MPHASIS","OFSS"]),
  PHARMA: N([
    "SUNPHARMA","DIVISLAB","CIPLA","DRREDDY","LUPIN","AUROPHARMA","TORNTPHARM","ZYDUSLIFE","BIOCON","ALKEM",
    "LAURUSLABS","GLENMARK","MANKIND","ABBOTINDIA","IPCALAB",
  ]),
  AUTO: N([
    "MARUTI","TATAMOTORS","M&M","BAJAJ-AUTO","EICHERMOT","HEROMOTOCO","TVSMOTOR","ASHOKLEY","BOSCHLTD","MRF",
    "BALKRISIND","MOTHERSON","BHARATFORG","TIINDIA","EXIDEIND",
  ]),
  ENERGY: N([
    "RELIANCE","ONGC","NTPC","POWERGRID","COALINDIA","BPCL","IOC","GAIL","TATAPOWER","ADANIGREEN",
    "ADANIENSOL","HINDPETRO","JSWENERGY","NHPC","SJVN",
  ]),
  FMCG: N([
    "HINDUNILVR","ITC","NESTLEIND","BRITANNIA","TATACONSUM","DABUR","GODREJCP","MARICO","COLPAL","VBL",
    "UNITDSPR","PGHH","EMAMILTD","RADICO","BALRAMCHIN",
  ]),
  METAL: N([
    "TATASTEEL","JSWSTEEL","HINDALCO","VEDL","JINDALSTEL","SAIL","NMDC","HINDZINC","NATIONALUM","APLAPOLLO",
    "JSL","HINDCOPPER","WELCORP","RATNAMANI","LLOYDSME",
  ]),
  REALTY: N([
    "DLF","GODREJPROP","LODHA","OBEROIRLTY","PRESTIGE","PHOENIXLTD","BRIGADE","SOBHA","ANANTRAJ","RAYMOND",
  ]),
  MEDIA: N([
    "ZEEL","SUNTV","PVRINOX","NETWORK18","TV18BRDCST","SAREGAMA","TIPSINDLTD","NAZARA","HATHWAY","DISHTV",
  ]),
  PSUBANK: N([
    "SBIN","BANKBARODA","PNB","CANBK","UNIONBANK","INDIANB","BANKINDIA","CENTRALBK","IOB","UCOBANK",
    "MAHABANK","PSB",
  ]),
  PVTBANK: N([
    "HDFCBANK","ICICIBANK","AXISBANK","KOTAKBANK","INDUSINDBK","IDFCFIRSTB","FEDERALBNK","BANDHANBNK","RBLBANK","CUB",
  ]),
  INFRA: N([
    "LT","ADANIPORTS","ULTRACEMCO","NTPC","POWERGRID","GRASIM","BHARTIARTL","ONGC","RELIANCE","GAIL",
    "DLF","SIEMENS","ABB","INDUSTOWER","IOC","AMBUJACEM","SHREECEM","GMRAIRPORT","IRB","NCC",
  ]),
  HEALTHCARE: N([
    "SUNPHARMA","DIVISLAB","CIPLA","DRREDDY","APOLLOHOSP","MAXHEALTH","FORTIS","LUPIN","AUROPHARMA","TORNTPHARM",
    "ZYDUSLIFE","ALKEM","BIOCON","LAURUSLABS","GLENMARK","ABBOTINDIA","MANKIND","SYNGENE","IPCALAB","GLAND",
  ]),
  CONSUMPTION: N([
    "HINDUNILVR","ITC","MARUTI","TITAN","M&M","BHARTIARTL","ASIANPAINT","NESTLEIND","TATAMOTORS","BAJAJ-AUTO",
    "TATACONSUM","DABUR","BRITANNIA","GODREJCP","VBL","TRENT","EICHERMOT","HEROMOTOCO","COLPAL","MARICO",
    "HAVELLS","DMART","ETERNAL","JUBLFOOD","PAGEIND","VOLTAS","INDHOTEL","UNITDSPR","TVSMOTOR","NAUKRI",
  ]),
  OILGAS: N([
    "RELIANCE","ONGC","IOC","BPCL","GAIL","HINDPETRO","PETRONET","ATGL","IGL","MGL",
    "OIL","GSPL","GUJGASLTD","CASTROLIND","AEGISLOG",
  ]),
  CONSRDURBL: N([
    "TITAN","HAVELLS","DIXON","CROMPTON","VOLTAS","BLUESTARCO","BATAINDIA","KAJARIACER","WHIRLPOOL","VGUARD",
    "AMBER","RAJESHEXPO","CERA","ORIENTELEC","KALYANKJIL",
  ]),
  SERVICES: N([
    "HDFCBANK","ICICIBANK","INFY","TCS","BHARTIARTL","SBIN","KOTAKBANK","AXISBANK","BAJFINANCE","HCLTECH",
    "WIPRO","TECHM","LTIM","ADANIPORTS","DMART","BAJAJFINSV","HDFCLIFE","SBILIFE","NAUKRI","INDUSINDBK",
    "ETERNAL","JIOFIN","SHRIRAMFIN","PFC","RECLTD",
  ]),
  COMMODITIES: N([
    "RELIANCE","ONGC","NTPC","POWERGRID","COALINDIA","TATASTEEL","JSWSTEEL","HINDALCO","ULTRACEMCO","GRASIM",
    "VEDL","ADANIGREEN","ADANIENSOL","BPCL","IOC","GAIL","AMBUJACEM","SHREECEM","PIDILITIND","UPL",
    "SRF","TATAPOWER","JINDALSTEL","NMDC","SAIL","HINDPETRO","ACC","PIIND","DALBHARAT","NATIONALUM",
  ]),
  DEFENCE: N([
    "HAL","BEL","BDL","SOLARINDS","MAZDOCK","COCHINSHIP","BEML","DATAPATTNS","ZENTEC","MTARTECH",
    "ASTRAMICRO","PARAS","GRSE","DYNAMATECH","IDEAFORGE",
  ]),
  CHEMICALS: N([
    "PIDILITIND","SRF","PIIND","DEEPAKNTR","AARTIIND","ATUL","NAVINFLUOR","TATACHEM","FLUOROCHEM","LINDEINDIA",
    "SOLARINDS","VINATIORGA","CLEAN","FINEORG","ALKYLAMINE","BALAMINES","COROMANDEL","UPL","EIDPARRY","CHAMBLFERT",
  ]),
  CAPITALMKT: N([
    "BSE","HDFCAMC","ANGELONE","MCX","CDSL","CAMS","KFINTECH","360ONE","NUVAMA","MOTILALOFS",
    "IEX","NAM-INDIA","ABSLAMC","UTIAMC","ANANDRATHI",
  ]),
};

// Sector-strength strip: broad + sectoral indices, matching the reference
// layout. Each entry references a canonical index key resolved by the
// FYERS-primary sector-index data layer (indexRegistry). Any key the chain
// can't resolve is simply dropped (no fabricated bars).
const BOOSTER_STRIP: { ik: string; isIndex: boolean }[] = [
  { ik: "NIFTY", isIndex: true },
  { ik: "BANKNIFTY", isIndex: true },
  { ik: "FINNIFTY", isIndex: true },
  { ik: "MIDCAP", isIndex: true },
  { ik: "IT", isIndex: false },
  { ik: "PHARMA", isIndex: false },
  { ik: "AUTO", isIndex: false },
  { ik: "ENERGY", isIndex: false },
  { ik: "FMCG", isIndex: false },
  { ik: "METAL", isIndex: false },
  { ik: "REALTY", isIndex: false },
  { ik: "MEDIA", isIndex: false },
  { ik: "PSUBANK", isIndex: false },
  { ik: "PVTBANK", isIndex: false },
  { ik: "INFRA", isIndex: false },
  { ik: "HEALTHCARE", isIndex: false },
  { ik: "CONSUMPTION", isIndex: false },
  { ik: "OILGAS", isIndex: false },
  { ik: "CONSRDURBL", isIndex: false },
  { ik: "SERVICES", isIndex: false },
  { ik: "COMMODITIES", isIndex: false },
  { ik: "DEFENCE", isIndex: false },
  { ik: "CHEMICALS", isIndex: false },
  { ik: "CAPITALMKT", isIndex: false },
];

export const getIntradayBooster = createServerFn({ method: "GET" }).handler(async () => {
  // Index / sector-index VALUES come from the FYERS-primary sector-index layer
  // (FYERS → NSE allIndices → Yahoo → EOD cache). Constituent STOCK quotes stay
  // on the Upstox → Yahoo quotes layer. Both are real data only.
  const idxMap = new Map<string, IndexQuote>();
  try {
    const indexQuotes = await marketDataLayer.getSectorIndices();
    for (const iq of indexQuotes) idxMap.set(iq.key, iq);
  } catch {
    // All index tiers + EOD failed — groups/strip with no resolved value drop.
  }

  // Collect every constituent across all strip indices/sectors (deduped), fetch
  // in chunks of 50.
  const symSet = new Set<string>();
  for (const s of BOOSTER_STRIP) (INDEX_CONSTITUENTS[s.ik] ?? []).forEach((x) => symSet.add(x));
  const all = [...symSet];
  const chunks: string[][] = [];
  for (let i = 0; i < all.length; i += 50) chunks.push(all.slice(i, i + 50));
  const results = await Promise.all(chunks.map((c) => cachedQuotes(c).catch(() => [] as Quote[])));

  const qmap = new Map<string, Quote>();
  for (const arr of results) for (const q of arr) qmap.set(q.symbol, q);

  const buildStocks = (syms: string[]): BoosterStock[] =>
    syms
      .map((s) => {
        const q = qmap.get(s);
        if (!q) return null;
        return { symbol: cleanSym(s), name: q.name, ltp: q.price, changePct: q.changePct };
      })
      .filter((x): x is BoosterStock => x !== null)
      .sort((a, b) => b.changePct - a.changePct);

  // One group per strip index/sector (strip order), each with its real
  // constituents. Only groups with at least one resolved constituent are kept.
  const groups: BoosterGroup[] = BOOSTER_STRIP
    .map((s) => {
      const iq = idxMap.get(s.ik);
      const def = getIndexDef(s.ik);
      return {
        key: s.ik,
        name: def?.label ?? s.ik,
        isIndex: s.isIndex,
        changePct: iq?.changePct ?? 0,
        price: iq?.price ?? 0,
        stocks: buildStocks(INDEX_CONSTITUENTS[s.ik] ?? []),
      };
    })
    .filter((g) => g.stocks.length > 0);

  // Sector-strength strip: only entries whose index value resolved (no
  // fabricated bars), sorted best → worst.
  const strip: StripItem[] = BOOSTER_STRIP
    .map((s) => {
      const iq = idxMap.get(s.ik);
      if (!iq) return null;
      const def = getIndexDef(s.ik);
      return { key: s.ik, label: def?.label ?? s.ik, changePct: iq.changePct, price: iq.price, isIndex: s.isIndex };
    })
    .filter((x): x is StripItem => x !== null)
    .sort((a, b) => b.changePct - a.changePct);

  // Market sentiment breadth from every constituent (real quotes only).
  let adv = 0, dec = 0;
  for (const s of symSet) {
    const q = qmap.get(s);
    if (!q) continue;
    if (q.changePct > 0) adv++;
    else if (q.changePct < 0) dec++;
  }
  const totalBreadth = adv + dec || 1;
  const bullPct = Math.round((adv / totalBreadth) * 100);
  const breadth = { bullPct, bearPct: 100 - bullPct, advances: adv, declines: dec };

  return { groups, strip, breadth, updatedAt: Date.now() };
});
