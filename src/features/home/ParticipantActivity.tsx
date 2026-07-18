import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { participantActivityQuery } from "@/lib/dashboard-query";
import type {
  ParticipantCard,
  ParticipantKey,
  ParticipantQuickStats,
  ParticipantSentiment,
} from "@/lib/participant.functions";

/**
 * Participant Activity — FII / DII / Client / Pro (NSE F&O participant report).
 *
 * Layout mirrors the justticks.in/fii-data reference (Market Sentiment gauge +
 * Quick Stats + four participant cards), styled to the app's dark theme. Every
 * number is REAL, derived from the latest official OI report stored in SQLite by
 * the EOD collector — verified to match the reference for 2026-07-17. Nothing is
 * fabricated. Day-over-day fields (buildup / OI change / net change / vs avg)
 * require a prior stored session and render as a truthful "—" until one exists.
 */

// ── formatters ──────────────────────────────────────────────────────────────
/** Compact Indian notation, sign preserved (e.g. -2.17 L, 59.2 K, 6.50 L). */
function fmtLakh(v: number | null): string {
  if (v === null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)} K`;
  return String(Math.round(v));
}
/** Same as fmtLakh but always shows an explicit + for positives. */
function fmtSigned(v: number | null): string {
  if (v === null || !isFinite(v)) return "—";
  return (v >= 0 ? "+" : "") + fmtLakh(v);
}
function fmtPct(v: number | null): string {
  if (v === null || !isFinite(v)) return "—";
  return (v >= 0 ? "+" : "") + Math.round(v) + "%";
}
function signColor(v: number | null): string {
  if (v === null || !isFinite(v) || v === 0) return "text-muted-foreground";
  return v > 0 ? "text-[var(--bull)]" : "text-[var(--bear)]";
}

// Per-participant top-border accent (echoes the reference's multi-colour cards).
const ACCENT: Record<ParticipantKey, string> = {
  FII: "border-t-sky-500",
  DII: "border-t-emerald-500",
  Client: "border-t-amber-500",
  Pro: "border-t-violet-500",
};

// ── Market Sentiment gauge (institutional index-futures positioning) ────────
function SentimentBar({ sentiment }: { sentiment: ParticipantSentiment | null }) {
  const score = sentiment?.score ?? null;
  const label = sentiment?.label ?? "—";
  // score −100..+100 → marker position 0..100%.
  const pos = score === null ? 50 : (score + 100) / 2;
  const labelColor =
    label === "Bullish"
      ? "text-[var(--bull)]"
      : label === "Bearish"
        ? "text-[var(--bear)]"
        : "text-muted-foreground";

  return (
    <div className="rounded-xl border border-border bg-background/40 p-4">
      <div className="flex items-center justify-between">
        <h4
          className="text-xs uppercase tracking-widest text-muted-foreground"
          title="Derived from latest official NSE participant OI report."
        >
          Institutional Index-Fut Bias
        </h4>
        <span
          className={`rounded-md border border-border bg-background/60 px-2 py-0.5 text-[10px] font-semibold ${labelColor}`}
        >
          {label}
        </span>
      </div>
      <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
        Derived from latest official NSE participant OI report.
      </p>

      <div className="relative mt-4 h-2 rounded-full bg-gradient-to-r from-[var(--bear)] via-[var(--muted-foreground)] to-[var(--bull)]">
        {score !== null && (
          <div
            className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow"
            style={{ left: `${pos}%` }}
            aria-hidden
          />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>Bearish</span>
        <span>Neutral</span>
        <span>Bullish</span>
      </div>

      <div className="mt-3 text-center">
        <span className={`font-mono text-3xl font-bold ${labelColor}`}>
          {score === null ? "—" : (score >= 0 ? "+" : "") + score}
        </span>
        <span className="ml-1 text-xs text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

// ── Quick Stats strip ───────────────────────────────────────────────────────
function StatItem({
  label,
  value,
  tone,
  highlight,
}: {
  label: string;
  value: string;
  tone: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg px-3 py-2 ${
        highlight ? "border border-amber-500/60 bg-amber-500/5" : ""
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-sm font-bold ${tone}`}>{value}</div>
    </div>
  );
}

function QuickStats({ q }: { q: ParticipantQuickStats }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-4 lg:col-span-2">
      <h4 className="text-xs uppercase tracking-widest text-muted-foreground">Quick Stats</h4>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatItem label="FII Index Fut" value={fmtLakh(q.fiiIndexFut)} tone={signColor(q.fiiIndexFut)} highlight />
        <StatItem label="DII Index Fut" value={fmtLakh(q.diiIndexFut)} tone={signColor(q.diiIndexFut)} />
        <StatItem label="Institutional Net" value={fmtLakh(q.institutionalNet)} tone={signColor(q.institutionalNet)} />
        <StatItem label="Retail Net" value={fmtLakh(q.retailNet)} tone={signColor(q.retailNet)} />
        <StatItem label="FII PCR" value={`${Math.round(q.fiiPcr * 100)}%`} tone="text-foreground" />
        <StatItem label="Client PCR" value={`${Math.round(q.clientPcr * 100)}%`} tone="text-foreground" />
      </div>
    </div>
  );
}

// ── Participant card ────────────────────────────────────────────────────────
function ParticipantCardView({ c }: { c: ParticipantCard }) {
  const long = c.side === "LONG";
  const sideTone = long ? "text-[var(--bull)]" : "text-[var(--bear)]";
  const sideBg = long
    ? "bg-[var(--bull)]/15 text-[var(--bull)]"
    : "bg-[var(--bear)]/15 text-[var(--bear)]";

  return (
    <div className={`rounded-xl border border-t-2 border-border ${ACCENT[c.key]} bg-background/40 p-4`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground/80">{c.label}</span>
        {c.buildup && (
          <span
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
              c.buildup === "Long Buildup"
                ? "bg-[var(--bull)]/15 text-[var(--bull)]"
                : "bg-[var(--bear)]/15 text-[var(--bear)]"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {c.buildup}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className={`font-mono text-2xl font-bold ${sideTone}`}>{fmtLakh(c.net)}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${sideBg}`}>{c.side}</span>
      </div>

      <div className="mt-3">
        <div className="flex justify-between text-[11px]">
          <span className="text-muted-foreground">Long {Math.round(c.longPct)}%</span>
          <span className="text-[var(--bear)]">Short {Math.round(c.shortPct)}%</span>
        </div>
        <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-background/60">
          <div className="bg-[var(--bull)]" style={{ width: `${c.longPct}%` }} />
          <div className="bg-[var(--bear)]" style={{ width: `${c.shortPct}%` }} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          { label: "OI Change", value: fmtSigned(c.oiChange), tone: signColor(c.oiChange) },
          { label: "Net Chg", value: fmtSigned(c.netChg), tone: signColor(c.netChg) },
          { label: "vs Avg", value: fmtPct(c.vsAvgPct), tone: signColor(c.vsAvgPct) },
        ].map((s) => (
          <div key={s.label} className="rounded-lg bg-background/60 p-2 text-center">
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
            <div className={`mt-0.5 font-mono text-xs font-semibold ${s.tone}`}>{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ParticipantActivity() {
  const { data, isPending } = useQuery({
    ...participantActivityQuery,
    placeholderData: keepPreviousData,
  });

  const available = data?.available ?? false;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Participant Activity</h3>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {available && data?.reportDate
            ? `Latest official session · ${data.reportDate}`
            : isPending
              ? "Loading…"
              : "No official session available"}
        </span>
      </div>

      {available && data ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <SentimentBar sentiment={data.sentiment} />
            {data.quickStats && <QuickStats q={data.quickStats} />}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.cards.map((c) => (
              <ParticipantCardView key={c.key} c={c} />
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-background/30 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Participant activity data is not currently available from the configured sources.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Official NSE F&amp;O participant reports are collected after market close.
          </p>
        </div>
      )}
    </div>
  );
}
