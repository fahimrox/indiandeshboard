import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { constituentsQuery } from "@/lib/dashboard-query";
import { marketHistoryQuery, breadthHistoryQuery } from "@/lib/history-query";
import type { MarketHistoryRow, MarketBreadthHistoryRow } from "@/lib/history-types";
import { getIstDate } from "@/lib/market-hours";

/**
 * ─── Fear & Greed calculation ──────────────────────────────────────────────
 *
 * Deterministic, real-data-only 0–100 score built from four independently
 * optional inputs. Each input is scored 0–100 on its own scale, then combined
 * with fixed weights. If an input is missing, it is dropped and the
 * remaining weights are renormalized proportionally — a missing input is
 * NEVER replaced with a bullish/bearish guess (e.g. 50). If too few real
 * inputs are available, the function returns `score: null` ("Unavailable").
 *
 * Weights (of the full 100%, when all four inputs are present):
 *   - Breadth contribution      35%  — advances / (advances + declines),
 *                                       averaged across whichever of
 *                                       NIFTY / BANK NIFTY / SENSEX resolved.
 *   - Momentum contribution     30%  — index % change, averaged across
 *                                       whichever of NIFTY / BANK NIFTY /
 *                                       SENSEX resolved, clamped to ±1.5%
 *                                       and mapped linearly to 0–100.
 *   - Sector participation      20%  — % of tracked sector indices that are
 *                                       positive on the day.
 *   - VIX risk adjustment       15%  — India VIX level, clamped to [10, 30]
 *                                       and inverted (low VIX = greed, high
 *                                       VIX = fear).
 *
 * Minimum data requirement: at least one of {breadth, momentum} must be
 * available (they are the primary directional signals) AND at least two of
 * the four dimensions overall must be available. Otherwise the score is
 * `null` and the UI must show an "Unavailable" state.
 */

const WEIGHTS = { breadth: 0.35, momentum: 0.3, sector: 0.2, vix: 0.15 } as const;

export type FearGreedBreadthInput = { advance: number; decline: number } | null | undefined;
export type FearGreedIndexInput = { changePct: number } | null | undefined;
export type FearGreedSectorInput = { changePct: number };

export interface FearGreedInput {
  niftyBreadth?: FearGreedBreadthInput;
  bankNiftyBreadth?: FearGreedBreadthInput;
  sensexBreadth?: FearGreedBreadthInput;
  niftyChange?: FearGreedIndexInput;
  bankNiftyChange?: FearGreedIndexInput;
  sensexChange?: FearGreedIndexInput;
  sectors?: FearGreedSectorInput[];
  vix?: { price: number } | null;
}

export type FearGreedLabel = "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed";

export interface FearGreedResult {
  score: number | null;
  label: FearGreedLabel | "Unavailable";
  components: {
    breadth: number | null;
    momentum: number | null;
    sector: number | null;
    vix: number | null;
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function labelFor(score: number): FearGreedLabel {
  if (score < 20) return "Extreme Fear";
  if (score < 40) return "Fear";
  if (score < 60) return "Neutral";
  if (score < 80) return "Greed";
  return "Extreme Greed";
}

/** Pure, deterministic Fear & Greed calculation. Real inputs only. */
export function computeFearGreed(input: FearGreedInput): FearGreedResult {
  // Breadth: average advance/(advance+decline)*100 across resolved indices.
  const breadthSamples: number[] = [];
  for (const b of [input.niftyBreadth, input.bankNiftyBreadth, input.sensexBreadth]) {
    if (!b) continue;
    const total = b.advance + b.decline;
    if (total <= 0) continue;
    breadthSamples.push((b.advance / total) * 100);
  }
  const breadth =
    breadthSamples.length > 0
      ? breadthSamples.reduce((a, v) => a + v, 0) / breadthSamples.length
      : null;

  // Momentum: average index %change across resolved indices, clamped to
  // ±1.5% and mapped linearly onto 0–100.
  const momentumSamples: number[] = [];
  for (const q of [input.niftyChange, input.bankNiftyChange, input.sensexChange]) {
    if (!q || typeof q.changePct !== "number" || !isFinite(q.changePct)) continue;
    const clamped = clamp(q.changePct, -1.5, 1.5);
    momentumSamples.push(((clamped + 1.5) / 3) * 100);
  }
  const momentum =
    momentumSamples.length > 0
      ? momentumSamples.reduce((a, v) => a + v, 0) / momentumSamples.length
      : null;

  // Sector participation: % of tracked sector indices positive on the day.
  const validSectors = (input.sectors ?? []).filter(
    (s) => typeof s.changePct === "number" && isFinite(s.changePct),
  );
  const sector =
    validSectors.length > 0
      ? (validSectors.filter((s) => s.changePct > 0).length / validSectors.length) * 100
      : null;

  // VIX risk adjustment: clamp [10,30], invert (low vol = greed).
  const vixLevel = input.vix?.price;
  const vix =
    typeof vixLevel === "number" && isFinite(vixLevel) && vixLevel > 0
      ? ((30 - clamp(vixLevel, 10, 30)) / 20) * 100
      : null;

  const components = { breadth, momentum, sector, vix };

  const available = (["breadth", "momentum", "sector", "vix"] as const).filter(
    (k) => components[k] !== null,
  );
  const hasCoreSignal = breadth !== null || momentum !== null;

  if (!hasCoreSignal || available.length < 2) {
    return { score: null, label: "Unavailable", components };
  }

  const totalWeight = available.reduce((sum, k) => sum + WEIGHTS[k], 0);
  const weightedSum = available.reduce(
    (sum, k) => sum + (components[k] as number) * WEIGHTS[k],
    0,
  );
  const score = clamp(Math.round(weightedSum / totalWeight), 0, 100);

  return { score, label: labelFor(score), components };
}

// ─── Gauge geometry ─────────────────────────────────────────────────────────

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

function scoreToAngle(score: number) {
  // score 0 -> 180deg (left), score 100 -> 0deg (right), sweeping over the top.
  return 180 * (1 - score / 100);
}

function arcPath(cx: number, cy: number, r: number, startScore: number, endScore: number) {
  const a1 = scoreToAngle(startScore);
  const a2 = scoreToAngle(endScore);
  const p1 = polarToCartesian(cx, cy, r, a1);
  const p2 = polarToCartesian(cx, cy, r, a2);
  return `M ${p1.x} ${p1.y} A ${r} ${r} 0 0 1 ${p2.x} ${p2.y}`;
}

const SEGMENTS: { from: number; to: number; color: string; label: string }[] = [
  { from: 0, to: 20, color: "var(--bear)", label: "Extreme Fear" },
  { from: 20, to: 40, color: "color-mix(in oklab, var(--bear) 55%, var(--muted-foreground))", label: "Fear" },
  { from: 40, to: 60, color: "var(--muted-foreground)", label: "Neutral" },
  { from: 60, to: 80, color: "color-mix(in oklab, var(--bull) 55%, var(--muted-foreground))", label: "Greed" },
  { from: 80, to: 100, color: "var(--bull)", label: "Extreme Greed" },
];

const CX = 100;
const CY = 92;
const R = 78;

function GaugeSvg({ score }: { score: number | null }) {
  const needleAngle = score === null ? 90 : scoreToAngle(score);
  const needleTip = polarToCartesian(CX, CY, R - 14, needleAngle);
  return (
    <svg viewBox="0 0 200 108" className="w-full" role="img" aria-label="Fear and greed gauge">
      {SEGMENTS.map((seg) => (
        <path
          key={seg.label}
          d={arcPath(CX, CY, R, seg.from, seg.to)}
          fill="none"
          stroke={seg.color}
          strokeWidth={14}
          strokeLinecap="butt"
        />
      ))}
      {score !== null && (
        <>
          <line
            x1={CX}
            y1={CY}
            x2={needleTip.x}
            y2={needleTip.y}
            stroke="var(--foreground)"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <circle cx={CX} cy={CY} r={5} fill="var(--foreground)" />
        </>
      )}
    </svg>
  );
}

// ─── Timeframe selector ───────────────────────────────────────────────────
// "Day" is the live daily read (constituent breadth + live index change +
// sectors + India VIX). 5m / 15m / 1h are computed from REAL stored intraday
// history (market + breadth snapshots) for the latest available trading
// session — never fabricated. If there is no recent session data, the intraday
// score shows a truthful "Unavailable" state.

type Timeframe = "5m" | "15m" | "1h" | "day";
const TIMEFRAMES: { key: Timeframe; label: string }[] = [
  { key: "5m", label: "5m" },
  { key: "15m", label: "15m" },
  { key: "1h", label: "1h" },
  { key: "day", label: "Day" },
];
const INTRADAY_MINUTES: Record<Exclude<Timeframe, "day">, number> = {
  "5m": 5,
  "15m": 15,
  "1h": 60,
};

// ── Intraday helpers (pure, real-data-only) ─────────────────────────────────

/** Parse "HH:MM[:SS]" into fractional minutes-of-day. Unit-independent — avoids
 *  relying on the raw epoch timestamp column (ms vs s ambiguity). */
function timeToMinutes(t: string | undefined | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0);
}

/** Latest (max) trading_date across the provided date strings (YYYY-MM-DD). */
function latestTradingDate(dates: string[]): string | null {
  let latest: string | null = null;
  for (const d of dates) if (d && (latest === null || d > latest)) latest = d;
  return latest;
}

/** Rows for one symbol on `date`, sorted ascending by intraday time. */
function sessionRows(rows: MarketHistoryRow[], date: string): MarketHistoryRow[] {
  return rows
    .filter((r) => r.trading_date === date)
    .slice()
    .sort((a, b) => (timeToMinutes(a.trading_time) ?? 0) - (timeToMinutes(b.trading_time) ?? 0));
}

function ltpOf(r: MarketHistoryRow): number {
  return r.ltp && isFinite(r.ltp) && r.ltp > 0 ? r.ltp : r.close;
}

/** % change from the baseline row (at or before latest_time - `minutes`) to the
 *  latest row. Returns null if the session is too short to have a baseline. */
function intradayMomentum(rows: MarketHistoryRow[], minutes: number): number | null {
  if (rows.length < 2) return null;
  const latest = rows[rows.length - 1];
  const latestMin = timeToMinutes(latest.trading_time);
  if (latestMin === null) return null;
  const cutoff = latestMin - minutes;
  let baseline: MarketHistoryRow | null = null;
  for (const r of rows) {
    const rm = timeToMinutes(r.trading_time);
    if (rm === null) continue;
    if (rm <= cutoff) baseline = r;
    else break;
  }
  if (!baseline) return null;
  const base = ltpOf(baseline);
  const last = ltpOf(latest);
  if (!base || !isFinite(base) || base <= 0 || !isFinite(last)) return null;
  return ((last - base) / base) * 100;
}

interface IntradayBuild {
  input: FearGreedInput;
  sessionDate: string;
}

/**
 * Build a FearGreedInput from stored intraday history for the LATEST available
 * trading session. All selected rows come from ONE trading_date. Overall breadth
 * is passed exactly ONCE (as niftyBreadth) so it is never triple-counted. Sector
 * intraday history is not stored per-index here, so sectors are intentionally
 * omitted (computeFearGreed renormalizes the remaining weights).
 */
function buildIntradayInput(
  market: Record<string, MarketHistoryRow[]> | undefined,
  breadth: MarketBreadthHistoryRow[] | undefined,
  minutes: number,
): IntradayBuild | null {
  if (!market) return null;
  const niftyRows = market["NIFTY"] ?? [];
  const bankRows = market["BANKNIFTY"] ?? [];
  const sensexRows = market["SENSEX"] ?? [];
  const vixRows = market["INDIAVIX"] ?? [];

  // Latest session date from index PRICE rows (not VIX-only).
  const dates: string[] = [];
  for (const arr of [niftyRows, bankRows, sensexRows]) {
    for (const r of arr) dates.push(r.trading_date);
  }
  const date = latestTradingDate(dates);
  if (!date) return null;

  const niftyMom = intradayMomentum(sessionRows(niftyRows, date), minutes);
  const bankMom = intradayMomentum(sessionRows(bankRows, date), minutes);
  const sensexMom = intradayMomentum(sessionRows(sensexRows, date), minutes);

  // India VIX: latest value from the SAME session.
  const vixS = sessionRows(vixRows, date);
  const vixLatest = vixS.length ? ltpOf(vixS[vixS.length - 1]) : null;

  // Overall breadth: latest breadth row from the SAME session (passed ONCE).
  let breadthInput: FearGreedBreadthInput = undefined;
  if (breadth && breadth.length) {
    const bRows = breadth
      .filter((r) => r.trading_date === date)
      .slice()
      .sort((a, b) => (timeToMinutes(a.trading_time) ?? 0) - (timeToMinutes(b.trading_time) ?? 0));
    if (bRows.length) {
      const last = bRows[bRows.length - 1];
      if (last.advance + last.decline > 0) {
        breadthInput = { advance: last.advance, decline: last.decline };
      }
    }
  }

  const input: FearGreedInput = {
    niftyBreadth: breadthInput, // overall breadth, passed ONCE
    niftyChange: niftyMom !== null ? { changePct: niftyMom } : undefined,
    bankNiftyChange: bankMom !== null ? { changePct: bankMom } : undefined,
    sensexChange: sensexMom !== null ? { changePct: sensexMom } : undefined,
    vix: vixLatest !== null && vixLatest > 0 ? { price: vixLatest } : null,
    // sectors intentionally omitted — no per-session sector intraday history.
  };
  return { input, sessionDate: date };
}

/** Local YYYY-MM-DD from an IST-shifted Date (see getIstDate). */
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const UNAVAILABLE_RESULT: FearGreedResult = {
  score: null,
  label: "Unavailable",
  components: { breadth: null, momentum: null, sector: null, vix: null },
};

// ─── Component ──────────────────────────────────────────────────────────────

export function FearGreedGauge({
  nifty,
  bankNifty,
  sensex,
  vix,
  sectors,
}: {
  nifty?: FearGreedIndexInput;
  bankNifty?: FearGreedIndexInput;
  sensex?: FearGreedIndexInput;
  vix?: { price: number } | null;
  sectors?: FearGreedSectorInput[];
}) {
  const [timeframe, setTimeframe] = useState<Timeframe>("day");
  const intraday = timeframe !== "day";

  // ── Day (live) inputs — live constituent breadth + live index change etc. ──
  const niftyC = useQuery({ ...constituentsQuery("nifty"), placeholderData: keepPreviousData });
  const bankC = useQuery({ ...constituentsQuery("banknifty"), placeholderData: keepPreviousData });
  const sensexC = useQuery({ ...constituentsQuery("sensex"), placeholderData: keepPreviousData });

  const liveResult = useMemo(
    () =>
      computeFearGreed({
        niftyBreadth: niftyC.data,
        bankNiftyBreadth: bankC.data,
        sensexBreadth: sensexC.data,
        niftyChange: nifty,
        bankNiftyChange: bankNifty,
        sensexChange: sensex,
        sectors,
        vix,
      }),
    [niftyC.data, bankC.data, sensexC.data, nifty, bankNifty, sensex, sectors, vix],
  );

  // ── Intraday history — last 7 calendar days, 5-min bars. A single fetch powers
  //    all three intraday timeframes (identical query key). The latest available
  //    trading session in range is used automatically (handles weekends/holidays).
  const { startDate, endDate } = useMemo(() => {
    const today = getIstDate();
    const start = new Date(today);
    start.setDate(start.getDate() - 7);
    return { startDate: isoDate(start), endDate: isoDate(today) };
  }, []);

  const marketHist = useQuery(
    marketHistoryQuery({ startDate, endDate, interval: 5, enabled: intraday }),
  );
  const breadthHist = useQuery(
    breadthHistoryQuery({ startDate, endDate, interval: 5, enabled: intraday }),
  );

  const intradayResult = useMemo(() => {
    if (!intraday) return null;
    const minutes = INTRADAY_MINUTES[timeframe as Exclude<Timeframe, "day">];
    const built = buildIntradayInput(marketHist.data?.data, breadthHist.data?.data, minutes);
    if (!built) return { result: UNAVAILABLE_RESULT, sessionDate: null as string | null };
    return { result: computeFearGreed(built.input), sessionDate: built.sessionDate };
  }, [intraday, timeframe, marketHist.data, breadthHist.data]);

  const intradayLoading =
    intraday &&
    (marketHist.isPending || breadthHist.isPending) &&
    !(marketHist.data && breadthHist.data);
  const intradayError = intraday && (marketHist.isError || breadthHist.isError);

  const result: FearGreedResult = intraday
    ? intradayResult?.result ?? UNAVAILABLE_RESULT
    : liveResult;
  const sessionDate = intraday ? (intradayResult?.sessionDate ?? null) : null;

  const toneColor =
    result.score === null
      ? "text-muted-foreground"
      : result.score < 40
        ? "text-[var(--bear)]"
        : result.score > 60
          ? "text-[var(--bull)]"
          : "text-foreground";

  const badgeLabel = timeframe === "day" ? "Live" : timeframe;

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">
          Fear &amp; Greed
        </h3>
        <span className="rounded-md border border-border bg-background/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {badgeLabel}
        </span>
      </div>

      {/* Timeframe selector — Day is live; 5m/15m/1h use real intraday history. */}
      <div
        className="mt-2.5 flex items-center justify-center gap-1.5"
        role="group"
        aria-label="Fear and Greed timeframe"
      >
        {TIMEFRAMES.map((tf) => {
          const active = tf.key === timeframe;
          return (
            <button
              key={tf.key}
              type="button"
              onClick={() => setTimeframe(tf.key)}
              aria-pressed={active}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                active
                  ? "bg-[var(--neon)]/15 text-[var(--neon)] ring-1 ring-[var(--neon)]/30"
                  : "bg-background/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {tf.label}
            </button>
          );
        })}
      </div>

      <div className="mx-auto mt-2 max-w-[210px]">
        <GaugeSvg score={intradayLoading ? null : result.score} />
        <div className="mt-1 flex justify-between px-1 text-[9px] uppercase tracking-wide text-muted-foreground">
          <span className="text-[var(--bear)]">Extreme Fear</span>
          <span>Neutral</span>
          <span className="text-[var(--bull)]">Extreme Greed</span>
        </div>
      </div>

      <div className="mt-1.5 text-center" aria-live="polite">
        {intradayLoading ? (
          <>
            <div className="font-mono text-3xl font-bold leading-none text-muted-foreground">…</div>
            <div className="mt-1 text-sm font-semibold text-muted-foreground">Loading {timeframe}…</div>
          </>
        ) : intradayError ? (
          <>
            <div className="font-mono text-3xl font-bold leading-none text-muted-foreground">—</div>
            <div className="mt-1 text-sm font-semibold text-muted-foreground">Unavailable</div>
            <div className="mt-1 text-xs text-muted-foreground">Could not load intraday history.</div>
          </>
        ) : result.score !== null ? (
          <>
            <div className={`font-mono text-3xl font-bold leading-none ${toneColor}`}>{result.score}</div>
            <div className={`mt-1 text-sm font-semibold ${toneColor}`}>{result.label}</div>
            {intraday && sessionDate && (
              <div className="mt-1 text-[10px] text-muted-foreground">
                {timeframe} change · session {sessionDate}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="font-mono text-3xl font-bold leading-none text-muted-foreground">—</div>
            <div className="mt-1 text-sm font-semibold text-muted-foreground">Unavailable</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {intraday
                ? "No recent intraday session data available yet."
                : "Not enough real market data resolved yet to compute a score."}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
