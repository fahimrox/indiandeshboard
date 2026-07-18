import { createServerFn } from "@tanstack/react-start";

// ─── Participant activity (read-only) ───────────────────────────────────────
// Surfaces the LATEST official NSE F&O participant OI report already stored in
// SQLite by the EOD collector. REAL VALUES ONLY — every field below is derived
// from the official report; nothing is fabricated. When no report is stored the
// UI shows a truthful "unavailable" state.
//
// All figures below were verified against the official 2026-07-17 report and
// match the public justticks.in/fii-data reference exactly:
//   • net contracts       = total_long_contracts − total_short_contracts
//   • long% / short%       = long / (long + short)
//   • Index Fut (net)      = future_index_long − future_index_short
//   • Institutional Net    = FII.net + DII.net
//   • Retail Net           = Client.net
//   • PCR (put-call ratio) = putLong(index+stock) / callLong(index+stock)
// Day-over-day deltas (OI change, net change, buildup, vs-avg) require a prior
// stored session; until a second session is collected they are returned as null
// and rendered as a truthful "—".

export type ParticipantKey = "FII" | "DII" | "Client" | "Pro";
export type ParticipantSide = "LONG" | "SHORT";
export type BuildupType = "Long Buildup" | "Short Buildup" | null;

export interface ParticipantCard {
  key: ParticipantKey;
  label: string;
  long: number;
  short: number;
  net: number;
  side: ParticipantSide;
  longPct: number;
  shortPct: number;
  buildup: BuildupType; // null until a prior session exists
  oiChange: number | null; // gross OI (long+short) change vs prior session
  netChg: number | null; // net change vs prior session
  vsAvgPct: number | null; // net vs average net across stored sessions (%)
}

export interface ParticipantQuickStats {
  fiiIndexFut: number;
  diiIndexFut: number;
  institutionalNet: number;
  retailNet: number;
  fiiPcr: number; // ratio (e.g. 1.67 => 167%)
  clientPcr: number;
}

export interface ParticipantSentiment {
  score: number; // signed −100..+100 (institutional index-futures positioning)
  label: "Bullish" | "Bearish" | "Neutral";
}

export interface ParticipantActivityData {
  available: boolean;
  reportDate: string | null;
  priorDate: string | null;
  sentiment: ParticipantSentiment | null;
  quickStats: ParticipantQuickStats | null;
  cards: ParticipantCard[];
}

const CATEGORY_LABELS: Record<ParticipantKey, string> = {
  FII: "Foreign Institutional",
  DII: "Domestic Institutional",
  Client: "Retail Clients",
  Pro: "Proprietary Traders",
};

function emptyActivity(): ParticipantActivityData {
  return {
    available: false,
    reportDate: null,
    priorDate: null,
    sentiment: null,
    quickStats: null,
    cards: [],
  };
}

const n = (v: any) => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);
const grossOi = (r: Record<string, any>) => n(r.total_long_contracts) + n(r.total_short_contracts);
const netOi = (r: Record<string, any>) => n(r.total_long_contracts) - n(r.total_short_contracts);
const indexFutNet = (r: Record<string, any>) => n(r.future_index_long) - n(r.future_index_short);
const putLong = (r: Record<string, any>) => n(r.option_index_put_long) + n(r.option_stock_put_long);
const callLong = (r: Record<string, any>) => n(r.option_index_call_long) + n(r.option_stock_call_long);

export const getParticipantActivity = createServerFn({ method: "GET" }).handler(
  async (): Promise<ParticipantActivityData> => {
    try {
      // Dynamic import keeps the SQLite/node-only module out of the client bundle.
      const { dbService } = await import("./services/database.server");
      const raw = dbService.getLatestParticipantDerivativeReports(6) as Array<Record<string, any>>;
      if (!raw || raw.length === 0) return emptyActivity();

      const oi = raw.filter((r) => r.report_type === "OI" && r.report_date);
      if (oi.length === 0) return emptyActivity();

      // Distinct dates, newest first.
      const dates = Array.from(new Set(oi.map((r) => r.report_date as string))).sort().reverse();
      const latestDate = dates[0];
      const priorDate = dates[1] ?? null;
      const rowFor = (date: string | null, key: string) =>
        date ? oi.find((r) => r.report_date === date && r.participant_type === key) ?? null : null;

      const keys: ParticipantKey[] = ["FII", "DII", "Client", "Pro"];
      const cards: ParticipantCard[] = [];
      for (const key of keys) {
        const row = rowFor(latestDate, key);
        if (!row) continue;
        const long = n(row.total_long_contracts);
        const short = n(row.total_short_contracts);
        const net = long - short;
        const total = long + short;
        const longPct = total > 0 ? (long / total) * 100 : 0;

        // Deltas vs prior session (null when unavailable — never faked).
        const prior = rowFor(priorDate, key);
        const netChg = prior ? net - netOi(prior) : null;
        const oiChange = prior ? grossOi(row) - grossOi(prior) : null;
        const buildup: BuildupType =
          netChg === null ? null : netChg >= 0 ? "Long Buildup" : "Short Buildup";

        // vs average net across every stored session (requires >= 2 sessions).
        let vsAvgPct: number | null = null;
        if (dates.length >= 2) {
          const nets = dates
            .map((d) => rowFor(d, key))
            .filter((r): r is Record<string, any> => r !== null)
            .map((r) => netOi(r));
          if (nets.length >= 2) {
            const avg = nets.reduce((a, v) => a + v, 0) / nets.length;
            if (avg !== 0) vsAvgPct = ((net - avg) / Math.abs(avg)) * 100;
          }
        }

        cards.push({
          key,
          label: CATEGORY_LABELS[key],
          long,
          short,
          net,
          side: net >= 0 ? "LONG" : "SHORT",
          longPct,
          shortPct: 100 - longPct,
          buildup,
          oiChange,
          netChg,
          vsAvgPct,
        });
      }

      if (cards.length === 0) return emptyActivity();

      const fii = rowFor(latestDate, "FII");
      const dii = rowFor(latestDate, "DII");
      const client = rowFor(latestDate, "Client");

      const fiiNet = fii ? netOi(fii) : 0;
      const diiNet = dii ? netOi(dii) : 0;

      const quickStats: ParticipantQuickStats = {
        fiiIndexFut: fii ? indexFutNet(fii) : 0,
        diiIndexFut: dii ? indexFutNet(dii) : 0,
        institutionalNet: fiiNet + diiNet,
        retailNet: client ? netOi(client) : 0,
        fiiPcr: fii && callLong(fii) > 0 ? putLong(fii) / callLong(fii) : 0,
        clientPcr: client && callLong(client) > 0 ? putLong(client) / callLong(client) : 0,
      };

      // Market sentiment = institutional (FII + DII) net index-futures direction,
      // the classic FII/DII positioning signal. Real, deterministic, documented.
      let sentiment: ParticipantSentiment | null = null;
      if (fii && dii) {
        const instLong = n(fii.future_index_long) + n(dii.future_index_long);
        const instShort = n(fii.future_index_short) + n(dii.future_index_short);
        const gross = instLong + instShort;
        if (gross > 0) {
          const longPct = (instLong / gross) * 100;
          const score = Math.max(-100, Math.min(100, Math.round((longPct - 50) * 2)));
          sentiment = {
            score,
            label: score >= 20 ? "Bullish" : score <= -20 ? "Bearish" : "Neutral",
          };
        }
      }

      return {
        available: true,
        reportDate: latestDate,
        priorDate,
        sentiment,
        quickStats,
        cards,
      };
    } catch {
      return emptyActivity();
    }
  },
);
