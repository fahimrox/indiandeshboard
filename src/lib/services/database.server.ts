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


export interface DBParticipantDerivativeRow {
  participantType: "Client" | "DII" | "FII" | "Pro" | "TOTAL";
  futureIndexLong: number;
  futureIndexShort: number;
  futureStockLong: number;
  futureStockShort: number;
  optionIndexCallLong: number;
  optionIndexPutLong: number;
  optionIndexCallShort: number;
  optionIndexPutShort: number;
  optionStockCallLong: number;
  optionStockPutLong: number;
  optionStockCallShort: number;
  optionStockPutShort: number;
  totalLongContracts: number;
  totalShortContracts: number;
}
export interface MarketDatabase {
  init(): void;
  saveSnapshots(quotes: DBQuote[], timestamp: number, dateStr: string, timeStr: string): void;
  saveOptionChain(chain: DBOptionChain, timestamp: number, dateStr: string, timeStr: string): void;
  saveBreadth(breadth: DBBreadth, timestamp: number, dateStr: string, timeStr: string): void;
  saveSectors(sectors: DBSector[], timestamp: number, dateStr: string, timeStr: string): void;
  saveSignals(signals: DBSignal[], timestamp: number, dateStr: string, timeStr: string): void;
  saveParticipantDerivatives(
    reportType: "OI" | "VOLUME",
    reportDate: string,
    rows: DBParticipantDerivativeRow[]
  ): void;
  getLatestParticipantDerivativeReports(limitDates?: number): any[];
  logEvent(level: "INFO" | "WARN" | "ERROR", message: string, details?: string): void;
  
  getAvailableDates(): string[];
  getMarketHistory(symbol: string, date: string, intervalMinutes: number): any[];
  getMarketHistoryRangeRaw(symbol: string, startDate: string, endDate: string): SQLiteMarketSnapshotRow[];
  getCandles(symbol: string, date: string, intervalMinutes: number): any[];
  getOptionHistory(symbol: string, date: string, intervalMinutes: number): any[];
  getOptionHistoryRangeRaw(symbol: string, startDate: string, endDate: string): any[];
  getOiHistory(snapshotId: number): any[];
  getOiActivityHistoryRangeRaw(
    symbol: string,
    startDate: string,
    endDate: string,
    expiry?: string
  ): any[];
  getBreadthHistory(date: string, intervalMinutes: number): any[];
  getBreadthHistoryRangeRaw(startDate: string, endDate: string): any[];
  getSectorStrengthHistoryRangeRaw(
    startDate: string,
    endDate: string,
    symbol?: string
  ): any[];
  
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
      CREATE TABLE IF NOT EXISTS participant_derivatives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_date TEXT NOT NULL,
        report_type TEXT NOT NULL CHECK(report_type IN ('OI', 'VOLUME')),
        participant_type TEXT NOT NULL,
        future_index_long INTEGER NOT NULL,
        future_index_short INTEGER NOT NULL,
        future_stock_long INTEGER NOT NULL,
        future_stock_short INTEGER NOT NULL,
        option_index_call_long INTEGER NOT NULL,
        option_index_put_long INTEGER NOT NULL,
        option_index_call_short INTEGER NOT NULL,
        option_index_put_short INTEGER NOT NULL,
        option_stock_call_long INTEGER NOT NULL,
        option_stock_put_long INTEGER NOT NULL,
        option_stock_call_short INTEGER NOT NULL,
        option_stock_put_short INTEGER NOT NULL,
        total_long_contracts INTEGER NOT NULL,
        total_short_contracts INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'NSE',
        collected_at INTEGER NOT NULL,
        UNIQUE(report_date, report_type, participant_type)
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
      CREATE INDEX IF NOT EXISTS idx_participant_derivatives_date
        ON participant_derivatives(report_date DESC, report_type, participant_type);
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

  public saveParticipantDerivatives(
    reportType: "OI" | "VOLUME",
    reportDate: string,
    rows: DBParticipantDerivativeRow[]
  ) {
    const insert = this.db.prepare(`
      INSERT INTO participant_derivatives (
        report_date,
        report_type,
        participant_type,
        future_index_long,
        future_index_short,
        future_stock_long,
        future_stock_short,
        option_index_call_long,
        option_index_put_long,
        option_index_call_short,
        option_index_put_short,
        option_stock_call_long,
        option_stock_put_long,
        option_stock_call_short,
        option_stock_put_short,
        total_long_contracts,
        total_short_contracts,
        source,
        collected_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NSE', ?
      )
      ON CONFLICT(report_date, report_type, participant_type) DO UPDATE SET
        future_index_long = excluded.future_index_long,
        future_index_short = excluded.future_index_short,
        future_stock_long = excluded.future_stock_long,
        future_stock_short = excluded.future_stock_short,
        option_index_call_long = excluded.option_index_call_long,
        option_index_put_long = excluded.option_index_put_long,
        option_index_call_short = excluded.option_index_call_short,
        option_index_put_short = excluded.option_index_put_short,
        option_stock_call_long = excluded.option_stock_call_long,
        option_stock_put_long = excluded.option_stock_put_long,
        option_stock_call_short = excluded.option_stock_call_short,
        option_stock_put_short = excluded.option_stock_put_short,
        total_long_contracts = excluded.total_long_contracts,
        total_short_contracts = excluded.total_short_contracts,
        source = excluded.source,
        collected_at = excluded.collected_at
    `);

    const collectedAt = Date.now();

    const transaction = this.db.transaction(
      (items: DBParticipantDerivativeRow[]) => {
        for (const row of items) {
          insert.run(
            reportDate,
            reportType,
            row.participantType,
            row.futureIndexLong,
            row.futureIndexShort,
            row.futureStockLong,
            row.futureStockShort,
            row.optionIndexCallLong,
            row.optionIndexPutLong,
            row.optionIndexCallShort,
            row.optionIndexPutShort,
            row.optionStockCallLong,
            row.optionStockPutLong,
            row.optionStockCallShort,
            row.optionStockPutShort,
            row.totalLongContracts,
            row.totalShortContracts,
            collectedAt
          );
        }
      }
    );

    transaction(rows);
  }

  public getLatestParticipantDerivativeReports(limitDates = 2): any[] {
    const safeLimit = Math.max(1, Math.min(30, Math.trunc(limitDates)));

    const query = this.db.prepare(`
      SELECT *
      FROM participant_derivatives
      WHERE report_date IN (
        SELECT DISTINCT report_date
        FROM participant_derivatives
        ORDER BY report_date DESC
        LIMIT ?
      )
      ORDER BY
        report_date DESC,
        CASE report_type
          WHEN 'OI' THEN 1
          WHEN 'VOLUME' THEN 2
          ELSE 3
        END,
        CASE participant_type
          WHEN 'FII' THEN 1
          WHEN 'DII' THEN 2
          WHEN 'Client' THEN 3
          WHEN 'Pro' THEN 4
          WHEN 'TOTAL' THEN 5
          ELSE 6
        END
    `);

    return query.all(safeLimit);
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

  public getOptionHistoryRangeRaw(
    symbol: string,
    startDate: string,
    endDate: string
  ): any[] {
    const query = this.db.prepare(`
      SELECT *
      FROM option_chain_snapshots
      WHERE symbol = ?
        AND trading_date BETWEEN ? AND ?
      ORDER BY
        trading_date ASC,
        trading_time ASC,
        expiry ASC,
        id ASC
    `);

    return query.all(symbol, startDate, endDate);
  }

  public getOiHistory(snapshotId: number): any[] {
    const query = this.db.prepare(`
      SELECT * FROM oi_activity WHERE snapshot_id = ? ORDER BY strike ASC
    `);
    return query.all(snapshotId);
  }

  public getOiActivityHistoryRangeRaw(
    symbol: string,
    startDate: string,
    endDate: string,
    expiry?: string
  ): any[] {
    const expiryFilter = expiry?.trim();

    if (expiryFilter) {
      const query = this.db.prepare(`
        SELECT
          oi.id,
          oi.snapshot_id,
          snapshots.timestamp,
          snapshots.trading_date,
          snapshots.trading_time,
          snapshots.symbol,
          snapshots.expiry,
          oi.strike,
          oi.ce_ltp,
          oi.ce_oi,
          oi.ce_oi_chg,
          oi.ce_vol,
          oi.ce_signal,
          oi.pe_ltp,
          oi.pe_oi,
          oi.pe_oi_chg,
          oi.pe_vol,
          oi.pe_signal
        FROM oi_activity AS oi
        INNER JOIN option_chain_snapshots AS snapshots
          ON snapshots.id = oi.snapshot_id
        WHERE snapshots.symbol = ?
          AND snapshots.trading_date BETWEEN ? AND ?
          AND snapshots.expiry = ?
        ORDER BY
          snapshots.trading_date ASC,
          snapshots.trading_time ASC,
          snapshots.expiry ASC,
          oi.strike ASC,
          oi.id ASC
      `);

      return query.all(symbol, startDate, endDate, expiryFilter);
    }

    const query = this.db.prepare(`
      SELECT
        oi.id,
        oi.snapshot_id,
        snapshots.timestamp,
        snapshots.trading_date,
        snapshots.trading_time,
        snapshots.symbol,
        snapshots.expiry,
        oi.strike,
        oi.ce_ltp,
        oi.ce_oi,
        oi.ce_oi_chg,
        oi.ce_vol,
        oi.ce_signal,
        oi.pe_ltp,
        oi.pe_oi,
        oi.pe_oi_chg,
        oi.pe_vol,
        oi.pe_signal
      FROM oi_activity AS oi
      INNER JOIN option_chain_snapshots AS snapshots
        ON snapshots.id = oi.snapshot_id
      WHERE snapshots.symbol = ?
        AND snapshots.trading_date BETWEEN ? AND ?
      ORDER BY
        snapshots.trading_date ASC,
        snapshots.trading_time ASC,
        snapshots.expiry ASC,
        oi.strike ASC,
        oi.id ASC
    `);

    return query.all(symbol, startDate, endDate);
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

  public getBreadthHistoryRangeRaw(
    startDate: string,
    endDate: string
  ): any[] {
    const query = this.db.prepare(`
      SELECT *
      FROM market_breadth
      WHERE trading_date BETWEEN ? AND ?
      ORDER BY
        trading_date ASC,
        trading_time ASC,
        id ASC
    `);

    return query.all(startDate, endDate);
  }

  public getSectorStrengthHistoryRangeRaw(
    startDate: string,
    endDate: string,
    symbol?: string
  ): any[] {
    const normalizedSymbol = symbol?.trim().toUpperCase();

    if (normalizedSymbol) {
      const query = this.db.prepare(`
        SELECT *
        FROM sector_strength
        WHERE trading_date BETWEEN ? AND ?
          AND symbol = ?
        ORDER BY
          trading_date ASC,
          trading_time ASC,
          symbol ASC,
          id ASC
      `);

      return query.all(startDate, endDate, normalizedSymbol);
    }

    const query = this.db.prepare(`
      SELECT *
      FROM sector_strength
      WHERE trading_date BETWEEN ? AND ?
      ORDER BY
        trading_date ASC,
        trading_time ASC,
        symbol ASC,
        id ASC
    `);

    return query.all(startDate, endDate);
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
