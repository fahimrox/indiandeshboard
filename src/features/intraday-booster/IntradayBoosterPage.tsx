import { useState, useMemo, useCallback, useRef } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { fmt } from "@/components/MarketBits";
import { useMarketOpen } from "@/hooks/useMarketOpen";
import { intradayBoosterQuery, fnoStocksQuery } from "@/lib/dashboard-query";
import type { BoosterGroup, StripItem } from "@/lib/market.functions";
import { computeBoosterFlows, type FlowStock } from "@/lib/boosterFlow";
import { TrendingUp, TrendingDown, Clock, Zap } from "lucide-react";

const BULL = "#22c55e";
const BEAR = "#f87171";
// Diverging constituent-bar colours (match the reference: vivid green / red)
const BAR_GREEN = "#22c55e";
const BAR_RED = "#ef4444";

// ─── Stock logo (shared pattern) ──────────────────────────────────────────────
function StockAvatar({ symbol, size = 20 }: { symbol: string; size?: number }) {
  const initials = symbol.slice(0, 2);
  const sum = symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const colors = [
    "bg-red-500/15 text-red-400", "bg-blue-500/15 text-blue-400", "bg-green-500/15 text-green-400",
    "bg-yellow-500/15 text-yellow-400", "bg-purple-500/15 text-purple-400", "bg-pink-500/15 text-pink-400",
    "bg-indigo-500/15 text-indigo-400", "bg-teal-500/15 text-teal-400",
  ];
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full text-[8px] font-bold ${colors[sum % colors.length]}`}
      style={{ height: size, width: size }}>
      {initials}
    </div>
  );
}
function StockLogo({ symbol, size = 20 }: { symbol: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <StockAvatar symbol={symbol} size={size} />;
  return (
    <div className="shrink-0 overflow-hidden rounded-full bg-white" style={{ height: size, width: size }}>
      <img
        src={`https://dharunashokkumar.github.io/indian-listed-company-logos/nse/NSE_${symbol}.svg`}
        alt={symbol} className="object-contain" style={{ height: size, width: size }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

// ─── Slim page header ─────────────────────────────────────────────────────────
function SlimHeader({
  view, setView, updatedAt,
}: { view: "all" | "sector"; setView: (v: "all" | "sector") => void; updatedAt: number }) {
  const time = new Date(updatedAt).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  });
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-sky-500/15">
            <Zap className="h-3.5 w-3.5 text-sky-400" />
          </div>
          <span className="text-sm font-bold text-slate-100">Intraday Booster</span>
          <span className="text-[11px] text-muted-foreground">(future)</span>
        </div>
        <div className="flex rounded-md border border-border bg-background/50 p-0.5">
          {(["all", "sector"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                view === v ? "bg-sky-600 text-white" : "text-muted-foreground hover:text-slate-200"
              }`}
            >
              {v === "all" ? "All" : "Sector Only"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1 tabular-nums">
          <Clock className="h-3.5 w-3.5" /> {time}
        </span>
        <div className="h-6 w-6 rounded-full bg-gradient-to-br from-slate-600 to-slate-800 ring-1 ring-border" />
      </div>
    </div>
  );
}

// ─── Market Sentiment slim line ───────────────────────────────────────────────
function MarketSentiment({ bullPct, bearPct }: { bullPct: number; bearPct: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <span className="shrink-0 text-xs font-bold text-slate-200">Market Sentiment</span>
      <div className="flex h-2.5 flex-1 overflow-hidden rounded-full">
        <div style={{ width: `${bullPct}%`, background: BULL, transition: "width 500ms ease" }} />
        <div style={{ width: `${bearPct}%`, background: BEAR, transition: "width 500ms ease" }} />
      </div>
      <span className="shrink-0 text-xs font-bold tabular-nums" style={{ color: BULL }}>{bullPct}%</span>
      <span className="shrink-0 text-[10px] text-muted-foreground">vs</span>
      <span className="shrink-0 text-xs font-bold tabular-nums" style={{ color: BEAR }}>{bearPct}%</span>
    </div>
  );
}

// ─── SECTOR vertical bar chart (SVG) — click a bar to jump to its table ───────
function SectorBarChart({ data, onSelect }: { data: StripItem[]; onSelect?: (key: string) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  if (!data.length) {
    return <div className="py-10 text-center text-xs text-slate-500">Sector data unavailable.</div>;
  }
  const count = data.length;
  const slotW = 44;
  const barW = 28;
  const leftPad = 34;
  const rightPad = 10;
  const plotTop = 14;
  const plotH = 200;
  const plotBottom = plotTop + plotH;
  const labelArea = 74;
  const vbW = leftPad + count * slotW + rightPad;
  const vbH = plotBottom + labelArea;

  const maxV = Math.max(0, ...data.map((d) => d.changePct));
  const minV = Math.min(0, ...data.map((d) => d.changePct));
  const niceMax = Math.max(1, Math.ceil(maxV));
  const niceMin = Math.min(-1, Math.floor(minV));
  const y = (v: number) => plotTop + ((niceMax - v) / (niceMax - niceMin)) * plotH;
  const y0 = y(0);

  const ticks: number[] = [];
  for (let t = niceMax; t >= niceMin; t -= 1) ticks.push(t);

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg viewBox={`0 0 ${vbW} ${vbH}`} width="100%" preserveAspectRatio="xMidYMid meet" onMouseLeave={() => setHover(null)}>
        {/* grid + y labels */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={leftPad} y1={y(t)} x2={vbW - rightPad} y2={y(t)}
              stroke={t === 0 ? "rgba(148,163,184,0.35)" : "rgba(148,163,184,0.10)"} strokeWidth={t === 0 ? 1 : 0.75} />
            <text x={leftPad - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill="#64748b" className="tabular-nums">
              {t.toFixed(1)}
            </text>
          </g>
        ))}
        {/* bars */}
        {data.map((d, i) => {
          const cx = leftPad + i * slotW + slotW / 2;
          const up = d.changePct >= 0;
          const yv = y(d.changePct);
          const barY = up ? yv : y0;
          const barH = Math.max(1, Math.abs(yv - y0));
          const color = up ? BULL : BEAR;
          return (
            <g
              key={d.key + i}
              onClick={() => onSelect?.(d.key)}
              onMouseMove={(e) => {
                const r = wrapRef.current?.getBoundingClientRect();
                if (r) setHover({ i, x: e.clientX - r.left, y: e.clientY - r.top });
              }}
              style={{ cursor: onSelect ? "pointer" : "default" }}
            >
              {/* full-height hit area so the whole column is clickable */}
              <rect x={cx - slotW / 2} y={plotTop} width={slotW} height={plotH + labelArea} fill="transparent" />
              <rect x={cx - barW / 2} y={barY} width={barW} height={barH} rx={2}
                fill={color} style={{ transition: "height 400ms ease, y 400ms ease" }} />
              {/* value label */}
              <text x={cx} y={up ? yv - 4 : yv + 11} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={color} className="tabular-nums">
                {up ? "" : ""}{fmt(d.changePct, 2)}%
              </text>
              {/* x label rotated */}
              <text x={cx} y={plotBottom + 12} fontSize={9} fill="#94a3b8"
                textAnchor="end" transform={`rotate(-45 ${cx} ${plotBottom + 12})`}>
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover && data[hover.i] && (
        <div
          className="pointer-events-none absolute z-30 min-w-[160px] rounded-lg border border-border bg-[#0b0f17] px-3 py-2 shadow-xl"
          style={{
            left: Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 320) - 172),
            top: Math.max(hover.y - 24, 4),
          }}
        >
          <div className="text-sm font-bold text-slate-100">{data[hover.i].label}</div>
          <div className="my-1 h-px bg-border" />
          <div className="flex items-center justify-between gap-4 text-[11px]">
            <span className="text-slate-400">Price:</span>
            <span className="font-mono font-bold tabular-nums text-slate-100">{fmt(data[hover.i].price, 2)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-[11px]">
            <span className="text-slate-400">Change:</span>
            <span className="font-mono font-bold tabular-nums" style={{ color: data[hover.i].changePct >= 0 ? BULL : BEAR }}>
              {data[hover.i].changePct >= 0 ? "+" : ""}{fmt(data[hover.i].changePct, 2)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Index badge (small circle with initials) ─────────────────────────────────
function IndexBadge({ label, up }: { label: string; up: boolean }) {
  const initials = label.replace(/[^A-Z0-9]/gi, "").slice(0, 3).toUpperCase();
  return (
    <div
      className={`flex h-6 shrink-0 items-center justify-center rounded-full px-1.5 text-[9px] font-extrabold ${
        up ? "bg-[var(--bull)]/20 text-[var(--bull)]" : "bg-[var(--bear)]/20 text-[var(--bear)]"
      }`}
      style={{ minWidth: 24 }}
    >
      {initials}
    </div>
  );
}

// ─── Paired index/sector table: gainers (left) ↔ losers (right) ───────────────
// Most-positive stock pairs with the most-negative, row by row. Centre bar shows
// green (gainer) + red (paired loser) on a shared scale. All constituents, no scroll.
function IndexFlowTable({ group, selected }: { group: BoosterGroup; selected?: boolean }) {
  const gainers = group.stocks.filter((s) => s.changePct >= 0).sort((a, b) => b.changePct - a.changePct);
  const losers = group.stocks.filter((s) => s.changePct < 0).sort((a, b) => a.changePct - b.changePct);
  const rowCount = Math.max(gainers.length, losers.length);
  const maxAbs = Math.max(0.25, ...group.stocks.map((s) => Math.abs(s.changePct)));
  const up = group.changePct >= 0;

  return (
    <div
      id={`tbl-${group.key}`}
      className={`scroll-mt-24 overflow-hidden rounded-xl border bg-card transition-shadow ${
        selected ? "border-sky-500 ring-2 ring-sky-500/60" : "border-border"
      }`}
    >
      {/* header: badge + name + (chg%) on left, advances↑ declines↓ centred */}
      <div className="relative flex items-center border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <IndexBadge label={group.name} up={up} />
          <span className="truncate text-sm font-bold text-slate-100">{group.name}</span>
          <span className="shrink-0 font-mono text-xs font-bold tabular-nums" style={{ color: up ? BULL : BEAR }}>
            ({up ? "+" : ""}{fmt(group.changePct, 2)}%)
          </span>
        </div>
        <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-2 font-mono text-xs font-bold tabular-nums">
          <span style={{ color: BULL }}>{gainers.length}↑</span>
          <span style={{ color: BEAR }}>{losers.length}↓</span>
        </div>
      </div>

      {/* paired rows — big tables scroll (dark scrollbar); small ones just fit */}
      <div className="scroll-dark max-h-[440px] overflow-y-auto">
        {Array.from({ length: rowCount }).map((_, i) => {
          const g = gainers[i];
          const l = losers[i];
          const gw = g ? Math.max(3, (g.changePct / maxAbs) * 100) : 0;
          const lw = l ? Math.max(3, (Math.abs(l.changePct) / maxAbs) * 100) : 0;
          return (
            <div key={i} className="flex items-center border-b border-dotted border-border/40 px-3 py-1.5 last:border-b-0">
              {/* gainer labels (left) */}
              <div className="flex w-[150px] shrink-0 items-center gap-1.5">
                {g && (
                  <>
                    <StockLogo symbol={g.symbol} size={22} />
                    <span className="w-[72px] shrink-0 truncate text-[12px] font-bold text-slate-100">{g.symbol}</span>
                    <span className="flex-1 text-right font-mono text-[11px] font-bold tabular-nums" style={{ color: BULL }}>
                      +{fmt(g.changePct, 2)}%
                    </span>
                  </>
                )}
              </div>
              {/* green bar — right-aligned, ends at the centre */}
              <div className="flex h-3 flex-1 items-center justify-end overflow-hidden pl-2">
                {g && <div className="h-full rounded-[1px]" style={{ width: `${gw}%`, background: BAR_GREEN, transition: "width 400ms ease" }} />}
              </div>
              {/* fixed centre gap (straight vertical line down the table) */}
              <div className="w-1.5 shrink-0" />
              {/* red bar — left-aligned, starts at the centre */}
              <div className="flex h-3 flex-1 items-center justify-start overflow-hidden pr-2">
                {l && <div className="h-full rounded-[1px]" style={{ width: `${lw}%`, background: BAR_RED, transition: "width 400ms ease" }} />}
              </div>
              {/* loser labels (right, mirrored) */}
              <div className="flex w-[150px] shrink-0 items-center justify-end gap-1.5">
                {l && (
                  <>
                    <span className="flex-1 text-left font-mono text-[11px] font-bold tabular-nums" style={{ color: BEAR }}>
                      {fmt(l.changePct, 2)}%
                    </span>
                    <span className="w-[72px] shrink-0 truncate text-right text-[12px] font-bold text-slate-100">{l.symbol}</span>
                    <StockLogo symbol={l.symbol} size={22} />
                  </>
                )}
              </div>
            </div>
          );
        })}
        {rowCount === 0 && <div className="px-3 py-4 text-center text-xs text-slate-500">No data</div>}
      </div>
    </div>
  );
}

// ─── Inflow / Outflow flow table ──────────────────────────────────────────────
function fmtTime(ts: number): string {
  if (!ts) return "--:--";
  const d = new Date(ts);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}
function FlowTable({ title, stocks, tone }: { title: string; stocks: FlowStock[]; tone: "in" | "out" }) {
  const color = tone === "in" ? BULL : BEAR;
  const Icon = tone === "in" ? TrendingUp : TrendingDown;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* Header — icon + title only (matches reference) */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5" style={{ background: `${color}10` }}>
        <Icon className="h-4 w-4" style={{ color }} />
        <span className="text-sm font-bold" style={{ color }}>{title}</span>
      </div>
      {/* Exactly 10 rows, no scroll. Newest signal on top; old ones drop off the bottom. */}
      <div>
        {stocks.map((s) => {
          const sUp = s.changePct >= 0;
          const c = sUp ? BULL : BEAR;
          return (
            <div key={s.symbol} className="flex items-center gap-2 border-b border-dotted border-border/40 px-3 py-2 last:border-b-0 hover:bg-background/40">
              <StockLogo symbol={s.symbol} size={24} />
              <span className="flex-1 truncate text-[13px] font-bold text-slate-100" title={`${s.buildup} · OI ${s.oiChgPct >= 0 ? "+" : ""}${fmt(s.oiChgPct, 1)}%`}>
                {s.symbol}
              </span>
              {s.fresh && (
                <span
                  className="shrink-0 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide"
                  style={{ color, background: `${color}22` }}
                  title="Freshly ignited signal"
                >
                  New
                </span>
              )}
              <span className="flex shrink-0 items-center gap-1 rounded-md bg-background/60 px-2 py-1 text-[11px] tabular-nums text-slate-400">
                <Clock className="h-3 w-3" />@ {fmtTime(s.signalTime)}
              </span>
              <span
                className="w-[62px] shrink-0 rounded-md py-1 text-center font-mono text-[12px] font-bold tabular-nums"
                style={{ color: c, background: `${c}1a` }}
              >
                {sUp ? "+" : ""}{fmt(s.changePct, 2)}%
              </span>
            </div>
          );
        })}
        {stocks.length === 0 && <div className="px-3 py-6 text-center text-xs text-slate-500">No momentum stocks right now.</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
export default function IntradayBoosterPage() {
  const { data: booster } = useSuspenseQuery(intradayBoosterQuery);
  const { data: fno } = useSuspenseQuery(fnoStocksQuery);
  const marketOpen = useMarketOpen();
  const [view, setView] = useState<"all" | "sector">("all");

  const stripData = useMemo(() => {
    const rows = view === "sector" ? booster.strip.filter((s) => !s.isIndex) : booster.strip;
    return [...rows].sort((a, b) => b.changePct - a.changePct);
  }, [booster.strip, view]);

  // ── Momentum Ignition Score (early money-flow detector) ──────────────────────
  // Universe: NSE OI-spurt F&O stocks (already a leading feed). We rank by fresh
  // money flow so a stock surfaces AS momentum ignites, not after it has run:
  //   OI thrust (leading) + volume surge (confirmation) + price thrust (trigger),
  //   × buildup quality, + early-ignition bonus (OI/vol firing while price is
  //   still small) + recency (freshly-stamped signals boosted, decays through
  //   the session so faded ones drift down and drop off the 10-row list).
  // Inflow  = bullish money flow (Long Buildup / Short Covering).
  // Outflow = bearish money flow (Short Buildup / Long Unwinding).
  const { inflow, outflow } = useMemo(() => computeBoosterFlows(fno?.data ?? []), [fno]);

  // One table per strip index/sector; sorted by stock count so big tables pair
  // with big (and small with small) in the 2-column grid.
  const groups = useMemo(() => {
    const gs = view === "sector" ? booster.groups.filter((g) => !g.isIndex) : booster.groups;
    return [...gs].sort((a, b) => b.stocks.length - a.stocks.length);
  }, [booster.groups, view]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const scrollToTable = useCallback((key: string) => {
    setSelectedKey(key);
    const el = document.getElementById(`tbl-${key}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <DashboardShell>
      <div className="flex flex-col gap-3">
        {/* Slim header */}
        <SlimHeader view={view} setView={setView} updatedAt={booster.updatedAt} />

        {/* Market sentiment */}
        <MarketSentiment bullPct={booster.breadth.bullPct} bearPct={booster.breadth.bearPct} />

        {/* SECTOR bar chart */}
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-sky-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200">Sector</span>
          </div>
          <SectorBarChart data={stripData} onSelect={scrollToTable} />
        </div>

        {/* Gainers/Inflow + Losers/Outflow */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <FlowTable title="Gainers / Inflow" stocks={inflow} tone="in" />
          <FlowTable title="Losers / Outflow" stocks={outflow} tone="out" />
        </div>

        {fno?.source === "fallback" && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200">
            F&O momentum feed unavailable right now — inflow/outflow will populate once the live feed responds.
          </div>
        )}

        {/* One paired gainers↔losers table per strip index/sector (big beside big) */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {groups.map((g) => (
            <IndexFlowTable key={g.key} group={g} selected={selectedKey === g.key} />
          ))}
        </div>

        {!marketOpen && (
          <div className="pb-2 text-center text-[11px] text-slate-500">
            Market closed — showing latest end-of-day (EOD) data.
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
