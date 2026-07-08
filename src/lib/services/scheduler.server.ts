import { getIstDate, isMarketOpenIst } from "../market-hours";
import { dbService, DBQuote, DBOptionChain, DBBreadth, DBSector, DBSignal } from "./database.server";
import { marketDataLayer, getQuotesCacheKey } from "./marketDataLayer";
import { dashboardService } from "./dashboardService.server";
import { fetchFnoStocks, fetchFnoScreener } from "../nse.functions";
import { NIFTY_STOCKS, BANKNIFTY_STOCKS, SENSEX_STOCKS } from "../market.functions";
import { saveEodData } from "./persistentCache";
import type { Quote } from "../market.functions";
import {
  isDualWriteEnabled,
  insertSystemLog,
  insertMarketSnapshot,
  insertMarketBreadth,
  insertSectorStrength,
  insertOptionChainSnapshot,
  insertOiActivity,
  type SupabaseMarketSnapshot,
  type SupabaseMarketBreadth,
  type SupabaseSectorStrength,
  type SupabaseOptionChainSnapshot,
  type SupabaseOiActivity,
} from "./supabase.server";

declare global {
  var __market_data_scheduler__: {
    intervalId: any;
    isRunning: boolean;
    lastTickWasOpen: boolean;
  } | undefined;
}

// HMR Cleanup: Clear active background intervals on file reload
if (globalThis.__market_data_scheduler__?.intervalId) {
  console.log("[HMR] Clearing active background scheduler interval...");
  clearInterval(globalThis.__market_data_scheduler__.intervalId);
  globalThis.__market_data_scheduler__ = undefined;
}

// Configurable save interval (default 1 minute)
const SAVE_INTERVAL_MS = process.env.INTRA_LOG_INTERVAL 
  ? parseInt(process.env.INTRA_LOG_INTERVAL, 10) 
  : 60000; // 1 minute default

let isRunningTick = false;
let tickCount = 0;

// Format helper
const pad = (n: number) => String(n).padStart(2, "0");
const getFormattedTime = (date: Date) => {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
const getFormattedDate = (date: Date) => {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// ── Fire-and-forget Supabase write wrapper ─────────────────────────────────────
// Wraps any Supabase insert in a void promise that logs errors but NEVER throws.
// The SQLite write has already happened before this is called — this is secondary.
function dualWrite(label: string, p: Promise<any>): void {
  void p.catch((err) => {
    console.error(`[scheduler] dual-write failed [${label}]:`, err?.message ?? err);
  });
}

async function executeTick() {
  if (isRunningTick) return;
  isRunningTick = true;

  const dualWrite_ = isDualWriteEnabled();

  const now = new Date();
  const ist = getIstDate(now.getTime());
  const dateStr = getFormattedDate(ist);
  const timeStr = getFormattedTime(ist);
  const timestamp = ist.getTime();

  const isOpen = isMarketOpenIst(now.getTime());
  
  // Transition check: Market just closed
  if (!isOpen && globalThis.__market_data_scheduler__?.lastTickWasOpen) {
    dbService.logEvent("INFO", "Market session ended. Triggering EOD database backup and pruning...");
    try {
      const backupPath = await dbService.backupDatabase(dateStr);
      const pruned = dbService.pruneData(180);
      dbService.logEvent("INFO", `EOD maintenance complete. Backup created: ${backupPath}. Pruned ${pruned} old records.`);
    } catch (e: any) {
      dbService.logEvent("ERROR", `EOD maintenance failed: ${e.message}`);
    }
  }

  // Update status
  if (globalThis.__market_data_scheduler__) {
    globalThis.__market_data_scheduler__.lastTickWasOpen = isOpen;
  }

  // If market is closed, idle
  if (!isOpen) {
    isRunningTick = false;
    return;
  }

  tickCount++;
  dbService.logEvent("INFO", `Executing scheduler data capture tick #${tickCount} at ${timeStr}`);

  try {
    // 1. Fetch Dashboard Quotes & Breadth
    const dash = await dashboardService.getDashboardData(true);
    
    // ── Breadth ──────────────────────────────────────────────────────────────
    const breadth: DBBreadth = {
      advance: dash.advance ?? 0,
      decline: dash.decline ?? 0,
      unchanged: dash.unchanged ?? 0,
      adr: dash.advance && dash.decline ? parseFloat((dash.advance / dash.decline).toFixed(3)) : 1.0,
      indiaVix: dash.vix?.price ?? 13.42
    };
    dbService.saveBreadth(breadth, timestamp, dateStr, timeStr);

    // Dual-write breadth to Supabase (fire-and-forget)
    if (dualWrite_) {
      const sbBreadth: SupabaseMarketBreadth = {
        trading_date: dateStr,
        trading_time: timeStr,
        advance: breadth.advance,
        decline: breadth.decline,
        unchanged: breadth.unchanged,
        adr: breadth.adr,
        india_vix: breadth.indiaVix,
      };
      dualWrite("market_breadth", insertMarketBreadth(sbBreadth));
    }

    // ── Index Quotes ──────────────────────────────────────────────────────────
    const quotesToSave: DBQuote[] = [];
    const sbQuotes: SupabaseMarketSnapshot[] = [];

    const pushQuote = (
      symbol: string, exchange: string, q: { open: number; dayHigh: number; dayLow: number; price: number; prevClose: number; change: number; changePct: number }
    ) => {
      const dbQ: DBQuote = {
        symbol, exchange,
        open: q.open, high: q.dayHigh, low: q.dayLow, close: q.price,
        ltp: q.price, prevClose: q.prevClose, changeVal: q.change, changePct: q.changePct,
        volume: 0, vwap: q.price
      };
      quotesToSave.push(dbQ);
      sbQuotes.push({
        trading_date: dateStr, trading_time: timeStr,
        symbol, exchange,
        open: q.open, high: q.dayHigh, low: q.dayLow, close: q.price,
        ltp: q.price, prev_close: q.prevClose, change_val: q.change, change_pct: q.changePct,
        volume: 0, vwap: q.price,
      });
    };

    if (dash.nifty)     pushQuote("NIFTY",    "NSE", dash.nifty);
    if (dash.bankNifty) pushQuote("BANKNIFTY", "NSE", dash.bankNifty);
    if (dash.sensex)    pushQuote("SENSEX",    "BSE", dash.sensex);
    if (dash.vix)       pushQuote("INDIAVIX",  "NSE", dash.vix);

    if (quotesToSave.length > 0) {
      dbService.saveSnapshots(quotesToSave, timestamp, dateStr, timeStr);

      // Dual-write quotes to Supabase (fire-and-forget)
      if (dualWrite_ && sbQuotes.length > 0) {
        dualWrite("market_snapshots", insertMarketSnapshot(sbQuotes));
      }
    }

    // ── Sector strength ───────────────────────────────────────────────────────
    if (dash.sectors && dash.sectors.length > 0) {
      const sectorsToSave: DBSector[] = dash.sectors.map((s: any) => ({
        symbol: s.symbol,
        name: s.label || s.name || s.symbol,
        price: s.price || 0,
        changePct: s.changePct || 0
      }));
      dbService.saveSectors(sectorsToSave, timestamp, dateStr, timeStr);

      // Dual-write sectors to Supabase (fire-and-forget)
      if (dualWrite_) {
        const sbSectors: SupabaseSectorStrength[] = sectorsToSave.map((s) => ({
          trading_date: dateStr,
          trading_time: timeStr,
          symbol: s.symbol,
          name: s.name,
          price: s.price,
          change_pct: s.changePct,
        }));
        dualWrite("sector_strength", insertSectorStrength(sbSectors));
      }
    }

    // ── Sector index EOD snapshot refresh ────────────────────────────────────
    // Call getSectorIndices() each tick so eod_cache/sector_indices_snapshot.json
    // is updated with the latest live data. After market close the EOD branch will
    // then return the final same-day close prices instead of a stale previous-day
    // snapshot. Failures are logged but never crash or block the rest of the tick.
    try {
      await marketDataLayer.getSectorIndices();
      dbService.logEvent("INFO", `Sector index EOD snapshot refreshed at ${timeStr}`);
    } catch (sectorErr: any) {
      dbService.logEvent("WARN", `Sector index snapshot refresh failed at ${timeStr}: ${sectorErr?.message ?? sectorErr}`);
    }

    // ── Option Chains ─────────────────────────────────────────────────────────
    const indicesToFetch = ["NIFTY", "BANKNIFTY", "SENSEX"];
    for (const symbol of indicesToFetch) {
      try {
        const spotPrice = symbol === "NIFTY" ? dash.nifty?.price : symbol === "BANKNIFTY" ? dash.bankNifty?.price : dash.sensex?.price;
        const chain = await marketDataLayer.getOptionChain(symbol, spotPrice);
        
        if (chain && chain.rows) {
          const dbChain: DBOptionChain = {
            symbol,
            expiry: chain.expiry,
            spotPrice: chain.spot,
            pcr: chain.totals?.peOi && chain.totals?.ceOi ? parseFloat((chain.totals.peOi / chain.totals.ceOi).toFixed(3)) : 1.0,
            maxPain: chain.maxCeOiStrike, // Expiry gravity proxy strike
            atmStrike: Math.round(chain.spot / (symbol === "BANKNIFTY" ? 100 : 50)) * (symbol === "BANKNIFTY" ? 100 : 50),
            totalCeOi: chain.totals?.ceOi || 0,
            totalPeOi: chain.totals?.peOi || 0,
            totalCeOiChg: chain.totals?.ceOiChg || 0,
            totalPeOiChg: chain.totals?.peOiChg || 0,
            totalCeVol: chain.totals?.ceVol || 0,
            totalPeVol: chain.totals?.peVol || 0,
            maxCeOiStrike: chain.maxCeOiStrike || 0,
            maxPeOiStrike: chain.maxPeOiStrike || 0,
            supportLevels: JSON.stringify(chain.levels?.filter(l => l.kind.startsWith("S")) || []),
            resistanceLevels: JSON.stringify(chain.levels?.filter(l => l.kind.startsWith("R")) || []),
            rows: chain.rows.map(r => ({
              strike: r.strike,
              ceLtp: r.ce?.ltp || 0,
              ceOi: r.ce?.oi || 0,
              ceOiChg: r.ce?.oiChg || 0,
              ceVol: r.ce?.volume || 0,
              ceSignal: r.ce?.signal || "Neutral",
              peLtp: r.pe?.ltp || 0,
              peOi: r.pe?.oi || 0,
              peOiChg: r.pe?.oiChg || 0,
              peVol: r.pe?.volume || 0,
              peSignal: r.pe?.signal || "Neutral"
            }))
          };
          dbService.saveOptionChain(dbChain, timestamp, dateStr, timeStr);

          // Dual-write option chain + OI activity to Supabase (fire-and-forget)
          if (dualWrite_) {
            const sbSnap: SupabaseOptionChainSnapshot = {
              trading_date: dateStr,
              trading_time: timeStr,
              symbol: dbChain.symbol,
              expiry: dbChain.expiry,
              spot_price: dbChain.spotPrice,
              pcr: dbChain.pcr,
              max_pain: dbChain.maxPain,
              atm_strike: dbChain.atmStrike,
              total_ce_oi: dbChain.totalCeOi,
              total_pe_oi: dbChain.totalPeOi,
              total_ce_oi_chg: dbChain.totalCeOiChg,
              total_pe_oi_chg: dbChain.totalPeOiChg,
              total_ce_vol: dbChain.totalCeVol,
              total_pe_vol: dbChain.totalPeVol,
              max_ce_oi_strike: dbChain.maxCeOiStrike,
              max_pe_oi_strike: dbChain.maxPeOiStrike,
              support_levels: dbChain.supportLevels,
              resistance_levels: dbChain.resistanceLevels,
            };

            // Chain: first insert the snapshot, then link OI rows to its id
            dualWrite(
              `option_chain+oi [${symbol}]`,
              insertOptionChainSnapshot(sbSnap).then((snapId) => {
                if (!snapId) return; // snapshot insert failed or was a dup; skip OI rows
                const sbOiRows: SupabaseOiActivity[] = dbChain.rows.map((r) => ({
                  snapshot_id: snapId,
                  strike: r.strike,
                  ce_ltp: r.ceLtp,
                  ce_oi: r.ceOi,
                  ce_oi_chg: r.ceOiChg,
                  ce_vol: r.ceVol,
                  ce_signal: r.ceSignal,
                  pe_ltp: r.peLtp,
                  pe_oi: r.peOi,
                  pe_oi_chg: r.peOiChg,
                  pe_vol: r.peVol,
                  pe_signal: r.peSignal,
                }));
                return insertOiActivity(sbOiRows);
              })
            );
          }
        }
      } catch (err: any) {
        dbService.logEvent("WARN", `Option chain data capture failed for ${symbol}: ${err.message}`);
      }
    }

    // ── F&O Stocks & Screener snapshot refresh ───────────────────────────────
    if (tickCount % 3 === 0) {
      try {
        const screenerData = await fetchFnoScreener();
        dbService.logEvent("INFO", `F&O screener snapshot refreshed at ${timeStr} with ${screenerData.data?.length ?? 0} rows (F&O stocks also refreshed internally)`);
      } catch (screenerErr: any) {
        dbService.logEvent("WARN", `F&O screener snapshot refresh failed at ${timeStr}: ${screenerErr?.message ?? screenerErr}`);
      }
    } else if (tickCount % 2 === 0) {
      try {
        const stocksData = await fetchFnoStocks();
        dbService.logEvent("INFO", `F&O stocks snapshot refreshed at ${timeStr} with ${stocksData.data?.length ?? 0} rows`);
      } catch (stocksErr: any) {
        dbService.logEvent("WARN", `F&O stocks snapshot refresh failed at ${timeStr}: ${stocksErr?.message ?? stocksErr}`);
      }
    }

    // ── Constituent/index contribution stock refresh ─────────────────────────
    if (tickCount % 5 === 0) {
      try {
        const uniqueSymbols = Array.from(new Set([
          ...NIFTY_STOCKS,
          ...BANKNIFTY_STOCKS,
          ...SENSEX_STOCKS
        ]));

        const chunkArray = <T>(arr: T[], size: number): T[][] => {
          const chunks: T[][] = [];
          for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
          }
          return chunks;
        };

        const batches = chunkArray(uniqueSymbols, 30);
        const quotesMap = new Map<string, Quote>();

        for (const batch of batches) {
          const res = await marketDataLayer.getQuotes(batch);
          if (res && Array.isArray(res)) {
            for (const q of res) {
              quotesMap.set(q.symbol, q);
            }
          }
        }

        // Reconstruct constituent arrays for NIFTY, BANKNIFTY, and SENSEX and write EOD cache
        const indicesToCache = [
          { name: "NIFTY", symbols: NIFTY_STOCKS },
          { name: "BANKNIFTY", symbols: BANKNIFTY_STOCKS },
          { name: "SENSEX", symbols: SENSEX_STOCKS },
        ];

        let cacheCount = 0;
        for (const idx of indicesToCache) {
          const mappedQuotes = idx.symbols
            .map(sym => quotesMap.get(sym))
            .filter((q): q is Quote => q !== undefined);

          if (mappedQuotes.length > 0) {
            const cacheKey = getQuotesCacheKey(idx.symbols);
            await saveEodData(cacheKey, { quotes: mappedQuotes, updatedAt: Date.now() });
            cacheCount++;
          }
        }

        dbService.logEvent("INFO", `Constituent stocks snapshot refreshed: ${uniqueSymbols.length} symbols across ${batches.length} batches, successfully updated EOD cache for ${cacheCount}/3 indices`);
      } catch (constituentErr: any) {
        dbService.logEvent("WARN", `Constituent stocks snapshot refresh failed at ${timeStr}: ${constituentErr?.message ?? constituentErr}`);
      }
    }

    dbService.logEvent("INFO", `Scheduler successfully recorded batch snapshot at ${timeStr}`);
  } catch (err: any) {
    dbService.logEvent("ERROR", `Scheduler tick execution failed: ${err.message}`, err.stack);
  } finally {
    isRunningTick = false;
  }
}

export function startScheduler() {
  if (globalThis.__market_data_scheduler__?.isRunning) {
    console.log("Scheduler is already running. Skipping startup.");
    return;
  }

  // Initialize DB tables and WAL mode
  try {
    dbService.init();
    dbService.logEvent("INFO", "Market Data Storage System initialized.");
  } catch (err: any) {
    console.error("Critical: Database initialization failed:", err);
    return;
  }

  const dualEnabled = isDualWriteEnabled();
  console.log(`Starting Intraday Data Scheduler at interval: ${SAVE_INTERVAL_MS / 1000}s`);
  if (dualEnabled) {
    console.log("[scheduler] Supabase dual-write ENABLED (SUPABASE_DUAL_WRITE=true)");
    // Log scheduler startup to Supabase system_logs (fire-and-forget)
    dualWrite(
      "system_logs/startup",
      insertSystemLog({
        service: "scheduler",
        level: "INFO",
        message: "Intraday scheduler started with Supabase dual-write enabled",
      })
    );
  } else {
    console.log("[scheduler] Supabase dual-write DISABLED (set SUPABASE_DUAL_WRITE=true to enable)");
  }

  // Run first tick immediately to catch up
  executeTick().catch(err => console.error("Error executing initial scheduler tick:", err));

  // Set interval loop
  const intervalId = setInterval(() => {
    executeTick().catch(err => console.error("Error in scheduler loop tick:", err));
  }, SAVE_INTERVAL_MS);

  globalThis.__market_data_scheduler__ = {
    intervalId,
    isRunning: true,
    lastTickWasOpen: isMarketOpenIst()
  };
}

export function stopScheduler() {
  if (globalThis.__market_data_scheduler__?.intervalId) {
    clearInterval(globalThis.__market_data_scheduler__.intervalId);
    dbService.logEvent("INFO", "Intraday Data Scheduler stopped manually.");
  }
  globalThis.__market_data_scheduler__ = {
    intervalId: null,
    isRunning: false,
    lastTickWasOpen: false
  };
}
