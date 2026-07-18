import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { ChangePill, IndexHeroCard, fmt } from "@/components/MarketBits";
import { dashboardQuery } from "@/lib/dashboard-query";
import { FearGreedGauge } from "@/features/home/FearGreedGauge";
import { IndexBreadthBars } from "@/features/home/IndexBreadthBars";
import { ParticipantActivity } from "@/features/home/ParticipantActivity";
import { Sparkles, Activity } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Market Dashboard — Live NSE & BSE" },
      {
        name: "description",
        content:
          "Live NIFTY 50, BANK NIFTY and SENSEX dashboard with realtime auto-refresh, sector heatmap, AI sentiment and option chain for Indian markets.",
      },
      { property: "og:title", content: "Market Dashboard — Live NSE & BSE" },
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
  const { nifty, sensex, bankNifty: bank, vix, sectors, commentary } = data;

  return (
    <DashboardShell>
      <div className="grid gap-5 xl:grid-cols-3">
        {nifty && <IndexHeroCard q={nifty} label="NIFTY 50" vix={vix} />}
        {bank && <IndexHeroCard q={bank} label="BANK NIFTY" vix={vix} />}
        {sensex && <IndexHeroCard q={sensex} label="SENSEX" vix={vix} />}
      </div>

      {/* AI Market Sentiment (left 2/3) + compact Fear & Greed (right 1/3) */}
      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <div className="rounded-2xl border border-[var(--neon)]/30 bg-gradient-to-br from-[var(--neon)]/10 via-card to-card p-4 xl:col-span-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--neon)]" />
            <h2 className="text-xs uppercase tracking-widest text-[var(--neon)]">AI Market Sentiment</h2>
          </div>
          <div className="mt-1.5 flex items-baseline gap-3">
            <div
              className={`text-2xl font-bold ${
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
          <ul className="mt-3 space-y-1.5 text-sm leading-snug text-foreground/90">
            {commentary.lines.map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--neon)]" />
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </div>

        <FearGreedGauge
          nifty={nifty}
          bankNifty={bank}
          sensex={sensex}
          vix={vix}
          sectors={sectors}
        />
      </div>

      {/* Index Breadth */}
      <div className="mt-6">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
          Index Breadth
        </h2>
        <IndexBreadthBars />
      </div>

      {/* Market Overview & Pulse — top 3 index cards + Participant Activity */}
      <div className="mt-6 rounded-2xl border border-[var(--neon)]/30 bg-gradient-to-br from-card via-card to-[var(--neon)]/5 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--neon)]" />
          <h2 className="text-xs uppercase tracking-widest text-[var(--neon)]">Market Overview &amp; Pulse</h2>
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

        <div className="mt-4">
          <ParticipantActivity />
        </div>
      </div>
    </DashboardShell>
  );
}
