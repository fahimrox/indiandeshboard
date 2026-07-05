import { createFileRoute } from "@tanstack/react-router";
import { intradayBoosterQuery, fnoStocksQuery } from "@/lib/dashboard-query";
import IntradayBoosterPage from "@/features/intraday-booster/IntradayBoosterPage";

export const Route = createFileRoute("/intraday-booster")({
  head: () => ({
    meta: [
      { title: "Intraday Booster — Sector Flow & Momentum | IndexMover" },
      {
        name: "description",
        content:
          "Live intraday booster: sector strength, F&O inflow/outflow momentum with timestamps, and index/sector constituent movers for NIFTY, BANK NIFTY, SENSEX and all sectors.",
      },
      { property: "og:title", content: "Intraday Booster — Sector Flow & Momentum" },
      { property: "og:url", content: "https://indiandeshboard.lovable.app/intraday-booster" },
    ],
    links: [{ rel: "canonical", href: "https://indiandeshboard.lovable.app/intraday-booster" }],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(intradayBoosterQuery),
      context.queryClient.ensureQueryData(fnoStocksQuery),
    ]),
  component: IntradayBoosterPage,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});
