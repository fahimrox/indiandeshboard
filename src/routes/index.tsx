import { createFileRoute } from "@tanstack/react-router";
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
import { Sparkles, Activity } from "lucide-react";

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
  const { nifty, sensex, bankNifty: bank, vix, commentary } = data;

  const totalDirectional = Math.max(1, data.advance + data.decline);
  const bullsPct = (data.advance / totalDirectional) * 100;

  const allStocks = [...data.gainers, ...data.losers];
  const maxAbs = Math.max(0.5, ...allStocks.map((s) => Math.abs(s.changePct)));
  const sortedSectors = [...data.sectors].sort((a, b) => b.changePct - a.changePct);
  const topSector = sortedSectors[0];
  const bottomSector = sortedSectors[sortedSectors.length - 1];

  return (
    <DashboardShell
      title="Index Dashboard"
      subtitle="Live Indian market intelligence"
      updatedAt={data.updatedAt}
    >
      <div className="grid gap-5 xl:grid-cols-3">
        {nifty && <IndexHeroCard q={nifty} label="NIFTY 50" vix={vix} />}
        {bank && <IndexHeroCard q={bank} label="BANK NIFTY" vix={vix} />}
        {sensex && <IndexHeroCard q={sensex} label="SENSEX" vix={vix} />}
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

      {/* Market Overview / Pulse — replaces sector heatmap */}
      <div className="mt-6 rounded-2xl border border-[var(--neon)]/30 bg-gradient-to-br from-card via-card to-[var(--neon)]/5 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--neon)]" />
          <div className="text-xs uppercase tracking-widest text-[var(--neon)]">Market Overview & Pulse</div>
          <span className="ml-auto rounded-full border border-border bg-background/40 px-3 py-1 text-[10px] uppercase text-muted-foreground">
            One-glance market read
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {commentary.indices.map((i) => (
            <div
              key={i.label}
              className={`rounded-xl border p-4 ${
                i.bias === "Bullish"
                  ? "border-[var(--bull)]/40 bg-[var(--bull)]/5"
                  : i.bias === "Bearish"
                    ? "border-[var(--bear)]/40 bg-[var(--bear)]/5"
                    : "border-border bg-background/30"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">{i.label}</div>
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                    i.bias === "Bullish"
                      ? "bg-[var(--bull)]/20 text-[var(--bull)]"
                      : i.bias === "Bearish"
                        ? "bg-[var(--bear)]/20 text-[var(--bear)]"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {i.bias}
                </span>
              </div>
              <div
                className={`mt-1 font-mono text-lg font-bold ${
                  i.changePct >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"
                }`}
              >
                {i.changePct >= 0 ? "+" : ""}{fmt(i.changePct)}%
              </div>
              <div className="mt-2 text-xs text-foreground/80">{i.reason}.</div>
              <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>Reversal odds</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background/60">
                  <div
                    className={`h-full ${i.reversalChance >= 55 ? "bg-amber-500" : "bg-muted-foreground/40"}`}
                    style={{ width: `${i.reversalChance}%` }}
                  />
                </div>
                <span className="font-mono">{i.reversalChance}%</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-background/30 p-4">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Volatility & Positioning</div>
            <div className="mt-2 text-sm text-foreground/90">{commentary.vixStatus}.</div>
            {commentary.pcrStatus && <div className="mt-1 text-sm text-foreground/80">{commentary.pcrStatus}.</div>}
          </div>
          <div className="rounded-xl border border-border bg-background/30 p-4">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Sector Flow</div>
            {topSector && bottomSector ? (
              <div className="mt-2 text-sm text-foreground/90">
                Leader <span className="font-semibold text-[var(--bull)]">{topSector.label}</span> ({topSector.changePct >= 0 ? "+" : ""}{fmt(topSector.changePct)}%) vs laggard <span className="font-semibold text-[var(--bear)]">{bottomSector.label}</span> ({fmt(bottomSector.changePct)}%) — rotation favors {topSector.changePct >= 0 ? "risk-on" : "defensive"} names.
              </div>
            ) : (
              <div className="mt-2 text-sm text-muted-foreground">Sector data loading…</div>
            )}
          </div>
        </div>

        <ul className="mt-4 space-y-2 text-sm text-foreground/90">
          {commentary.lines.slice(-3).map((l, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--neon)]" />
              <span>{l}</span>
            </li>
          ))}
        </ul>
      </div>
    </DashboardShell>
  );
}
