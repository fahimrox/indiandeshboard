import fs from "node:fs/promises";
import path from "node:path";
import type { Quote } from "../market.functions";

const CACHE_FILE = path.join(process.cwd(), "upstox_instruments.json");

const STATIC_INDEX_MAP: Record<string, string> = {
  "^NSEI": "NSE_INDEX|Nifty 50",
  "^BSESN": "BSE_INDEX|SENSEX",
  "^NSEBANK": "NSE_INDEX|Nifty Bank",
  "^INDIAVIX": "NSE_INDEX|India VIX",
  "^CNXIT": "NSE_INDEX|Nifty IT",
  "^CNXPHARMA": "NSE_INDEX|Nifty Pharma",
  "^CNXAUTO": "NSE_INDEX|Nifty Auto",
  "^CNXENERGY": "NSE_INDEX|Nifty Energy",
  "^CNXFMCG": "NSE_INDEX|Nifty FMCG",
  "^CNXMETAL": "NSE_INDEX|Nifty Metal",
  "^CNXREALTY": "NSE_INDEX|Nifty Realty",
  "^CNXMEDIA": "NSE_INDEX|Nifty Media",
  "^CNXPSUBANK": "NSE_INDEX|Nifty PSU Bank",
  "NIFTY_FIN_SERVICE.NS": "NSE_INDEX|Nifty Fin Service",
  "^CNXINFRA": "NSE_INDEX|Nifty Infra",
};

let symbolToKeyMap = new Map<string, string>();
let initializing = false;
let initialized = false;

async function initInstruments() {
  if (initialized || initializing) return;
  initializing = true;
  try {
    // 1. Try reading from local cache file
    try {
      const data = await fs.readFile(CACHE_FILE, "utf-8");
      const parsed = JSON.parse(data);
      symbolToKeyMap = new Map(Object.entries(parsed));
      initialized = true;
      initializing = false;
      return;
    } catch {
      // Local cache not found, proceed to download
    }

    console.log("Downloading Upstox instrument master (assets URL)...");
    const res = await fetch("https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz");
    if (!res.ok) throw new Error(`Upstox instruments assets status: ${res.status}`);
    const buf = await res.arrayBuffer();
    
    const zlib = await import("node:zlib");
    const decompressed = zlib.gunzipSync(Buffer.from(buf)).toString("utf-8");
    const data = JSON.parse(decompressed) as any[];
    
    const tempMap: Record<string, string> = {};
    for (const item of data) {
      if (item.segment === "NSE_EQ" && item.trading_symbol) {
        symbolToKeyMap.set(item.trading_symbol, item.instrument_key);
        tempMap[item.trading_symbol] = item.instrument_key;
      }
    }

    // Save to local cache file
    await fs.writeFile(CACHE_FILE, JSON.stringify(tempMap), "utf-8");
    initialized = true;
  } catch (err) {
    console.error("Failed to initialize Upstox instruments:", err);
  } finally {
    initializing = false;
  }
}

// Helper to resolve symbol to Upstox instrument key
export async function getUpstoxKey(symbol: string): Promise<string | null> {
  const clean = symbol.replace(".NS", "").replace(".BO", "").trim();
  if (STATIC_INDEX_MAP[symbol]) return STATIC_INDEX_MAP[symbol];
  if (STATIC_INDEX_MAP[clean]) return STATIC_INDEX_MAP[clean];
  
  if (!initialized) {
    await initInstruments();
  }
  return symbolToKeyMap.get(clean) || null;
}

export const upstoxService = {
  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const token = process.env.UPSTOX_ACCESS_TOKEN;
    if (!token) throw new Error("Upstox Access Token is missing in environment");

    // Resolve all symbols to Upstox keys
    const resolvedKeys: string[] = [];
    const symbolMap: Record<string, string> = {}; // UpstoxKey -> OriginalSymbol

    for (const sym of symbols) {
      const key = await getUpstoxKey(sym);
      if (key) {
        resolvedKeys.push(key);
        symbolMap[key] = sym;
        // Also map by exchange|trading_symbol format (e.g. NSE_EQ|LT)
        const segment = key.split("|")[0];
        const cleanSymbol = sym.replace(".NS", "").replace(".BO", "").trim();
        symbolMap[`${segment}|${cleanSymbol}`] = sym;
      }
    }

    if (resolvedKeys.length === 0) return [];

    const url = `https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encodeURIComponent(
      resolvedKeys.join(",")
    )}`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Upstox Quotes API failed: status ${res.status}`);
    }

    const json = (await res.json()) as {
      status: string;
      data: Record<
        string,
        {
          last_price: number;
          volume: number;
          ohlc: { open: number; high: number; low: number; close: number };
          instrument_token: string;
        }
      >;
    };

    if (json.status !== "success" || !json.data) {
      throw new Error("Upstox Quotes API returned unsuccessful status");
    }

    const quotes: Quote[] = [];
    for (const [key, item] of Object.entries(json.data)) {
      const normalizedKey = key.replace(":", "|");
      const originalSymbol = symbolMap[normalizedKey] || symbolMap[key] || key;
      const price = item.last_price || 0;
      const change = typeof item.net_change === "number"
        ? item.net_change
        : (item.ohlc?.close ? (price - item.ohlc.close) : 0);
      const prevClose = price - change;
      const changePct = prevClose ? (change / prevClose) * 100 : 0;
      
      quotes.push({
        symbol: originalSymbol,
        name: originalSymbol.replace(".NS", "").replace(".BO", ""),
        price,
        prevClose,
        change,
        changePct,
        dayHigh: item.ohlc?.high || price,
        dayLow: item.ohlc?.low || price,
        open: item.ohlc?.open || price,
        marketState: "LIVE",
        currency: "INR",
        exchange: key.startsWith("BSE") ? "BSE" : "NSE",
      });
    }

    return quotes;
  },
};
