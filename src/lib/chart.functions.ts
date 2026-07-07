import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ─── Candle (OHLCV) feed for Chart Lab ────────────────────────────────────────
// Real data via Yahoo's chart endpoint (no auth, covers indices + NSE F&O + cash).
// Returns UNIX seconds already shifted to IST wall-clock so Lightweight Charts'
// (UTC-based) axis reads as IST. Real data only — empty array on no data.

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type CandleResponse = {
  symbol: string;
  tf: string;
  candles: Candle[];
  meta?: { currency?: string; exchange?: string; prevClose?: number };
};

const TF_MAP: Record<string, { interval: string; range: string }> = {
  "1m": { interval: "1m", range: "1d" },
  "2m": { interval: "2m", range: "1d" },
  "3m": { interval: "2m", range: "2d" },
  "5m": { interval: "5m", range: "5d" },
  "15m": { interval: "15m", range: "1mo" },
  "30m": { interval: "30m", range: "1mo" },
  "1h": { interval: "60m", range: "3mo" },
  "1D": { interval: "1d", range: "1y" },
  "1W": { interval: "1wk", range: "5y" },
};

const IST_OFFSET = 19800; // 5h30m in seconds

const YH = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
};

export const getCandles = createServerFn({ method: "GET" })
  .validator(z.object({ symbol: z.string().min(1), tf: z.string().default("5m") }))
  .handler(async ({ data }): Promise<CandleResponse> => {
    const tf = TF_MAP[data.tf] ?? TF_MAP["5m"];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(data.symbol)}?interval=${tf.interval}&range=${tf.range}&includePrePost=false`;

    // Never throw — return empty candles on any failure so the chart page never
    // errors/blanks. Try primary host, then fallback host.
    let json: any = null;
    try {
      const res = await fetch(url, { headers: YH });
      if (res.ok) json = await res.json();
    } catch {
      /* noop */
    }
    if (!json) {
      try {
        const res2 = await fetch(url.replace("query1", "query2"), { headers: YH });
        if (res2.ok) json = await res2.json();
      } catch {
        /* noop */
      }
    }
    if (!json) return { symbol: data.symbol, tf: data.tf, candles: [] };

    const r = json?.chart?.result?.[0];
    const ts: number[] | undefined = r?.timestamp;
    const q = r?.indicators?.quote?.[0];
    if (!ts || !q) return { symbol: data.symbol, tf: data.tf, candles: [] };

    const candles: Candle[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
      if (o == null || h == null || l == null || c == null) continue;
      candles.push({
        time: ts[i] + IST_OFFSET,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: q.volume?.[i] ?? 0,
      });
    }

    return {
      symbol: data.symbol,
      tf: data.tf,
      candles,
      meta: {
        currency: r?.meta?.currency,
        exchange: r?.meta?.exchangeName,
        prevClose: r?.meta?.previousClose ?? r?.meta?.chartPreviousClose,
      },
    };
  });

// ─── CE / PE volume time-series from SQLite ───────────────────────────────────
// Reads intraday option_chain_snapshots (saved every ~1 min by the scheduler)
// and returns {time, ceVol, peVol} points aligned to IST wall-clock seconds.
// Only works on Node runtime. Returns [] on Cloudflare / when no DB data yet.

export type CepeVolPoint = { time: number; ceVol: number; peVol: number };

export const getCepeVolHistory = createServerFn({ method: "GET" })
  .validator(z.object({
    symbol: z.string().default("NIFTY"),
    date: z.string().optional(),
  }))
  .handler(async ({ data }): Promise<CepeVolPoint[]> => {
    let db: any;
    try {
      const mod = await import("./services/database.server");
      db = mod.dbService;
    } catch {
      return [];
    }

    const istNow = new Date(Date.now() + IST_OFFSET * 1000);
    const todayIST = istNow.toISOString().slice(0, 10);
    const date = data.date ?? todayIST;

    let rows: any[];
    try {
      rows = db.getOptionHistory(data.symbol, date, 1);
    } catch {
      return [];
    }
    if (!rows?.length) return [];

    return rows.map((r: any) => {
      const [hh, mm] = (r.trading_time as string).split(":").map(Number);
      const istEpochMs = new Date(`${r.trading_date}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00+05:30`).getTime();
      const time = Math.floor(istEpochMs / 1000) + IST_OFFSET;
      return {
        time,
        ceVol: Number(r.total_ce_vol ?? 0),
        peVol: Number(r.total_pe_vol ?? 0),
      };
    });
  });

// ─── EOD OI snapshot (for Chart Lab OI bars after market close) ───────────────
// Fallback chain:
//   1. SQLite option_chain_snapshots (latest row for today) + oi_activity (per-strike)
//   2. eod_cache persistent JSON (getEodOptionChain)
//   3. Returns null if nothing saved yet
//
// This lets Chart Lab show OI bars even after market closes — using the last
// saved snapshot. Never fetches live brokers here (caller handles live path).

export type EodOiRow = {
  strike: number;
  callOI: number; putOI: number;
  callChg: number; putChg: number;
  callVol: number; putVol: number;
};

export type EodOiSnapshot = {
  symbol: string;
  spot: number;
  expiry: string;
  updatedAt: number;       // epoch ms IST
  lastTimeStr: string;     // e.g. "15:30"
  source: "db" | "eod_cache";
  rows: EodOiRow[];
};

export const getEodOiSnapshot = createServerFn({ method: "GET" })
  .validator(z.object({
    symbol: z.string().default("NIFTY"),
    date: z.string().optional(),   // YYYY-MM-DD; defaults to today IST
  }))
  .handler(async ({ data }): Promise<EodOiSnapshot | null> => {
    const IST = IST_OFFSET;

    const istNow = new Date(Date.now() + IST * 1000);
    const todayIST = istNow.toISOString().slice(0, 10);
    const date = data.date ?? todayIST;

    // ── 1. Try SQLite DB ──────────────────────────────────────────────────────
    try {
      const { dbService } = await import("./services/database.server");
      // Get latest snapshot row for this symbol+date
      const snapRows: any[] = dbService.getOptionHistory(data.symbol, date, 1);
      if (snapRows?.length) {
        // Pick the latest snapshot
        const snap = snapRows[snapRows.length - 1];
        const snapshotId = snap.id as number;

        // Get per-strike rows from oi_activity
        const oiRows: any[] = dbService.getOiHistory(snapshotId);

        if (oiRows?.length) {
          const [hh, mm] = (snap.trading_time as string).split(":").map(Number);
          const updatedAt = new Date(
            `${snap.trading_date}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00+05:30`
          ).getTime();

          return {
            symbol: data.symbol,
            spot: Number(snap.spot_price),
            expiry: snap.expiry,
            updatedAt,
            lastTimeStr: snap.trading_time,
            source: "db",
            rows: oiRows.map((r: any) => ({
              strike: Number(r.strike),
              callOI: Number(r.ce_oi ?? 0),
              putOI: Number(r.pe_oi ?? 0),
              callChg: Number(r.ce_oi_chg ?? 0),
              putChg: Number(r.pe_oi_chg ?? 0),
              callVol: Number(r.ce_vol ?? 0),
              putVol: Number(r.pe_vol ?? 0),
            })),
          };
        }
      }
    } catch {
      /* DB not available on Cloudflare — fall through */
    }

    // ── 2. Try eod_cache JSON ─────────────────────────────────────────────────
    try {
      const { getEodOptionChain } = await import("./services/persistentCache");
      const cached = await getEodOptionChain(data.symbol);
      if (cached?.rows?.length) {
        return {
          symbol: data.symbol,
          spot: cached.spot ?? 0,
          expiry: cached.expiry ?? "",
          updatedAt: cached.updatedAt ?? Date.now(),
          lastTimeStr: new Date((cached.updatedAt ?? Date.now()) + IST * 1000)
            .toISOString()
            .slice(11, 16),
          source: "eod_cache",
          rows: cached.rows.map((r: any) => ({
            strike: r.strike,
            callOI: r.ce?.oi ?? 0,
            putOI: r.pe?.oi ?? 0,
            callChg: r.ce?.oiChg ?? 0,
            putChg: r.pe?.oiChg ?? 0,
            callVol: r.ce?.volume ?? 0,
            putVol: r.pe?.volume ?? 0,
          })),
        };
      }
    } catch {
      /* noop */
    }

    return null;
  });
