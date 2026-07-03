import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { IndexHeroCard } from "@/components/MarketBits";
import { IndexBreadthCard, IndexContributionPanel } from "@/components/IndexPanels";
import { dashboardQuery, constituentsQuery, indexContributionsQuery } from "@/lib/dashboard-query";

export const Route = createFileRoute("/sensex")({
  head: () => ({
    meta: [
      { title: "SENSEX — Live BSE Constituents | IndexMover" },
      {
        name: "description",
        content:
          "BSE SENSEX live index with all 30 constituents, advance/decline and live change % for every member.",
      },
      { property: "og:title", content: "SENSEX — Live BSE Constituents" },
      {
        property: "og:description",
        content: "Live SENSEX price, breadth and constituent-level performance.",
      },
      { property: "og:url", content: "https://indiandeshboard.lovable.app/sensex" },
    ],
    links: [{ rel: "canonical", href: "https://indiandeshboard.lovable.app/sensex" }],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(dashboardQuery),
      context.queryClient.ensureQueryData(constituentsQuery("sensex")),
      context.queryClient.ensureQueryData(indexContributionsQuery("sensex")),
    ]),
  component: Page,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function Page() {
  const { data: dash } = useSuspenseQuery(dashboardQuery);
  const { data } = useSuspenseQuery(constituentsQuery("sensex"));
  const { data: contrib } = useSuspenseQuery(indexContributionsQuery("sensex"));
  return (
    <DashboardShell title="SENSEX" subtitle="Constituent breadth & contribution — live" updatedAt={data.updatedAt}>
      {dash.sensex && (
        <div className="mb-5 grid gap-4 lg:grid-cols-2">
          <IndexHeroCard q={dash.sensex} label="SENSEX" vix={dash.vix} />
          <IndexBreadthCard label="SENSEX" advance={data.advance} decline={data.decline} changePct={dash.sensex.changePct} />
        </div>
      )}
      <IndexContributionPanel positive={contrib.positive} negative={contrib.negative} />
    </DashboardShell>
  );
}
