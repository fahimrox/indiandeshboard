import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { IndexHeroCard } from "@/components/MarketBits";
import { IndexBreadthCard, IndexContributionPanel } from "@/components/IndexPanels";
import { dashboardQuery, indexContributionsQuery } from "@/lib/dashboard-query";

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
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(dashboardQuery),
      context.queryClient.ensureQueryData(indexContributionsQuery("nifty")),
    ]),
  component: Page,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function Page() {
  const { data } = useSuspenseQuery(dashboardQuery);
  const { data: contrib } = useSuspenseQuery(indexContributionsQuery("nifty"));
  return (
    <DashboardShell title="NIFTY 50" subtitle="Constituent breadth & contribution — live" updatedAt={data.updatedAt}>
      {data.nifty && (
        <div className="mb-5 grid gap-4 lg:grid-cols-2">
          <IndexHeroCard q={data.nifty} label="NIFTY 50" vix={data.vix} />
          <IndexBreadthCard label="NIFTY 50" advance={data.advance} decline={data.decline} changePct={data.nifty.changePct} />
        </div>
      )}
      <IndexContributionPanel positive={contrib.positive} negative={contrib.negative} />
    </DashboardShell>
  );
}
