import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import type { SQLiteMarketSnapshotRow } from "./historicalDataService.server";

export interface DBQuote {
  symbol: string;
  exchange: string;
  open: number;
  high: number;
  low: number;
  close: number;
  ltp: number;
  prevClose: number;
  changeVal: number;
  changePct: number;
  volume: number;
  vwap: number;
}

export interface DBOptionChain {
  symbol: string;
  expiry: string;
  spotPrice: number;
  pcr: number;
  maxPain: number;
  atmStrike: number;
  totalCeOi: number;
  totalPeOi: number;
  totalCeOiChg: number;
  totalPeOiChg: number;
  totalCeVol: number;
  totalPeVol: number;
  maxCeOiStrike: number;
  maxPeOiStrike: number;
  supportLevels: string; // JSON string
  resistanceLevels: string; // JSON string
  rows: DBOiRow[];
}

export interface DBOiRow {
  strike: number;
  ceLtp: number;
  ceOi: number;
  ceOiChg: number;
  ceVol: number;
  ceSignal: string;
  peLtp: number;
  peOi: number;
  peOiChg: number;
  peVol: number;
  peSignal: string;
}

export interface DBBreadth {
  advance: number;
  decline: number;
  unchanged: number;
  adr: number;
  indiaVix: number;
}

export interface DBSector {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
}

export interface DBSignal {
  symbol: string;
  signalType: string; // "VERY STRONG" | "STRONG" | "WEAK"
  direction: string; // "BULLISH" | "BEARISH" | "NEUTRAL"
  strike: number;
  entry: string;
  sl: string;
  t1: string;
  t2: string;
  rr: string;
  confidence: number;
}

export interface MarketDatabase {
  init(): void;
  saveSnapshots(quotes: DBQuote[], timestamp: number, dateStr: string, timeStr: string): void;
  saveOptionChain(chain: DBOptionChain, timestamp: number, dateStr: string, timeStr: string): void;
  saveBreadth(breadth: DBBreadth, timestamp: number, dateStr: string, timeStr: string): void;
  saveSectors(sectors: DBSector[], timestamp: number, dateStr: string, timeStr: string): void;
  saveSignals(signals: DBSignal[], timestamp: number, dateStr: string, timeStr: string): void;
  logEvent(level: "INFO" | "WARN" | "ERROR", message: string, details?: string): void;
  
  getAvailableDates(): string[];
  getMarketHistory(symbol: string, date: string, intervalMinutes: number): any[];
  getMarketHistoryRangeRaw(symbol: string, startDate: string, endDate: string): SQLiteMarketSnapshotRow[];
  getCandles(symbol: string, date: string, intervalMinutes: number): any[];
  getOptionHistory(symbol: string, date: string, intervalMinutes: number): any[];
  getOiHistory(snapshotId: number): any[];
  getBreadthHistory(date: string, intervalMinutes: number): any[];
  
  backupDatabase(dateStr: string): Promise<string>;
  pruneData(retentionDays: number): number;
}

class SQLiteDatabaseService implements MarketDatabase {
  private db!: Database.Database;
  private dbPath: string;

  constructor() {
    const dbFolder = path.join(process.cwd(), "backend", "database");
    if (!fs.existsSync(dbFolder)) {
      fs.mkdirSync(dbFolder, { recursive: true });
    }
    this.dbPath = path.join(dbFolder, "market_data.db");
  }

  public init() {
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    
    // 1. Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT
      );

      CREATE TABLE IF NOT EXISTS market_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        trading_date TEXT NOT NULL,
        trading_time TEXT NOT NULL,
        symbol TEXT NOT NULL,
        exchange TEXT NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        ltp REAL NOT NULL,
        prev_close REAL NOT NULL,
        change_val REAL NOT NULL,
        change_pct REAL NOT NULL,
        volume REAL NOT NULL,
        vwap REAL NOT NULL,
        UNIQUE(trading_date, trading_time, symbol)
      );

      CREATE TABLE IF NOT EXISTS option_chain_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        trading_date TEXT NOT NULL,
        trading_time TEXT NOT NULL,
        symbol TEXT NOT NULL,
        expiry TEXT NOT NULL,
        spot_price REAL NOT NULL,
        pcr REAL NOT NULL,
        max_pain REAL NOT NULL,
        atm_strike REAL NOT NULL,
        total_ce_oi REAL NOT NULL,
        total_pe_oi REAL NOT NULL,
        total_ce_oi_chg REAL NOT NULL,
        total_pe_oi_chg REAL NOT NULL,
        total_ce_vol REAL NOT NULL,
        total_pe_vol REAL NOT NULL,
        max_ce_oi_strike REAL NOT NULL,
        max_pe_oi_strike REAL NOT NULL,
        support_levels TEXT NOT NULL,
        resistance_levels TEXT NOT NULL,
        UNIQUE(trading_date, trading_time, symbol, expiry)
      );

      CREATE TABLE IF NOT EXISTS oi_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL,
        strike REAL NOT NULL,
        ce_ltp REAL NOT NULL,
        ce_oi REAL NOT NULL,
        ce_oi_chg REAL NOT NULL,
        ce_vol REAL NOT NULL,
        ce_signal TEXT NOT NULL,
        pe_ltp REAL NOT NULL,
        pe_oi REAL NOT NULL,
        pe_oi_chg REAL NOT NULL,
        pe_vol REAL NOT NULL,
        pe_signal TEXT NOT NULL,
        FOREIGN KEY(snapshot_id) REFERENCES option_chain_snapshots(id) ON DELETE CASCADE,
        UNIQUE(snapshot_id, strike)
      );

      CREATE TABLE IF NOT EXISTS market_breadth (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        trading_date TEXT NOT NULL,
        trading_time TEXT NOT NULL,
        advance INTEGER NOT NULL,
        decline INTEGER NOT NULL,
        unchanged INTEGER NOT NULL,
        adr REAL NOT NULL,
        india_vix REAL NOT NULL,
        UNIQUE(trading_date, trading_time)
      );

      CREATE TABLE IF NOT EXISTS sector_strength (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        trading_date TEXT NOT NULL,
        trading_time TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        change_pct REAL NOT NULL,
        UNIQUE(trading_date, trading_time, symbol)
      );

      CREATE TABLE IF NOT EXISTS trade_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        trading_date TEXT NOT NULL,
        trading_time TEXT NOT NULL,
        symbol TEXT NOT NULL,
        signal_type TEXT NOT NULL,
        direction TEXT NOT NULL,
        strike REAL NOT NULL,
        entry TEXT,
        sl TEXT,
        t1 TEXT,
        t2 TEXT,
        rr TEXT,
        confidence REAL NOT NULL,
        UNIQUE(trading_date, trading_time, symbol, strike)
      );
    `);

    // 2. Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_snapshots_sym_date ON market_snapshots(symbol, trading_date, timestamp);
      CREATE INDEX IF NOT EXISTS idx_options_sym_date ON option_chain_snapshots(symbol, trading_date, timestamp);
      CREATE INDEX IF NOT EXISTS idx_oi_snapshot_id ON oi_activity(snapshot_id);
      CREATE INDEX IF NOT EXISTS idx_breadth_date ON market_breadth(trading_date, timestamp);
      CREATE INDEX IF NOT EXISTS idx_sector_sym_date ON sector_strength(symbol, trading_date);
      CREATE INDEX IF NOT EXISTS idx_signals_sym_date ON trade_signals(symbol, trading_date);
    `);
  }

  public saveSnapshots(quotes: DBQuote[], timestamp: number, dateStr: string, timeStr: string) {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO market_snapshots (
        timestamp, trading_date, trading_time, symbol, exchange,
        open, high, low, close, ltp, prev_close, change_val, change_pct, volume, vwap
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((items: DBQuote[]) => {
      for (const q of items) {
        insert.run(
          timestamp, dateStr, timeStr, q.symbol, q.exchange,
          q.open, q.high, q.low, q.close, q.ltp, q.prevClose, q.changeVal, q.changePct, q.volume, q.vwap
        );
      }
    });

    transaction(quotes);
  }

  public saveOptionChain(chain: DBOptionChain, timestamp: number, dateStr: string, timeStr: string) {
    const insertSnapshot = this.db.prepare(`
      INSERT OR IGNORE INTO option_chain_snapshots (
        timestamp, trading_date, trading_time, symbol, expiry, spot_price, pcr, max_pain, atm_strike,
        total_ce_oi, total_pe_oi, total_ce_oi_chg, total_pe_oi_chg, total_ce_vol, total_pe_vol,
        max_ce_oi_strike, max_pe_oi_strike, support_levels, resistance_levels
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertOiRow = this.db.prepare(`
      INSERT OR IGNORE INTO oi_activity (
        snapshot_id, strike, ce_ltp, ce_oi, ce_oi_chg, ce_vol, ce_signal,
        pe_ltp, pe_oi, pe_oi_chg, pe_vol, pe_signal
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((c: DBOptionChain) => {
      const res = insertSnapshot.run(
        timestamp, dateStr, timeStr, c.symbol, c.expiry, c.spotPrice, c.pcr, c.maxPain, c.atmStrike,
        c.totalCeOi, c.totalPeOi, c.totalCeOiChg, c.totalPeOiChg, c.totalCeVol, c.totalPeVol,
        c.maxCeOiStrike, c.maxPeOiStrike, c.supportLevels, c.resistanceLevels
      );

      const snapshotId = res.lastInsertRowid;
      if (snapshotId) {
        for (const row of c.rows) {
          insertOiRow.run(
            snapshotId, row.strike, row.ceLtp, row.ceOi, row.ceOiChg, row.ceVol, row.ceSignal,
            row.peLtp, row.peOi, row.peOiChg, row.peVol, row.peSignal
          );
        }
      }
    });

    transaction(chain);
  }

  public saveBreadth(breadth: DBBreadth, timestamp: number, dateStr: string, timeStr: string) {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO market_breadth (
        timestamp, trading_date, trading_time, advance, decline, unchanged, adr, india_vix
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(timestamp, dateStr, timeStr, breadth.advance, breadth.decline, breadth.unchanged, breadth.adr, breadth.indiaVix);
  }

  public saveSectors(sectors: DBSector[], timestamp: number, dateStr: string, timeStr: string) {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO sector_strength (
        timestamp, trading_date, trading_time, symbol, name, price, change_pct
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((items: DBSector[]) => {
      for (const s of items) {
        insert.run(timestamp, dateStr, timeStr, s.symbol, s.name, s.price, s.changePct);
      }
    });

    transaction(sectors);
  }

  public saveSignals(signals: DBSignal[], timestamp: number, dateStr: string, timeStr: string) {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO trade_signals (
        timestamp, trading_date, trading_time, symbol, signal_type, direction, strike,
        entry, sl, t1, t2, rr, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((items: DBSignal[]) => {
      for (const s of items) {
        insert.run(timestamp, dateStr, timeStr, s.symbol, s.signalType, s.direction, s.strike, s.entry, s.sl, s.t1, s.t2, s.rr, s.confidence);
      }
    });

    transaction(signals);
  }

  public logEvent(level: "INFO" | "WARN" | "ERROR", message: string, details?: string) {
    try {
      const insert = this.db.prepare(`
        INSERT INTO system_logs (timestamp, level, message, details) VALUES (?, ?, ?, ?)
      `);
      insert.run(Date.now(), level, message, details || null);
    } catch (e) {
      console.error("Failed to write to system_logs inside SQLite:", e);
    }
  }

  public getAvailableDates(): string[] {
    const query = this.db.prepare(`
      SELECT DISTINCT trading_date FROM market_snapshots ORDER BY trading_date DESC
    `);
    const rows = query.all() as { trading_date: string }[];
    return rows.map((r) => r.trading_date);
  }

  public getMarketHistory(symbol: string, date: string, intervalMinutes: number): any[] {
    const intervalMs = intervalMinutes * 60 * 1000;
    const query = this.db.prepare(`
      SELECT * FROM market_snapshots
      WHERE symbol = ? AND trading_date = ?
      GROUP BY (timestamp / ?)
      ORDER BY timestamp ASC
    `);
    return query.all(symbol, date, intervalMs);
  }

  public getMarketHistoryRangeRaw(
    symbol: string,
    startDate: string,
    endDate: string
  ): SQLiteMarketSnapshotRow[] {
    const query = this.db.prepare(`
      SELECT
        id,
        timestamp,
        trading_date,
        trading_time,
        symbol,
        exchange,
        open,
        high,
        low,
        close,
        ltp,
        prev_close,
        change_val,
        change_pct,
        volume,
        vwap
      FROM market_snapshots
      WHERE symbol = ?
        AND trading_date BETWEEN ? AND ?
      ORDER BY
        trading_date ASC,
        timestamp ASC,
        id ASC
    `);
    return query.all(symbol, startDate, endDate) as SQLiteMarketSnapshotRow[];
  }

  public getCandles(symbol: string, date: string, intervalMinutes: number): any[] {
    const intervalMs = intervalMinutes * 60 * 1000;
    
    // Downsample quotes to form OHLCV candles
    const query = this.db.prepare(`
      SELECT 
        (timestamp / ?) * ? AS bucket_timestamp,
        MIN(open) AS open,
        MAX(high) AS high,
        MIN(low) AS low,
        close, -- Simple approximation or LAST_VALUE
        SUM(volume) AS volume
      FROM market_snapshots
      WHERE symbol = ? AND trading_date = ?
      GROUP BY (timestamp / ?)
      ORDER BY bucket_timestamp ASC
    `);
    return query.all(intervalMs, intervalMs, symbol, date, intervalMs);
  }

  public getOptionHistory(symbol: string, date: string, intervalMinutes: number): any[] {
    const intervalMs = intervalMinutes * 60 * 1000;
    const query = this.db.prepare(`
      SELECT * FROM option_chain_snapshots
      WHERE symbol = ? AND trading_date = ?
      GROUP BY (timestamp / ?)
      ORDER BY timestamp ASC
    `);
    return query.all(symbol, date, intervalMs);
  }

  public getOiHistory(snapshotId: number): any[] {
    const query = this.db.prepare(`
      SELECT * FROM oi_activity WHERE snapshot_id = ? ORDER BY strike ASC
    `);
    return query.all(snapshotId);
  }

  public getBreadthHistory(date: string, intervalMinutes: number): any[] {
    const intervalMs = intervalMinutes * 60 * 1000;
    const query = this.db.prepare(`
      SELECT * FROM market_breadth
      WHERE trading_date = ?
      GROUP BY (timestamp / ?)
      ORDER BY timestamp ASC
    `);
    return query.all(date, intervalMs);
  }

  public async backupDatabase(dateStr: string): Promise<string> {
    const backupFolder = path.join(process.cwd(), "backend", "database", "backups");
    if (!fs.existsSync(backupFolder)) {
      fs.mkdirSync(backupFolder, { recursive: true });
    }
    const backupFile = path.join(backupFolder, `market_data_${dateStr}.db`);
    
    return new Promise((resolve, reject) => {
      try {
        // Run vacuum to optimize database
        this.db.exec("VACUUM");
        
        // Execute backup API of better-sqlite3
        this.db.backup(backupFile)
          .then(() => {
            this.logEvent("INFO", `Successfully backed up database to ${backupFile}`);
            resolve(backupFile);
          })
          .catch((err) => {
            this.logEvent("ERROR", `Failed to backup database: ${err.message}`);
            reject(err);
          });
      } catch (err: any) {
        this.logEvent("ERROR", `Backup execution crash: ${err.message}`);
        reject(err);
      }
    });
  }

  public pruneData(retentionDays: number): number {
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    
    // We execute pruning inside a single transaction to maintain integrity
    const transaction = this.db.transaction(() => {
      // 1. Delete old option snaps (will cascade delete related oi_activity entries)
      const delOptionSnaps = this.db.prepare(`
        DELETE FROM option_chain_snapshots WHERE timestamp < ?
      `).run(cutoffTime);

      // 2. Delete old quote snaps
      const delQuotes = this.db.prepare(`
        DELETE FROM market_snapshots WHERE timestamp < ?
      `).run(cutoffTime);

      // 3. Delete old breadth snaps
      const delBreadth = this.db.prepare(`
        DELETE FROM market_breadth WHERE timestamp < ?
      `).run(cutoffTime);

      // 4. Delete old sector snaps
      const delSectors = this.db.prepare(`
        DELETE FROM sector_strength WHERE timestamp < ?
      `).run(cutoffTime);

      // 5. Delete old signals
      const delSignals = this.db.prepare(`
        DELETE FROM trade_signals WHERE timestamp < ?
      `).run(cutoffTime);

      return delOptionSnaps.changes + delQuotes.changes + delBreadth.changes + delSectors.changes + delSignals.changes;
    });

    const deletedCount = transaction();
    if (deletedCount > 0) {
      this.logEvent("INFO", `Database pruning complete. Deleted ${deletedCount} expired snapshots older than ${retentionDays} days.`);
      this.db.exec("VACUUM");
    }
    return deletedCount;
  }
}

// Export a singleton adapter instance
export const dbService: MarketDatabase = new SQLiteDatabaseService();
