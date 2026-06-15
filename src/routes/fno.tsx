import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { fmt } from "@/components/MarketBits";
import { fnoStocksQuery } from "@/lib/dashboard-query";
import { Flame, TrendingDown, TrendingUp, Activity, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import type { FnoStock } from "@/lib/nse.functions";

export const Route = createFileRoute("/fno")({
  head: () => ({
    meta: [
      { title: "F&O Stocks — Live NSE Buildup | IndexMover" },
      {
        name: "description",
        content:
          "All NSE F&O stocks with LTP, change %, volume, OI, OI change %, buildup classification, volume shocker and AI sentiment. Sortable columns and live updates.",
      },
      { property: "og:title", content: "F&O Stocks — Live NSE Buildup" },
      { property: "og:url", content: "https://indiandeshboard.lovable.app/fno" },
    ],
    links: [{ rel: "canonical", href: "https://indiandeshboard.lovable.app/fno" }],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(fnoStocksQuery),
  component: Page,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

const BUILDUP_STYLES: Record<FnoStock["buildup"], string> = {
  "Long Buildup": "bg-[var(--bull)]/15 text-[var(--bull)]",
  "Short Covering": "bg-emerald-500/15 text-emerald-300",
  "Short Buildup": "bg-[var(--bear)]/15 text-[var(--bear)]",
  "Long Unwinding": "bg-amber-500/15 text-amber-300",
  Neutral: "bg-muted text-muted-foreground",
};

function fmtN(n: number) {
  if (!isFinite(n)) return "—";
  if (Math.abs(n) >= 1e7) return (n / 1e7).toFixed(2) + " Cr";
  if (Math.abs(n) >= 1e5) return (n / 1e5).toFixed(2) + " L";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toLocaleString("en-IN");
}

type SortKey = "symbol" | "ltp" | "changePct" | "volume" | "oi" | "oiChgPct" | "buildup" | "signalTime" | "aiSentiment";
type SortDir = "asc" | "desc";

function fmtSignalTime(ts: number | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

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
    <th className={`px-3 py-3 text-${align}`}>
      <button
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 text-xs uppercase tracking-wider transition hover:text-foreground ${
          active ? "text-[var(--neon)]" : "text-muted-foreground"
        }`}
      >
        <span>{label}</span>
        <Icon className="h-3 w-3" />
      </button>
    </th>
  );
}

function Page() {
  const { data } = useSuspenseQuery(fnoStocksQuery);
  const [filter, setFilter] = useState<FnoStock["buildup"] | "All">("All");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("changePct");
  const [dir, setDir] = useState<SortDir>("desc");

  const onSort = (k: SortKey) => {
    if (k === sortKey) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setDir(k === "symbol" ? "asc" : "desc");
    }
  };

  const rows = useMemo(() => {
    const filtered = data.data
      .filter((s) => filter === "All" || s.buildup === filter)
      .filter((s) => s.symbol.toLowerCase().includes(search.toLowerCase()));
    const sorted = [...filtered].sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (sortKey === "symbol") { av = a.symbol; bv = b.symbol; }
      else if (sortKey === "buildup") { av = BUILDUP_ORDER[a.buildup]; bv = BUILDUP_ORDER[b.buildup]; }
      else if (sortKey === "signalTime") { av = a.signalTime ?? 0; bv = b.signalTime ?? 0; }
      else { av = a[sortKey] as number; bv = b[sortKey] as number; }
      if (typeof av === "string" && typeof bv === "string") {
        return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return dir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return sorted;
  }, [data.data, filter, search, sortKey, dir]);

  const counts = {
    "Long Buildup": data.data.filter((s) => s.buildup === "Long Buildup").length,
    "Short Buildup": data.data.filter((s) => s.buildup === "Short Buildup").length,
    "Short Covering": data.data.filter((s) => s.buildup === "Short Covering").length,
    "Long Unwinding": data.data.filter((s) => s.buildup === "Long Unwinding").length,
  };

  return (
    <DashboardShell title="F&O Stocks" subtitle="All NSE F&O underlyings — buildup & AI sentiment" updatedAt={data.updatedAt}>
      {data.source === "fallback" && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          NSE feed blocked right now. Auto-retry every 15s during market hours.
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        {(Object.keys(counts) as Array<keyof typeof counts>).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(filter === k ? "All" : k)}
            className={`rounded-xl border p-4 text-left transition ${
              filter === k ? "border-[var(--neon)] ring-1 ring-[var(--neon)]/50" : "border-border bg-card hover:border-[var(--neon)]/40"
            }`}
          >
            <div className="text-xs uppercase tracking-widest text-muted-foreground">{k}</div>
            <div className="mt-1 font-mono text-2xl font-bold">{counts[k]}</div>
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search symbol…"
          aria-label="Search F&O symbol"
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-[var(--neon)]"
        />
        <button
          onClick={() => { setFilter("All"); setSearch(""); setSortKey("changePct"); setDir("desc"); }}
          className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
        >
          Reset
        </button>
        <div className="ml-auto text-xs text-muted-foreground">{rows.length} stocks • Sorted by {sortKey} {dir === "asc" ? "↑" : "↓"}</div>
      </div>

      <div className="mt-3 overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border">
              <SortHeader label="Symbol" k="symbol" sortKey={sortKey} dir={dir} align="left" onClick={onSort} />
              <SortHeader label="LTP" k="ltp" sortKey={sortKey} dir={dir} onClick={onSort} />
              <SortHeader label="Change %" k="changePct" sortKey={sortKey} dir={dir} onClick={onSort} />
              <SortHeader label="Volume" k="volume" sortKey={sortKey} dir={dir} onClick={onSort} />
              <SortHeader label="OI" k="oi" sortKey={sortKey} dir={dir} onClick={onSort} />
              <SortHeader label="OI Chg %" k="oiChgPct" sortKey={sortKey} dir={dir} onClick={onSort} />
              <SortHeader label="Buildup" k="buildup" sortKey={sortKey} dir={dir} align="left" onClick={onSort} />
              <SortHeader label="Time" k="signalTime" sortKey={sortKey} dir={dir} onClick={onSort} />
              <SortHeader label="AI Sentiment" k="aiSentiment" sortKey={sortKey} dir={dir} onClick={onSort} />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const up = s.changePct >= 0;
              return (
                <tr key={s.symbol} className="border-b border-border/40 hover:bg-background/30">
                  <td className="px-3 py-2 font-semibold">
                    <div className="flex items-center gap-2">
                      <span>{s.symbol}</span>
                      {s.volumeShocker && (
                        <span className="rounded bg-[var(--neon)]/20 px-1.5 py-0.5 text-[9px] font-bold text-[var(--neon)]">
                          VOL SHOCK
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(s.ltp)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${up ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                    {up ? "+" : ""}{fmt(s.changePct)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{fmtN(s.volume)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtN(s.oi)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${s.oiChgPct >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                    {s.oiChgPct >= 0 ? "+" : ""}{fmt(s.oiChgPct)}%
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ${BUILDUP_STYLES[s.buildup]}`}>
                      {s.buildup === "Long Buildup" && <TrendingUp className="h-3 w-3" />}
                      {s.buildup === "Short Buildup" && <TrendingDown className="h-3 w-3" />}
                      {s.buildup === "Short Covering" && <Flame className="h-3 w-3" />}
                      {s.buildup === "Long Unwinding" && <Activity className="h-3 w-3" />}
                      {s.buildup}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                    {fmtSignalTime(s.signalTime)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-background/60">
                        <div
                          className={s.aiSentiment >= 0 ? "h-full bg-[var(--bull)]" : "h-full bg-[var(--bear)]"}
                          style={{ width: `${Math.min(100, Math.abs(s.aiSentiment))}%` }}
                        />
                      </div>
                      <span className={`font-mono text-xs ${s.aiSentiment >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                        {s.aiSentiment >= 0 ? "+" : ""}{s.aiSentiment}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-sm text-muted-foreground">
                  No F&O stocks loaded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
