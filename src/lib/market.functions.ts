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

async function fetchYahooChunk(symbols: string[]): Promise<Quote[]> {
  const url = `https://query2.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(
    symbols.join(","),
  )}&range=1d&interval=5m`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://finance.yahoo.com/",
      Origin: "https://finance.yahoo.com",
    },
  });
  if (!res.ok) throw new Error(`Yahoo request failed: ${res.status}`);
  const json = (await res.json()) as {
    spark: { result: Array<{ symbol: string; response: Array<{ meta: any }> }> };
  };
  const out: Quote[] = [];
  for (const r of json.spark?.result ?? []) {
    const meta = r.response?.[0]?.meta;
    if (!meta) continue;
    const price = meta.regularMarketPrice ?? 0;
    const prev = meta.chartPreviousClose ?? meta.previousClose ?? price;
    out.push({
      symbol: meta.symbol,
      name: meta.longName ?? meta.shortName ?? meta.symbol,
      price,
      prevClose: prev,
      change: price - prev,
      changePct: prev ? ((price - prev) / prev) * 100 : 0,
      dayHigh: meta.regularMarketDayHigh ?? price,
      dayLow: meta.regularMarketDayLow ?? price,
      open:
        meta.regularMarketDayHigh && meta.regularMarketDayLow
          ? (meta.regularMarketDayHigh + meta.regularMarketDayLow) / 2
          : price,
      marketState: meta.marketState ?? "UNKNOWN",
      currency: meta.currency ?? "INR",
      exchange: meta.fullExchangeName ?? meta.exchangeName ?? "",
    });
  }
  return out;
}

async function fetchYahoo(symbols: string[]): Promise<Quote[]> {
  const CHUNK = 10;
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += CHUNK) chunks.push(symbols.slice(i, i + CHUNK));
  const results = await Promise.all(chunks.map((c) => fetchYahooChunk(c)));
  return results.flat();
}

const INDICES = ["^NSEI", "^BSESN", "^NSEBANK", "^INDIAVIX"];

export const SECTORS = [
  { key: "it", symbol: "^CNXIT", name: "IT" },
  { key: "pharma", symbol: "^CNXPHARMA", name: "Pharma" },
  { key: "auto", symbol: "^CNXAUTO", name: "Auto" },
  { key: "energy", symbol: "^CNXENERGY", name: "Energy" },
  { key: "fmcg", symbol: "^CNXFMCG", name: "FMCG" },
  { key: "metal", symbol: "^CNXMETAL", name: "Metal" },
  { key: "realty", symbol: "^CNXREALTY", name: "Realty" },
  { key: "media", symbol: "^CNXMEDIA", name: "Media" },
  { key: "psubank", symbol: "^CNXPSUBANK", name: "PSU Bank" },
  { key: "finance", symbol: "NIFTY_FIN_SERVICE.NS", name: "Finance" },
  { key: "banking", symbol: "^NSEBANK", name: "Banking" },
  { key: "infra", symbol: "^CNXINFRA", name: "Infra" },
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

const NIFTY_STOCKS = [
  "RELIANCE.NS","HDFCBANK.NS","ICICIBANK.NS","INFY.NS","TCS.NS",
  "BHARTIARTL.NS","ITC.NS","LT.NS","KOTAKBANK.NS","AXISBANK.NS",
  "SBIN.NS","HINDUNILVR.NS","BAJFINANCE.NS","MARUTI.NS","ASIANPAINT.NS",
  "M&M.NS","SUNPHARMA.NS","HCLTECH.NS","ULTRACEMCO.NS","TITAN.NS",
  "NTPC.NS","POWERGRID.NS","WIPRO.NS","NESTLEIND.NS","TATAMOTORS.NS",
];

const BANKNIFTY_STOCKS = [
  "HDFCBANK.NS","ICICIBANK.NS","KOTAKBANK.NS","AXISBANK.NS","SBIN.NS",
  "INDUSINDBK.NS","AUBANK.NS","FEDERALBNK.NS","IDFCFIRSTB.NS","BANDHANBNK.NS",
  "PNB.NS","BANKBARODA.NS",
];

const SENSEX_STOCKS = [
  "RELIANCE.NS","HDFCBANK.NS","ICICIBANK.NS","INFY.NS","TCS.NS",
  "BHARTIARTL.NS","ITC.NS","LT.NS","KOTAKBANK.NS","AXISBANK.NS",
  "SBIN.NS","HINDUNILVR.NS","BAJFINANCE.NS","MARUTI.NS","ASIANPAINT.NS",
  "M&M.NS","SUNPHARMA.NS","HCLTECH.NS","ULTRACEMCO.NS","TITAN.NS",
  "NTPC.NS","POWERGRID.NS","WIPRO.NS","NESTLEIND.NS","TATAMOTORS.NS",
  "TECHM.NS","TATASTEEL.NS","JSWSTEEL.NS","ADANIPORTS.NS","INDUSINDBK.NS",
];

const cache = new Map<string, { at: number; data: Quote[] }>();
const TTL_MS = 25_000;

async function cachedYahoo(symbols: string[]): Promise<Quote[]> {
  const key = [...symbols].sort().join(",");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  try {
    const data = await fetchYahoo(symbols);
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (err) {
    if (hit) return hit.data;
    throw err;
  }
}

export const getQuotes = createServerFn({ method: "GET" })
  .inputValidator(z.object({ symbols: z.array(z.string()).min(1).max(60) }))
  .handler(async ({ data }) => cachedYahoo(data.symbols));

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

export const getDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const [indices, sectors, stocks] = await Promise.all([
    cachedYahoo(INDICES),
    cachedYahoo(SECTORS.map((s) => s.symbol)),
    cachedYahoo(NIFTY_STOCKS),
  ]);
  const indexMap = Object.fromEntries(indices.map((q) => [q.symbol, q]));
  const sectorList = sectors.map((q) => {
    const meta = SECTORS.find((s) => s.symbol === q.symbol);
    return { ...q, key: meta?.key ?? q.symbol, label: meta?.name ?? q.name };
  });
  const s = statsFor(stocks);
  const sortedSectors = [...sectorList].sort((a, b) => b.changePct - a.changePct);
  const bullsPct = (s.advance / Math.max(1, s.advance + s.decline)) * 100;
  // crude PCR proxy from breadth (real PCR loaded on option chain page); leave 0 if unknown
  const pcr = 0;
  const commentary = buildPulse({
    nifty: indexMap["^NSEI"],
    bank: indexMap["^NSEBANK"],
    sensex: indexMap["^BSESN"],
    vix: indexMap["^INDIAVIX"],
    bullsPct,
    advance: s.advance,
    decline: s.decline,
    topSector: sortedSectors[0],
    bottomSector: sortedSectors[sortedSectors.length - 1],
    topGainer: s.gainers[0],
    topLoser: s.losers[0],
    pcr,
  });
  return {
    nifty: indexMap["^NSEI"] ?? null,
    sensex: indexMap["^BSESN"] ?? null,
    bankNifty: indexMap["^NSEBANK"] ?? null,
    vix: indexMap["^INDIAVIX"] ?? null,
    sectors: sectorList,
    ...s,
    commentary,
    updatedAt: Date.now(),
  };
});

export const getIndexConstituents = createServerFn({ method: "GET" })
  .inputValidator(z.object({ index: z.enum(["nifty", "banknifty", "sensex"]) }))
  .handler(async ({ data }) => {
    const map = { nifty: NIFTY_STOCKS, banknifty: BANKNIFTY_STOCKS, sensex: SENSEX_STOCKS };
    const stocks = await cachedYahoo(map[data.index]);
    return { ...statsFor(stocks), updatedAt: Date.now() };
  });

export const getSectorDetail = createServerFn({ method: "GET" })
  .inputValidator(z.object({ key: z.string() }))
  .handler(async ({ data }) => {
    const sector = SECTORS.find((s) => s.key === data.key);
    if (!sector) throw new Error("Unknown sector");
    const list = SECTOR_STOCKS[data.key] ?? [];
    const [idxArr, stocks] = await Promise.all([
      cachedYahoo([sector.symbol]),
      list.length ? cachedYahoo(list) : Promise.resolve([]),
    ]);
    return {
      sector: { ...sector, quote: idxArr[0] ?? null },
      ...statsFor(stocks),
      updatedAt: Date.now(),
    };
  });
