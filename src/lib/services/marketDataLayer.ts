import { upstoxService } from "./upstoxService";
import { fyersService } from "./fyersService";
import { angelOneService } from "./angelOneService";
import { yahooService } from "./yahooService";
import { nseFallbackService, synthOptionChain } from "./nseFallbackService";
import { getFyersConfig } from "./configStore";
import { saveEodData, getEodData } from "./persistentCache";
import type { Quote } from "../market.functions";
import type { OptionChain } from "../nse.functions";

const INDEX_SYMBOL_MAP: Record<string, string> = {
  NIFTY: "^NSEI",
  BANKNIFTY: "^NSEBANK",
  SENSEX: "^BSESN",
};

export const marketDataLayer = {
  async getQuotes(symbols: string[]): Promise<Quote[]> {
    // 1. Try Upstox (Primary)
    try {
      // console.log("Attempting Upstox for quotes...");
      const quotes = await upstoxService.getQuotes(symbols);
      if (quotes && quotes.length > 0) {
        return quotes;
      }
      console.warn("Upstox returned no quotes. Falling back to Angel One.");
    } catch (err: any) {
      console.warn(`Upstox quotes failed: ${err.message}. Falling back to Angel One.`);
    }

    // 2. Try Angel One (Backup 1)
    try {
      // console.log("Attempting Angel One for quotes...");
      const quotes = await angelOneService.getQuotes(symbols);
      if (quotes && quotes.length > 0) {
        return quotes;
      }
      console.warn("Angel One returned no quotes. Falling back to Yahoo Finance.");
    } catch (err: any) {
      console.warn(`Angel One quotes failed: ${err.message}. Falling back to Yahoo Finance.`);
    }

    // 3. Try Yahoo Finance (Final backup)
    try {
      // console.log("Attempting Yahoo Finance for quotes...");
      const quotes = await yahooService.getQuotes(symbols);
      if (quotes && quotes.length > 0) {
        return quotes;
      }
      console.error("Yahoo Finance returned no quotes.");
    } catch (err: any) {
      console.error(`All quote providers failed. Last error: ${err.message}`);
    }

    throw new Error(`Market quotes service temporarily unavailable.`);
  },

  async getOptionChain(
    symbol: string,
    spotPrice?: number,
    expiry?: string
  ): Promise<OptionChain & { fyersTokenStatus?: { ok: boolean; error?: string } }> {
    let spot = spotPrice;

    // Resolve spot price using live quotes first if not provided
    if (!spot) {
      try {
        const yahooSymbol = INDEX_SYMBOL_MAP[symbol] || symbol;
        const quotes = await this.getQuotes([yahooSymbol]);
        if (quotes.length > 0) {
          spot = quotes[0].price;
        }
      } catch (err: any) {
        console.warn(`Failed to resolve spot price for option chain: ${err.message}`);
      }
    }

    const defaultSpot = symbol === "BANKNIFTY" ? 52000 : symbol === "SENSEX" ? 80000 : 24500;
    const finalSpot = spot || defaultSpot;

    let fyersTokenStatus = { ok: true, error: "" };

    const cacheKey = `option_chain_${symbol}_${expiry || "default"}`;

    // 1. Try FYERS (Primary Option Chain Source)
    try {
      const config = await getFyersConfig();
      if (!config.accessToken || config.isExpired) {
        throw new Error(config.expiryError || "Fyers token missing or marked as expired.");
      }
      
      const chain = await fyersService.getOptionChain(symbol, finalSpot, expiry);
      const result = { ...chain, fyersTokenStatus: { ok: true } };
      await saveEodData(cacheKey, result);
      return result;
    } catch (err: any) {
      console.warn(`Fyers option chain failed: ${err.message}. Falling back to Angel One.`);
      fyersTokenStatus = { ok: false, error: err.message };
    }

    // 2. Try Angel One (Backup Option Chain Source)
    try {
      const chain = await angelOneService.getOptionChain(symbol, finalSpot, expiry);
      const result = { ...chain, fyersTokenStatus };
      await saveEodData(cacheKey, result);
      return result;
    } catch (err: any) {
      console.warn(`Angel One option chain failed: ${err.message}. Falling back to NSE scraper.`);
    }

    // 3. Try NSE fallback (Scraper)
    try {
      const chain = await nseFallbackService.getOptionChain(symbol, expiry);
      const result = { ...chain, fyersTokenStatus };
      await saveEodData(cacheKey, result);
      return result;
    } catch (err: any) {
      console.error(`All option chain providers failed. Last error: ${err.message}`);
    }

    // 4. Try persistent EOD cache
    const cachedData = await getEodData(cacheKey);
    if (cachedData) {
      return {
        ...cachedData,
        fyersTokenStatus,
        isEod: true,
        updatedAt: cachedData.updatedAt || Date.now(),
      };
    }

    // 5. Fallback to pure synthetic so the dashboard never crashes
    const synthChain = synthOptionChain(symbol, finalSpot, expiry);
    return { ...synthChain, fyersTokenStatus };
  },
};
