import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { fnoStocksQuery } from "@/lib/dashboard-query";
import { fmt } from "@/components/MarketBits";
import { useState, useMemo } from "react";

type FilterTab = "all" | "gainers" | "losers" | "oi_gainers" | "oi_losers" | "long_buildup" | "short_buildup" | "short_covering" | "long_unwinding";

function Page() {
  const { data } = useSuspenseQuery(fnoStocksQuery);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [hoveredStock, setHoveredStock] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const allStocks = useMemo(() => [...data.data].sort((a, b) => b.changePct - a.changePct), [data.data]);

  const filterCounts = useMemo(() => ({
    all: allStocks.length,
    gainers: allStocks.filter(s => s.changePct > 0).length,
    losers: allStocks.filter(s => s.changePct < 0).length,
    oi_gainers: allStocks.filter(s => s.oiChgPct > 0).length,
    oi_losers: allStocks.filter(s => s.oiChgPct < 0).length,
    long_buildup: allStocks.filter(s => s.buildup === "Long Buildup").length,
    short_buildup: allStocks.filter(s => s.buildup === "Short Buildup").length,
    short_covering: allStocks.filter(s => s.buildup === "Short Covering").length,
    long_unwinding: allStocks.filter(s => s.buildup === "Long Unwinding").length,
  }), [allStocks]);

  const filteredStocks = useMemo(() => {
    switch (activeFilter) {
      case "gainers": return allStocks.filter(s => s.changePct > 0);
      case "losers": return allStocks.filter(s => s.changePct < 0);
      case "oi_gainers": return allStocks.filter(s => s.oiChgPct > 0);
      case "oi_losers": return allStocks.filter(s => s.oiChgPct < 0);
      case "long_buildup": return allStocks.filter(s => s.buildup === "Long Buildup");
      case "short_buildup": return allStocks.filter(s => s.buildup === "Short Buildup");
      case "short_covering": return allStocks.filter(s => s.buildup === "Short Covering");
      case "long_unwinding": return allStocks.filter(s => s.buildup === "Long Unwinding");
      default: return allStocks;
    }
  }, [allStocks, activeFilter]);

  const maxAbsChange = useMemo(() => {
    const max = Math.max(...allStocks.map(s => Math.abs(s.changePct)), 1);
    return max;
  }, [allStocks]);

  const getHeatmapColor = (stock: typeof allStocks[0]) => {
    const { changePct, buildup } = stock;
    const intensity = Math.min(1, Math.abs(changePct) / maxAbsChange);
    const alpha = Math.round(25 + intensity * 65);
    
    if (buildup === "Long Unwinding") {
      return `oklch(0.65 0.18 70 / ${alpha}%)`;
    }
    if (changePct >= 0) {
      return `oklch(0.55 0.24 142 / ${alpha}%)`;
    }
    return `oklch(0.55 0.22 25 / ${alpha}%)`;
  };

  const handleMouseEnter = (symbol: string, e: React.MouseEvent) => {
    setHoveredStock(symbol);
    setTooltipPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    setTooltipPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseLeave = () => {
    setHoveredStock(null);
  };

  const hoveredData = hoveredStock ? allStocks.find(s => s.symbol === hoveredStock) : null;

  const filterTabs: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "All", count: filterCounts.all },
    { key: "gainers", label: "Top Gainers", count: filterCounts.gainers },
    { key: "losers", label: "Top Losers", count: filterCounts.losers },
    { key: "oi_gainers", label: "OI Gainers", count: filterCounts.oi_gainers },
    { key: "oi_losers", label: "OI Losers", count: filterCounts.oi_losers },
    { key: "long_buildup", label: "Long Buildup", count: filterCounts.long_buildup },
    { key: "short_buildup", label: "Short Buildup", count: filterCounts.short_buildup },
    { key: "short_covering", label: "Short Covering", count: filterCounts.short_covering },
    { key: "long_unwinding", label: "Long Unwinding", count: filterCounts.long_unwinding },
  ];

  return (
    <DashboardShell title="F&O Board" subtitle="All NSE F&O stocks heat-tiled by % change" updatedAt={data.updatedAt}>
      {data.source === "fallback" && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          NSE feed blocked from server right now. Retrying every 45s.
        </div>
      )}
      {/* F&O Heatmap Section */}
      <div className="my-4">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {filterTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeFilter === tab.key
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300"
              }`}
            >
              {tab.label} <span className="ml-1 opacity-70">{tab.count}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <div className="grid grid-cols-4 gap-1 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12">
            {filteredStocks.map(s => {
              const up = s.changePct >= 0;
              const bg = getHeatmapColor(s);
              return (
                <div
                  key={s.symbol}
                  className="flex flex-col rounded border border-border p-1.5 text-xs cursor-pointer hover:ring-1 hover:ring-white/30 transition-all"
                  style={{ background: bg, minHeight: "60px" }}
                  onMouseEnter={(e) => handleMouseEnter(s.symbol, e)}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={handleMouseLeave}
                >
                  <div className="flex items-center gap-1">
                    <StockLogo symbol={s.symbol} />
                    <span className="truncate font-semibold text-[10px] leading-tight">{s.symbol}</span>
                  </div>
                  <div className="mt-auto font-mono text-[10px]">{fmt(s.ltp)}</div>
                  <div className={`font-mono text-[10px] ${up ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                    {up ? "+" : ""}{fmt(s.changePct)}%
                  </div>
                </div>
              );
            })}
          </div>
          {hoveredData && (
            <div
              className="fixed z-50 pointer-events-none bg-gray-900 border border-gray-600 rounded-lg p-3 shadow-xl text-xs"
              style={{ left: tooltipPos.x + 12, top: tooltipPos.y + 12 }}
            >
              <div className="font-bold text-white mb-1">{hoveredData.symbol}</div>
              <div className="text-gray-300">Price: <span className="text-white">{fmt(hoveredData.ltp)}</span></div>
              <div className="text-gray-300">Price Change %: <span className={hoveredData.changePct >= 0 ? "text-green-400" : "text-red-400"}>{hoveredData.changePct >= 0 ? "+" : ""}{fmt(hoveredData.changePct)}%</span></div>
              <div className="text-gray-300">OI Change %: <span className={hoveredData.oiChgPct >= 0 ? "text-green-400" : "text-red-400"}>{hoveredData.oiChgPct >= 0 ? "+" : ""}{fmt(hoveredData.oiChgPct)}%</span></div>
              <div className="text-gray-300">Sentiment: <span className="text-yellow-400">{hoveredData.buildup}</span></div>
            </div>
          )}
        </div>
      </div>
      {/* ALL F&O Header */}
      <div className="mt-6 mb-3">
        <h2 className="text-lg font-bold text-slate-200">ALL F&O</h2>
      </div>
      {/* Existing content starts here */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        {allStocks.map((s) => {
          const up = s.changePct >= 0;
          const intensity = Math.min(1, Math.abs(s.changePct) / 5);
          const alpha = Math.round(25 + intensity * 65);
          const bg = up
            ? `oklch(0.55 0.24 142 / ${alpha}%)`
            : `oklch(0.55 0.22 25 / ${alpha}%)`;
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
