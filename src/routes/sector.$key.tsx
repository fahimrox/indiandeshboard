import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { ChangePill, KpiCard, StockRow, fmt } from "@/components/MarketBits";
import { sectorDetailQuery } from "@/lib/dashboard-query";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/sector/$key")({
  head: ({ params }) => ({ meta: [{ title: `${params.key.toUpperCase()} Sector — Live | IndexMover` }] }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(sectorDetailQuery(params.key)),
  component: Page,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Sector not found</div>,
});

function Page() {
  const { key } = Route.useParams();
  const { data } = useSuspenseQuery(sectorDetailQuery(key));
  const stocks = [...data.stocks].sort((a, b) => b.changePct - a.changePct);
  const max = Math.max(0.5, ...stocks.map((s) => Math.abs(s.changePct)));
  const idx = data.sector.quote;
  return (
    <DashboardShell title={`${data.sector.name} Sector`} subtitle="Live constituents & breadth" updatedAt={data.updatedAt}>
      <Link to="/heatmap" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Back to heatmap
      </Link>
      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard
          label={`${data.sector.name} Index`}
          value={idx ? fmt(idx.price) : "—"}
          sub={idx ? `${idx.changePct >= 0 ? "+" : ""}${fmt(idx.changePct)}%` : ""}
          tone={idx && idx.changePct >= 0 ? "bull" : "bear"}
        />
        <KpiCard label="Advance" value={String(data.advance)} tone="bull" />
        <KpiCard label="Decline" value={String(data.decline)} tone="bear" />
        <KpiCard
          label="Avg Change"
          value={`${data.avgChange >= 0 ? "+" : ""}${fmt(data.avgChange)}%`}
          tone={data.avgChange >= 0 ? "bull" : "bear"}
        />
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-2 text-sm font-semibold text-[var(--bull)]">▲ Top Gainers</div>
          {data.gainers.map((s) => <StockRow key={s.symbol} q={s} max={max} />)}
          {data.gainers.length === 0 && <div className="text-xs text-muted-foreground">None.</div>}
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-2 text-sm font-semibold text-[var(--bear)]">▼ Top Losers</div>
          {data.losers.map((s) => <StockRow key={s.symbol} q={s} max={max} />)}
          {data.losers.length === 0 && <div className="text-xs text-muted-foreground">None.</div>}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">All sector stocks</div>
          <ChangePill pct={data.avgChange} />
        </div>
        <div className="divide-y divide-border">
          {stocks.map((s) => <StockRow key={s.symbol} q={s} max={max} />)}
          {stocks.length === 0 && <div className="py-4 text-sm text-muted-foreground">No stocks mapped for this sector yet.</div>}
        </div>
      </div>
    </DashboardShell>
  );
}
