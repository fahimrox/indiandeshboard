import { createFileRoute } from "@tanstack/react-router";
import { candlesQuery } from "@/lib/dashboard-query";
import ChartLabPage from "@/features/chart/ChartLabPage";

export const Route = createFileRoute("/chart")({
  head: () => ({
    meta: [
      { title: "Live Chart — NIFTY, BANKNIFTY, F&O & Stocks with OI Overlay | IndexMover" },
      {
        name: "description",
        content:
          "Professional live candlestick chart for NIFTY, BANK NIFTY, SENSEX, all NSE F&O and cash stocks, with right-side Call/Put OI bars overlay and volume.",
      },
      { property: "og:title", content: "Live Chart with OI Overlay" },
      { property: "og:url", content: "https://indiandeshboard.lovable.app/chart" },
    ],
    links: [{ rel: "canonical", href: "https://indiandeshboard.lovable.app/chart" }],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(candlesQuery("^NSEI", "5m")),
  component: ChartLabPage,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});
