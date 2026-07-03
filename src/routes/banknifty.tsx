import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { IndexHeroCard } from "@/components/MarketBits";
import { IndexBreadthCard, IndexContributionPanel } from "@/components/IndexPanels";
import { dashboardQuery, constituentsQuery, indexContributionsQuery } from "@/lib/dashboard-query";

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
      context.queryClient.ensureQueryData(indexContributionsQuery("banknifty")),
    ]),
  component: Page,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function Page() {
  const { data: dash } = useSuspenseQuery(dashboardQuery);
  const { data } = useSuspenseQuery(constituentsQuery("banknifty"));
  const { data: contrib } = useSuspenseQuery(indexContributionsQuery("banknifty"));
  return (
    <DashboardShell title="BANK NIFTY" subtitle="Constituent breadth & contribution — live" updatedAt={data.updatedAt}>
      {dash.bankNifty && (
        <div className="mb-5 grid gap-4 lg:grid-cols-2">
          <IndexHeroCard q={dash.bankNifty} label="BANK NIFTY" vix={dash.vix} />
          <IndexBreadthCard label="BANK NIFTY" advance={data.advance} decline={data.decline} changePct={dash.bankNifty.changePct} />
        </div>
      )}
      <IndexContributionPanel positive={contrib.positive} negative={contrib.negative} />
    </DashboardShell>
  );
}
