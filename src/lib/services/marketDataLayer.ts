import { upstoxService } from "./upstoxService";
import { fyersService } from "./fyersService";
import { angelOneService } from "./angelOneService";
import { yahooService } from "./yahooService";
import { nseFallbackService } from "./nseFallbackService";
import { saveEodData, getEodData, getEodOptionChain, saveEodOptionChain } from "./persistentCache";
import { getFyersConfig } from "./configStore";
import { resolveSymbol, StandardSymbol, BrokerName } from "./symbolMapper";
import { DataLineage, EnvelopedResponse } from "./dataLineage";
import { isBrokerAvailable, recordFailure, recordSuccess } from "./circuitBreaker";
import {
  ALL_INDEX_KEYS,
  YAHOO_INDEX_SYMBOL,
  type IndexQuote,
} from "./indexRegistry";
import type { Quote } from "../market.functions";
import type { OptionChain } from "../nse.functions";

const INDEX_SYMBOL_MAP: Record<string, string> = {
  NIFTY: "^NSEI",
  BANKNIFTY: "^NSEBANK",
  SENSEX: "^BSESN",
};

export type FeatureCategory = "quotes" | "futuresOI" | "optionChain" | "sectorIndices";

export const routingConfig: Record<FeatureCategory, BrokerName[]> = {
  quotes: ["upstox", "yahoo"],
  futuresOI: ["angelone", "nse"],
  optionChain: ["fyers", "angelone", "nse"],
  // Sector/broad index quotes: FYERS is authenticated HTTPS (works on Cloudflare
  // and carries every sectoral index incl. Defence/Chemicals/Capital Markets),
  // then NSE allIndices, then Yahoo, then the EOD snapshot.
  sectorIndices: ["fyers", "nse", "yahoo"],
};

const SECTOR_INDICES_CACHE_KEY = "sector_indices_snapshot";

export function getQuotesCacheKey(symbols: string[]): string {
  const sorted = [...symbols].sort().join(",");
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    const char = sorted.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `quotes_snapshot_${Math.abs(hash)}`;
}

// In-memory cache of last known prices for quotes sanity check
const lastKnownPrices = new Map<string, number>();

function isMarketOpen(): boolean {
  if (process.env.BYPASS_MARKET_HOURS === "true") return true;

  const now = new Date();
  // Convert now to IST (Indian Standard Time: UTC+5:30)
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 3600000 * 5.5);

  const day = ist.getDay();
  if (day === 0 || day === 6) return false; // weekend

  const hour = ist.getHours();
  const min = ist.getMinutes();
  const timeVal = hour * 100 + min; // e.g. 0915 or 1530

  return timeVal >= 915 && timeVal <= 1530;
}

function sanitizeQuotes(quotes: Quote[]): Quote[] {
  return quotes.map((q) => {
    const lastPrice = lastKnownPrices.get(q.symbol);
    if (lastPrice && lastPrice > 0) {
      const pctChange = Math.abs(q.price - lastPrice) / lastPrice;
      const isIndex = q.symbol.startsWith("^") || ["NIFTY", "BANKNIFTY", "SENSEX"].includes(q.symbol);
      const pctLimit = isIndex ? 0.05 : 0.15; // 5% limit for indices, 15% for stocks

      if (pctChange > pctLimit) {
        console.warn(
          `Sanity check failed for ${q.symbol}: new price ${q.price} vs last price ${lastPrice}. Using last known price.`
        );
        return {
          ...q,
          price: lastPrice,
          change: lastPrice - q.prevClose,
          changePct: q.prevClose ? ((lastPrice - q.prevClose) / q.prevClose) * 100 : 0,
        };
      }
    }
    lastKnownPrices.set(q.symbol, q.price);
    return q;
  });
}

export const marketDataLayer = {
  async getQuotes(symbols: string[]): Promise<EnvelopedResponse<Quote[]>> {
    const start = Date.now();
    const cacheKey = getQuotesCacheKey(symbols);

    // 1. Check if Market is open (if closed, we can immediately serve from cache if available)
    const marketOpen = isMarketOpen();
    if (!marketOpen) {
      const cached = await getEodData(cacheKey);
      if (cached) {
        const res = cached.quotes as EnvelopedResponse<Quote[]>;
        res._metadata = {
          source: "cache",
          status: "cached",
          timestamp: cached.updatedAt || Date.now(),
        };
        return res;
      }
    }

    // 2. Try Upstox (Primary quotes)
    if (isBrokerAvailable("upstox")) {
      try {
        const quotes = await upstoxService.getQuotes(symbols);
        if (quotes && quotes.length > 0) {
          recordSuccess("upstox");
          const sanitized = sanitizeQuotes(quotes);
          const res = sanitized as EnvelopedResponse<Quote[]>;
          res._metadata = {
            source: "upstox",
            status: "live",
            timestamp: Date.now(),
            latencyMs: Date.now() - start,
          };
          // Save snapshot for EOD cache
          await saveEodData(cacheKey, { quotes: sanitized, updatedAt: Date.now() });
          return res;
        }
        console.warn("Upstox returned empty quotes.");
      } catch (err: any) {
        console.warn(`Upstox quotes failed: ${err.message}. Falling back to Yahoo.`);
        recordFailure("upstox");
      }
    }

    // 3. Try Yahoo Finance (Backup quotes)
    if (isBrokerAvailable("yahoo")) {
      try {
        // Resolve symbols for Yahoo and track mapping back to original queried symbols
        const symbolMap = new Map<string, string>();
        const yahooSymbols = symbols.map((s) => {
          let resolved = s;
          if (INDEX_SYMBOL_MAP[s]) {
            resolved = INDEX_SYMBOL_MAP[s];
          } else {
            try {
              resolved = resolveSymbol(s as StandardSymbol, "yahoo");
            } catch {
              resolved = s;
            }
          }
          symbolMap.set(resolved, s);
          return resolved;
        });

        const quotes = await yahooService.getQuotes(yahooSymbols);
        if (quotes && quotes.length > 0) {
          recordSuccess("yahoo");
          // Map back to original queried symbols
          const mappedQuotes = quotes.map((q) => {
            const originalSymbol = symbolMap.get(q.symbol) || q.symbol;
            return { ...q, symbol: originalSymbol };
          });
          const sanitized = sanitizeQuotes(mappedQuotes);
          const res = sanitized as EnvelopedResponse<Quote[]>;
          res._metadata = {
            source: "yahoo",
            status: "fallback",
            timestamp: Date.now(),
            latencyMs: Date.now() - start,
          };
          // Save snapshot for EOD cache
          await saveEodData(cacheKey, { quotes: sanitized, updatedAt: Date.now() });
          return res;
        }
      } catch (err: any) {
        console.error(`Yahoo quotes failed: ${err.message}`);
        recordFailure("yahoo");
      }
    }

    // 4. Try EOD cache as final resort
    const cached = await getEodData(cacheKey);
    if (cached) {
      const res = cached.quotes as EnvelopedResponse<Quote[]>;
      res._metadata = {
        source: "cache",
        status: "cached",
        timestamp: cached.updatedAt || Date.now(),
      };
      return res;
    }

    throw new Error(`Market quotes service temporarily unavailable.`);
  },

  /**
   * Sector/broad index quotes with the sectorIndices fallback chain:
   * FYERS (primary) → NSE allIndices → Yahoo → EOD snapshot. Each tier only
   * fills the keys still missing, so the result degrades gracefully per-index
   * (e.g. when the FYERS token expires, core sectors still resolve via NSE/Yahoo
   * and only FYERS-exclusive indices drop). Real data only — no fabrication.
   */
  async getSectorIndices(): Promise<EnvelopedResponse<IndexQuote[]>> {
    const start = Date.now();
    const keys = ALL_INDEX_KEYS;
    const marketOpen = isMarketOpen();

    // Market closed → serve the real EOD snapshot immediately if present.
    if (!marketOpen) {
      const cached = await getEodData(SECTOR_INDICES_CACHE_KEY);
      if (cached?.indices?.length) {
        const res = cached.indices as EnvelopedResponse<IndexQuote[]>;
        res._metadata = { source: "cache", status: "cached", timestamp: cached.updatedAt || Date.now() };
        return res;
      }
    }

    const result = new Map<string, IndexQuote>();
    let primary: DataLineage["source"] | "" = "";

    // 1. FYERS (primary) — unless circuit-broken or token expired.
    let fyersAvailable = isBrokerAvailable("fyers");
    if (fyersAvailable) {
      try {
        const cfg = await getFyersConfig();
        if (cfg.isExpired || !cfg.accessToken) fyersAvailable = false;
      } catch {
        fyersAvailable = false;
      }
    }
    if (fyersAvailable) {
      try {
        const q = await fyersService.getIndexQuotes(keys);
        if (q.length) {
          recordSuccess("fyers");
          for (const iq of q) result.set(iq.key, iq);
          primary = "fyers";
        }
      } catch (err: any) {
        console.warn(`FYERS sector indices failed: ${err.message}. Falling back to NSE.`);
        recordFailure("fyers");
      }
    }

    // 2. NSE allIndices — fill any keys still missing.
    let missing = keys.filter((k) => !result.has(k));
    if (missing.length && isBrokerAvailable("nse")) {
      try {
        const q = await nseFallbackService.getAllIndices(missing);
        if (q.length) {
          recordSuccess("nse");
          for (const iq of q) if (!result.has(iq.key)) result.set(iq.key, iq);
          if (!primary) primary = "nse";
        }
      } catch (err: any) {
        console.warn(`NSE allIndices failed: ${err.message}. Falling back to Yahoo.`);
        recordFailure("nse");
      }
    }

    // 3. Yahoo — fill remaining keys that have a Yahoo ticker.
    missing = keys.filter((k) => !result.has(k) && YAHOO_INDEX_SYMBOL[k]);
    if (missing.length && isBrokerAvailable("yahoo")) {
      try {
        const symToKey = new Map<string, string>();
        const ySyms = missing.map((k) => {
          const s = YAHOO_INDEX_SYMBOL[k];
          symToKey.set(s, k);
          return s;
        });
        const quotes = await yahooService.getQuotes(ySyms);
        if (quotes.length) {
          recordSuccess("yahoo");
          for (const qt of quotes) {
            const key = symToKey.get(qt.symbol);
            if (key && !result.has(key)) {
              result.set(key, { key, price: qt.price, changePct: qt.changePct, prevClose: qt.prevClose });
            }
          }
          if (!primary) primary = "yahoo";
        }
      } catch (err: any) {
        console.error(`Yahoo sector indices failed: ${err.message}`);
        recordFailure("yahoo");
      }
    }

    const arr = [...result.values()];
    if (arr.length && primary) {
      const res = arr as EnvelopedResponse<IndexQuote[]>;
      res._metadata = {
        source: primary,
        status: primary === "fyers" ? "live" : "fallback",
        timestamp: Date.now(),
        latencyMs: Date.now() - start,
      };
      // Persist a real snapshot for the closed-market / EOD path.
      await saveEodData(SECTOR_INDICES_CACHE_KEY, { indices: arr, updatedAt: Date.now(), source: primary });
      return res;
    }

    // 4. EOD snapshot (last real data) as the final resort.
    const cached = await getEodData(SECTOR_INDICES_CACHE_KEY);
    if (cached?.indices?.length) {
      const res = cached.indices as EnvelopedResponse<IndexQuote[]>;
      res._metadata = { source: "cache", status: "cached", timestamp: cached.updatedAt || Date.now() };
      return res;
    }

    throw new Error("Sector index service temporarily unavailable: all sources and EOD cache failed.");
  },

  async getOptionChain(
    symbol: string,
    spotPrice?: number,
    expiry?: string
  ): Promise<EnvelopedResponse<OptionChain & { fyersTokenStatus?: { ok: boolean; error?: string } }>> {
    let spot = spotPrice;

    // Resolve spot price using live quotes first if not provided
    if (!spot) {
      try {
        const quotes = await this.getQuotes([symbol]);
        if (quotes.length > 0) {
          spot = quotes[0].price;
        }
      } catch (err: any) {
        console.warn(`Failed to resolve spot price for option chain: ${err.message}`);
      }
    }

    const defaultSpot = symbol === "BANKNIFTY" ? 52000 : symbol === "SENSEX" ? 80000 : 24500;
    const finalSpot = spot || defaultSpot;

    // Check if market is closed - serve from EOD cache immediately if possible
    if (!isMarketOpen()) {
      const cachedData = await getEodOptionChain(symbol, expiry);
      if (cachedData) {
        const res = {
          ...cachedData,
          fyersTokenStatus: { ok: true },
          isEod: true,
          updatedAt: cachedData.updatedAt || Date.now(),
        } as EnvelopedResponse<any>;
        res._metadata = {
          source: "cache",
          status: "cached",
          timestamp: cachedData.updatedAt || Date.now(),
        };
        return res;
      }
    }

    let fyersTokenStatus = { ok: true, error: "" };
    const start = Date.now();

    // 1. Try FYERS (Primary Options Source)
    let fyersAvailable = isBrokerAvailable("fyers");
    if (fyersAvailable) {
      try {
        const config = await getFyersConfig();
        if (config.isExpired || !config.accessToken) {
          fyersAvailable = false;
        }
      } catch {
        fyersAvailable = false;
      }
    }

    if (fyersAvailable) {
      try {
        const chain = await fyersService.getOptionChain(symbol, finalSpot, expiry);
        recordSuccess("fyers");
        const res = { ...chain, fyersTokenStatus: { ok: true } } as EnvelopedResponse<any>;
        res._metadata = {
          source: "fyers",
          status: "live",
          timestamp: Date.now(),
          latencyMs: Date.now() - start,
        };
        await saveEodOptionChain(symbol, expiry, res);
        return res;
      } catch (err: any) {
        console.warn(`Fyers option chain failed: ${err.message}. Falling back to Angel One.`);
        recordFailure("fyers");
        fyersTokenStatus = { ok: false, error: err.message };
      }
    } else {
      fyersTokenStatus = { ok: false, error: "Fyers marked as expired or circuit broken" };
    }

    // 2. Try Angel One (Backup Options Source)
    if (isBrokerAvailable("angelone")) {
      try {
        const chain = await angelOneService.getOptionChain(symbol, finalSpot, expiry);
        recordSuccess("angelone");
        const res = { ...chain, fyersTokenStatus } as EnvelopedResponse<any>;
        res._metadata = {
          source: "angelone",
          status: "fallback",
          timestamp: Date.now(),
          latencyMs: Date.now() - start,
        };
        await saveEodOptionChain(symbol, expiry, res);
        return res;
      } catch (err: any) {
        console.warn(`Angel One option chain failed: ${err.message}. Falling back to NSE scraper.`);
        recordFailure("angelone");
      }
    }

    // 3. Try NSE fallback (Scraper - Last resort Live Source)
    if (isBrokerAvailable("nse")) {
      try {
        const chain = await nseFallbackService.getOptionChain(symbol, expiry);
        recordSuccess("nse");
        const res = { ...chain, fyersTokenStatus } as EnvelopedResponse<any>;
        res._metadata = {
          source: "nse",
          status: "fallback",
          timestamp: Date.now(),
          latencyMs: Date.now() - start,
        };
        await saveEodOptionChain(symbol, expiry, res);
        return res;
      } catch (err: any) {
        console.error(`NSE scraper failed: ${err.message}`);
        recordFailure("nse");
      }
    }

    // 4. Try persistent EOD cache (exact expiry, else default snapshot)
    const cachedData = await getEodOptionChain(symbol, expiry);
    if (cachedData) {
      const res = {
        ...cachedData,
        fyersTokenStatus,
        isEod: true,
        updatedAt: cachedData.updatedAt || Date.now(),
      } as EnvelopedResponse<any>;
      res._metadata = {
        source: "cache",
        status: "cached",
        timestamp: cachedData.updatedAt || Date.now(),
      };
      return res;
    }

    // 5. No synthetic/mock fallback. If every live source and the EOD cache
    //    failed, surface a real error so the UI can show a FAIL state instead
    //    of fabricated data.
    throw new Error(
      `Option chain unavailable for ${symbol}: all live sources and EOD cache failed.`
    );
  },
};
