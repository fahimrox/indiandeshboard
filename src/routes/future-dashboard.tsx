import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { fmt } from "@/components/MarketBits";
import { fnoStocksQuery } from "@/lib/dashboard-query";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Search,
  RefreshCw,
  AlertTriangle,
  Clock,
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
      { title: "F&O Market Activity — Buildup & OI | Market Dashboard" },
      {
        name: "description",
        content:
          "Available NSE F&O OI-activity symbols: price gainers, price losers and open-interest buildup classification (long buildup, short buildup, long unwinding, short covering) from live NSE OI-spurt data. Not a complete F&O-universe snapshot.",
      },
      { property: "og:title", content: "F&O Market Activity — Buildup & OI" },
      {
        property: "og:url",
        content: "https://indiandeshboard.lovable.app/future-dashboard",
      },
    ],
    links: [
      {
        rel: "canonical",
        href: "https://indiandeshboard.lovable.app/future-dashboard",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(fnoStocksQuery),
  component: Page,
  pendingComponent: PageSkeleton,
  errorComponent: ({ error }) => (
    <DashboardShell title="F&O Market Activity">
      <FailState message={error.message} />
    </DashboardShell>
  ),
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

// ─── Buildup badge styles (real classification only) ───────────────────────────
const BUILDUP_STYLES: Record<FnoStock["buildup"], string> = {
  "Long Buildup": "bg-[var(--bull)]/15 text-[var(--bull)] border-[var(--bull)]/25",
  "Short Covering": "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  "Short Buildup": "bg-[var(--bear)]/15 text-[var(--bear)] border-[var(--bear)]/25",
  "Long Unwinding": "bg-amber-500/15 text-amber-300 border-amber-500/25",
  Neutral: "bg-muted text-muted-foreground border-border",
};

function BuildupBadge({ buildup }: { buildup: FnoStock["buildup"] }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${BUILDUP_STYLES[buildup]}`}
    >
      {buildup}
    </span>
  );
}

// Format large numbers into Indian short scale.
function fmtN(n: number) {
  if (!isFinite(n)) return "—";
  if (Math.abs(n) >= 1e7) return (n / 1e7).toFixed(2) + " Cr";
  if (Math.abs(n) >= 1e5) return (n / 1e5).toFixed(2) + " L";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toLocaleString("en-IN");
}

// Detection time = the timestamp when the RUNNING server first observed this
// symbol's current buildup classification. It is held across subsequent fetches
// and re-stamped only when the buildup transitions within the same server
// session. It resets on server restart and is NOT an exchange event / true
// category-entry time. No fabricated time.
function fmtTime(ts: number | null) {
  if (!ts) return null;
  return new Date(ts).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

const DETECTED_TOOLTIP =
  "Session-observed time: when the server first detected this buildup state. Held until the buildup changes, resets on server restart. Not an exchange event time.";

// Small clock + time chip (renders only when a real detection time exists).
function DetectedTime({ ts, className = "" }: { ts: number | null; className?: string }) {
  const t = fmtTime(ts);
  if (!t) return <span className="text-muted-foreground/60">—</span>;
  return (
    <span
      title={DETECTED_TOOLTIP}
      className={`inline-flex cursor-help items-center gap-1 text-muted-foreground ${className}`}
    >
      <Clock className="h-2.5 w-2.5 shrink-0" />
      <span className="tabular-nums">{t}</span>
    </span>
  );
}

// Stock logo with a neutral, non-derived fallback (no data simulation).
function StockLogo({ symbol }: { symbol: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const logoUrl = `https://dharunashokkumar.github.io/indian-listed-company-logos/nse/NSE_${symbol}.svg`;

  if (imgFailed) {
    return (
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-[10px] font-bold text-muted-foreground">
        {symbol.slice(0, 2)}
      </div>
    );
  }

  return (
    <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white">
      <img
        src={logoUrl}
        alt={symbol}
        className="h-6 w-6 object-contain"
        onError={() => setImgFailed(true)}
      />
    </div>
  );
}

// ─── Table sort header ─────────────────────────────────────────────────────────
type SortKey =
  | "symbol"
  | "ltp"
  | "changePct"
  | "volume"
  | "oi"
  | "oiChgPct"
  | "buildup"
  | "signalTime";
type SortDir = "asc" | "desc";

const BUILDUP_ORDER: Record<FnoStock["buildup"], number> = {
  "Long Buildup": 4,
  "Short Covering": 3,
  Neutral: 2,
  "Long Unwinding": 1,
  "Short Buildup": 0,
};

function SortHeader({
  label,
  k,
  sortKey,
  dir,
  align = "right",
  onClick,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  dir: SortDir;
  align?: "left" | "right";
  onClick: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={`px-3 py-2.5 ${align === "left" ? "text-left" : "text-right"}`}>
      <button
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider transition hover:text-foreground ${
          active ? "text-[var(--neon)]" : "text-muted-foreground"
        }`}
      >
        <span>{label}</span>
        <Icon className="h-3 w-3" />
      </button>
    </th>
  );
}

// ─── Category card with top-5 preview + full-list modal ────────────────────────
function CategoryCard({
  title,
  stocks,
  negative = false,
  isEod = false,
}: {
  title: string;
  stocks: FnoStock[];
  negative?: boolean;
  isEod?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("changePct");
  const [dir, setDir] = useState<SortDir>(negative ? "asc" : "desc");

  const topTen = stocks.slice(0, 10);
  const maxVal = Math.max(0.1, ...topTen.map((s) => Math.abs(s.changePct)));

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
      let av: number | string;
      let bv: number | string;
      if (sortKey === "symbol") {
        av = a.symbol;
        bv = b.symbol;
      } else if (sortKey === "buildup") {
        av = BUILDUP_ORDER[a.buildup];
        bv = BUILDUP_ORDER[b.buildup];
      } else if (sortKey === "signalTime") {
        av = a.signalTime ?? 0;
        bv = b.signalTime ?? 0;
      } else {
        av = a[sortKey] as number;
        bv = b[sortKey] as number;
      }
      if (typeof av === "string" && typeof bv === "string") {
        return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return dir === "asc"
        ? (av as number) - (bv as number)
        : (bv as number) - (av as number);
    });
  }, [stocks, search, sortKey, dir]);

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-sm ${
              negative ? "bg-[var(--bear)]" : "bg-[var(--bull)]"
            }`}
          />
          <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <span className="text-[11px] text-muted-foreground">({stocks.length})</span>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <button
              disabled={stocks.length === 0}
              className="text-[11px] font-semibold text-[var(--neon)] transition hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
            >
              View all
            </button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden border border-border bg-card text-foreground">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-sm ${
                    negative ? "bg-[var(--bear)]" : "bg-[var(--bull)]"
                  }`}
                />
                <DialogTitle className="text-base font-semibold">
                  {title}
                </DialogTitle>
              </div>
            </DialogHeader>

            <div className="my-2 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search symbol..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 border-border bg-background pl-9 text-xs focus:border-[var(--neon)]"
                />
              </div>
              <div className="text-[11px] text-muted-foreground">
                {modalRows.length} symbols
              </div>
            </div>

            <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-border bg-background">
                  <tr>
                    <SortHeader
                      label="Symbol"
                      k="symbol"
                      sortKey={sortKey}
                      dir={dir}
                      align="left"
                      onClick={handleSort}
                    />
                    <SortHeader label="LTP" k="ltp" sortKey={sortKey} dir={dir} onClick={handleSort} />
                    <SortHeader label="Chg %" k="changePct" sortKey={sortKey} dir={dir} onClick={handleSort} />
                    <SortHeader label="Volume" k="volume" sortKey={sortKey} dir={dir} onClick={handleSort} />
                    <SortHeader label="OI" k="oi" sortKey={sortKey} dir={dir} onClick={handleSort} />
                    <SortHeader label="OI Chg %" k="oiChgPct" sortKey={sortKey} dir={dir} onClick={handleSort} />
                    <SortHeader label="Buildup" k="buildup" sortKey={sortKey} dir={dir} onClick={handleSort} />
                    <SortHeader label="Detected" k="signalTime" sortKey={sortKey} dir={dir} onClick={handleSort} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {modalRows.map((s) => {
                    const up = s.changePct >= 0;
                    return (
                      <tr key={s.symbol} className="hover:bg-background/50">
                        <td className="px-3 py-2.5 text-left font-medium text-foreground">
                          <div className="flex items-center gap-2">
                            <StockLogo symbol={s.symbol} />
                            <span>{s.symbol}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmt(s.ltp)}</td>
                        <td
                          className={`px-3 py-2.5 text-right tabular-nums ${
                            up ? "text-[var(--bull)]" : "text-[var(--bear)]"
                          }`}
                        >
                          {up ? "+" : ""}
                          {fmt(s.changePct)}%
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtN(s.volume)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtN(s.oi)}</td>
                        <td
                          className={`px-3 py-2.5 text-right tabular-nums ${
                            s.oiChgPct >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"
                          }`}
                        >
                          {s.oiChgPct >= 0 ? "+" : ""}
                          {fmt(s.oiChgPct)}%
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <BuildupBadge buildup={s.buildup} />
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          {isEod ? (
                            <span className="text-[11px] font-medium text-muted-foreground">
                              EOD
                            </span>
                          ) : (
                            <DetectedTime ts={s.signalTime} className="text-[11px]" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {modalRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-3 py-8 text-center text-muted-foreground"
                      >
                        No symbols found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Top-10 preview */}
      <div className="space-y-2.5">
        {topTen.map((stock) => {
          const val = stock.changePct;
          const pct = maxVal > 0 ? (Math.abs(val) / maxVal) * 100 : 0;
          const up = val >= 0;
          return (
            <div key={stock.symbol} className="flex items-center gap-3 text-xs">
              <div className="flex w-[124px] shrink-0 items-center gap-2">
                <StockLogo symbol={stock.symbol} />
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">
                    {stock.symbol}
                  </div>
                  {isEod ? (
                    <span className="text-[10px] font-medium text-muted-foreground">
                      EOD
                    </span>
                  ) : (
                    <DetectedTime ts={stock.signalTime} className="text-[10px]" />
                  )}
                </div>
              </div>
              <div
                className={`relative h-3.5 flex-1 overflow-hidden border-l-2 bg-muted/10 ${
                  negative ? "border-[var(--bear)]" : "border-[var(--bull)]"
                }`}
              >
                <div
                  className={`h-full transition-all duration-500 ${
                    negative ? "bg-[var(--bear)]" : "bg-[var(--bull)]"
                  }`}
                  style={{ width: `${Math.min(100, Math.max(4, pct))}%` }}
                />
              </div>
              <div
                className={`w-[60px] shrink-0 text-right font-medium tabular-nums ${
                  up ? "text-[var(--bull)]" : "text-[var(--bear)]"
                }`}
              >
                {up ? "+" : ""}
                {val.toFixed(2)}%
              </div>
            </div>
          );
        })}
        {topTen.length === 0 && (
          <div className="py-6 text-center text-xs text-muted-foreground">
            No symbols in this category.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── FAIL state ────────────────────────────────────────────────────────────────
function FailState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--bear)]/40 bg-[var(--bear)]/5 px-6 py-16 text-center">
      <AlertTriangle className="mb-3 h-8 w-8 text-[var(--bear)]" />
      <h2 className="text-base font-semibold text-foreground">
        No F&O activity data available
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        The live NSE derivatives feed is unavailable and no end-of-day snapshot
        could be loaded. No data is shown rather than estimated values.
      </p>
      {message && (
        <p className="mt-2 max-w-md break-words text-xs text-muted-foreground/70">
          {message}
        </p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:border-[var(--neon)]/50"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      )}
    </div>
  );
}

// ─── Loading skeleton ──────────────────────────────────────────────────────────
function PageSkeleton() {
  return (
    <DashboardShell
      title="F&O Market Activity"
      subtitle="NSE F&O — available OI-activity symbols, price & open-interest buildup"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-[420px] animate-pulse rounded-lg border border-border bg-card"
          />
        ))}
      </div>
    </DashboardShell>
  );
}

function Page() {
  const { data, refetch } = useSuspenseQuery(fnoStocksQuery);
  const stocks = data.data;
  const isEod = Boolean(data.isEod);

  const priceGainers = useMemo(
    () =>
      [...stocks].filter((s) => s.changePct > 0).sort((a, b) => b.changePct - a.changePct),
    [stocks]
  );
  const priceLosers = useMemo(
    () =>
      [...stocks].filter((s) => s.changePct < 0).sort((a, b) => a.changePct - b.changePct),
    [stocks]
  );
  const longBuildup = useMemo(
    () =>
      [...stocks]
        .filter((s) => s.buildup === "Long Buildup")
        .sort((a, b) => b.changePct - a.changePct),
    [stocks]
  );
  const shortBuildup = useMemo(
    () =>
      [...stocks]
        .filter((s) => s.buildup === "Short Buildup")
        .sort((a, b) => a.changePct - b.changePct),
    [stocks]
  );
  const longUnwinding = useMemo(
    () =>
      [...stocks]
        .filter((s) => s.buildup === "Long Unwinding")
        .sort((a, b) => a.changePct - b.changePct),
    [stocks]
  );
  const shortCovering = useMemo(
    () =>
      [...stocks]
        .filter((s) => s.buildup === "Short Covering")
        .sort((a, b) => b.changePct - a.changePct),
    [stocks]
  );

  const snapshotDate =
    stocks.length > 0
      ? new Date(data.updatedAt).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : null;

  return (
    <DashboardShell
      title="F&O Market Activity"
      subtitle="NSE F&O — available OI-activity symbols, price & open-interest buildup"
      updatedAt={data.updatedAt}
    >
      {/* Status banners */}
      {isEod && (
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[var(--neon)]/40 bg-[var(--neon)]/10 px-4 py-3 text-xs text-foreground">
          <span className="font-semibold">EOD snapshot</span>
          <span className="text-muted-foreground">
            Last saved end-of-day derivatives activity
            {snapshotDate ? ` · ${snapshotDate} IST` : ""}. Live updates resume
            during market hours.
          </span>
        </div>
      )}

      {data.source === "fallback" && !isEod && stocks.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          Live NSE derivatives feed is temporarily unavailable. Showing the last
          cached session. Auto-retry every 15s during market hours.
        </div>
      )}

      {stocks.length === 0 ? (
        <FailState onRetry={() => refetch()} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CategoryCard title="Price Gainers" stocks={priceGainers} isEod={isEod} />
          <CategoryCard title="Price Losers" stocks={priceLosers} negative isEod={isEod} />
          <CategoryCard title="Long Buildup" stocks={longBuildup} isEod={isEod} />
          <CategoryCard title="Short Buildup" stocks={shortBuildup} negative isEod={isEod} />
          <CategoryCard title="Short Covering" stocks={shortCovering} isEod={isEod} />
          <CategoryCard title="Long Unwinding" stocks={longUnwinding} negative isEod={isEod} />
        </div>
      )}
    </DashboardShell>
  );
}
