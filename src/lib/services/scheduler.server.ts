import { getIstDate, isMarketOpenIst } from "../market-hours";
import { dbService, DBQuote, DBOptionChain, DBBreadth, DBSector, DBSignal } from "./database.server";
import { marketDataLayer } from "./marketDataLayer";
import { dashboardService } from "./dashboardService.server";

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

// Format helper
const pad = (n: number) => String(n).padStart(2, "0");
const getFormattedTime = (date: Date) => {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
const getFormattedDate = (date: Date) => {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

async function executeTick() {
  if (isRunningTick) return;
  isRunningTick = true;

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

  dbService.logEvent("INFO", `Executing scheduler data capture tick at ${timeStr}`);

  try {
    // 1. Fetch Dashboard Quotes & Breadth
    const dash = await dashboardService.getDashboardData(true);
    
    // Save Breadth
    const breadth: DBBreadth = {
      advance: dash.advance ?? 0,
      decline: dash.decline ?? 0,
      unchanged: dash.unchanged ?? 0,
      adr: dash.advance && dash.decline ? parseFloat((dash.advance / dash.decline).toFixed(3)) : 1.0,
      indiaVix: dash.vix?.price ?? 13.42
    };
    dbService.saveBreadth(breadth, timestamp, dateStr, timeStr);

    // Save Index Quotes
    const quotesToSave: DBQuote[] = [];
    if (dash.nifty) {
      quotesToSave.push({
        symbol: "NIFTY", exchange: "NSE",
        open: dash.nifty.open, high: dash.nifty.dayHigh, low: dash.nifty.dayLow, close: dash.nifty.price,
        ltp: dash.nifty.price, prevClose: dash.nifty.prevClose, changeVal: dash.nifty.change, changePct: dash.nifty.changePct,
        volume: 0, vwap: dash.nifty.price
      });
    }
    if (dash.bankNifty) {
      quotesToSave.push({
        symbol: "BANKNIFTY", exchange: "NSE",
        open: dash.bankNifty.open, high: dash.bankNifty.dayHigh, low: dash.bankNifty.dayLow, close: dash.bankNifty.price,
        ltp: dash.bankNifty.price, prevClose: dash.bankNifty.prevClose, changeVal: dash.bankNifty.change, changePct: dash.bankNifty.changePct,
        volume: 0, vwap: dash.bankNifty.price
      });
    }
    if (dash.sensex) {
      quotesToSave.push({
        symbol: "SENSEX", exchange: "BSE",
        open: dash.sensex.open, high: dash.sensex.dayHigh, low: dash.sensex.dayLow, close: dash.sensex.price,
        ltp: dash.sensex.price, prevClose: dash.sensex.prevClose, changeVal: dash.sensex.change, changePct: dash.sensex.changePct,
        volume: 0, vwap: dash.sensex.price
      });
    }
    if (dash.vix) {
      quotesToSave.push({
        symbol: "INDIAVIX", exchange: "NSE",
        open: dash.vix.open, high: dash.vix.dayHigh, low: dash.vix.dayLow, close: dash.vix.price,
        ltp: dash.vix.price, prevClose: dash.vix.prevClose, changeVal: dash.vix.change, changePct: dash.vix.changePct,
        volume: 0, vwap: dash.vix.price
      });
    }

    if (quotesToSave.length > 0) {
      dbService.saveSnapshots(quotesToSave, timestamp, dateStr, timeStr);
    }

    // Save Sector strength
    if (dash.sectors && dash.sectors.length > 0) {
      const sectorsToSave: DBSector[] = dash.sectors.map((s: any) => ({
        symbol: s.symbol,
        name: s.label || s.name || s.symbol,
        price: s.price || 0,
        changePct: s.changePct || 0
      }));
      dbService.saveSectors(sectorsToSave, timestamp, dateStr, timeStr);
    }

    // 2. Fetch Option Chains
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
        }
      } catch (err: any) {
        dbService.logEvent("WARN", `Option chain data capture failed for ${symbol}: ${err.message}`);
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

  console.log(`Starting Intraday Data Scheduler at interval: ${SAVE_INTERVAL_MS / 1000}s`);

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
