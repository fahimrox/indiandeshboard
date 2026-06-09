import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { SectorTile, ChangePill } from "@/components/MarketBits";
import { dashboardQuery } from "@/lib/dashboard-query";

export const Route = createFileRoute("/heatmap")({
  head: () => ({ meta: [{ title: "Sector Heatmap — Live | IndexMover" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQuery),
  component: Page,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function Page() {
  const { data } = useSuspenseQuery(dashboardQuery);
  const sorted = [...data.sectors].sort((a, b) => b.changePct - a.changePct);
  return (
    <DashboardShell title="Sector Heatmap" subtitle="Live sectoral performance" updatedAt={data.updatedAt}>
      <div className="mb-4 flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Avg sector move:</span>
        <ChangePill pct={sorted.reduce((a, s) => a + s.changePct, 0) / (sorted.length || 1)} />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {sorted.map((s) => (
          <SectorTile key={s.symbol} name={s.label} pct={s.changePct} />
        ))}
      </div>
    </DashboardShell>
  );
}
