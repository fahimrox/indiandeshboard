import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { ChangePill, IndexHeroCard, StockRow, fmt } from "@/components/MarketBits";
import { dashboardQuery } from "@/lib/dashboard-query";

export const Route = createFileRoute("/nifty50")({
  head: () => ({
    meta: [
      { title: "NIFTY 50 — Live Constituents | IndexMover" },
      {
        name: "description",
        content:
          "NIFTY 50 live index price with all tracked constituents, advance/decline breadth and per-stock change %.",
      },
      { property: "og:title", content: "NIFTY 50 — Live Constituents" },
      {
        property: "og:description",
        content: "Live NIFTY 50 price, breadth and constituent-level performance.",
      },
      { property: "og:url", content: "https://indiandeshboard.lovable.app/nifty50" },
    ],
    links: [{ rel: "canonical", href: "https://indiandeshboard.lovable.app/nifty50" }],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQuery),
  component: Page,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function Page() {
  const { data } = useSuspenseQuery(dashboardQuery);
  const stocks = [...data.stocks].sort((a, b) => b.changePct - a.changePct);
  const max = Math.max(0.5, ...stocks.map((s) => Math.abs(s.changePct)));
  return (
    <DashboardShell title="NIFTY 50" subtitle="All tracked constituents — live" updatedAt={data.updatedAt}>
      {data.nifty && (
        <div className="mb-6 grid gap-5 lg:grid-cols-2">
          <IndexHeroCard q={data.nifty} label="NIFTY 50" />
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Advance</div>
              <div className="mt-2 font-mono text-3xl font-bold text-[var(--bull)]">{data.advance}</div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Decline</div>
              <div className="mt-2 font-mono text-3xl font-bold text-[var(--bear)]">{data.decline}</div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 col-span-2">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Avg Change</div>
              <div className="mt-2 font-mono text-3xl font-bold">
                <ChangePill pct={data.avgChange} />
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Mean of {data.stocks.length} tracked NIFTY constituents
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-2 text-sm font-semibold">All constituents</div>
        <div className="divide-y divide-border">
          {stocks.map((s) => (
            <StockRow key={s.symbol} q={s} max={max} />
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
