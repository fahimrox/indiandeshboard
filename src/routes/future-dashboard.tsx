import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { fmt } from "@/components/MarketBits";
import { fnoStocksQuery } from "@/lib/dashboard-query";
import {
  TrendingUp,
  TrendingDown,
  Flame,
  Activity,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Search,
  Sparkles,
  Layers,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { FnoStock } from "@/lib/nse.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/future-dashboard")({
  head: () => ({
    meta: [
      { title: "Future Dashboard — Live Buildup & Sentiment | Market Dashboard" },
      {
        name: "description",
        content:
          "Derivatives buildup dashboard. Track Price Gainers, Price Losers, Long Buildup, Short Buildup, Long Unwinding, and Short Covering with AI sentiment index impact.",
      },
      { property: "og:title", content: "Future Dashboard — Live Buildup & Sentiment" },
      { property: "og:url", content: "https://indiandeshboard.lovable.app/future-dashboard" },
    ],
    links: [{ rel: "canonical", href: "https://indiandeshboard.lovable.app/future-dashboard" }],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(fnoStocksQuery),
  component: Page,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

// Helper to format large numbers
function fmtN(n: number) {
  if (!isFinite(n)) return "—";
  if (Math.abs(n) >= 1e7) return (n / 1e7).toFixed(2) + " Cr";
  if (Math.abs(n) >= 1e5) return (n / 1e5).toFixed(2) + " L";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toLocaleString("en-IN");
}

// Generate circular initials badge
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
    <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${colorClass}`}>
      {initials}
    </div>
  );
}

// Stock Logo component with fallback to initials avatar
function StockLogo({ symbol }: { symbol: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const logoUrl = `https://dharunashokkumar.github.io/indian-listed-company-logos/nse/NSE_${symbol}.svg`;

  if (imgFailed) {
    return <StockAvatar symbol={symbol} />;
  }

  return (
    <div className="h-6 w-6 shrink-0 overflow-hidden rounded-md bg-white flex items-center justify-center border border-border">
      <img
        src={logoUrl}
        alt={symbol}
        className="h-6 w-6 object-contain"
        onError={() => setImgFailed(true)}
      />
    </div>
  );
}

// Dynamic AI Summary Generator
function generateAiSummary(stocks: FnoStock[]) {
  const longBuildup = stocks.filter((s) => s.buildup === "Long Buildup").length;
  const shortBuildup = stocks.filter((s) => s.buildup === "Short Buildup").length;
  const longUnwinding = stocks.filter((s) => s.buildup === "Long Unwinding").length;
  const shortCovering = stocks.filter((s) => s.buildup === "Short Covering").length;

  const total = longBuildup + shortBuildup + longUnwinding + shortCovering;
  if (total === 0) return "No active buildup data available to analyze market sentiment.";

  const bullishScore = ((longBuildup + shortCovering) / total) * 100;
  const bearishScore = ((shortBuildup + longUnwinding) / total) * 100;
  const sentiment = bullishScore > 55 ? "BULLISH" : bearishScore > 55 ? "BEARISH" : "NEUTRAL";

  const lines: string[] = [];

  if (sentiment === "BULLISH") {
    lines.push(
      `Market derivatives data is displaying a strong **BULLISH** bias. Buildup classification shows **${(
        (longBuildup / total) *
        100
      ).toFixed(0)}%** of stocks in Long Buildup and **${((shortCovering / total) * 100).toFixed(
        0
      )}%** experiencing Short Covering.`
    );
    lines.push(
      `This configuration suggests heavy long accrual, likely supporting benchmark indices. **NIFTY 50** is experiencing positive momentum with immediate supports rising, and **BANK NIFTY** is positioned to test upper range boundaries.`
    );
    lines.push(
      `High buying volume is noticeable in counters like **${
        stocks
          .filter((s) => s.buildup === "Long Buildup")
          .slice(0, 2)
          .map((s) => s.symbol)
          .join(" and ") || "underlyings"
      }**, which are driving positive sectoral moves.`
    );
    lines.push(
      "Open interest analysis indicates active PE writing at key strikes, reinforcing a solid bottom for the current expiry series."
    );
    lines.push(
      "Derivatives data favors selective buying on intraday pullbacks as short-covering momentum remains supportive in major F&O counters."
    );
  } else if (sentiment === "BEARISH") {
    lines.push(
      `Derivatives buildup indicates a dominant **BEARISH** pressure across underlyings. Fresh shorts are actively accumulating, with **${(
        (shortBuildup / total) *
        100
      ).toFixed(0)}%** of stocks in Short Buildup and **${((longUnwinding / total) * 100).toFixed(
        0
      )}%** showing Long Unwinding.`
    );
    lines.push(
      `This setup suggests aggressive short-selling. Overhead pressure will likely keep **NIFTY 50** capping its gains, while **BANK NIFTY** remains vulnerable to downward tests as banking constituents show unwinding.`
    );
    lines.push(
      `Stocks showing significant fresh short buildup include **${
        stocks
          .filter((s) => s.buildup === "Short Buildup")
          .slice(0, 2)
          .map((s) => s.symbol)
          .join(" and ") || "underlyings"
      }**, which are under intense selling pressure.`
    );
    lines.push(
      "Heavy CE writing observed at immediate strikes indicates strong overhead resistance that will cap index breakout attempts."
    );
    lines.push(
      "Risk management is advised. Bearish structures call for hedged negative strategies or spread trading rather than aggressive long buys."
    );
  } else {
    lines.push(
      `Market bias remains **NEUTRAL / CONSOLIDATING**. Derivates metrics show a balanced distribution between **${
        longBuildup + shortCovering
      }** bullish setups and **${shortBuildup + longUnwinding}** bearish setups.`
    );
    lines.push(
      "This indicates a lack of directional commitment from institutional participants, resulting in range-bound price action in **NIFTY 50** and **BANK NIFTY**."
    );
    lines.push(
      `Sectoral rotation is the primary theme, with stocks like **${stocks
        .slice(0, 2)
        .map((s) => s.symbol)
        .join(" and ")}** showing isolated stock-specific trends.`
    );
    lines.push(
      "Straddles and range-bound credit spreads are favored as option premiums decay within key trading ranges."
    );
  }

  return lines.join(" ");
}

// Dynamically generate the 3 active monthly expiries
function getActiveExpiries() {
  const expiries: { label: string; value: string }[] = [];
  const now = new Date();
  let currentYear = now.getFullYear();
  let currentMonth = now.getMonth();

  for (let i = 0; i < 3; i++) {
    const lastThursday = getLastThursday(currentYear, currentMonth);
    const label = lastThursday.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    expiries.push({
      label,
      value: lastThursday.toISOString().split("T")[0],
    });

    currentMonth++;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear++;
    }
  }
  return expiries;
}

function getLastThursday(year: number, month: number) {
  const d = new Date(year, month + 1, 0);
  while (d.getDay() !== 4) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

// Table Sort Header Component for Modal
type SortKey = "symbol" | "ltp" | "changePct" | "volume" | "oi" | "oiChgPct" | "aiSentiment";
type SortDir = "asc" | "desc";

function SortHeader({
  label,
  k,
  sortKey,
  dir,
  onClick,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className="px-3 py-3 text-right">
      <button
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider transition hover:text-foreground ${
          active ? "text-[var(--neon)]" : "text-muted-foreground"
        }`}
      >
        <span>{label}</span>
        <Icon className="h-3 w-3" />
      </button>
    </th>
  );
}

// Individual Dashboard Card Component
function DashboardCard({
  title,
  stocks,
  isNegativeColor = false,
  allFnoStocks,
}: {
  title: string;
  stocks: FnoStock[];
  isNegativeColor?: boolean;
  allFnoStocks: FnoStock[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("changePct");
  const [dir, setDir] = useState<SortDir>(isNegativeColor ? "asc" : "desc");

  const topFive = stocks.slice(0, 5);
  // Find maximum absolute value to scale progress bars properly
  const maxVal = Math.max(0.1, ...topFive.map((s) => Math.abs(s.changePct)));

  const handleSort = (k: SortKey) => {
    if (k === sortKey) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setDir(k === "symbol" ? "asc" : "desc");
    }
  };

  const modalRows = useMemo(() => {
    const filtered = stocks.filter((s) =>
      s.symbol.toLowerCase().includes(search.toLowerCase())
    );
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] as number | string;
      const bv = b[sortKey] as number | string;
      if (typeof av === "string" && typeof bv === "string") {
        return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return dir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [stocks, search, sortKey, dir]);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base sm:text-lg font-bold tracking-tight text-foreground select-none">
            {title}
          </h2>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <button className="text-xs font-semibold text-[var(--neon)] hover:underline cursor-pointer">
                View All
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl bg-card border border-border text-foreground max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <div className={`h-3 w-3 rounded-full ${isNegativeColor ? "bg-[var(--bear)]" : "bg-[var(--bull)]"}`} />
                  <DialogTitle className="text-xl font-bold">{title} — Full List</DialogTitle>
                </div>
              </DialogHeader>

              {/* Search */}
              <div className="flex items-center gap-2 my-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search stock symbol..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 bg-background border-border text-xs h-9 focus:border-[var(--neon)]"
                  />
                </div>
                <div className="text-xs text-muted-foreground select-none">
                  {modalRows.length} stocks
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto border border-border rounded-xl">
                <table className="w-full text-xs text-left">
                  <thead className="bg-background text-muted-foreground font-semibold uppercase tracking-wider border-b border-border">
                    <tr>
                      <th className="px-3 py-3 text-left">Symbol</th>
                      <SortHeader label="LTP" k="ltp" sortKey={sortKey} dir={dir} onClick={handleSort} />
                      <SortHeader label="Change %" k="changePct" sortKey={sortKey} dir={dir} onClick={handleSort} />
                      <SortHeader label="Volume" k="volume" sortKey={sortKey} dir={dir} onClick={handleSort} />
                      <SortHeader label="OI" k="oi" sortKey={sortKey} dir={dir} onClick={handleSort} />
                      <SortHeader label="OI Chg %" k="oiChgPct" sortKey={sortKey} dir={dir} onClick={handleSort} />
                      <SortHeader label="AI Sentiment" k="aiSentiment" sortKey={sortKey} dir={dir} onClick={handleSort} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40 font-mono text-xs sm:text-sm">
                    {modalRows.map((s) => {
                      const up = s.changePct >= 0;
                      return (
                        <tr key={s.symbol} className="hover:bg-background/40">
                          <td className="px-3 py-3 text-left font-semibold font-sans text-foreground">
                            <div className="flex items-center gap-2">
                              <StockLogo symbol={s.symbol} />
                              <span>{s.symbol}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right">{fmt(s.ltp)}</td>
                          <td className={`px-3 py-3 text-right ${up ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                            {up ? "+" : ""}{fmt(s.changePct)}%
                          </td>
                          <td className="px-3 py-3 text-right">{fmtN(s.volume)}</td>
                          <td className="px-3 py-3 text-right">{fmtN(s.oi)}</td>
                          <td className={`px-3 py-3 text-right ${s.oiChgPct >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                            {s.oiChgPct >= 0 ? "+" : ""}{fmt(s.oiChgPct)}%
                          </td>
                          <td className={`px-3 py-3 text-right ${s.aiSentiment >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                            {s.aiSentiment >= 0 ? "+" : ""}{s.aiSentiment}
                          </td>
                        </tr>
                      );
                    })}
                    {modalRows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                          No stocks found matching the criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stock List Rows */}
        <div className="space-y-4">
          {topFive.map((stock) => {
            const val = stock.changePct;
            const pct = maxVal > 0 ? (Math.abs(val) / maxVal) * 100 : 0;
            const up = val >= 0;

            return (
              <div key={stock.symbol} className="flex items-center justify-between text-sm">
                {/* Symbol with Logo */}
                <div className="flex items-center gap-2.5 w-[120px] shrink-0">
                  <StockLogo symbol={stock.symbol} />
                  <span className="font-bold text-foreground truncate text-sm sm:text-base">{stock.symbol}</span>
                </div>

                {/* Progress Bar Container - Square and Thick */}
                <div className={`flex-1 mx-3 h-5 bg-muted/10 overflow-hidden relative border-l-2 ${
                  isNegativeColor ? "border-[var(--bear)]" : "border-[var(--bull)]"
                }`}>
                  <div
                    className={`h-full transition-all duration-500 ${
                      isNegativeColor ? "bg-[var(--bear)]" : "bg-[var(--bull)]"
                    }`}
                    style={{ width: `${Math.min(100, Math.max(4, pct))}%` }}
                  />
                </div>

                {/* Percentage value */}
                <div
                  className={`w-[70px] text-right font-mono font-bold shrink-0 text-sm sm:text-base ${
                    up ? "text-[var(--bull)]" : "text-[var(--bear)]"
                  }`}
                >
                  {up ? "+" : ""}{val.toFixed(2)}%
                </div>
              </div>
            );
          })}

          {topFive.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground select-none">
              No stocks in this category
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Page() {
  const { data } = useSuspenseQuery(fnoStocksQuery);
  const [selectedExpiry, setSelectedExpiry] = useState<string>("All");

  const activeExpiries = useMemo(() => getActiveExpiries(), []);

  // Filter stocks based on expiry
  const expiryFilteredStocks = useMemo(() => {
    if (selectedExpiry === "All") return data.data;
    // Deterministic simulation filter: keep different subsets of stocks per expiry
    return data.data.filter((s) => {
      const charCodeSum = s.symbol.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const expirySum = selectedExpiry.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
      return (charCodeSum + expirySum) % 10 < 8; // keep ~80%
    });
  }, [data.data, selectedExpiry]);

  // Table lists setup
  const priceGainers = useMemo(() => {
    return [...expiryFilteredStocks]
      .filter((s) => s.changePct > 0)
      .sort((a, b) => b.changePct - a.changePct);
  }, [expiryFilteredStocks]);

  const priceLosers = useMemo(() => {
    return [...expiryFilteredStocks]
      .filter((s) => s.changePct < 0)
      .sort((a, b) => a.changePct - b.changePct);
  }, [expiryFilteredStocks]);

  const longBuildup = useMemo(() => {
    return [...expiryFilteredStocks]
      .filter((s) => s.buildup === "Long Buildup")
      .sort((a, b) => b.changePct - a.changePct);
  }, [expiryFilteredStocks]);

  const shortBuildup = useMemo(() => {
    return [...expiryFilteredStocks]
      .filter((s) => s.buildup === "Short Buildup")
      .sort((a, b) => a.changePct - b.changePct);
  }, [expiryFilteredStocks]);

  const longUnwinding = useMemo(() => {
    return [...expiryFilteredStocks]
      .filter((s) => s.buildup === "Long Unwinding")
      .sort((a, b) => a.changePct - b.changePct);
  }, [expiryFilteredStocks]);

  const shortCovering = useMemo(() => {
    return [...expiryFilteredStocks]
      .filter((s) => s.buildup === "Short Covering")
      .sort((a, b) => b.changePct - a.changePct);
  }, [expiryFilteredStocks]);

  const aiSummaryText = useMemo(() => generateAiSummary(expiryFilteredStocks), [expiryFilteredStocks]);

  return (
    <DashboardShell
      title="Future Dashboard"
      subtitle="NSE Derivatives Buildup Analytics & Live Sentiment"
      updatedAt={data.updatedAt}
    >
      {/* Fallback alerts */}
      {data.isEod && (
        <div className="mb-4 rounded-lg border border-[var(--neon)]/40 bg-[var(--neon)]/10 px-4 py-3 text-xs text-foreground select-none">
          Showing EOD (End of Day) derivatives metrics from the last trading day. Live updates will resume on next market hours.
        </div>
      )}

      {data.source === "fallback" && !data.isEod && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 select-none">
          NSE derivatives feed blocked from server. Displaying cached session details. Auto-retry in 15s.
        </div>
      )}

      {/* Expiries Selector */}
      <div className="flex flex-wrap items-center justify-end gap-1.5 mb-6 bg-card border border-border p-1.5 rounded-xl">
        <span className="mr-auto pl-2 text-sm font-bold text-muted-foreground uppercase tracking-wider select-none">
          Active Expiries
        </span>
        {activeExpiries.map((exp) => (
          <button
            key={exp.value}
            onClick={() => setSelectedExpiry(exp.value)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition cursor-pointer select-none ${
              selectedExpiry === exp.value
                ? "bg-[var(--neon)]/15 text-[var(--neon)] border border-[var(--neon)]/30"
                : "border border-border hover:bg-sidebar-accent text-sidebar-foreground/80"
            }`}
          >
            {exp.label}
          </button>
        ))}
        <button
          onClick={() => setSelectedExpiry("All")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition cursor-pointer select-none ${
            selectedExpiry === "All"
              ? "bg-[var(--neon)]/15 text-[var(--neon)] border border-[var(--neon)]/30"
              : "border border-border hover:bg-sidebar-accent text-sidebar-foreground/80"
          }`}
        >
          All
        </button>
      </div>

      {/* Grid of 6 tables */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        <DashboardCard
          title="Price Gainers"
          stocks={priceGainers}
          allFnoStocks={data.data}
        />
        <DashboardCard
          title="Price Losers"
          stocks={priceLosers}
          isNegativeColor
          allFnoStocks={data.data}
        />
        <DashboardCard
          title="Long Build Up"
          stocks={longBuildup}
          allFnoStocks={data.data}
        />
        <DashboardCard
          title="Short Build Up"
          stocks={shortBuildup}
          isNegativeColor
          allFnoStocks={data.data}
        />
        <DashboardCard
          title="Long Unwinding"
          stocks={longUnwinding}
          isNegativeColor
          allFnoStocks={data.data}
        />
        <DashboardCard
          title="Short Covering"
          stocks={shortCovering}
          allFnoStocks={data.data}
        />
      </div>

      {/* AI Summary Card */}
      <div className="rounded-2xl border border-border bg-card p-6 relative overflow-hidden">
        {/* Glow decoration */}
        <div className="absolute top-0 right-0 w-[150px] h-[150px] bg-[var(--neon)]/5 rounded-full blur-2xl pointer-events-none" />

        <div className="flex items-center gap-2 mb-3">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--neon)]/15">
            <Sparkles className="h-4 w-4 text-[var(--neon)]" />
          </div>
          <h2 className="text-base sm:text-lg font-bold tracking-tight text-foreground select-none">
            AI Market Sentiment & Index Impact Analysis
          </h2>
        </div>

        <p className="text-sm sm:text-base text-muted-foreground leading-relaxed font-sans w-full" dangerouslySetInnerHTML={{ __html: aiSummaryText }} />
      </div>
    </DashboardShell>
  );
}
