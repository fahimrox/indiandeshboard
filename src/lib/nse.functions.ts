import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// NSE scraper. NSE requires a cookie session — we hit the homepage first,
// reuse cookies for the JSON API, and cache responses to dodge rate limits.
// If the upstream blocks the server's IP (common on cloud edge), we fall back
// to a synthesized response so the UI keeps working.

let cookieStore: { value: string; at: number } | null = null;
const COOKIE_TTL = 5 * 60_000;

const HEADERS_BASE: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.nseindia.com/",
};

async function getCookies(): Promise<string> {
  if (cookieStore && Date.now() - cookieStore.at < COOKIE_TTL) return cookieStore.value;
  const res = await fetch("https://www.nseindia.com/option-chain", {
    headers: HEADERS_BASE,
  });
  const raw = res.headers.get("set-cookie") ?? "";
  const cookie = raw
    .split(/,(?=[^ ])/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
  cookieStore = { value: cookie, at: Date.now() };
  return cookie;
}

async function nseGet<T>(path: string): Promise<T> {
  const cookie = await getCookies();
  const res = await fetch(`https://www.nseindia.com${path}`, {
    headers: { ...HEADERS_BASE, Cookie: cookie },
  });
  if (!res.ok) throw new Error(`NSE ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 30_000;

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data as T;
  try {
    const data = await fn();
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (err) {
    if (hit) return hit.data as T;
    throw err;
  }
}

// ============ OPTION CHAIN ============

export type OcSignal =
  | "Strong Long Buildup"
  | "Weak Long Buildup"
  | "Strong Short Buildup"
  | "Weak Short Buildup"
  | "Strong Short Cover"
  | "Weak Short Cover"
  | "Strong Long Unwinding"
  | "Weak Long Unwinding"
  | "Neutral";

export type OcLeg = {
  oi: number;
  oiChg: number;
  oiChgPct: number;
  volume: number;
  ltp: number;
  iv: number;
  signal: OcSignal;
} | null;

export type OcRow = {
  strike: number;
  ce: OcLeg;
  pe: OcLeg;
  straddle: number;
  pcr: number;
};

export type SrLevel = { strike: number; kind: "R1" | "R2" | "S1" | "S2"; basis: "oi" | "oiShift" };

export type OptionChain = {
  symbol: string;
  spot: number;
  expiry: string;
  rows: OcRow[];
  maxCeOiStrike: number;
  maxPeOiStrike: number;
  maxCeVolStrike: number;
  maxPeVolStrike: number;
  second: { ceOi: number; peOi: number; ceVol: number; peVol: number };
  totals: { ceOi: number; peOi: number; ceOiChg: number; peOiChg: number; ceVol: number; peVol: number };
  levels: SrLevel[];
  source: "nse" | "fallback";
  updatedAt: number;
};

function classifyOcSignal(side: "ce" | "pe", oiChgPct: number): OcSignal {
  const m = Math.abs(oiChgPct);
  if (m < 1.5) return "Neutral";
  const strong = m >= 15;
  if (side === "ce") {
    // CE writers are bearish; CE OI up = short buildup (bearish for spot)
    if (oiChgPct > 0) return strong ? "Strong Short Buildup" : "Weak Short Buildup";
    return strong ? "Strong Short Cover" : "Weak Short Cover";
  } else {
    // PE writers are bullish; PE OI up = short buildup on PE (bullish for spot)
    if (oiChgPct > 0) return strong ? "Strong Short Buildup" : "Weak Short Buildup";
    return strong ? "Strong Short Cover" : "Weak Short Cover";
  }
}

function synthOptionChain(symbol: string, spot: number): OptionChain {
  const step = symbol === "BANKNIFTY" ? 100 : 50;
  const center = Math.round(spot / step) * step;
  const rows: OcRow[] = [];
  for (let i = -7; i <= 7; i++) {
    const strike = center + i * step;
    const dist = Math.abs(strike - spot) / spot;
    const base = Math.round(50_000 * Math.exp(-dist * 18));
    const noise = () => 0.5 + Math.random();
    const ceOi = Math.round(base * noise() * (i < 0 ? 0.6 : 1.2));
    const peOi = Math.round(base * noise() * (i > 0 ? 0.6 : 1.2));
    rows.push({
      strike,
      ce: {
        oi: ceOi,
        oiChg: Math.round(ceOi * (Math.random() - 0.4) * 0.5),
        volume: Math.round(ceOi * (1 + Math.random() * 4)),
        ltp: Math.max(0.5, spot - strike + Math.random() * 80),
      },
      pe: {
        oi: peOi,
        oiChg: Math.round(peOi * (Math.random() - 0.4) * 0.5),
        volume: Math.round(peOi * (1 + Math.random() * 4)),
        ltp: Math.max(0.5, strike - spot + Math.random() * 80),
      },
    });
  }
  return computeOcAggregates({
    symbol,
    spot,
    expiry: "WEEKLY",
    rows,
    source: "fallback",
    updatedAt: Date.now(),
  } as OptionChain);
}

function computeOcAggregates(oc: OptionChain): OptionChain {
  const ceOis = oc.rows
    .map((r) => ({ s: r.strike, v: r.ce?.oi ?? 0 }))
    .sort((a, b) => b.v - a.v);
  const peOis = oc.rows
    .map((r) => ({ s: r.strike, v: r.pe?.oi ?? 0 }))
    .sort((a, b) => b.v - a.v);
  const ceVols = oc.rows
    .map((r) => ({ s: r.strike, v: r.ce?.volume ?? 0 }))
    .sort((a, b) => b.v - a.v);
  const peVols = oc.rows
    .map((r) => ({ s: r.strike, v: r.pe?.volume ?? 0 }))
    .sort((a, b) => b.v - a.v);
  oc.maxCeOiStrike = ceOis[0]?.s ?? 0;
  oc.maxPeOiStrike = peOis[0]?.s ?? 0;
  oc.maxCeVolStrike = ceVols[0]?.s ?? 0;
  oc.maxPeVolStrike = peVols[0]?.s ?? 0;
  oc.second = {
    ceOi: ceOis[1]?.s ?? 0,
    peOi: peOis[1]?.s ?? 0,
    ceVol: ceVols[1]?.s ?? 0,
    peVol: peVols[1]?.s ?? 0,
  };
  oc.totals = {
    ceOi: oc.rows.reduce((a, r) => a + (r.ce?.oi ?? 0), 0),
    peOi: oc.rows.reduce((a, r) => a + (r.pe?.oi ?? 0), 0),
    ceOiChg: oc.rows.reduce((a, r) => a + (r.ce?.oiChg ?? 0), 0),
    peOiChg: oc.rows.reduce((a, r) => a + (r.pe?.oiChg ?? 0), 0),
    ceVol: oc.rows.reduce((a, r) => a + (r.ce?.volume ?? 0), 0),
    peVol: oc.rows.reduce((a, r) => a + (r.pe?.volume ?? 0), 0),
  };
  return oc;
}

async function fetchOptionChain(symbol: string): Promise<OptionChain> {
  const indexSyms = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];
  const path = indexSyms.includes(symbol)
    ? `/api/option-chain-indices?symbol=${symbol}`
    : `/api/option-chain-equities?symbol=${symbol}`;
  try {
    type Resp = {
      records: {
        expiryDates: string[];
        underlyingValue: number;
        data: Array<{
          strikePrice: number;
          expiryDate: string;
          CE?: { openInterest: number; changeinOpenInterest: number; totalTradedVolume: number; lastPrice: number };
          PE?: { openInterest: number; changeinOpenInterest: number; totalTradedVolume: number; lastPrice: number };
        }>;
      };
    };
    const json = await nseGet<Resp>(path);
    const spot = json.records.underlyingValue;
    const expiry = json.records.expiryDates[0];
    const rowMap = new Map<number, OcRow>();
    for (const d of json.records.data) {
      if (d.expiryDate !== expiry) continue;
      rowMap.set(d.strikePrice, {
        strike: d.strikePrice,
        ce: d.CE
          ? {
              oi: d.CE.openInterest,
              oiChg: d.CE.changeinOpenInterest,
              volume: d.CE.totalTradedVolume,
              ltp: d.CE.lastPrice,
            }
          : null,
        pe: d.PE
          ? {
              oi: d.PE.openInterest,
              oiChg: d.PE.changeinOpenInterest,
              volume: d.PE.totalTradedVolume,
              ltp: d.PE.lastPrice,
            }
          : null,
      });
    }
    const sorted = [...rowMap.values()].sort((a, b) => a.strike - b.strike);
    // keep 15 strikes around spot
    const idx = sorted.findIndex((r) => r.strike >= spot);
    const start = Math.max(0, idx - 7);
    const slice = sorted.slice(start, start + 15);
    return computeOcAggregates({
      symbol,
      spot,
      expiry,
      rows: slice,
      source: "nse",
      updatedAt: Date.now(),
    } as OptionChain);
  } catch (err) {
    // best-effort fallback near approximate spot
    const fallbackSpots: Record<string, number> = {
      NIFTY: 24500,
      BANKNIFTY: 52000,
      FINNIFTY: 23500,
    };
    return synthOptionChain(symbol, fallbackSpots[symbol] ?? 1000);
  }
}

export const getOptionChain = createServerFn({ method: "GET" })
  .inputValidator(z.object({ symbol: z.string().default("NIFTY"), spot: z.number().optional() }))
  .handler(async ({ data }) => {
    return cached(`oc:${data.symbol}`, async () => {
      const oc = await fetchOptionChain(data.symbol);
      if (data.spot && oc.source === "fallback") {
        return synthOptionChain(data.symbol, data.spot);
      }
      return oc;
    });
  });

// ============ F&O STOCKS w/ BUILDUP ============

export type FnoStock = {
  symbol: string;
  ltp: number;
  changePct: number;
  volume: number;
  oi: number;
  oiChgPct: number;
  buildup: "Long Buildup" | "Short Buildup" | "Short Covering" | "Long Unwinding" | "Neutral";
  volumeShocker: boolean;
  aiSentiment: number; // -100..100
};

type FnoResponse = { data: FnoStock[]; source: "nse" | "fallback"; updatedAt: number };
type YahooMiniQuote = { price: number; prevClose: number; changePct: number };

function classifyBuildup(priceChg: number, oiChg: number): FnoStock["buildup"] {
  if (Math.abs(priceChg) < 0.1 && Math.abs(oiChg) < 0.5) return "Neutral";
  if (priceChg > 0 && oiChg > 0) return "Long Buildup";
  if (priceChg < 0 && oiChg > 0) return "Short Buildup";
  if (priceChg > 0 && oiChg < 0) return "Short Covering";
  if (priceChg < 0 && oiChg < 0) return "Long Unwinding";
  return "Neutral";
}

const FNO_FALLBACK_SYMBOLS = [
  "RELIANCE","TCS","HDFCBANK","ICICIBANK","INFY","SBIN","BHARTIARTL","ITC","LT","KOTAKBANK",
  "AXISBANK","HINDUNILVR","BAJFINANCE","MARUTI","ASIANPAINT","SUNPHARMA","TITAN","WIPRO","ULTRACEMCO","NESTLEIND",
  "TATAMOTORS","M&M","TATASTEEL","JSWSTEEL","ADANIENT","ADANIPORTS","POWERGRID","NTPC","ONGC","COALINDIA",
  "HCLTECH","TECHM","DRREDDY","CIPLA","DIVISLAB","GRASIM","HINDALCO","BAJAJFINSV","BRITANNIA","EICHERMOT",
  "BPCL","IOC","HEROMOTOCO","BAJAJ-AUTO","SHREECEM","UPL","APOLLOHOSP","INDUSINDBK","SBILIFE","HDFCLIFE",
];

function num(n: unknown, fallback = 0): number {
  const v = typeof n === "string" ? parseFloat(n) : (n as number);
  return typeof v === "number" && isFinite(v) ? v : fallback;
}

function stableNoise(symbol: string, min: number, max: number) {
  const dayKey = new Date().toISOString().slice(0, 10);
  let hash = 0;
  for (const ch of `${symbol}:${dayKey}`) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return min + (hash / 0xffffffff) * (max - min);
}

function synthFno(): FnoStock[] {
  return FNO_FALLBACK_SYMBOLS.map((symbol) => {
    const changePct = stableNoise(symbol, -3, 3);
    const oiChgPct = stableNoise(`${symbol}:oi`, -10, 10);
    const ltp = stableNoise(`${symbol}:ltp`, 100, 3100);
    const volume = Math.floor(stableNoise(`${symbol}:vol`, 100000, 5100000));
    const oi = Math.floor(stableNoise(`${symbol}:oiBase`, 50000, 8050000));
    const buildup = classifyBuildup(changePct, oiChgPct);
    const aiSentiment = Math.max(-100, Math.min(100, Math.round(changePct * 12 + oiChgPct * 0.5)));
    return { symbol, ltp, changePct, volume, oi, oiChgPct, buildup, volumeShocker: false, aiSentiment };
  }).sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}

async function fetchYahooMiniQuotes(symbols: string[]): Promise<Map<string, YahooMiniQuote>> {
  const out = new Map<string, YahooMiniQuote>();
  const CHUNK = 20;
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += CHUNK) {
    chunks.push(symbols.slice(i, i + CHUNK));
  }
  const results = await Promise.all(chunks.map(async (chunk) => {
    const url = `https://query2.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(
      chunk.map((s) => `${s}.NS`).join(","),
    )}&range=1d&interval=5m`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": HEADERS_BASE["User-Agent"],
        Accept: "application/json, text/plain, */*",
        Referer: "https://finance.yahoo.com/",
        Origin: "https://finance.yahoo.com",
      },
    });
    if (!res.ok) return [] as Array<[string, YahooMiniQuote]>;
    const json = (await res.json()) as {
      spark?: { result?: Array<{ symbol: string; response?: Array<{ meta?: Record<string, number | string> }> }> };
    };
    const rows: Array<[string, YahooMiniQuote]> = [];
    for (const r of json.spark?.result ?? []) {
      const meta = r.response?.[0]?.meta;
      if (!meta) continue;
      const symbol = String(meta.symbol ?? r.symbol).replace(".NS", "");
      const price = num(meta.regularMarketPrice);
      const prevClose = num(meta.chartPreviousClose ?? meta.previousClose, price);
      if (price > 0) rows.push([symbol, { price, prevClose, changePct: prevClose ? ((price - prevClose) / prevClose) * 100 : 0 }]);
    }
    return rows;
  }));
  for (const rows of results) for (const [symbol, quote] of rows) out.set(symbol, quote);
  return out;
}

async function fetchFnoStocks(): Promise<FnoResponse> {
  try {
    type Resp = {
      data: Array<{
        symbol: string;
        lastPrice?: number | string;
        underlyingValue?: number | string;
        pChange?: number | string;
        totalTradedVolume?: number | string;
        volume?: number | string;
        openInterest?: number | string;
        latestOI?: number | string;
        prevOI?: number | string;
        changeInOI?: number | string;
        pchangeinOpenInterest?: number | string;
        avgInOI?: number | string;
      }>;
    };
    const json = await nseGet<Resp>("/api/live-analysis-oi-spurts-underlyings");
    if (!json?.data?.length) throw new Error("empty");
    const quotes = await fetchYahooMiniQuotes(json.data.map((d) => String(d.symbol ?? "")).filter(Boolean));
    const stocks: FnoStock[] = json.data
      .map((d) => {
        const symbol = String(d.symbol ?? "");
        const quote = quotes.get(symbol);
        const ltp = quote?.price || num(d.lastPrice ?? d.underlyingValue);
        const changePct = quote?.changePct ?? num(d.pChange);
        const oi = num(d.openInterest ?? d.latestOI);
        const prevOI = num(d.prevOI);
        const oiChgRaw = num(d.changeInOI);
        const oiChg = num(d.pchangeinOpenInterest ?? d.avgInOI, prevOI ? (oiChgRaw / prevOI) * 100 : 0);
        const buildup = classifyBuildup(changePct, oiChg);
        const aiSentiment = Math.max(
          -100,
          Math.min(100, Math.round(changePct * 8 + (oiChg * (buildup === "Long Buildup" ? 1 : -1)) * 0.5)),
        );
        return {
          symbol,
          ltp,
          changePct,
          volume: num(d.totalTradedVolume ?? d.volume),
          oi,
          oiChgPct: oiChg,
          buildup,
          volumeShocker: false,
          aiSentiment,
        };
      })
      .filter((s) => s.symbol && s.ltp > 0)
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
    if (!stocks.length) throw new Error("no valid rows");
    const volSort = [...stocks].sort((a, b) => b.volume - a.volume);
    const cutoff = volSort[Math.floor(volSort.length * 0.1)]?.volume ?? Infinity;
    for (const s of stocks) if (s.volume >= cutoff) s.volumeShocker = true;
    return { data: stocks, source: "nse", updatedAt: Date.now() };
  } catch (err) {
    return { data: synthFno(), source: "fallback", updatedAt: Date.now() };
  }
}

export const getFnoStocks = createServerFn({ method: "GET" }).handler(async () =>
  cached("fno-stocks", fetchFnoStocks),
);

