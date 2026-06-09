import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Yahoo Finance public spark endpoint — no token required.
// Used as a free, reliable source for NSE/BSE quotes.

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

async function fetchYahoo(symbols: string[]): Promise<Quote[]> {
  const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(
    symbols.join(","),
  )}&range=1d&interval=5m`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      Accept: "application/json",
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
      open: meta.regularMarketDayHigh && meta.regularMarketDayLow ? (meta.regularMarketDayHigh + meta.regularMarketDayLow) / 2 : price,
      marketState: meta.marketState ?? "UNKNOWN",
      currency: meta.currency ?? "INR",
      exchange: meta.fullExchangeName ?? meta.exchangeName ?? "",
    });
  }
  return out;
}

const INDICES = ["^NSEI", "^BSESN", "^NSEBANK"];
const SECTORS = [
  { symbol: "^CNXIT", name: "IT" },
  { symbol: "^CNXPHARMA", name: "Pharma" },
  { symbol: "^CNXAUTO", name: "Auto" },
  { symbol: "^CNXENERGY", name: "Energy" },
  { symbol: "^CNXFMCG", name: "FMCG" },
  { symbol: "^CNXMETAL", name: "Metal" },
  { symbol: "NIFTY_FIN_SERVICE.NS", name: "Finance" },
  { symbol: "^NSEBANK", name: "Banking" },
];
// Top NIFTY 50 constituents by weight (subset for gainers/losers card)
const NIFTY_STOCKS = [
  "RELIANCE.NS","HDFCBANK.NS","ICICIBANK.NS","INFY.NS","TCS.NS",
  "BHARTIARTL.NS","ITC.NS","LT.NS","KOTAKBANK.NS","AXISBANK.NS",
  "SBIN.NS","HINDUNILVR.NS","BAJFINANCE.NS","MARUTI.NS","ASIANPAINT.NS",
  "M&M.NS","SUNPHARMA.NS","HCLTECH.NS","ULTRACEMCO.NS","TITAN.NS",
  "NTPC.NS","POWERGRID.NS","WIPRO.NS","NESTLEIND.NS","TATAMOTORS.NS",
];

// Simple in-memory cache (per server instance) to dodge upstream rate limits.
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
    if (hit) return hit.data; // serve stale on upstream error
    throw err;
  }
}

export const getQuotes = createServerFn({ method: "GET" })
  .inputValidator(z.object({ symbols: z.array(z.string()).min(1).max(60) }))
  .handler(async ({ data }) => cachedYahoo(data.symbols));

export const getDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const [indices, sectors, stocks] = await Promise.all([
    cachedYahoo(INDICES),
    cachedYahoo(SECTORS.map((s) => s.symbol)),
    cachedYahoo(NIFTY_STOCKS),
  ]);
  const indexMap = Object.fromEntries(indices.map((q) => [q.symbol, q]));
  const sectorList = sectors.map((q) => ({
    ...q,
    label: SECTORS.find((s) => s.symbol === q.symbol)?.name ?? q.name,
  }));
  const sorted = [...stocks].sort((a, b) => b.changePct - a.changePct);
  const gainers = sorted.filter((s) => s.changePct > 0).slice(0, 5);
  const losers = sorted.filter((s) => s.changePct < 0).slice(-5).reverse();
  const advance = stocks.filter((s) => s.changePct > 0).length;
  const decline = stocks.filter((s) => s.changePct < 0).length;
  const unchanged = stocks.length - advance - decline;
  const avgChange = stocks.reduce((a, s) => a + s.changePct, 0) / (stocks.length || 1);
  return {
    nifty: indexMap["^NSEI"] ?? null,
    sensex: indexMap["^BSESN"] ?? null,
    bankNifty: indexMap["^NSEBANK"] ?? null,
    sectors: sectorList,
    stocks,
    gainers,
    losers,
    advance,
    decline,
    unchanged,
    avgChange,
    updatedAt: Date.now(),
  };
});
