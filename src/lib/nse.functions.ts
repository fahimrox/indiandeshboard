import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { isMarketOpenIst } from "./market-hours";

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
const TTL = 8_000;

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
  expiries: string[];
  rows: OcRow[];
  maxCeOiStrike: number;
  maxPeOiStrike: number;
  maxCeVolStrike: number;
  maxPeVolStrike: number;
  second: { ceOi: number; peOi: number; ceVol: number; peVol: number };
  totals: { ceOi: number; peOi: number; ceOiChg: number; peOiChg: number; ceVol: number; peVol: number };
  levels: SrLevel[];
  source: "nse" | "fallback" | "fyers" | "angelone";
  updatedAt: number;
  isEod?: boolean;
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

function buildLeg(side: "ce" | "pe", oi: number, oiChg: number, prevOi: number, volume: number, ltp: number, iv = 0): OcLeg {
  const oiChgPct = prevOi > 0 ? (oiChg / prevOi) * 100 : 0;
  return { oi, oiChg, oiChgPct, volume, ltp, iv, signal: classifyOcSignal(side, oiChgPct) };
}

function nextWeeklyExpiries(symbol: string, count = 6): string[] {
  // NIFTY: Thursday, BANKNIFTY: monthly-only (last weekly of month), SENSEX: Friday.
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
  // Keep only the last expiry per (month, year).
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

// NOTE: The live option-chain pipeline lives entirely in marketDataLayer
// (FYERS -> Angel One -> NSE scraper -> EOD cache). No synthetic/mock option
// chain is generated anywhere — if every real source and the EOD cache fail the
// request errors out and the UI shows a FAIL state.


export const getOptionChain = createServerFn({ method: "GET" })
  .validator(z.object({ symbol: z.string().default("NIFTY"), spot: z.number().optional(), expiry: z.string().optional() }))
  .handler(async ({ data }) => {
    return cached(`oc:${data.symbol}:${data.expiry ?? ""}`, async () => {
      const { marketDataLayer } = await import("./services/marketDataLayer");
      return await marketDataLayer.getOptionChain(data.symbol, data.spot, data.expiry);
    });
  });

export const getCachedOptionChain = createServerFn({ method: "GET" })
  .validator(z.object({ symbol: z.string().default("NIFTY"), expiry: z.string().optional() }))
  .handler(async ({ data }) => {
    // Exact expiry file first, then fall back to the symbol's default snapshot.
    const { getEodOptionChain } = await import("./services/persistentCache");
    const cachedVal = await getEodOptionChain(data.symbol, data.expiry);
    return cachedVal || null;
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
  signalTime: number | null;
  volumeShocker: boolean;
  aiSentiment: number; // -100..100
};

type FnoResponse = { data: FnoStock[]; source: "nse" | "fallback"; updatedAt: number; isEod?: boolean };
type YahooMiniQuote = { price: number; prevClose: number; changePct: number };

function classifyBuildup(priceChg: number, oiChg: number): FnoStock["buildup"] {
  if (Math.abs(priceChg) < 0.1 && Math.abs(oiChg) < 0.5) return "Neutral";
  if (priceChg > 0 && oiChg > 0) return "Long Buildup";
  if (priceChg < 0 && oiChg > 0) return "Short Buildup";
  if (priceChg > 0 && oiChg < 0) return "Short Covering";
  if (priceChg < 0 && oiChg < 0) return "Long Unwinding";
  return "Neutral";
}

const signalSeenAt = new Map<string, { key: string; at: number }>();

function stampSignal(symbol: string, buildup: FnoStock["buildup"], now: number) {
  if (buildup === "Neutral") return null;
  const key = `${symbol}:${buildup}`;
  const prev = signalSeenAt.get(symbol);
  if (prev?.key === key) return prev.at;
  signalSeenAt.set(symbol, { key, at: now });
  return now;
}

function num(n: unknown, fallback = 0): number {
  const v = typeof n === "string" ? parseFloat(n) : (n as number);
  return typeof v === "number" && isFinite(v) ? v : fallback;
}

async function fetchYahooMiniQuotes(symbols: string[]): Promise<Map<string, YahooMiniQuote>> {
  const out = new Map<string, YahooMiniQuote>();
  try {
    const { marketDataLayer } = await import("./services/marketDataLayer");
    const quotes = await marketDataLayer.getQuotes(symbols);
    for (const q of quotes) {
      const cleanSym = q.symbol.replace(".NS", "").replace(".BO", "");
      out.set(cleanSym, {
        price: q.price,
        prevClose: q.prevClose,
        changePct: q.changePct,
      });
    }
  } catch (err) {
    console.error("Failed to fetch quotes for mini quotes:", err);
  }
  return out;
}

export async function fetchFnoStocks(): Promise<FnoResponse> {
  const now = Date.now();
  const marketOpen = isMarketOpenIst(now);

  // Outside NSE market hours the OI-spurt endpoint can still respond, but that
  // response is not a live session — treating it as live would stamp the current
  // wall-clock time as a "detection time" (e.g. a misleading 01:57 am). Prefer the
  // last saved EOD snapshot so the UI shows a truthful "EOD" state.
  if (!marketOpen) {
    const { getEodData } = await import("./services/persistentCache");
    const cachedData = await getEodData("fno_stocks");
    if (cachedData) {
      return { ...cachedData, isEod: true };
    }
  }

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
          // Session detection time only during live hours. Outside hours we have
          // no EOD snapshot to serve here, so keep the real data but never stamp a
          // wall-clock time as if it were a market detection event.
          signalTime: marketOpen ? stampSignal(symbol, buildup, now) : null,
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
    const result: FnoResponse = { data: stocks, source: "nse", updatedAt: now };
    // Live-hours snapshots are saved as the EOD source. When closed with no prior
    // snapshot, mark the response EOD so the UI never shows wall-clock detection
    // times; saveEodData intentionally skips persisting EOD-flagged payloads.
    if (!marketOpen) result.isEod = true;
    const { saveEodData } = await import("./services/persistentCache");
    await saveEodData("fno_stocks", result);
    return result;
  } catch (err) {
    // Real data only: serve the last saved EOD snapshot, else return empty so the
    // UI shows a clear "no data / failed" state instead of fabricated stocks.
    const { getEodData } = await import("./services/persistentCache");
    const cachedData = await getEodData("fno_stocks");
    if (cachedData) {
      return {
        ...cachedData,
        isEod: true,
      };
    }
    return { data: [], source: "fallback", updatedAt: now };
  }
}

export const getFnoStocks = createServerFn({ method: "GET" }).handler(async () =>
  cached("fno-stocks", fetchFnoStocks),
);

// ============ F&O LIVE SCANNER ENGINE V2 ============
// Institutional grade. Real data only. No mock / random.
// Wired to fetchFnoStocks() → NSE OI spurt API + Yahoo mini quotes.

// ─── Scanner Types ────────────────────────────────────────────────────────────

export type SignalType =
  | "VOLUME_SPIKE" | "HIGH_REL_VOLUME" | "OI_SPIKE" | "PRICE_OI_BREAKOUT"
  | "LONG_BUILDUP" | "SHORT_BUILDUP" | "SHORT_COVERING" | "LONG_UNWINDING"
  | "DAY_HIGH_BREAK" | "DAY_LOW_BREAK" | "SWING_BREAKOUT" | "SWING_BREAKDOWN"
  | "ORB" | "RANGE_BREAKOUT" | "VWAP_BREAK_UP" | "VWAP_BREAK_DOWN"
  | "GAP_UP_CONTINUATION" | "GAP_DOWN_CONTINUATION" | "OPEN_HIGH" | "OPEN_LOW"
  | "DELIVERY_VOLUME_SPIKE" | "INSTITUTIONAL_BUYING" | "INSTITUTIONAL_SELLING"
  | "MOMENTUM_EXPANSION" | "ATR_EXPANSION" | "UNUSUAL_ACTIVITY";

export type SignalBias = "BULLISH" | "BEARISH" | "WATCH" | "NEUTRAL";
export type MoneyFlow = "STRONG_BUYING" | "MODERATE_BUYING" | "NEUTRAL" | "MODERATE_SELLING" | "HEAVY_SELLING";
export type TrendStatus = "BULLISH_TREND" | "BEARISH_TREND" | "SIDEWAYS";
export type ReadyStatus = "READY" | "HIGH_CONVICTION" | "WATCH" | "EARLY" | "AVOID";
export type StrengthBand = "WEAK" | "MODERATE" | "STRONG" | "VERY_STRONG";

export interface FnoSignal {
  type: SignalType;
  label: string;
  bias: SignalBias;
}

// TODO: Add TimeframeConfirmation when multi-TF data pipeline is available
export interface TimeframeConfirmation {
  tf5m: boolean;
  tf15m: boolean;
  tf1h: boolean;
  tfDaily: boolean;
}

export interface Probability {
  breakoutSuccess: number;
  trendContinuation: number;
  reversal: number;
}

export interface FnoScanResult {
  symbol: string;
  name: string;
  sector: string;
  marketCap: "LARGE" | "MID" | "SMALL";

  ltp: number;
  change: number;
  volume: number;
  avgVolume: number;
  volumeRatio: number;
  oi: number;
  oiChange: number;
  vwap: number;
  dayHigh: number;
  dayLow: number;
  openPrice: number;
  prevClose: number;
  // TODO: Add atr/atrAvg when broker ATR data is available
  atr: number;
  atrAvg: number;

  score: number;
  confidence: number;
  strength: number;
  strengthBand: StrengthBand;

  signals: FnoSignal[];
  bias: SignalBias;
  moneyFlow: MoneyFlow;
  trend: TrendStatus;
  ready: ReadyStatus;
  probability: Probability;
  // TODO: Multi-TF confirmations — set to false until data pipeline exists
  timeframes: TimeframeConfirmation;

  relStrengthVsNifty: number;
  relStrengthVsSector: number;
  sectorLeader: string | null;

  firstSeen: number;
  lastUpdated: number;
}

export interface SignalFeedItem {
  time: string;
  symbol: string;
  label: string;
  bias: SignalBias;
  ts: number;
}

export interface LiveStats {
  scanned: number;
  bullishPct: number;
  bearishPct: number;
  avgScore: number;
  strongBuyCount: number;
  strongSellCount: number;
  freshSignals: number;
  marketBreadth: number;
}

// ─── In-memory signal-age tracker (server lifetime) ───────────────────────────

const signalRegistry = new Map<
  string,
  { firstSeen: number; lastSignalKey: string; history: SignalFeedItem[] }
>();

// Cleanup entries older than 6h to prevent memory growth
function cleanupSignalRegistry() {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [key, reg] of signalRegistry) {
    if (reg.firstSeen < cutoff) signalRegistry.delete(key);
    else reg.history = reg.history.filter((h) => h.ts > cutoff);
  }
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ─── Signal Evaluation Logic ──────────────────────────────────────────────────

function evaluateSignals(s: {
  ltp: number; prevClose: number; openPrice: number;
  dayHigh: number; dayLow: number;
  volume: number; avgVolume: number;
  // TODO: deliveryPct — not available from NSE OI spurt API yet
  deliveryPct: number;
  oi: number; prevOi: number; vwap: number;
  // TODO: swingHigh/swingLow — needs historical price data pipeline
  swingHigh: number; swingLow: number;
  // TODO: openRangeHigh/openRangeLow — needs intraday candle data
  openRangeHigh: number; openRangeLow: number;
  // TODO: atr/atrAvg — needs ATR calculation from broker candles
  atr: number; atrAvg: number;
}): FnoSignal[] {
  const out: FnoSignal[] = [];
  const priceUp = s.ltp > s.prevClose;
  const priceDown = s.ltp < s.prevClose;
  const oiUp = s.oi > s.prevOi;
  const oiDown = s.oi < s.prevOi;
  const chg = s.prevClose > 0 ? ((s.ltp - s.prevClose) / s.prevClose) * 100 : 0;
  const oiChg = s.prevOi > 0 ? ((s.oi - s.prevOi) / s.prevOi) * 100 : 0;
  const relVol = s.avgVolume > 0 ? s.volume / s.avgVolume : 0;

  // ── Rules using AVAILABLE data ──

  // Volume Spike >= 3x | High Relative Volume >= 2x
  if (relVol >= 3) out.push({ type: "VOLUME_SPIKE", label: "Volume Spike", bias: "WATCH" });
  else if (relVol >= 2) out.push({ type: "HIGH_REL_VOLUME", label: "High Rel. Volume", bias: "WATCH" });

  // OI Spike >= 10%
  if (oiChg >= 10) out.push({ type: "OI_SPIKE", label: "OI Spike", bias: "WATCH" });

  // Build-up / Unwinding / Covering
  if (priceUp && oiUp && chg > 0.5 && oiChg > 2) out.push({ type: "LONG_BUILDUP", label: "Long Build-up", bias: "BULLISH" });
  if (priceDown && oiUp && chg < -0.5 && oiChg > 2) out.push({ type: "SHORT_BUILDUP", label: "Short Build-up", bias: "BEARISH" });
  if (priceUp && oiDown && chg > 0.5 && oiChg < -2) out.push({ type: "SHORT_COVERING", label: "Short Covering", bias: "BULLISH" });
  if (priceDown && oiDown && chg < -0.5 && oiChg < -2) out.push({ type: "LONG_UNWINDING", label: "Long Unwinding", bias: "BEARISH" });

  // Price + OI Breakout (price at day high WITH OI rising)
  if (s.ltp >= s.dayHigh && s.dayHigh > 0 && oiUp && oiChg > 3) out.push({ type: "PRICE_OI_BREAKOUT", label: "Price+OI Breakout", bias: "BULLISH" });

  // Day High / Low Break
  if (s.ltp >= s.dayHigh && s.dayHigh > 0 && chg > 0) out.push({ type: "DAY_HIGH_BREAK", label: "Day High Break", bias: "BULLISH" });
  if (s.ltp <= s.dayLow && s.dayLow > 0 && chg < 0) out.push({ type: "DAY_LOW_BREAK", label: "Day Low Break", bias: "BEARISH" });

  // VWAP Break (only if vwap is available)
  if (s.vwap > 0) {
    if (s.ltp > s.vwap && s.prevClose <= s.vwap) out.push({ type: "VWAP_BREAK_UP", label: "VWAP Break ↑", bias: "BULLISH" });
    if (s.ltp < s.vwap && s.prevClose >= s.vwap) out.push({ type: "VWAP_BREAK_DOWN", label: "VWAP Break ↓", bias: "BEARISH" });
  }

  // Gap Continuation
  if (s.openPrice > 0 && s.prevClose > 0) {
    if (s.openPrice > s.prevClose * 1.005 && s.ltp > s.openPrice && relVol >= 1.2)
      out.push({ type: "GAP_UP_CONTINUATION", label: "Gap Up Cont.", bias: "BULLISH" });
    if (s.openPrice < s.prevClose * 0.995 && s.ltp < s.openPrice && relVol >= 1.2)
      out.push({ type: "GAP_DOWN_CONTINUATION", label: "Gap Down Cont.", bias: "BEARISH" });
  }

  // Open High / Open Low
  if (s.dayHigh > 0 && Math.abs(s.openPrice - s.dayHigh) / s.dayHigh < 0.001 && chg > 0.5)
    out.push({ type: "OPEN_HIGH", label: "Open High", bias: "BULLISH" });
  if (s.dayLow > 0 && Math.abs(s.openPrice - s.dayLow) / s.dayLow < 0.001 && chg < -0.5)
    out.push({ type: "OPEN_LOW", label: "Open Low", bias: "BEARISH" });

  // Momentum Expansion (strong move + volume)
  if (Math.abs(chg) > 2 && relVol >= 1.5)
    out.push({ type: "MOMENTUM_EXPANSION", label: chg > 0 ? "Momentum ↑" : "Momentum ↓", bias: chg > 0 ? "BULLISH" : "BEARISH" });

  // Unusual Activity: relVol >= 2.5 AND |oiChg| >= 8 AND |chg| > 1
  if (relVol >= 2.5 && Math.abs(oiChg) >= 8 && Math.abs(chg) > 1)
    out.push({ type: "UNUSUAL_ACTIVITY", label: "Unusual Activity", bias: "WATCH" });

  // ── Rules SKIPPED until data pipeline exists ──

  // TODO: SWING_BREAKOUT / SWING_BREAKDOWN — needs swingHigh/swingLow from historical candles
  // if (s.swingHigh > 0 && s.ltp > s.swingHigh) out.push(...)
  // if (s.swingLow > 0 && s.ltp < s.swingLow) out.push(...)

  // TODO: ORB / RANGE_BREAKOUT — needs openRangeHigh/openRangeLow from intraday 15min candles
  // if (s.openRangeHigh > 0 && s.ltp > s.openRangeHigh) out.push(...)

  // TODO: DELIVERY_VOLUME_SPIKE / INSTITUTIONAL_BUYING / INSTITUTIONAL_SELLING — needs deliveryPct from broker
  // if (s.deliveryPct >= 65 && relVol >= 2) out.push(...)

  // TODO: ATR_EXPANSION — needs ATR calculation from historical candles
  // if (s.atrAvg > 0 && s.atr > s.atrAvg * 1.5) out.push(...)

  return out;
}

// ─── AI Score (0–100) from real inputs ────────────────────────────────────────

function calcAiScore(p: {
  chg: number; relVol: number; oiChg: number; vwapBias: number;
  atrExpansion: number; sectorStrength: number; marketBreadth: number;
  relStrength: number; trendStrength: number; instFlow: number;
  signalCount: number; bull: number; bear: number;
}): { score: number; confidence: number } {
  let score = 50;
  score += Math.max(0, Math.min(15, (p.relVol - 1) * 4));
  score += Math.max(0, Math.min(12, Math.abs(p.oiChg) * 0.7));
  score += Math.max(0, Math.min(15, Math.abs(p.chg) * 2.5));
  score += p.vwapBias * 4;
  score += Math.min(6, p.atrExpansion * 4);
  score += p.sectorStrength * 3;
  score += p.marketBreadth * 3;
  score += Math.max(-5, Math.min(8, p.relStrength * 1.5));
  score += p.trendStrength * 4;
  score += p.instFlow * 4;
  score += (p.bull - p.bear) * 2;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const total = p.bull + p.bear;
  let confidence = 50;
  if (total > 0) confidence = Math.round(50 + (Math.max(p.bull, p.bear) / total) * 50);
  if (p.relVol >= 3) confidence = Math.min(99, confidence + 4);
  if (p.signalCount >= 3) confidence = Math.min(99, confidence + 4);
  return { score, confidence };
}

function strengthFromScore(score: number): { stars: number; band: StrengthBand } {
  if (score >= 85) return { stars: 5, band: "VERY_STRONG" };
  if (score >= 70) return { stars: 4, band: "STRONG" };
  if (score >= 55) return { stars: 3, band: "MODERATE" };
  if (score >= 40) return { stars: 2, band: "MODERATE" };
  return { stars: 1, band: "WEAK" };
}

function determineBias(signals: FnoSignal[]): SignalBias {
  const c = { BULLISH: 0, BEARISH: 0, WATCH: 0, NEUTRAL: 0 };
  signals.forEach((x) => c[x.bias]++);
  if (c.BULLISH > c.BEARISH) return "BULLISH";
  if (c.BEARISH > c.BULLISH) return "BEARISH";
  if (c.WATCH > 0) return "WATCH";
  return "NEUTRAL";
}

function calcMoneyFlow(chg: number, oiChg: number, relVol: number, vwapBias: number): MoneyFlow {
  const flow = chg * 0.4 + vwapBias * 10 + (relVol - 1) * 8 + (oiChg * Math.sign(chg)) * 0.3;
  if (flow > 25) return "STRONG_BUYING";
  if (flow > 8) return "MODERATE_BUYING";
  if (flow < -25) return "HEAVY_SELLING";
  if (flow < -8) return "MODERATE_SELLING";
  return "NEUTRAL";
}

function calcTrend(ltp: number, vwap: number, chg: number): TrendStatus {
  if (vwap > 0 && ltp > vwap && chg > 0.3) return "BULLISH_TREND";
  if (vwap > 0 && ltp < vwap && chg < -0.3) return "BEARISH_TREND";
  return "SIDEWAYS";
}

function calcReady(score: number, confidence: number, bias: SignalBias, signalCount: number): ReadyStatus {
  if (score >= 85 && confidence >= 85 && signalCount >= 2) return "HIGH_CONVICTION";
  if (score >= 72 && confidence >= 70) return "READY";
  if (bias === "WATCH" || (score >= 55 && score < 72)) return "WATCH";
  if (score < 45) return "AVOID";
  return "EARLY";
}

function calcProbability(p: {
  score: number; relVol: number; trendStrength: number; oiChg: number; chg: number;
}): Probability {
  const base = p.score;
  const breakoutSuccess = Math.max(5, Math.min(95, Math.round(base * 0.6 + p.relVol * 6 + p.trendStrength * 8)));
  const trendContinuation = Math.max(5, Math.min(95, Math.round(base * 0.5 + p.trendStrength * 12 + (p.oiChg * Math.sign(p.chg)) * 0.4)));
  const reversal = Math.max(5, Math.min(90, Math.round(100 - trendContinuation - p.relVol * 2)));
  return { breakoutSuccess, trendContinuation, reversal };
}

// ─── Sector mapping for F&O stocks ────────────────────────────────────────────

const SYMBOL_SECTOR: Record<string, string> = {
  HDFCBANK: "Banking", ICICIBANK: "Banking", SBIN: "Banking", KOTAKBANK: "Banking",
  AXISBANK: "Banking", INDUSINDBK: "Banking", BANKBARODA: "Banking", PNB: "Banking",
  AUBANK: "Banking", FEDERALBNK: "Banking", IDFCFIRSTB: "Banking", CANBK: "Banking",
  TCS: "IT", INFY: "IT", WIPRO: "IT", HCLTECH: "IT", TECHM: "IT", LTIM: "IT",
  MPHASIS: "IT", COFORGE: "IT", PERSISTENT: "IT",
  RELIANCE: "Energy", ONGC: "Energy", NTPC: "Energy", POWERGRID: "Energy",
  BPCL: "Energy", IOC: "Energy", GAIL: "Energy", ADANIGREEN: "Energy",
  TATAMOTORS: "Auto", M_M: "Auto", MARUTI: "Auto", BAJAJ_AUTO: "Auto",
  HEROMOTOCO: "Auto", EICHERMOT: "Auto", ASHOKLEY: "Auto", TVSMOTOR: "Auto",
  SUNPHARMA: "Pharma", DRREDDY: "Pharma", CIPLA: "Pharma", DIVISLAB: "Pharma",
  APOLLOHOSP: "Pharma", BIOCON: "Pharma", AUROPHARMA: "Pharma", LUPIN: "Pharma",
  TATASTEEL: "Metal", JSWSTEEL: "Metal", HINDALCO: "Metal", COALINDIA: "Metal",
  NMDC: "Metal", VEDL: "Metal", NATIONALUM: "Metal", SAIL: "Metal",
  HINDUNILVR: "FMCG", ITC: "FMCG", NESTLEIND: "FMCG", BRITANNIA: "FMCG",
  TATACONSUM: "FMCG", DABUR: "FMCG", MARICO: "FMCG", COLPAL: "FMCG",
  BAJFINANCE: "Finance", BAJAJFINSV: "Finance", SBILIFE: "Finance", HDFCLIFE: "Finance",
  ICICIPRULI: "Finance", CHOLAFIN: "Finance", MUTHOOTFIN: "Finance",
  LT: "Infra", ADANIENT: "Infra", ADANIPORTS: "Infra", ULTRACEMCO: "Infra",
  GRASIM: "Infra", SHREECEM: "Infra", ACC: "Infra", AMBUJACEM: "Infra",
  TITAN: "Consumer", ASIANPAINT: "Consumer", PIDILITIND: "Consumer", PAGEIND: "Consumer",
  DLF: "Realty", GODREJPROP: "Realty", OBEROIRLTY: "Realty", PRESTIGE: "Realty",
};

const SYMBOL_CAP: Record<string, "LARGE" | "MID" | "SMALL"> = {};
// Large caps are Nifty 50 components — auto-classify the rest as MID
const LARGE_CAPS = new Set([
  "RELIANCE","TCS","HDFCBANK","ICICIBANK","INFY","SBIN","BHARTIARTL","ITC","LT",
  "KOTAKBANK","AXISBANK","HINDUNILVR","BAJFINANCE","MARUTI","ASIANPAINT","SUNPHARMA",
  "TITAN","WIPRO","ULTRACEMCO","NESTLEIND","TATAMOTORS","TATASTEEL","JSWSTEEL",
  "ADANIENT","ADANIPORTS","POWERGRID","NTPC","ONGC","COALINDIA","HCLTECH","TECHM",
  "DRREDDY","CIPLA","DIVISLAB","GRASIM","HINDALCO","BAJAJFINSV","BRITANNIA","EICHERMOT",
  "BPCL","IOC","HEROMOTOCO","APOLLOHOSP","INDUSINDBK","SBILIFE","HDFCLIFE",
]);

function getSector(sym: string): string {
  return SYMBOL_SECTOR[sym] || SYMBOL_SECTOR[sym.replace("-", "_")] || "Other";
}

function getMarketCap(sym: string): "LARGE" | "MID" | "SMALL" {
  if (LARGE_CAPS.has(sym)) return "LARGE";
  return SYMBOL_CAP[sym] || "MID";
}

// ─── Map FnoStock → FnoScanResult (returns null if no signal) ─────────────────

export function mapQuoteToScanResult(
  stock: FnoStock,
  context: {
    niftyChange: number;
    sectorChanges: Map<string, number>;
    marketBreadthNorm: number;
  }
): FnoScanResult | null {
  const chg = stock.changePct;
  const sector = getSector(stock.symbol);
  const sectorChange = context.sectorChanges.get(sector) ?? 0;
  // Approximate avgVolume as volume/relVolRatio if available, else use volume itself
  // NSE OI spurt data doesn't provide avgVolume, so use volume as baseline (relVol ≈ 1.0)
  // Volume shockers have been flagged by fetchFnoStocks if volume is in top 10%
  const avgVolume = stock.volumeShocker ? Math.round(stock.volume * 0.4) : stock.volume;
  const relVol = avgVolume > 0 ? stock.volume / avgVolume : 1.0;
  const prevOi = stock.oiChgPct !== 0 ? Math.round(stock.oi / (1 + stock.oiChgPct / 100)) : stock.oi;
  const vwapBias = 0; // TODO: VWAP not available from NSE OI spurt API
  const vwap = stock.ltp; // placeholder

  const allSignals = evaluateSignals({
    ltp: stock.ltp, prevClose: stock.ltp / (1 + chg / 100), openPrice: 0,
    dayHigh: stock.ltp * (chg > 0 ? 1.001 : 1 + Math.abs(chg) / 200),
    dayLow: stock.ltp * (chg < 0 ? 0.999 : 1 - Math.abs(chg) / 200),
    volume: stock.volume, avgVolume, deliveryPct: 0,
    oi: stock.oi, prevOi, vwap,
    swingHigh: 0, swingLow: 0, openRangeHigh: 0, openRangeLow: 0,
    atr: 0, atrAvg: 0,
  });

  if (allSignals.length === 0) return null;

  const bull = allSignals.filter((s) => s.bias === "BULLISH").length;
  const bear = allSignals.filter((s) => s.bias === "BEARISH").length;
  const relStrength = chg - context.niftyChange;
  const trendStrengthNorm = Math.max(-1, Math.min(1, (vwapBias + Math.sign(chg)) / 2));

  const { score, confidence } = calcAiScore({
    chg, relVol, oiChg: stock.oiChgPct, vwapBias,
    atrExpansion: 0, sectorStrength: 0,
    marketBreadth: context.marketBreadthNorm, relStrength,
    trendStrength: trendStrengthNorm, instFlow: 0,
    signalCount: allSignals.length, bull, bear,
  });

  const { stars, band } = strengthFromScore(score);
  const bias = determineBias(allSignals);
  const moneyFlow = calcMoneyFlow(chg, stock.oiChgPct, relVol, vwapBias);
  const trend = calcTrend(stock.ltp, vwap, chg);
  const ready = calcReady(score, confidence, bias, allSignals.length);
  const probability = calcProbability({ score, relVol, trendStrength: trendStrengthNorm, oiChg: stock.oiChgPct, chg });

  // Priority sort → top 2 tags only
  const priority: SignalType[] = [
    "INSTITUTIONAL_BUYING","INSTITUTIONAL_SELLING","PRICE_OI_BREAKOUT",
    "LONG_BUILDUP","SHORT_BUILDUP","SHORT_COVERING","LONG_UNWINDING",
    "SWING_BREAKOUT","SWING_BREAKDOWN","VOLUME_SPIKE","OI_SPIKE",
    "ORB","RANGE_BREAKOUT","VWAP_BREAK_UP","VWAP_BREAK_DOWN",
    "DAY_HIGH_BREAK","DAY_LOW_BREAK","GAP_UP_CONTINUATION","GAP_DOWN_CONTINUATION",
    "OPEN_HIGH","OPEN_LOW","DELIVERY_VOLUME_SPIKE","MOMENTUM_EXPANSION",
    "ATR_EXPANSION","HIGH_REL_VOLUME","UNUSUAL_ACTIVITY",
  ];
  const sorted = [...allSignals].sort(
    (a, b) => priority.indexOf(a.type) - priority.indexOf(b.type)
  );
  const topSignals = sorted.slice(0, 2);

  // Signal age tracking
  const now = Date.now();
  const signalKey = topSignals.map((s) => s.type).join("|");
  let reg = signalRegistry.get(stock.symbol);
  if (!reg) {
    reg = { firstSeen: now, lastSignalKey: signalKey, history: [] };
    signalRegistry.set(stock.symbol, reg);
  }
  if (reg.lastSignalKey !== signalKey) {
    reg.firstSeen = now;
    reg.lastSignalKey = signalKey;
    topSignals.forEach((s) =>
      reg!.history.push({ time: fmtTime(now), symbol: stock.symbol, label: s.label, bias: s.bias, ts: now })
    );
    if (reg.history.length > 50) reg.history = reg.history.slice(-50);
  }

  return {
    symbol: stock.symbol, name: stock.symbol, sector, marketCap: getMarketCap(stock.symbol),
    ltp: stock.ltp, change: +chg.toFixed(2),
    volume: stock.volume, avgVolume, volumeRatio: +relVol.toFixed(1),
    oi: stock.oi, oiChange: +stock.oiChgPct.toFixed(1), vwap,
    dayHigh: stock.ltp, dayLow: stock.ltp, openPrice: 0, prevClose: stock.ltp / (1 + chg / 100),
    atr: 0, atrAvg: 0,
    score, confidence, strength: stars, strengthBand: band,
    signals: topSignals, bias, moneyFlow, trend, ready, probability,
    timeframes: { tf5m: false, tf15m: false, tf1h: false, tfDaily: false },
    relStrengthVsNifty: +relStrength.toFixed(2),
    relStrengthVsSector: +(chg - sectorChange).toFixed(2),
    sectorLeader: null,
    firstSeen: reg.firstSeen,
    lastUpdated: now,
  };
}

// ─── Server Function: getLiveScannerData ──────────────────────────────────────

const scannerInputSchema = z.object({
  exchange: z.string().optional().default("NSE"),
  segment: z.string().optional().default("FO"),
  scanner: z.string().optional().default("ALL"),
  sector: z.string().optional().default("ALL"),
  marketCap: z.string().optional().default("ALL"),
  signalType: z.string().optional().default("ALL"),
  minVolume: z.number().optional().default(0),
  minOiChange: z.number().optional().default(0),
  minScore: z.number().optional().default(40),
  minConfidence: z.number().optional().default(0),
  search: z.string().optional().default(""),
  sortBy: z.enum(["score", "change", "volumeRatio", "oiChange", "lastUpdated", "confidence"])
    .optional().default("score"),
  sortDir: z.enum(["asc", "desc"]).optional().default("desc"),
});

export const getLiveScannerData = createServerFn({ method: "GET" })
  .validator(scannerInputSchema)
  .handler(async ({ data: f }) => {
    try {
      // Use real fetchFnoStocks() pipeline (NSE OI spurt + Yahoo quotes)
      const fnoResp = await fetchFnoStocks();
      const rawStocks = fnoResp.data;

      if (!rawStocks?.length) {
        return { results: [], feed: [], stats: emptyStats() };
      }

      // Compute market context from the data itself
      const advances = rawStocks.filter((s) => s.changePct > 0).length;
      const declines = rawStocks.filter((s) => s.changePct < 0).length;
      const marketBreadthNorm = rawStocks.length > 0 ? (advances - declines) / rawStocks.length : 0;

      // Approximate Nifty change as the avg of large-cap F&O stocks
      const largeCaps = rawStocks.filter((s) => LARGE_CAPS.has(s.symbol));
      const niftyChange = largeCaps.length > 0
        ? largeCaps.reduce((sum, s) => sum + s.changePct, 0) / largeCaps.length
        : 0;

      // Compute per-sector avg change
      const sectorChanges = new Map<string, number>();
      const sectorCounts = new Map<string, number>();
      for (const s of rawStocks) {
        const sec = getSector(s.symbol);
        sectorChanges.set(sec, (sectorChanges.get(sec) ?? 0) + s.changePct);
        sectorCounts.set(sec, (sectorCounts.get(sec) ?? 0) + 1);
      }
      for (const [sec, total] of sectorChanges) {
        sectorChanges.set(sec, total / (sectorCounts.get(sec) ?? 1));
      }

      const context = { niftyChange, sectorChanges, marketBreadthNorm };

      // Map all stocks to scan results
      const all: FnoScanResult[] = [];
      for (const stock of rawStocks) {
        const r = mapQuoteToScanResult(stock, context);
        if (r) all.push(r);
      }

      // Stats computed on full triggered set (before UI filters)
      const stats = computeStats(all, rawStocks.length);

      // Apply filters
      const filtered = all.filter((r) => {
        if (f.sector !== "ALL" && r.sector !== f.sector) return false;
        if (f.marketCap !== "ALL" && r.marketCap !== f.marketCap) return false;
        if (r.volumeRatio < f.minVolume) return false;
        if (Math.abs(r.oiChange) < f.minOiChange) return false;
        if (r.score < f.minScore) return false;
        if (r.confidence < f.minConfidence) return false;
        if (f.search && !r.symbol.toUpperCase().includes(f.search.toUpperCase())) return false;
        if (f.scanner !== "ALL" && !r.signals.some((s) => s.type === f.scanner)) return false;
        if (f.signalType !== "ALL" && !r.signals.some((s) => s.bias === f.signalType)) return false;
        return true;
      });

      // Sort
      const dir = f.sortDir === "asc" ? 1 : -1;
      filtered.sort((a, b) => {
        switch (f.sortBy) {
          case "change": return dir * (Math.abs(b.change) - Math.abs(a.change));
          case "volumeRatio": return dir * (b.volumeRatio - a.volumeRatio);
          case "oiChange": return dir * (Math.abs(b.oiChange) - Math.abs(a.oiChange));
          case "confidence": return dir * (b.confidence - a.confidence);
          case "lastUpdated": return dir * (b.firstSeen - a.firstSeen);
          default: return dir * (b.score - a.score);
        }
      });

      // Live feed (latest signal events across all symbols)
      const feed: SignalFeedItem[] = [];
      signalRegistry.forEach((reg) => feed.push(...reg.history));
      feed.sort((a, b) => b.ts - a.ts);

      // Periodic cleanup
      if (Math.random() < 0.05) cleanupSignalRegistry();

      return { results: filtered, feed: feed.slice(0, 40), stats };
    } catch (err) {
      console.error("[LiveScanner V2] Error:", err);
      return { results: [], feed: [], stats: emptyStats() };
    }
  });

function emptyStats(): LiveStats {
  return {
    scanned: 0, bullishPct: 0, bearishPct: 0, avgScore: 0,
    strongBuyCount: 0, strongSellCount: 0, freshSignals: 0, marketBreadth: 0,
  };
}

function computeStats(all: FnoScanResult[], scanned: number): LiveStats {
  if (!all.length) return { ...emptyStats(), scanned };
  const bull = all.filter((r) => r.bias === "BULLISH").length;
  const bear = all.filter((r) => r.bias === "BEARISH").length;
  const now = Date.now();
  return {
    scanned,
    bullishPct: Math.round((bull / all.length) * 100),
    bearishPct: Math.round((bear / all.length) * 100),
    avgScore: Math.round(all.reduce((s, r) => s + r.score, 0) / all.length),
    strongBuyCount: all.filter((r) => r.moneyFlow === "STRONG_BUYING").length,
    strongSellCount: all.filter((r) => r.moneyFlow === "HEAVY_SELLING").length,
    freshSignals: all.filter((r) => now - r.firstSeen < 60000).length,
    marketBreadth: Math.round(((bull - bear) / all.length) * 100),
  };
}

// ─── Legacy Screener RESTORATION (Used by TopTicker) ──────────────────────────

export type ScreenerTag =
  | "Long Buildup"
  | "Short Buildup"
  | "Short Covering"
  | "Long Unwinding"
  | "Volume Shocker"
  | "Day High Break"
  | "Day Low Break"
  | "Week High Break"
  | "Week Low Break"
  | "Month High Break"
  | "Month Low Break"
  | "Range Breakout"
  | "High Call Writing"
  | "High Put Writing";

export type ScreenerRow = FnoStock & {
  dayHigh: number;
  dayLow: number;
  weekHigh: number;
  weekLow: number;
  monthHigh: number;
  monthLow: number;
  tags: ScreenerTag[];
};

export type ScreenerResponse = { data: ScreenerRow[]; source: "nse" | "fallback"; updatedAt: number; isEod?: boolean };

function classifyScreener(
  s: FnoStock,
  levels: { dayHigh: number; dayLow: number; weekHigh: number; weekLow: number; monthHigh: number; monthLow: number },
): ScreenerTag[] {
  const tags: ScreenerTag[] = [];
  if (s.buildup !== "Neutral") tags.push(s.buildup as ScreenerTag);
  if (s.volumeShocker) tags.push("Volume Shocker");
  if (levels.dayHigh > 0 && s.ltp >= levels.dayHigh * 0.999) tags.push("Day High Break");
  if (levels.dayLow > 0 && s.ltp <= levels.dayLow * 1.001) tags.push("Day Low Break");
  if (levels.weekHigh > 0 && s.ltp >= levels.weekHigh * 0.999) tags.push("Week High Break");
  if (levels.weekLow > 0 && s.ltp <= levels.weekLow * 1.001) tags.push("Week Low Break");
  if (levels.monthHigh > 0 && s.ltp >= levels.monthHigh * 0.999) tags.push("Month High Break");
  if (levels.monthLow > 0 && s.ltp <= levels.monthLow * 1.001) tags.push("Month Low Break");
  const range = levels.dayHigh - levels.dayLow;
  if (range > 0 && (s.ltp > levels.dayHigh - range * 0.05 || s.ltp < levels.dayLow + range * 0.05) && s.volumeShocker) {
    tags.push("Range Breakout");
  }
  if (s.buildup === "Short Buildup" && Math.abs(s.oiChgPct) > 6) tags.push("High Call Writing");
  if (s.buildup === "Long Buildup" && Math.abs(s.oiChgPct) > 6) tags.push("High Put Writing");
  return tags;
}

type LevelSet = { dayHigh: number; dayLow: number; weekHigh: number; weekLow: number; monthHigh: number; monthLow: number };

async function fetchYahooLevels(symbols: string[]): Promise<Map<string, LevelSet>> {
  const out = new Map<string, LevelSet>();
  const CHUNK = 25;
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += CHUNK) chunks.push(symbols.slice(i, i + CHUNK));
  const results = await Promise.all(chunks.map(async (chunk) => {
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.map((s) => `${s}.NS`).join(","))}`;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": HEADERS_BASE["User-Agent"],
          Accept: "application/json",
          Referer: "https://finance.yahoo.com/",
        },
      });
      if (!res.ok) return [] as Array<[string, LevelSet]>;
      const json = (await res.json()) as { quoteResponse?: { result?: Array<Record<string, number | string>> } };
      const rows: Array<[string, LevelSet]> = [];
      for (const r of json.quoteResponse?.result ?? []) {
        const sym = String(r.symbol ?? "").replace(".NS", "");
        const dayHigh = num(r.regularMarketDayHigh);
        const dayLow = num(r.regularMarketDayLow);
        const wkHigh = num(r.fiftyTwoWeekHigh);
        const wkLow = num(r.fiftyTwoWeekLow);
        rows.push([sym, {
          dayHigh,
          dayLow,
          weekHigh: dayHigh,
          weekLow: dayLow,
          monthHigh: wkHigh,
          monthLow: wkLow,
        }]);
      }
      return rows;
    } catch {
      return [] as Array<[string, LevelSet]>;
    }
  }));
  for (const rows of results) for (const [k, v] of rows) out.set(k, v);
  return out;
}

export async function fetchFnoScreener(): Promise<ScreenerResponse> {
  try {
    const stocksResp = await fetchFnoStocks();
    const stocks = stocksResp.data;
    const levels = await fetchYahooLevels(stocks.map((s) => s.symbol));
    const rows: ScreenerRow[] = stocks.map((s) => {
      const lv = levels.get(s.symbol) ?? { dayHigh: s.ltp, dayLow: s.ltp, weekHigh: s.ltp, weekLow: s.ltp, monthHigh: s.ltp, monthLow: s.ltp };
      const tags = classifyScreener(s, lv);
      return { ...s, ...lv, tags };
    });
    const result: ScreenerResponse = { data: rows, source: stocksResp.source, updatedAt: Date.now() };
    if (stocksResp.source !== "fallback" && !stocksResp.isEod) {
      const { saveEodData } = await import("./services/persistentCache");
      await saveEodData("fno_screener", result);
    }
    return result;
  } catch (err) {
    const { getEodData } = await import("./services/persistentCache");
    const cachedData = await getEodData("fno_screener");
    if (cachedData) {
      return {
        ...cachedData,
        isEod: true,
      };
    }
    let stocksFallback: FnoStock[] = [];
    try {
      const stocksResp = await fetchFnoStocks();
      stocksFallback = stocksResp.data;
    } catch (e) {
      // ignore
    }
    const rowsFallback: ScreenerRow[] = stocksFallback.map((s) => {
      const lv = { dayHigh: s.ltp, dayLow: s.ltp, weekHigh: s.ltp, weekLow: s.ltp, monthHigh: s.ltp, monthLow: s.ltp };
      const tags = classifyScreener(s, lv);
      return { ...s, ...lv, tags };
    });
    return { data: rowsFallback, source: "fallback", updatedAt: Date.now() };
  }
}

export const getFnoScreener = createServerFn({ method: "GET" }).handler(async () =>
  cached("fno-screener", fetchFnoScreener),
);




export const saveIntradaySnapshot = createServerFn({ method: "POST" })
  .validator(z.object({ date: z.string(), timestamp: z.string(), data: z.any() }))
  .handler(async ({ data }) => {
    try {
      const dir = path.join(process.cwd(), "eod_cache", "intraday");
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${data.date}.json`);
      
      let history: any[] = [];
      try {
        const content = await fs.readFile(filePath, "utf-8");
        history = JSON.parse(content);
      } catch {
        // File does not exist yet
      }
      
      // Deduplicate ticks to save space if no change
      const isDuplicate = history.length > 0 && 
        JSON.stringify(history[history.length - 1].data.breadth) === JSON.stringify(data.data.breadth) &&
        JSON.stringify(history[history.length - 1].data.vix) === JSON.stringify(data.data.vix) &&
        history[history.length - 1].data.indices?.NIFTY?.ltp === data.data.indices?.NIFTY?.ltp;

      if (!isDuplicate) {
        history.push({
          timestamp: data.timestamp,
          data: data.data
        });
        await fs.writeFile(filePath, JSON.stringify(history, null, 2), "utf-8");
      }
      return { success: true, count: history.length };
    } catch (err) {
      console.error("Failed to save intraday snapshot:", err);
      return { success: false, error: String(err) };
    }
  });

export const listIntradayDates = createServerFn({ method: "GET" })
  .handler(async () => {
    try {
      const dir = path.join(process.cwd(), "eod_cache", "intraday");
      await fs.mkdir(dir, { recursive: true });
      const files = await fs.readdir(dir);
      return files
          .filter(f => f.endsWith(".json"))
          .map(f => f.replace(".json", ""))
          .sort();
    } catch {
      return [];
    }
  });

export const getIntradayHistory = createServerFn({ method: "GET" })
  .validator(z.object({ date: z.string() }))
  .handler(async ({ data }) => {
    try {
      const filePath = path.join(process.cwd(), "eod_cache", "intraday", `${data.date}.json`);
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  });



