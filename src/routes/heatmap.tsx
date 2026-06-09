import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { ChangePill, fmt } from "@/components/MarketBits";
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
    <DashboardShell title="Sector Heatmap" subtitle="Click any sector to drill into stocks" updatedAt={data.updatedAt}>
      <div className="mb-4 flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Avg sector move:</span>
        <ChangePill pct={sorted.reduce((a, s) => a + s.changePct, 0) / (sorted.length || 1)} />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {sorted.map((s) => {
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
              <div className="mt-3 flex items-end justify-between">
                <div className={`font-mono text-xl font-bold ${up ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                  {up ? "+" : ""}{fmt(s.changePct)}%
                </div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">View →</div>
              </div>
            </Link>
          );
        })}
      </div>
    </DashboardShell>
  );
}
