// ============================================================
// LIVE F&O SCANNER V2 — src/routes/screener.tsx
// Bloomberg / TradingView / Zerodha style live market radar
// Full Tailwind conversion, DashboardShell, proper virtualization
// ============================================================

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useMemo, useCallback, useRef, memo } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import {
  getLiveScannerData,
  type FnoScanResult,
  type SignalBias,
  type SignalType,
  type SignalFeedItem,
  type LiveStats,
} from "../lib/nse.functions";
import {
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  RefreshCw,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Layers,
  SlidersHorizontal,
  Flame,
  Volume2,
  ChevronDown,
  ChevronUp,
  Star,
  Activity,
  X,
  Zap,
  BarChart3,
} from "lucide-react";

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/screener")({
  component: LiveScanner,
});

// ─── Constants ────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 5000;
const ROW_HEIGHT = 56;
const OVERSCAN = 5;

const SCANNER_OPTIONS = [
  { value: "ALL", label: "All Setups" },
  { value: "VOLUME_SPIKE", label: "Volume Spike (≥3x)" },
  { value: "OI_SPIKE", label: "OI Spike (≥10%)" },
  { value: "LONG_BUILDUP", label: "Long Build-up" },
  { value: "SHORT_BUILDUP", label: "Short Build-up" },
  { value: "SHORT_COVERING", label: "Short Covering" },
  { value: "LONG_UNWINDING", label: "Long Unwinding" },
  { value: "DAY_HIGH_BREAK", label: "Day High Break" },
  { value: "DAY_LOW_BREAK", label: "Day Low Break" },
  { value: "PRICE_OI_BREAKOUT", label: "Price+OI Breakout" },
  { value: "MOMENTUM_EXPANSION", label: "Momentum Expansion" },
  { value: "UNUSUAL_ACTIVITY", label: "Unusual Activity" },
];

const SECTOR_OPTIONS = [
  "ALL", "Banking", "IT", "Energy", "Auto", "Pharma", "Metal", "FMCG",
  "Finance", "Infra", "Consumer", "Realty", "Other",
];

const SORT_OPTIONS = [
  { value: "score", label: "AI Score" },
  { value: "change", label: "% Change" },
  { value: "volumeRatio", label: "Volume Ratio" },
  { value: "oiChange", label: "OI Change" },
  { value: "confidence", label: "Confidence" },
  { value: "lastUpdated", label: "Freshness" },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, d = 2) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: d });
}

function compactNum(n: number) {
  if (n >= 1e7) return (n / 1e7).toFixed(2) + "Cr";
  if (n >= 1e5) return (n / 1e5).toFixed(1) + "L";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString("en-IN");
}

function getBiasColor(bias: SignalBias) {
  switch (bias) {
    case "BULLISH": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "BEARISH": return "bg-rose-500/10 text-rose-400 border-rose-500/20";
    case "WATCH": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    default: return "bg-slate-500/10 text-slate-400 border-slate-500/20";
  }
}

function getBiasTextColor(bias: SignalBias) {
  switch (bias) {
    case "BULLISH": return "text-emerald-400";
    case "BEARISH": return "text-rose-400";
    case "WATCH": return "text-amber-400";
    default: return "text-slate-400";
  }
}

function ageLabel(firstSeen: number) {
  const diff = Date.now() - firstSeen;
  if (diff < 10_000) return "NEW";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}

function renderStars(n: number) {
  return Array.from({ length: 5 }, (_, i) => (
    <Star
      key={i}
      className={`w-3 h-3 ${i < n ? "text-amber-400 fill-amber-400" : "text-slate-700"}`}
    />
  ));
}

// ─── Scanner Row (memoized) ───────────────────────────────────────────────────

const ScannerRow = memo(function ScannerRow({
  r,
  isSelected,
  onSelect,
  style,
}: {
  r: FnoScanResult;
  isSelected: boolean;
  onSelect: (r: FnoScanResult) => void;
  style: React.CSSProperties;
}) {
  const age = ageLabel(r.firstSeen);
  const isNew = age === "NEW";

  return (
    <div
      style={style}
      onClick={() => onSelect(r)}
      className={`flex items-center gap-2 px-3 border-b border-slate-800/50 cursor-pointer transition-colors hover:bg-slate-800/50 ${
        isSelected ? "bg-indigo-900/30 border-l-2 border-l-indigo-400" : ""
      } ${isNew ? "animate-pulse" : ""}`}
    >
      {/* Symbol + Sector */}
      <div className="w-32 min-w-[8rem] shrink-0">
        <div className="font-semibold text-sm text-white truncate">{r.symbol}</div>
        <div className="text-[10px] text-slate-500 flex items-center gap-1">
          <span className={r.marketCap === "LARGE" ? "text-blue-400" : r.marketCap === "MID" ? "text-cyan-400" : "text-gray-400"}>
            {r.marketCap}
          </span>
          <span>·</span>
          <span>{r.sector}</span>
        </div>
      </div>

      {/* LTP + Change */}
      <div className="w-24 min-w-[6rem] text-right shrink-0">
        <div className="text-sm font-medium text-white">₹{fmt(r.ltp)}</div>
        <div className={`text-xs font-mono ${r.change >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {r.change >= 0 ? "+" : ""}{r.change}%
        </div>
      </div>

      {/* Volume Ratio */}
      <div className="w-16 min-w-[4rem] text-center shrink-0">
        <div className={`text-xs font-mono ${r.volumeRatio >= 2 ? "text-amber-300 font-bold" : "text-slate-400"}`}>
          {r.volumeRatio}x
        </div>
        <div className="text-[10px] text-slate-600">{compactNum(r.volume)}</div>
      </div>

      {/* OI Change */}
      <div className="w-16 min-w-[4rem] text-center shrink-0">
        <div className={`text-xs font-mono ${r.oiChange >= 5 ? "text-cyan-300" : r.oiChange <= -5 ? "text-orange-300" : "text-slate-400"}`}>
          {r.oiChange >= 0 ? "+" : ""}{r.oiChange}%
        </div>
        <div className="text-[10px] text-slate-600">{compactNum(r.oi)}</div>
      </div>

      {/* Signals (top 2) */}
      <div className="flex-1 min-w-[10rem] flex items-center gap-1">
        {r.signals.map((sig, i) => (
          <span
            key={i}
            className={`px-1.5 py-0.5 text-[10px] rounded border ${getBiasColor(sig.bias)} truncate max-w-[7rem]`}
          >
            {sig.label}
          </span>
        ))}
      </div>

      {/* AI Score */}
      <div className="w-14 min-w-[3.5rem] text-center shrink-0">
        <div className={`text-sm font-bold ${
          r.score >= 80 ? "text-emerald-300" : r.score >= 60 ? "text-cyan-300" : r.score >= 45 ? "text-amber-300" : "text-slate-400"
        }`}>
          {r.score}
        </div>
        <div className="flex justify-center gap-px">{renderStars(r.strength)}</div>
      </div>

      {/* Confidence */}
      <div className="w-14 min-w-[3.5rem] text-center shrink-0">
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              r.confidence >= 80 ? "bg-emerald-500" : r.confidence >= 60 ? "bg-cyan-500" : "bg-slate-600"
            }`}
            style={{ width: `${r.confidence}%` }}
          />
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">{r.confidence}%</div>
      </div>

      {/* Bias Badge */}
      <div className="w-14 min-w-[3.5rem] flex justify-center shrink-0">
        <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${getBiasColor(r.bias)}`}>
          {r.bias}
        </span>
      </div>

      {/* Age */}
      <div className="w-14 min-w-[3.5rem] text-right shrink-0">
        <span suppressHydrationWarning className={`text-[10px] ${isNew ? "text-green-400 font-bold animate-pulse" : "text-slate-500"}`}>
          {age}
        </span>
      </div>
    </div>
  );
}, (prev, next) => {
  return prev.r.symbol === next.r.symbol
    && prev.r.score === next.r.score
    && prev.r.change === next.r.change
    && prev.r.oiChange === next.r.oiChange
    && prev.r.volumeRatio === next.r.volumeRatio
    && prev.isSelected === next.isSelected
    && prev.style?.top === next.style?.top
    && prev.style?.height === next.style?.height
    && prev.style?.transform === next.style?.transform;
});

// ─── Virtualized List ─────────────────────────────────────────────────────────

function VirtualList({
  items,
  selectedSymbol,
  onSelect,
}: {
  items: FnoScanResult[];
  selectedSymbol: string | null;
  onSelect: (r: FnoScanResult) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(500);
  const [scrollTop, setScrollTop] = useState(0);

  // Measure container height with ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const totalHeight = items.length * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(items.length - 1, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);
  const visibleItems = items.slice(startIdx, endIdx + 1);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent"
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        {visibleItems.map((r, i) => (
          <ScannerRow
            key={r.symbol}
            r={r}
            isSelected={r.symbol === selectedSymbol}
            onSelect={onSelect}
            style={{
              position: "absolute",
              top: (startIdx + i) * ROW_HEIGHT,
              left: 0,
              right: 0,
              height: ROW_HEIGHT,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ stats, resultCount }: { stats: LiveStats; resultCount: number }) {
  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-slate-900/60 border-b border-slate-800 text-xs overflow-x-auto">
      <StatChip icon={<Layers className="w-3 h-3" />} label="Scanned" value={String(stats.scanned)} />
      <StatChip icon={<Zap className="w-3 h-3 text-indigo-400" />} label="Matched" value={String(resultCount)} color="text-indigo-300" />
      <StatChip icon={<TrendingUp className="w-3 h-3 text-emerald-400" />} label="Bullish" value={`${stats.bullishPct}%`} color="text-emerald-400" />
      <StatChip icon={<TrendingDown className="w-3 h-3 text-rose-400" />} label="Bearish" value={`${stats.bearishPct}%`} color="text-rose-400" />
      <StatChip icon={<Sparkles className="w-3 h-3 text-amber-400" />} label="Avg Score" value={String(stats.avgScore)} color="text-amber-300" />
      <StatChip icon={<Flame className="w-3 h-3 text-orange-400" />} label="Fresh" value={String(stats.freshSignals)} color="text-orange-300" />
      <StatChip icon={<Activity className="w-3 h-3 text-cyan-400" />} label="Breadth" value={`${stats.marketBreadth}%`} color={stats.marketBreadth >= 0 ? "text-emerald-300" : "text-rose-300"} />
    </div>
  );
}

function StatChip({ icon, label, value, color = "text-white" }: { icon: React.ReactNode; label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-1 whitespace-nowrap">
      {icon}
      <span className="text-slate-500">{label}:</span>
      <span className={`font-semibold ${color}`}>{value}</span>
    </div>
  );
}

// ─── Live Feed Panel ──────────────────────────────────────────────────────────

function LiveFeed({ feed }: { feed: SignalFeedItem[] }) {
  return (
    <div className="w-64 border-l border-slate-800 bg-slate-900/30 flex flex-col shrink-0">
      <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2">
        <Activity className="w-3.5 h-3.5 text-cyan-400" />
        <span className="text-xs font-semibold text-slate-300">Live Feed</span>
        <span className="ml-auto text-[10px] text-slate-600">{feed.length} events</span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent px-2 py-1">
        {feed.length === 0 ? (
          <div className="text-xs text-slate-600 text-center mt-8">No signal events yet</div>
        ) : (
          feed.map((f, i) => (
            <div key={`${f.symbol}-${f.ts}-${i}`} className="flex items-start gap-2 py-1.5 border-b border-slate-800/30">
              <span className="text-[10px] text-slate-600 w-10 shrink-0">{f.time}</span>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold text-white">{f.symbol}</span>
                <span className={`ml-1 text-[10px] ${getBiasTextColor(f.bias)}`}>{f.label}</span>
              </div>
              <span className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${
                f.bias === "BULLISH" ? "bg-emerald-400" : f.bias === "BEARISH" ? "bg-rose-400" : "bg-amber-400"
              }`} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Details Drawer ───────────────────────────────────────────────────────────

function DetailsDrawer({ r, onClose }: { r: FnoScanResult; onClose: () => void }) {
  return (
    <div className="border-t border-slate-700 bg-slate-900/90 backdrop-blur">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-white">{r.symbol}</span>
          <span className={`text-xs font-mono ${r.change >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            ₹{fmt(r.ltp)} ({r.change >= 0 ? "+" : ""}{r.change}%)
          </span>
          <span className={`px-2 py-0.5 text-[10px] rounded-full font-medium ${getBiasColor(r.bias)}`}>
            {r.bias}
          </span>
          <span className={`px-2 py-0.5 text-[10px] rounded-full border ${
            r.ready === "HIGH_CONVICTION" ? "border-emerald-500 text-emerald-400 bg-emerald-500/10" :
            r.ready === "READY" ? "border-cyan-500 text-cyan-400 bg-cyan-500/10" :
            r.ready === "WATCH" ? "border-amber-500 text-amber-400 bg-amber-500/10" :
            "border-slate-600 text-slate-400 bg-slate-600/10"
          }`}>
            {r.ready}
          </span>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 text-xs">
        {/* Probability Bars */}
        <div className="col-span-2 lg:col-span-1 space-y-2">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Probability</div>
          <ProbBar label="Breakout" pct={r.probability.breakoutSuccess} />
          <ProbBar label="Trend Cont." pct={r.probability.trendContinuation} />
          <ProbBar label="Reversal" pct={r.probability.reversal} color="rose" />
        </div>

        {/* Key Metrics */}
        <div className="space-y-1.5">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Metrics</div>
          <MetricRow label="Volume" value={compactNum(r.volume)} sub={`${r.volumeRatio}x avg`} />
          <MetricRow label="OI" value={compactNum(r.oi)} sub={`${r.oiChange >= 0 ? "+" : ""}${r.oiChange}%`} />
          <MetricRow label="Score" value={String(r.score)} sub={`${r.confidence}% conf`} />
          <MetricRow label="Strength" value={r.strengthBand} />
        </div>

        {/* Money Flow & Trend */}
        <div className="space-y-1.5">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Flow & Trend</div>
          <MetricRow label="Money Flow" value={r.moneyFlow.replace(/_/g, " ")} />
          <MetricRow label="Trend" value={r.trend.replace(/_/g, " ")} />
          <MetricRow label="vs Nifty" value={`${r.relStrengthVsNifty >= 0 ? "+" : ""}${r.relStrengthVsNifty}%`} />
          <MetricRow label="vs Sector" value={`${r.relStrengthVsSector >= 0 ? "+" : ""}${r.relStrengthVsSector}%`} />
        </div>

        {/* Signals & Timeframes */}
        <div className="space-y-1.5">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Signals</div>
          <div className="flex flex-wrap gap-1">
            {r.signals.map((sig, i) => (
              <span key={i} className={`px-1.5 py-0.5 text-[10px] rounded border ${getBiasColor(sig.bias)}`}>
                {sig.label}
              </span>
            ))}
          </div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-2 mb-1">
            Multi-TF
            <span className="ml-1 text-slate-600">(TODO)</span>
          </div>
          <div className="flex gap-1">
            {(["5m", "15m", "1h", "Daily"] as const).map((tf) => (
              <span key={tf} className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 text-slate-600 border border-slate-700">
                {tf}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProbBar({ label, pct, color = "cyan" }: { label: string; pct: number; color?: string }) {
  const cls = color === "rose" ? "bg-rose-500" : pct >= 70 ? "bg-emerald-500" : "bg-cyan-500";
  return (
    <div>
      <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${cls}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function MetricRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-slate-500">{label}</span>
      <div className="text-right">
        <span className="text-white font-medium">{value}</span>
        {sub && <span className="text-slate-600 ml-1">{sub}</span>}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function LiveScanner() {
  // Filters
  const [scanner, setScanner] = useState("ALL");
  const [sector, setSector] = useState("ALL");
  const [marketCap, setMarketCap] = useState("ALL");
  const [search, setSearch] = useState("");
  const [minVolume, setMinVolume] = useState(0);
  const [minOiChange, setMinOiChange] = useState(0);
  const [minScore, setMinScore] = useState(40);
  const [minConfidence, setMinConfidence] = useState(0);
  const [sortBy, setSortBy] = useState<"score" | "change" | "volumeRatio" | "oiChange" | "lastUpdated" | "confidence">("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selected, setSelected] = useState<FnoScanResult | null>(null);

  // Query
  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: [
      "live-scanner",
      scanner, sector, marketCap, search,
      minVolume, minOiChange, minScore, minConfidence,
      sortBy, sortDir,
    ],
    queryFn: () =>
      getLiveScannerData({
        data: {
          scanner, sector, marketCap, search,
          minVolume, minOiChange, minScore, minConfidence,
          sortBy, sortDir,
        },
      }),
    refetchInterval: REFRESH_INTERVAL,
    placeholderData: (prev) => prev,
    staleTime: 4000,
  });

  const results = data?.results ?? [];
  const feed = data?.feed ?? [];
  const stats: LiveStats = data?.stats ?? {
    scanned: 0, bullishPct: 0, bearishPct: 0, avgScore: 0,
    strongBuyCount: 0, strongSellCount: 0, freshSignals: 0, marketBreadth: 0,
  };

  // Reset selected if symbol disappears from results
  useEffect(() => {
    if (selected && !results.find((r) => r.symbol === selected.symbol)) {
      setSelected(null);
    }
  }, [results, selected]);

  const handleSelect = useCallback((r: FnoScanResult) => {
    setSelected((prev) => (prev?.symbol === r.symbol ? null : r));
  }, []);

  const toggleSort = useCallback((col: typeof sortBy) => {
    setSortBy(col);
    setSortDir((d) => (d === "desc" ? "asc" : "desc"));
  }, []);

  return (
    <DashboardShell>
      <div className="flex flex-col h-full bg-slate-950 text-white overflow-hidden">
        {/* Stats Bar */}
        <StatsBar stats={stats} resultCount={results.length} />

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800 bg-slate-900/40 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search symbol..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 pr-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none w-36"
            />
          </div>

          {/* Scanner */}
          <select
            value={scanner}
            onChange={(e) => setScanner(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded text-xs text-white px-2 py-1.5 focus:border-indigo-500 focus:outline-none"
          >
            {SCANNER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {/* Sector */}
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded text-xs text-white px-2 py-1.5 focus:border-indigo-500 focus:outline-none"
          >
            {SECTOR_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === "ALL" ? "All Sectors" : s}</option>
            ))}
          </select>

          {/* Market Cap */}
          <select
            value={marketCap}
            onChange={(e) => setMarketCap(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded text-xs text-white px-2 py-1.5 focus:border-indigo-500 focus:outline-none"
          >
            <option value="ALL">All Caps</option>
            <option value="LARGE">Large</option>
            <option value="MID">Mid</option>
            <option value="SMALL">Small</option>
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="bg-slate-800 border border-slate-700 rounded text-xs text-white px-2 py-1.5 focus:border-indigo-500 focus:outline-none"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <button
            onClick={() => setSortDir((d) => d === "desc" ? "asc" : "desc")}
            className="p-1.5 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 transition-colors"
            title={`Sort ${sortDir === "desc" ? "descending" : "ascending"}`}
          >
            {sortDir === "desc" ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />}
          </button>

          {/* Advanced Toggle */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={`flex items-center gap-1 px-2 py-1.5 rounded border text-xs transition-colors ${
              showAdvanced ? "bg-indigo-900/40 border-indigo-600 text-indigo-300" : "bg-slate-800 border-slate-700 text-slate-400 hover:text-white"
            }`}
          >
            <SlidersHorizontal className="w-3 h-3" />
            Advanced
            {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {/* Refresh indicator */}
          <div className="ml-auto flex items-center gap-2 text-[10px] text-slate-500">
            <RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin text-indigo-400" : ""}`} />
            {dataUpdatedAt > 0 && (
              <span suppressHydrationWarning>{new Date(dataUpdatedAt).toLocaleTimeString("en-IN")}</span>
            )}
          </div>
        </div>

        {/* Advanced Filters Panel */}
        {showAdvanced && (
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/20 flex items-center gap-4 flex-wrap text-xs">
            <label className="flex items-center gap-1 text-slate-400">
              Min Volume:
              <input
                type="number"
                value={minVolume}
                onChange={(e) => setMinVolume(+e.target.value)}
                className="w-14 bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-white text-xs"
                min={0} step={0.5}
              />
              x
            </label>
            <label className="flex items-center gap-1 text-slate-400">
              Min OI Chg:
              <input
                type="number"
                value={minOiChange}
                onChange={(e) => setMinOiChange(+e.target.value)}
                className="w-14 bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-white text-xs"
                min={0} step={1}
              />
              %
            </label>
            <label className="flex items-center gap-1 text-slate-400">
              Min Score:
              <input
                type="range"
                value={minScore}
                onChange={(e) => setMinScore(+e.target.value)}
                className="w-20 accent-indigo-500"
                min={0} max={100} step={5}
              />
              <span className="text-white w-6">{minScore}</span>
            </label>
            <label className="flex items-center gap-1 text-slate-400">
              Min Confidence:
              <input
                type="range"
                value={minConfidence}
                onChange={(e) => setMinConfidence(+e.target.value)}
                className="w-20 accent-indigo-500"
                min={0} max={100} step={5}
              />
              <span className="text-white w-6">{minConfidence}</span>
            </label>
            <button
              onClick={() => { setMinVolume(0); setMinOiChange(0); setMinScore(40); setMinConfidence(0); setSearch(""); setScanner("ALL"); setSector("ALL"); setMarketCap("ALL"); }}
              className="ml-auto px-2 py-1 text-[10px] text-slate-500 hover:text-white border border-slate-700 rounded transition-colors"
            >
              Reset All
            </button>
          </div>
        )}

        {/* Table Header */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-800 bg-slate-900/60 text-[10px] text-slate-500 uppercase tracking-wider">
          <div className="w-32 min-w-[8rem]">Symbol</div>
          <div className="w-24 min-w-[6rem] text-right cursor-pointer hover:text-white" onClick={() => toggleSort("change")}>
            LTP / Chg {sortBy === "change" && (sortDir === "desc" ? "↓" : "↑")}
          </div>
          <div className="w-16 min-w-[4rem] text-center cursor-pointer hover:text-white" onClick={() => toggleSort("volumeRatio")}>
            Vol {sortBy === "volumeRatio" && (sortDir === "desc" ? "↓" : "↑")}
          </div>
          <div className="w-16 min-w-[4rem] text-center cursor-pointer hover:text-white" onClick={() => toggleSort("oiChange")}>
            OI {sortBy === "oiChange" && (sortDir === "desc" ? "↓" : "↑")}
          </div>
          <div className="flex-1 min-w-[10rem]">Signals</div>
          <div className="w-14 min-w-[3.5rem] text-center cursor-pointer hover:text-white" onClick={() => toggleSort("score")}>
            Score {sortBy === "score" && (sortDir === "desc" ? "↓" : "↑")}
          </div>
          <div className="w-14 min-w-[3.5rem] text-center cursor-pointer hover:text-white" onClick={() => toggleSort("confidence")}>
            Conf {sortBy === "confidence" && (sortDir === "desc" ? "↓" : "↑")}
          </div>
          <div className="w-14 min-w-[3.5rem] text-center">Bias</div>
          <div className="w-14 min-w-[3.5rem] text-right cursor-pointer hover:text-white" onClick={() => toggleSort("lastUpdated")}>
            Age {sortBy === "lastUpdated" && (sortDir === "desc" ? "↓" : "↑")}
          </div>
        </div>

        {/* Main Content: Scanner + Live Feed */}
        <div className="flex flex-1 min-h-0">
          {/* Scanner Table */}
          {results.length === 0 && !isLoading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-600">
              <div className="text-center">
                <Sparkles className="w-8 h-8 mx-auto mb-2 text-slate-700" />
                <p>No setups match current filters</p>
                <p className="text-[10px] mt-1">Try lowering the min score or expanding filters</p>
              </div>
            </div>
          ) : (
            <VirtualList
              items={results}
              selectedSymbol={selected?.symbol ?? null}
              onSelect={handleSelect}
            />
          )}

          {/* Live Feed */}
          <LiveFeed feed={feed} />
        </div>

        {/* Details Drawer */}
        {selected && <DetailsDrawer r={selected} onClose={() => setSelected(null)} />}
      </div>
    </DashboardShell>
  );
}
