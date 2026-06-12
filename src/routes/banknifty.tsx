import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { ChangePill, IndexHeroCard, StockRow } from "@/components/MarketBits";
import { dashboardQuery, constituentsQuery } from "@/lib/dashboard-query";

export const Route = createFileRoute("/banknifty")({
  head: () => ({
    meta: [
      { title: "BANK NIFTY — Live Constituents | IndexMover" },
      {
        name: "description",
        content:
          "BANK NIFTY live index with all banking constituents, advance/decline and live change % for every member.",
      },
      { property: "og:title", content: "BANK NIFTY — Live Constituents" },
      {
        property: "og:description",
        content: "Live BANK NIFTY price, breadth and constituent-level performance.",
      },
      { property: "og:url", content: "https://indiandeshboard.lovable.app/banknifty" },
    ],
    links: [{ rel: "canonical", href: "https://indiandeshboard.lovable.app/banknifty" }],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(dashboardQuery),
      context.queryClient.ensureQueryData(constituentsQuery("banknifty")),
    ]),
  component: Page,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function Page() {
  const { data: dash } = useSuspenseQuery(dashboardQuery);
  const { data } = useSuspenseQuery(constituentsQuery("banknifty"));
  const stocks = [...data.stocks].sort((a, b) => b.changePct - a.changePct);
  const max = Math.max(0.5, ...stocks.map((s) => Math.abs(s.changePct)));
  return (
    <DashboardShell title="BANK NIFTY" subtitle="Banking benchmark — live constituents" updatedAt={data.updatedAt}>
      {dash.bankNifty && (
        <div className="mb-6 grid gap-5 lg:grid-cols-2">
          <IndexHeroCard q={dash.bankNifty} label="BANK NIFTY" />
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Advance</div>
              <div className="mt-2 font-mono text-3xl font-bold text-[var(--bull)]">{data.advance}</div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Decline</div>
              <div className="mt-2 font-mono text-3xl font-bold text-[var(--bear)]">{data.decline}</div>
            </div>
            <div className="col-span-2 rounded-2xl border border-border bg-card p-5">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Avg Change</div>
              <div className="mt-2"><ChangePill pct={data.avgChange} /></div>
            </div>
          </div>
        </div>
      )}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-2 text-sm font-semibold">All constituents</div>
        <div className="divide-y divide-border">
          {stocks.map((s) => <StockRow key={s.symbol} q={s} max={max} />)}
        </div>
      </div>
    </DashboardShell>
  );
}
