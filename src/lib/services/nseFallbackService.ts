import type { OptionChain, OcRow, OcLeg, SrLevel } from "../nse.functions";
import { getEodData } from "./persistentCache";

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

function classifyOcSignal(side: "ce" | "pe", oiChgPct: number): "Strong Long Buildup" | "Weak Long Buildup" | "Strong Short Buildup" | "Weak Short Buildup" | "Strong Short Cover" | "Weak Short Cover" | "Strong Long Unwinding" | "Weak Long Unwinding" | "Neutral" {
  const m = Math.abs(oiChgPct);
  if (m < 1.5) return "Neutral";
  const strong = m >= 15;
  if (side === "ce") {
    if (oiChgPct > 0) return strong ? "Strong Short Buildup" : "Weak Short Buildup";
    return strong ? "Strong Short Cover" : "Weak Short Cover";
  } else {
    if (oiChgPct > 0) return strong ? "Strong Short Buildup" : "Weak Short Buildup";
    return strong ? "Strong Short Cover" : "Weak Short Cover";
  }
}

function buildLeg(side: "ce" | "pe", oi: number, oiChg: number, prevOi: number, volume: number, ltp: number, iv = 0): OcLeg {
  const oiChgPct = prevOi > 0 ? (oiChg / prevOi) * 100 : 0;
  return { oi, oiChg, oiChgPct, volume, ltp, iv, signal: classifyOcSignal(side, oiChgPct) };
}

function nextWeeklyExpiries(symbol: string, count = 6): string[] {
  const dow = symbol === "SENSEX" ? 5 : 4; // 4=Thu, 5=Fri
  const out: string[] = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < count * 7 + 7 && out.length < count; i++) {
    if (d.getUTCDay() === dow) {
      const day = d.getUTCDate().toString().padStart(2, "0");
      const month = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
      const year = d.getUTCFullYear();
      out.push(`${day}-${month}-${year}`);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function filterMonthlyExpiries(expiries: string[]): string[] {
  const byMonth = new Map<string, string>();
  for (const e of expiries) {
    const parsed = new Date(e);
    if (isNaN(parsed.getTime())) {
      byMonth.set(e.slice(3), e);
      continue;
    }
    const key = `${parsed.getUTCFullYear()}-${parsed.getUTCMonth()}`;
    const prev = byMonth.get(key);
    if (!prev || new Date(e) > new Date(prev)) byMonth.set(key, e);
  }
  return [...byMonth.values()];
}

export function synthOptionChain(symbol: string, spot: number, expiry?: string): OptionChain {
  const step = symbol === "BANKNIFTY" ? 100 : symbol === "SENSEX" ? 100 : 50;
  const center = Math.round(spot / step) * step;
  const rows: OcRow[] = [];
  for (let i = -10; i <= 10; i++) {
    const strike = center + i * step;
    const dist = Math.abs(strike - spot) / spot;
    const base = Math.round(50_000 * Math.exp(-dist * 18));
    const noise = () => 0.5 + Math.random();
    const ceOi = Math.round(base * noise() * (i < 0 ? 0.6 : 1.2));
    const peOi = Math.round(base * noise() * (i > 0 ? 0.6 : 1.2));
    const ceOiChg = Math.round(ceOi * (Math.random() - 0.4) * 0.5);
    const peOiChg = Math.round(peOi * (Math.random() - 0.4) * 0.5);
    const ce = buildLeg("ce", ceOi, ceOiChg, Math.max(1, ceOi - ceOiChg), Math.round(ceOi * (1 + Math.random() * 4)), Math.max(0.5, spot - strike + Math.random() * 80), 12 + Math.random() * 8);
    const pe = buildLeg("pe", peOi, peOiChg, Math.max(1, peOi - peOiChg), Math.round(peOi * (1 + Math.random() * 4)), Math.max(0.5, strike - spot + Math.random() * 80), 12 + Math.random() * 8);
    rows.push({ strike, ce, pe, straddle: (ce?.ltp ?? 0) + (pe?.ltp ?? 0), pcr: ce && ce.oi ? (pe?.oi ?? 0) / ce.oi : 0 });
  }
  let expiries = nextWeeklyExpiries(symbol, 6);
  if (symbol === "BANKNIFTY") expiries = filterMonthlyExpiries(expiries);
  return computeOcAggregates({
    symbol,
    spot,
    expiry: expiry ?? expiries[0] ?? "WEEKLY",
    expiries,
    rows,
    maxCeOiStrike: 0,
    maxPeOiStrike: 0,
    maxCeVolStrike: 0,
    maxPeVolStrike: 0,
    second: { ceOi: 0, peOi: 0, ceVol: 0, peVol: 0 },
    totals: { ceOi: 0, peOi: 0, ceOiChg: 0, peOiChg: 0, ceVol: 0, peVol: 0 },
    levels: [],
    source: "fallback",
    updatedAt: Date.now(),
  });
}

function computeOcAggregates(oc: OptionChain): OptionChain {
  const ceOis = oc.rows.map((r) => ({ s: r.strike, v: r.ce?.oi ?? 0 })).sort((a, b) => b.v - a.v);
  const peOis = oc.rows.map((r) => ({ s: r.strike, v: r.pe?.oi ?? 0 })).sort((a, b) => b.v - a.v);
  const ceVols = oc.rows.map((r) => ({ s: r.strike, v: r.ce?.volume ?? 0 })).sort((a, b) => b.v - a.v);
  const peVols = oc.rows.map((r) => ({ s: r.strike, v: r.pe?.volume ?? 0 })).sort((a, b) => b.v - a.v);
  const ceOiShift = oc.rows.map((r) => ({ s: r.strike, v: r.ce?.oiChg ?? 0 })).sort((a, b) => b.v - a.v);
  const peOiShift = oc.rows.map((r) => ({ s: r.strike, v: r.pe?.oiChg ?? 0 })).sort((a, b) => b.v - a.v);
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
  const r1 = ceOis[0]?.s ?? 0;
  const r2 = ceOiShift[0]?.s ?? 0;
  const s1 = peOis[0]?.s ?? 0;
  const s2 = peOiShift[0]?.s ?? 0;
  oc.levels = [
    { strike: r1, kind: "R1", basis: "oi" },
    { strike: r2 && r2 !== r1 ? r2 : (ceOis[1]?.s ?? r1), kind: "R2", basis: "oiShift" },
    { strike: s1, kind: "S1", basis: "oi" },
    { strike: s2 && s2 !== s1 ? s2 : (peOis[1]?.s ?? s1), kind: "S2", basis: "oiShift" },
  ];
  return oc;
}

function num(n: unknown, fallback = 0): number {
  const v = typeof n === "string" ? parseFloat(n) : (n as number);
  return typeof v === "number" && isFinite(v) ? v : fallback;
}

async function fetchOptionChainSensex(spot: number, expiry?: string): Promise<OptionChain> {
  return synthOptionChain("SENSEX", spot || 80000, expiry);
}

export const nseFallbackService = {
  async getOptionChain(symbol: string, expiry?: string): Promise<OptionChain> {
    if (symbol === "SENSEX") {
      try {
        const res = await fetch(
          `https://query2.finance.yahoo.com/v7/finance/spark?symbols=%5EBSESN&range=1d&interval=5m`,
          { headers: { "User-Agent": HEADERS_BASE["User-Agent"], Accept: "application/json", Referer: "https://finance.yahoo.com/" } }
        );
        const json = (await res.json()) as { spark?: { result?: Array<{ response?: Array<{ meta?: Record<string, number> }> }> } };
        const meta = json.spark?.result?.[0]?.response?.[0]?.meta;
        const spot = num(meta?.regularMarketPrice, 80000);
        return fetchOptionChainSensex(spot, expiry);
      } catch {
        return fetchOptionChainSensex(80000, expiry);
      }
    }
    const contractPath = `/api/option-chain-contract-info?symbol=${encodeURIComponent(symbol)}`;
    try {
      type ContractInfo = { expiryDates?: string[] };
      type Resp = {
        records: {
          expiryDates: string[];
          underlyingValue: number;
          data: Array<{
            strikePrice: number;
            expiryDate?: string;
            expiryDates?: string;
            CE?: { openInterest: number; changeinOpenInterest: number; totalTradedVolume: number; lastPrice: number; impliedVolatility?: number };
            PE?: { openInterest: number; changeinOpenInterest: number; totalTradedVolume: number; lastPrice: number; impliedVolatility?: number };
          }>;
        };
      };
      const contracts = await nseGet<ContractInfo>(contractPath);
      const allExpiries = contracts.expiryDates ?? [];
      const expiries = symbol === "BANKNIFTY" ? filterMonthlyExpiries(allExpiries) : allExpiries;
      const chosen = expiry && expiries.includes(expiry) ? expiry : (expiries[0] ?? allExpiries[0]);
      if (!chosen) throw new Error("No option-chain expiry");
      const path = `/api/option-chain-v3?type=Indices&symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(chosen)}`;
      const json = await nseGet<Resp>(path);
      const spot = json.records.underlyingValue;
      if (!json.records.data?.length || !spot) throw new Error("Empty option-chain rows");
      const rowMap = new Map<number, OcRow>();
      for (const d of json.records.data) {
        const ce = d.CE
          ? buildLeg("ce", d.CE.openInterest, d.CE.changeinOpenInterest, Math.max(1, d.CE.openInterest - d.CE.changeinOpenInterest), d.CE.totalTradedVolume, d.CE.lastPrice, d.CE.impliedVolatility ?? 0)
          : null;
        const pe = d.PE
          ? buildLeg("pe", d.PE.openInterest, d.PE.changeinOpenInterest, Math.max(1, d.PE.openInterest - d.PE.changeinOpenInterest), d.PE.totalTradedVolume, d.PE.lastPrice, d.PE.impliedVolatility ?? 0)
          : null;
        rowMap.set(d.strikePrice, {
          strike: d.strikePrice,
          ce,
          pe,
          straddle: (ce?.ltp ?? 0) + (pe?.ltp ?? 0),
          pcr: ce && ce.oi ? (pe?.oi ?? 0) / ce.oi : 0,
        });
      }
      const sorted = [...rowMap.values()].sort((a, b) => a.strike - b.strike);
      const idx = sorted.findIndex((r) => r.strike >= spot);
      const start = Math.max(0, idx - 10);
      const slice = sorted.slice(start, start + 21);
      return computeOcAggregates({
        symbol,
        spot,
        expiry: chosen,
        expiries,
        rows: slice,
        maxCeOiStrike: 0,
        maxPeOiStrike: 0,
        maxCeVolStrike: 0,
        maxPeVolStrike: 0,
        second: { ceOi: 0, peOi: 0, ceVol: 0, peVol: 0 },
        totals: { ceOi: 0, peOi: 0, ceOiChg: 0, peOiChg: 0, ceVol: 0, peVol: 0 },
        levels: [],
        source: "nse",
        updatedAt: Date.now(),
      });
    } catch {
      const cacheKey = `option_chain_${symbol}_${expiry || "default"}`;
      const cachedData = await getEodData(cacheKey);
      if (cachedData) {
        return {
          ...cachedData,
          isEod: true,
        };
      }
      const fallbackSpots: Record<string, number> = { NIFTY: 24500, BANKNIFTY: 52000 };
      return synthOptionChain(symbol, fallbackSpots[symbol] ?? 1000, expiry);
    }
  },
};
