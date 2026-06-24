import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { fnoStocksQuery } from "@/lib/dashboard-query";
import { fmt } from "@/components/MarketBits";
import { useState } from "react";

export const Route = createFileRoute("/fnoboard")({
  head: () => ({
    meta: [
      { title: "F&O Board — NSE Heatmap | IndexMover" },
      {
        name: "description",
        content:
          "Heat-tiled view of every NSE F&O stock sorted and coloured by live % change.",
      },
      { property: "og:title", content: "F&O Board — NSE Heatmap" },
      {
        property: "og:description",
        content: "Live heatmap of all NSE F&O stocks by % change.",
      },
      { property: "og:url", content: "https://indiandeshboard.lovable.app/fnoboard" },
    ],
    links: [{ rel: "canonical", href: "https://indiandeshboard.lovable.app/fnoboard" }],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(fnoStocksQuery),
  component: Page,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function StockAvatar({ symbol }: { symbol: string }) {
  const initials = symbol.slice(0, 2);
  const charCodeSum = symbol.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const colors = [
    "bg-red-500/10 text-red-400 border-red-500/20",
    "bg-blue-500/10 text-blue-400 border-blue-500/20",
    "bg-green-500/10 text-green-400 border-green-500/20",
    "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    "bg-purple-500/10 text-purple-400 border-purple-500/20",
    "bg-pink-500/10 text-pink-400 border-pink-500/20",
    "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  ];
  const colorClass = colors[charCodeSum % colors.length];
  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${colorClass}`}>
      {initials}
    </div>
  );
}

function StockLogo({ symbol }: { symbol: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const logoUrl = `https://dharunashokkumar.github.io/indian-listed-company-logos/nse/NSE_${symbol}.svg`;

  if (imgFailed) {
    return <StockAvatar symbol={symbol} />;
  }

  return (
    <div className="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-white flex items-center justify-center border border-border">
      <img
        src={logoUrl}
        alt={symbol}
        className="h-8 w-8 object-contain"
        onError={() => setImgFailed(true)}
      />
    </div>
  );
}

function Page() {
  const { data } = useSuspenseQuery(fnoStocksQuery);
  const sorted = [...data.data].sort((a, b) => b.changePct - a.changePct);
  return (
    <DashboardShell title="F&O Board" subtitle="All NSE F&O stocks heat-tiled by % change" updatedAt={data.updatedAt}>
      {data.source === "fallback" && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          NSE feed blocked from server right now. Retrying every 45s.
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        {sorted.map((s) => {
          const up = s.changePct >= 0;
          const intensity = Math.min(1, Math.abs(s.changePct) / 5);
          const bg = up
            ? `color-mix(in oklab, var(--bull) ${15 + intensity * 55}%, transparent)`
            : `color-mix(in oklab, var(--bear) ${15 + intensity * 55}%, transparent)`;
          return (
            <div
              key={s.symbol}
              className="flex flex-col rounded-lg border border-border p-2 text-xs"
              style={{ background: bg }}
            >
              <div className="flex items-center gap-2">
                <StockLogo symbol={s.symbol} />
                <span className="truncate font-semibold">{s.symbol}</span>
              </div>
              <div className="mt-1 font-mono">{fmt(s.ltp)}</div>
              <div className={`font-mono ${up ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                {up ? "+" : ""}{fmt(s.changePct)}%
              </div>
            </div>
          );
        })}
      </div>
    </DashboardShell>
  );
}
