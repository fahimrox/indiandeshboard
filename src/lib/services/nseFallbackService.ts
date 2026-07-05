import type { OptionChain, OcRow, OcLeg, SrLevel } from "../nse.functions";
import { getEodData } from "./persistentCache";
import { NSE_INDEX_NAME, type IndexQuote } from "./indexRegistry";

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

export const nseFallbackService = {
  /**
   * Live sector/broad index quotes from NSE's public `allIndices` snapshot.
   * Accepts canonical registry keys, returns one IndexQuote per requested key
   * that NSE carries (matched by the registry's NSE index name). Used as the
   * first fallback when FYERS is unavailable. No fabrication — unmatched keys
   * are simply omitted.
   */
  async getAllIndices(keys: string[]): Promise<IndexQuote[]> {
    type Row = {
      index?: string;
      indexSymbol?: string;
      last?: number | string;
      percentChange?: number | string;
      previousClose?: number | string;
    };
    const json = await nseGet<{ data?: Row[] }>("/api/allIndices");
    const rows = json.data ?? [];
    const byName = new Map<string, Row>();
    for (const r of rows) {
      if (r.index) byName.set(r.index.toUpperCase().trim(), r);
    }
    const out: IndexQuote[] = [];
    for (const key of keys) {
      const name = NSE_INDEX_NAME[key];
      if (!name) continue;
      const r = byName.get(name.toUpperCase().trim());
      if (!r) continue;
      const price = num(r.last);
      if (!price) continue;
      out.push({
        key,
        price,
        changePct: num(r.percentChange),
        prevClose: num(r.previousClose, price),
      });
    }
    return out;
  },

  async getOptionChain(symbol: string, expiry?: string): Promise<OptionChain> {
    if (symbol === "SENSEX") {
      // No reliable BSE option-chain scraper from the edge. Let the caller fall
      // back to EOD cache / FAIL instead of fabricating a synthetic chain.
      throw new Error("SENSEX option chain not available from NSE scraper");
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
    } catch (err) {
      // Real data only: try the persisted EOD snapshot, otherwise propagate the
      // failure so the caller shows a FAIL state (no synthetic fabrication).
      const cacheKey = `option_chain_${symbol}_${expiry || "default"}`;
      const cachedData = await getEodData(cacheKey);
      if (cachedData) {
        return {
          ...cachedData,
          isEod: true,
        };
      }
      throw err instanceof Error ? err : new Error(`NSE option chain failed for ${symbol}`);
    }
  },
};
