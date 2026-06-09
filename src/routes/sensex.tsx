import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { IndexHeroCard } from "@/components/MarketBits";
import { dashboardQuery } from "@/lib/dashboard-query";

export const Route = createFileRoute("/sensex")({
  head: () => ({ meta: [{ title: "SENSEX — Live BSE | IndexMover" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQuery),
  component: Page,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function Page() {
  const { data } = useSuspenseQuery(dashboardQuery);
  return (
    <DashboardShell title="SENSEX" subtitle="BSE benchmark — live" updatedAt={data.updatedAt}>
      {data.sensex ? (
        <div className="max-w-2xl">
          <IndexHeroCard q={data.sensex} label="SENSEX" />
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">Data unavailable.</div>
      )}
    </DashboardShell>
  );
}
