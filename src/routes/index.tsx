import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import {
  ChangePill,
  IndexHeroCard,
  KpiCard,
  SectorTile,
  StockRow,
  fmt,
} from "@/components/MarketBits";
import { dashboardQuery } from "@/lib/dashboard-query";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "IndexMover — Live NSE & BSE Market Dashboard" },
      {
        name: "description",
        content:
          "Live NIFTY 50, BANK NIFTY and SENSEX dashboard with realtime auto-refresh, sector heatmap, and top gainers & losers.",
      },
      { property: "og:title", content: "IndexMover — Live Indian Market Dashboard" },
      {
        property: "og:description",
        content: "Realtime NSE & BSE intelligence. NIFTY, BANK NIFTY, SENSEX, sectors & more.",
      },
    ],
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
  const nifty = data.nifty;
  const sensex = data.sensex;
  const bank = data.bankNifty;

  const totalDirectional = Math.max(1, data.advance + data.decline);
  const bullsPct = (data.advance / totalDirectional) * 100;
  const sentimentLabel =
    bullsPct >= 65
      ? "Strong Bullish"
      : bullsPct >= 55
        ? "Bullish"
        : bullsPct >= 45
          ? "Neutral"
          : bullsPct >= 35
            ? "Bearish"
            : "Strong Bearish";

  const allStocks = [...data.gainers, ...data.losers];
  const maxAbs = Math.max(
    0.5,
    ...allStocks.map((s) => Math.abs(s.changePct)),
  );

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
        <KpiCard
          label="Positive Impact"
          value={String(data.advance)}
          sub="Stocks pushing index up"
          tone="bull"
        />
        <KpiCard
          label="Negative Impact"
          value={String(data.decline)}
          sub="Stocks dragging index down"
          tone="bear"
        />
        <KpiCard
          label="Advance / Decline"
          value={`${data.advance} / ${data.decline}`}
          sub={`${data.unchanged} unchanged`}
        />
        <KpiCard
          label="Avg Change"
          value={`${data.avgChange >= 0 ? "+" : ""}${fmt(data.avgChange)}%`}
          sub="Across NIFTY constituents"
          tone={data.avgChange >= 0 ? "bull" : "bear"}
        />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5 xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                Index Contribution
              </div>
              <div className="text-sm font-semibold">Top Gainers & Losers</div>
            </div>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-semibold text-[var(--bull)]">
                ▲ TOP GAINERS
              </div>
              {data.gainers.map((s) => (
                <StockRow key={s.symbol} q={s} max={maxAbs} />
              ))}
              {data.gainers.length === 0 && (
                <div className="py-2 text-xs text-muted-foreground">No gainers right now.</div>
              )}
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold text-[var(--bear)]">
                ▼ TOP LOSERS
              </div>
              {data.losers.map((s) => (
                <StockRow key={s.symbol} q={s} max={maxAbs} />
              ))}
              {data.losers.length === 0 && (
                <div className="py-2 text-xs text-muted-foreground">No losers right now.</div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Market Sentiment
          </div>
          <div className="mt-1 text-sm font-semibold">Bulls vs Bears</div>
          <div className="mt-5 flex items-center justify-between text-xs">
            <span className="text-[var(--bull)] font-semibold">BULLS {fmt(bullsPct, 1)}%</span>
            <span className="text-[var(--bear)] font-semibold">
              BEARS {fmt(100 - bullsPct, 1)}%
            </span>
          </div>
          <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-background/60">
            <div className="bg-[var(--bull)]" style={{ width: `${bullsPct}%` }} />
            <div className="bg-[var(--bear)]" style={{ width: `${100 - bullsPct}%` }} />
          </div>
          <div
            className={`mt-6 rounded-xl border p-4 ${
              bullsPct >= 55
                ? "border-[var(--bull)]/40 bg-[var(--bull)]/10"
                : bullsPct <= 45
                  ? "border-[var(--bear)]/40 bg-[var(--bear)]/10"
                  : "border-border bg-background/40"
            }`}
          >
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              Current Read
            </div>
            <div
              className={`mt-1 text-2xl font-bold ${
                bullsPct >= 55
                  ? "text-[var(--bull)]"
                  : bullsPct <= 45
                    ? "text-[var(--bear)]"
                    : ""
              }`}
            >
              {sentimentLabel}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Based on advance/decline of NIFTY constituents.
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              Sector Breakdown
            </div>
            <div className="text-sm font-semibold">Sectoral Performance (Live)</div>
          </div>
          <ChangePill pct={data.avgChange} />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-4">
          {data.sectors.map((s) => (
            <SectorTile key={s.symbol} name={s.label} pct={s.changePct} />
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
