import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import {
  ChangePill,
  IndexHeroCard,
  KpiCard,
  StockRow,
  fmt,
} from "@/components/MarketBits";
import { dashboardQuery } from "@/lib/dashboard-query";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "IndexMover — Live NSE & BSE Market Dashboard" },
      {
        name: "description",
        content:
          "Live NIFTY 50, BANK NIFTY and SENSEX dashboard with realtime auto-refresh, sector heatmap, AI sentiment and option chain for Indian markets.",
      },
      { property: "og:title", content: "IndexMover — Live NSE & BSE Market Dashboard" },
      {
        property: "og:description",
        content:
          "Realtime NIFTY, BANK NIFTY and SENSEX with sector heatmap, F&O buildup and option chain analytics.",
      },
      { property: "og:url", content: "https://indiandeshboard.lovable.app/" },
    ],
    links: [{ rel: "canonical", href: "https://indiandeshboard.lovable.app/" }],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQuery),
  component: IndexPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">Data load failed: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function IndexPage() {
  const { data } = useSuspenseQuery(dashboardQuery);
  const { nifty, sensex, bankNifty: bank, commentary } = data;

  const totalDirectional = Math.max(1, data.advance + data.decline);
  const bullsPct = (data.advance / totalDirectional) * 100;

  const allStocks = [...data.gainers, ...data.losers];
  const maxAbs = Math.max(0.5, ...allStocks.map((s) => Math.abs(s.changePct)));
  const sortedSectors = [...data.sectors].sort((a, b) => b.changePct - a.changePct);

  return (
    <DashboardShell
      title="Index Dashboard"
      subtitle="Live Indian market intelligence"
      updatedAt={data.updatedAt}
    >
      <div className="grid gap-5 xl:grid-cols-3">
        {nifty && <IndexHeroCard q={nifty} label="NIFTY 50" />}
        {bank && <IndexHeroCard q={bank} label="BANK NIFTY" />}
        {sensex && <IndexHeroCard q={sensex} label="SENSEX" />}
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Positive Impact" value={String(data.advance)} sub="Stocks pushing up" tone="bull" />
        <KpiCard label="Negative Impact" value={String(data.decline)} sub="Stocks dragging down" tone="bear" />
        <KpiCard label="Advance / Decline" value={`${data.advance} / ${data.decline}`} sub={`${data.unchanged} unchanged`} />
        <KpiCard
          label="Avg Change"
          value={`${data.avgChange >= 0 ? "+" : ""}${fmt(data.avgChange)}%`}
          tone={data.avgChange >= 0 ? "bull" : "bear"}
        />
      </div>

      {/* AI Sentiment + Breadth */}
      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <div className="rounded-2xl border border-[var(--neon)]/30 bg-gradient-to-br from-[var(--neon)]/10 via-card to-card p-5 xl:col-span-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--neon)]" />
            <div className="text-xs uppercase tracking-widest text-[var(--neon)]">AI Market Sentiment</div>
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <div
              className={`text-3xl font-bold ${
                commentary.tone === "Bullish"
                  ? "text-[var(--bull)]"
                  : commentary.tone === "Bearish"
                    ? "text-[var(--bear)]"
                    : ""
              }`}
            >
              {commentary.tone}
            </div>
            <ChangePill pct={data.avgChange} />
          </div>
          <ul className="mt-4 space-y-2 text-sm text-foreground/90">
            {commentary.lines.map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--neon)]" />
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Market Breadth</div>
          <div className="mt-1 text-sm font-semibold">Bulls vs Bears</div>
          <div className="mt-4 flex items-center justify-between text-xs">
            <span className="text-[var(--bull)] font-semibold">BULLS {fmt(bullsPct, 1)}%</span>
            <span className="text-[var(--bear)] font-semibold">BEARS {fmt(100 - bullsPct, 1)}%</span>
          </div>
          <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-background/60">
            <div className="bg-[var(--bull)]" style={{ width: `${bullsPct}%` }} />
            <div className="bg-[var(--bear)]" style={{ width: `${100 - bullsPct}%` }} />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-[var(--bull)]/10 p-3">
              <div className="text-xs text-muted-foreground">Advances</div>
              <div className="font-mono text-2xl font-bold text-[var(--bull)]">{data.advance}</div>
            </div>
            <div className="rounded-lg bg-[var(--bear)]/10 p-3">
              <div className="text-xs text-muted-foreground">Declines</div>
              <div className="font-mono text-2xl font-bold text-[var(--bear)]">{data.decline}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card p-5">
        <div className="mb-3 text-sm font-semibold">Top Gainers & Losers — NIFTY 50</div>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-semibold text-[var(--bull)]">▲ TOP GAINERS</div>
            {data.gainers.map((s) => <StockRow key={s.symbol} q={s} max={maxAbs} />)}
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold text-[var(--bear)]">▼ TOP LOSERS</div>
            {data.losers.map((s) => <StockRow key={s.symbol} q={s} max={maxAbs} />)}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Sector Heatmap</div>
            <div className="text-sm font-semibold">Click any sector for stock-level breakdown</div>
          </div>
          <ChangePill pct={data.avgChange} />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {sortedSectors.map((s) => {
            const up = s.changePct >= 0;
            const intensity = Math.min(1, Math.abs(s.changePct) / 2.5);
            const bg = up
              ? `color-mix(in oklab, var(--bull) ${20 + intensity * 50}%, transparent)`
              : `color-mix(in oklab, var(--bear) ${20 + intensity * 50}%, transparent)`;
            return (
              <Link
                key={s.symbol}
                to="/sector/$key"
                params={{ key: s.key }}
                className="flex flex-col justify-between rounded-xl border border-border p-4 transition hover:scale-[1.02]"
                style={{ background: bg }}
              >
                <div className="text-sm font-semibold">{s.label}</div>
                <div className={`mt-3 font-mono text-xl font-bold ${up ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                  {up ? "+" : ""}{fmt(s.changePct)}%
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </DashboardShell>
  );
}
