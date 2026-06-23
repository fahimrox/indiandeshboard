import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { fmt } from "@/components/MarketBits";
import { fnoScreenerQuery } from "@/lib/dashboard-query";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ScreenerTag, ScreenerRow } from "@/lib/nse.functions";

export const Route = createFileRoute("/screener")({
  head: () => ({
    meta: [
      { title: "F&O Screener — Live NSE Setups | IndexMover" },
      {
        name: "description",
        content:
          "Live NSE F&O screener: long/short buildup, short covering, long unwinding, volume shocker, day/week/month high-low breaks, range breakouts, call/put writing — with sortable filters.",
      },
      { property: "og:title", content: "F&O Screener — Live Setups" },
      { property: "og:url", content: "https://indiandeshboard.lovable.app/screener" },
    ],
    links: [{ rel: "canonical", href: "https://indiandeshboard.lovable.app/screener" }],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(fnoScreenerQuery),
  component: Page,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

const ALL_TAGS: ScreenerTag[] = [
  "Long Buildup",
  "Short Buildup",
  "Short Covering",
  "Long Unwinding",
  "Volume Shocker",
  "Day High Break",
  "Day Low Break",
  "Week High Break",
  "Week Low Break",
  "Month High Break",
  "Month Low Break",
  "Range Breakout",
  "High Call Writing",
  "High Put Writing",
];

const TAG_COLOR: Record<ScreenerTag, string> = {
  "Long Buildup": "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
  "Short Buildup": "bg-rose-500/20 text-rose-200 border-rose-500/40",
  "Short Covering": "bg-emerald-700/20 text-emerald-300 border-emerald-500/30",
  "Long Unwinding": "bg-amber-500/20 text-amber-200 border-amber-500/40",
  "Volume Shocker": "bg-[var(--neon)]/20 text-[var(--neon)] border-[var(--neon)]/40",
  "Day High Break": "bg-sky-500/20 text-sky-200 border-sky-500/40",
  "Day Low Break": "bg-orange-500/20 text-orange-200 border-orange-500/40",
  "Week High Break": "bg-blue-500/20 text-blue-200 border-blue-500/40",
  "Week Low Break": "bg-red-500/20 text-red-200 border-red-500/40",
  "Month High Break": "bg-indigo-500/20 text-indigo-200 border-indigo-500/40",
  "Month Low Break": "bg-rose-700/20 text-rose-200 border-rose-700/40",
  "Range Breakout": "bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-500/40",
  "High Call Writing": "bg-rose-500/15 text-rose-300 border-rose-500/30",
  "High Put Writing": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

function fmtN(n: number) {
  if (!isFinite(n)) return "—";
  if (Math.abs(n) >= 1e7) return (n / 1e7).toFixed(2) + " Cr";
  if (Math.abs(n) >= 1e5) return (n / 1e5).toFixed(2) + " L";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString("en-IN");
}

type SortKey = "symbol" | "ltp" | "changePct" | "volume" | "oi" | "oiChgPct" | "aiSentiment" | "signalTime";
type SortDir = "asc" | "desc";

const COLUMNS: Array<{ key: keyof ScreenerRow | "tags" | "signalTime"; label: string; visible: boolean; sortable?: SortKey }> = [
  { key: "symbol", label: "Symbol", visible: true, sortable: "symbol" },
  { key: "ltp", label: "LTP", visible: true, sortable: "ltp" },
  { key: "changePct", label: "Chg %", visible: true, sortable: "changePct" },
  { key: "volume", label: "Volume", visible: true, sortable: "volume" },
  { key: "oi", label: "OI", visible: true, sortable: "oi" },
  { key: "oiChgPct", label: "OI Chg %", visible: true, sortable: "oiChgPct" },
  { key: "dayHigh", label: "Day H/L", visible: true },
  { key: "monthHigh", label: "52W H/L", visible: true },
  { key: "tags", label: "Setups", visible: true },
  { key: "signalTime", label: "Signal Time", visible: true, sortable: "signalTime" },
  { key: "aiSentiment", label: "AI", visible: true, sortable: "aiSentiment" },
];

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function fmtSignalTime(ts: number | null) {
  return ts ? fmtTime(ts) : "—";
}

function signalDirection(row: ScreenerRow): "up" | "down" | "flat" {
  // Bullish setups → up, bearish → down
  const bull = row.tags.some((t) => t === "Long Buildup" || t === "Short Covering" || t === "Day High Break" || t === "Week High Break" || t === "Month High Break" || t === "High Put Writing");
  const bear = row.tags.some((t) => t === "Short Buildup" || t === "Long Unwinding" || t === "Day Low Break" || t === "Week Low Break" || t === "Month Low Break" || t === "High Call Writing");
  if (bull && !bear) return "up";
  if (bear && !bull) return "down";
  if (row.aiSentiment > 5) return "up";
  if (row.aiSentiment < -5) return "down";
  return "flat";
}

function Page() {
  const { data } = useSuspenseQuery(fnoScreenerQuery);
  const [active, setActive] = useState<Set<ScreenerTag>>(new Set());
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("changePct");
  const [dir, setDir] = useState<SortDir>("desc");
  const [colVis, setColVis] = useState(() => Object.fromEntries(COLUMNS.map((c) => [c.key as string, true])));

  const toggleTag = (t: ScreenerTag) =>
    setActive((prev) => {
      const n = new Set(prev);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });

  const onSort = (k: SortKey) => {
    if (k === sortKey) setDir(dir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setDir(k === "symbol" ? "asc" : "desc"); }
  };

  const rows = useMemo(() => {
    const filtered = data.data
      .filter((s) => s.symbol.toLowerCase().includes(search.toLowerCase()))
      .filter((s) => active.size === 0 || [...active].every((t) => s.tags.includes(t)));
    const sorted = [...filtered].sort((a, b) => {
      const get = (r: ScreenerRow) => (sortKey === "signalTime" ? (r.signalTime ?? 0) : (r as unknown as Record<string, number | string>)[sortKey]);
      const av = get(a);
      const bv = get(b);
      if (typeof av === "string" && typeof bv === "string") return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return dir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return sorted;
  }, [data.data, data.updatedAt, search, active, sortKey, dir]);

  const tagCounts = useMemo(() => {
    const map = new Map<ScreenerTag, number>();
    for (const r of data.data) for (const t of r.tags) map.set(t, (map.get(t) ?? 0) + 1);
    return map;
  }, [data.data]);

  return (
    <DashboardShell title="F&O Screener" subtitle="Live NSE F&O setups — buildup, breakouts, writing" updatedAt={data.updatedAt}>
      {data.isEod && (
        <div className="mb-4 rounded-lg border border-[var(--neon)]/40 bg-[var(--neon)]/10 px-4 py-3 text-xs text-foreground">
          Showing EOD (End of Day) data from the last trading day. Live updates will resume during next market hours.
        </div>
      )}

      {data.source === "fallback" && !data.isEod && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          Upstream blocked — using deterministic fallback. Live data resumes when feed responds.
        </div>
      )}

      {/* Tag filter chips */}
      <div className="mb-4 flex flex-wrap gap-2">
        {ALL_TAGS.map((t) => {
          const on = active.has(t);
          const c = tagCounts.get(t) ?? 0;
          return (
            <button
              key={t}
              onClick={() => toggleTag(t)}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                on ? TAG_COLOR[t] + " ring-1 ring-[var(--neon)]/40" : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {t} <span className="ml-1 font-mono opacity-70">{c}</span>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search symbol…"
          aria-label="Search symbol"
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-[var(--neon)]"
        />
        <button
          onClick={() => { setActive(new Set()); setSearch(""); }}
          className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
        >
          Reset filters
        </button>
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
            Columns ▾
          </summary>
          <div className="absolute z-30 mt-2 w-56 rounded-lg border border-border bg-card p-3 text-xs shadow-xl">
            {COLUMNS.map((c) => (
              <label key={c.key as string} className="flex cursor-pointer items-center gap-2 py-1">
                <input
                  type="checkbox"
                  checked={colVis[c.key as string]}
                  onChange={() => setColVis((p) => ({ ...p, [c.key as string]: !p[c.key as string] }))}
                />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </details>
        <div className="ml-auto text-xs text-muted-foreground">{rows.length} stocks • Live refresh 15s</div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border">
              {COLUMNS.filter((c) => colVis[c.key as string]).map((c) => {
                const align = c.key === "symbol" || c.key === "tags" ? "left" : "right";
                const Icon = c.sortable && sortKey === c.sortable ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <th key={c.key as string} className={`px-3 py-3 text-${align}`}>
                    {c.sortable ? (
                      <button onClick={() => onSort(c.sortable!)} className={`inline-flex items-center gap-1 ${sortKey === c.sortable ? "text-[var(--neon)]" : "hover:text-foreground"}`}>
                        <span>{c.label}</span>
                        <Icon className="h-3 w-3" />
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const up = s.changePct >= 0;
              return (
                <tr key={s.symbol} className="border-b border-border/40 hover:bg-background/30">
                  {colVis.symbol && (
                    <td className="px-3 py-2 font-semibold">{s.symbol}</td>
                  )}
                  {colVis.ltp && <td className="px-3 py-2 text-right font-mono">{fmt(s.ltp)}</td>}
                  {colVis.changePct && (
                    <td className={`px-3 py-2 text-right font-mono ${up ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                      {up ? "+" : ""}{fmt(s.changePct)}%
                    </td>
                  )}
                  {colVis.volume && <td className="px-3 py-2 text-right font-mono">{fmtN(s.volume)}</td>}
                  {colVis.oi && <td className="px-3 py-2 text-right font-mono">{fmtN(s.oi)}</td>}
                  {colVis.oiChgPct && (
                    <td className={`px-3 py-2 text-right font-mono ${s.oiChgPct >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                      {s.oiChgPct >= 0 ? "+" : ""}{fmt(s.oiChgPct)}%
                    </td>
                  )}
                  {colVis.dayHigh && (
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      <span className="text-[var(--bull)]">{fmt(s.dayHigh)}</span> / <span className="text-[var(--bear)]">{fmt(s.dayLow)}</span>
                    </td>
                  )}
                  {colVis.monthHigh && (
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      <span className="text-[var(--bull)]">{fmt(s.monthHigh)}</span> / <span className="text-[var(--bear)]">{fmt(s.monthLow)}</span>
                    </td>
                  )}
                  {colVis.tags && (
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {s.tags.map((t) => (
                          <span key={t} className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${TAG_COLOR[t]}`}>
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                  )}
                  {colVis.signalTime && (
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {(() => {
                        const dirS = signalDirection(s);
                        const arrow = dirS === "up" ? "▲" : dirS === "down" ? "▼" : "•";
                        const cls = dirS === "up" ? "text-[var(--bull)]" : dirS === "down" ? "text-[var(--bear)]" : "text-muted-foreground";
                        return (
                          <span className={`inline-flex items-center gap-1 ${cls}`}>
                            <span>{arrow}</span>
                            <span>{fmtSignalTime(s.signalTime)}</span>
                          </span>
                        );
                      })()}
                    </td>
                  )}
                  {colVis.aiSentiment && (
                    <td className="px-3 py-2 text-right">
                      <span className={`font-mono text-xs ${s.aiSentiment >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                        {s.aiSentiment >= 0 ? "+" : ""}{s.aiSentiment}
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-12 text-center text-sm text-muted-foreground">
                  No matches. Adjust filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
