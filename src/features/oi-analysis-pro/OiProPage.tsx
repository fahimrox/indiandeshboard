import { useState, useMemo, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { optionChainQuery, cachedOptionChainQuery, quotesQuery } from "@/lib/dashboard-query";
import { useMarketOpen } from "@/hooks/useMarketOpen";
import { TickingNumber } from "@/components/TickingNumber";
import {
  Brain, TrendingUp, TrendingDown, Minus, Activity, Target, Layers, Radio, Clock,
  ShieldCheck, Crosshair, Flame, Info, Zap, Gauge as GaugeIcon, ArrowUpRight, ArrowDownRight,
  Rocket, ShieldHalf, AlertTriangle, Sparkles,
} from "lucide-react";
import {
  analyzeOptionChain, readVix, computeSmartMoney, buildActionPlan, buildLiveSignals,
  CALL, PUT, type Bias, type ProAnalysis, type LiveSignal, type SignalIcon,
} from "./analysis";
import { OiProfileTable, fmtOi } from "./charts";

type Sym = "NIFTY" | "BANKNIFTY" | "SENSEX";
type DataStatus = "LIVE" | "EOD" | "FAIL";

const INDICES: { id: Sym; label: string }[] = [
  { id: "NIFTY", label: "NIFTY 50" },
  { id: "BANKNIFTY", label: "BANK NIFTY" },
  { id: "SENSEX", label: "SENSEX" },
];
const quoteSym: Record<Sym, string> = { NIFTY: "^NSEI", BANKNIFTY: "^NSEBANK", SENSEX: "^BSESN" };
const biasColor: Record<Bias, string> = { BULLISH: "#10b981", BEARISH: "#f43f5e", NEUTRAL: "#f59e0b" };

const toneClass = (t: string) => t === "bullish" ? "text-emerald-400" : t === "bearish" ? "text-rose-400" : "text-amber-400";
const toneDot = (t: string) => t === "bullish" ? "bg-emerald-400" : t === "bearish" ? "bg-rose-400" : "bg-amber-400";

// ─── Sentiment semicircle gauge ───────────────────────────────────────────────
function SentimentGauge({ score, bias }: { score: number; bias: Bias }) {
  const w = 240, r = 100, cx = w / 2, cy = 118, stroke = 18;
  const arcLen = Math.PI * r;
  const frac = Math.min(1, Math.max(0, score / 100));
  const color = biasColor[bias];
  const ang = Math.PI - frac * Math.PI;
  const mx = cx + r * Math.cos(ang);
  const my = cy - r * Math.sin(ang);
  return (
    <div className="relative flex flex-col items-center">
      <svg width={w} height={140}>
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f43f5e" /><stop offset="50%" stopColor="#f59e0b" /><stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="rgba(148,163,184,0.14)" strokeWidth={stroke} strokeLinecap="round" />
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="url(#gaugeGrad)" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${frac * arcLen} ${arcLen}`} style={{ transition: "stroke-dasharray 800ms cubic-bezier(.22,1,.36,1)" }} />
        <circle cx={mx} cy={my} r={9} fill={color} stroke="#0a0a0f" strokeWidth={3} style={{ transition: "cx 800ms, cy 800ms" }} />
        <text x={cx} y={cy - 34} textAnchor="middle" fontSize={40} fontWeight={800} fill={color}>{score}</text>
        <text x={cx} y={cy - 14} textAnchor="middle" fontSize={11} fill="#64748b" fontWeight={700} letterSpacing={1}>/ 100</text>
      </svg>
      <div className="-mt-2 flex w-full justify-between px-1 text-[9px] font-bold uppercase tracking-wider text-slate-600">
        <span className="text-rose-500/70">Bearish</span><span className="text-amber-500/70">Neutral</span><span className="text-emerald-500/70">Bullish</span>
      </div>
    </div>
  );
}

function BiasIcon({ bias, className }: { bias: Bias; className?: string }) {
  if (bias === "BULLISH") return <TrendingUp className={className} />;
  if (bias === "BEARISH") return <TrendingDown className={className} />;
  return <Minus className={className} />;
}

const Card = ({ title, subtitle, icon, children, className = "", right }: {
  title?: string; subtitle?: string; icon?: React.ReactNode; children: React.ReactNode; className?: string; right?: React.ReactNode;
}) => (
  <div className={`rounded-2xl border border-slate-800/80 bg-gradient-to-b from-slate-900/70 to-slate-900/40 p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.02)_inset] ${className}`}>
    {title && (
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-800/60 pb-2.5">
        <div className="flex items-center gap-2 text-slate-200">
          {icon}
          <div>
            <h3 className="text-xs font-extrabold uppercase tracking-widest leading-none">{title}</h3>
            {subtitle && <p className="mt-1 text-[10px] font-medium normal-case tracking-normal text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
    )}
    {children}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
export default function OiProPage() {
  const [symbol, setSymbol] = useState<Sym>("NIFTY");
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [strikeRange, setStrikeRange] = useState("10");
  const [liveExpiries, setLiveExpiries] = useState<string[] | null>(null);

  const marketOpen = useMarketOpen();
  const showEod = !marketOpen;

  const liveQ = useQuery({ ...optionChainQuery(symbol, undefined, selectedExpiry), enabled: !showEod, placeholderData: keepPreviousData });
  const cacheQ = useQuery({ ...cachedOptionChainQuery(symbol, selectedExpiry), enabled: showEod, placeholderData: keepPreviousData });
  const oc = (showEod ? cacheQ.data : liveQ.data) as any;
  const isPending = showEod ? cacheQ.isPending : liveQ.isPending;

  const quoteQ = useQuery({ ...quotesQuery([quoteSym[symbol], "^INDIAVIX"]), placeholderData: keepPreviousData });
  const quotes = quoteQ.data ?? [];
  const quote = quotes.find((q) => q.symbol === quoteSym[symbol]) ?? quotes.find((q) => !q.symbol.includes("VIX"));
  const vixQuote = quotes.find((q) => q.symbol.includes("VIX") || q.symbol === "^INDIAVIX");

  useEffect(() => { if (oc?.expiries?.length) setLiveExpiries(oc.expiries); }, [oc]);
  const expiries = liveExpiries ?? [];
  useEffect(() => { if (expiries.length && !expiries.includes(selectedExpiry)) setSelectedExpiry(expiries[0]); }, [expiries, selectedExpiry]);

  const analysis = useMemo<ProAnalysis>(() => analyzeOptionChain(oc, quote), [oc, quote]);
  const vix = useMemo(() => readVix(vixQuote?.price ?? 0, vixQuote?.changePct ?? 0), [vixQuote]);
  const smart = useMemo(() => computeSmartMoney(analysis), [analysis]);
  const plan = useMemo(() => buildActionPlan(analysis, vix.value), [analysis, vix.value]);
  const signals = useMemo(() => buildLiveSignals(oc, analysis, vix, symbol, oc?.updatedAt), [oc, analysis, vix, symbol]);

  // Volatility score (0-100) from India VIX, falling back to ATM IV.
  const vol = useMemo(() => {
    const clampN = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
    const v = vix.value;
    if (v > 0) {
      const s = Math.round(clampN(((v - 8) / (28 - 8)) * 100, 4, 98));
      return { score: s, label: v < 12 ? "Low volatility" : v < 16 ? "Moderate" : v < 20 ? "Elevated" : "High volatility", tone: (v < 16 ? "neutral" : "bearish") as string };
    }
    const iv = analysis.atmIv;
    if (iv > 0) {
      const s = Math.round(clampN(((iv - 8) / (30 - 8)) * 100, 4, 98));
      return { score: s, label: iv < 14 ? "Low volatility" : iv < 20 ? "Moderate" : "High volatility", tone: (iv < 20 ? "neutral" : "bearish") as string };
    }
    return { score: 0, label: "—", tone: "neutral" as string };
  }, [vix.value, analysis.atmIv]);

  const dataStatus = useMemo<DataStatus>(() => {
    if (!analysis.ok || !oc) return "FAIL";
    const meta = oc._metadata as { source?: string } | undefined;
    const isEodData = oc.isEod === true || meta?.source === "cache";
    if (marketOpen) return isEodData ? "FAIL" : "LIVE";
    return isEodData ? "EOD" : "LIVE";
  }, [analysis.ok, oc, marketOpen]);

  const sortedRows = useMemo(() => (oc?.rows ? [...oc.rows].sort((a: any, b: any) => a.strike - b.strike) : []), [oc]);
  const visibleRows = useMemo(() => {
    if (!sortedRows.length) return [];
    if (strikeRange === "All") return sortedRows;
    const n = parseInt(strikeRange, 10);
    const atmIdx = sortedRows.findIndex((r: any) => r.strike === analysis.atmStrike);
    if (atmIdx < 0) return sortedRows;
    return sortedRows.slice(Math.max(0, atmIdx - n), Math.min(sortedRows.length, atmIdx + n + 1));
  }, [sortedRows, strikeRange, analysis.atmStrike]);

  const spot = quote?.price ?? oc?.spot ?? analysis.spot ?? 0;
  const changePct = quote?.changePct ?? 0;
  const change = quote?.change ?? 0;
  const up = change >= 0;
  const lastUpdated = oc?.updatedAt ? new Date(oc.updatedAt).toLocaleTimeString("en-IN", { hour12: false }) : "--:--:--";
  const latency = oc?._metadata?.latencyMs as number | undefined;
  const bcolor = biasColor[analysis.bias];

  const statusStyle: Record<DataStatus, string> = {
    LIVE: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    EOD: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    FAIL: "border-rose-500/40 bg-rose-500/10 text-rose-400",
  };
  const statusDot: Record<DataStatus, string> = { LIVE: "bg-emerald-400 animate-pulse", EOD: "bg-amber-400", FAIL: "bg-rose-500" };

  return (
    <div className="min-h-screen w-full bg-[#06070a] p-3 text-slate-200 sm:p-4">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">

        {/* ============ CONTROL BAR ============ */}
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/50 p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500/20 to-purple-500/20 ring-1 ring-sky-500/30">
                <Brain className="h-5 w-5 text-sky-400" />
              </div>
              <div>
                <div className="text-sm font-black tracking-tight text-slate-100">AI Option Radar</div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{symbol} · Index OI Intelligence</div>
              </div>
            </div>
            <div className="flex gap-1 rounded-xl bg-slate-800/60 p-1">
              {INDICES.map((ix) => (
                <button key={ix.id} onClick={() => { setSymbol(ix.id); setLiveExpiries(null); setSelectedExpiry(""); }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${symbol === ix.id ? "bg-sky-600 text-white shadow" : "text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"}`}>
                  {ix.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-col">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{symbol} Spot</span>
              <div className="flex items-center gap-1.5">
                <TickingNumber value={spot} className={`text-lg font-black tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`} />
                {up ? <ArrowUpRight className="h-4 w-4 text-emerald-400" /> : <ArrowDownRight className="h-4 w-4 text-rose-400" />}
                <span className={`text-xs font-bold ${up ? "text-emerald-400" : "text-rose-400"}`}>{up ? "+" : ""}{change.toFixed(2)} ({up ? "+" : ""}{changePct.toFixed(2)}%)</span>
              </div>
            </div>
            <select value={selectedExpiry} onChange={(e) => setSelectedExpiry(e.target.value)}
              className="rounded-lg border border-slate-700/60 bg-slate-800/60 px-2.5 py-1.5 text-xs font-bold text-slate-200 outline-none focus:border-sky-500">
              {expiries.length ? expiries.map((e) => <option key={e} value={e}>{e}</option>) : <option>—</option>}
            </select>
            <div className="flex gap-1 rounded-lg bg-slate-800/60 p-1">
              {["10", "15", "20", "All"].map((r) => (
                <button key={r} onClick={() => setStrikeRange(r)}
                  className={`rounded px-2 py-1 text-[11px] font-bold transition ${strikeRange === r ? "bg-slate-600 text-white" : "text-slate-400 hover:text-slate-200"}`}>{r}</button>
              ))}
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-black uppercase tracking-wider ${statusStyle[dataStatus]}`}>
                <span className={`h-2 w-2 rounded-full ${statusDot[dataStatus]}`} /> {dataStatus}
              </span>
              <span className="flex items-center gap-1 text-[9px] font-semibold tabular-nums text-slate-500">
                <Clock className="h-2.5 w-2.5" />{lastUpdated}{latency !== undefined ? ` · ${latency}ms` : ""}
              </span>
            </div>
          </div>
        </div>

        {!analysis.ok ? (
          <div className="flex h-[50vh] flex-col items-center justify-center gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/40 text-center">
            <span className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-sm font-black uppercase tracking-wider text-rose-400">{isPending ? "Loading" : "FAIL"}</span>
            <p className="text-sm text-slate-400">{isPending ? "Fetching option chain\u2026" : marketOpen ? "Live option-chain feed unavailable from all sources." : "No EOD data available for this index/expiry."}</p>
          </div>
        ) : (
          <>
            {/* ============ AI VERDICT HERO ============ */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <Card className="lg:col-span-4">
                <div className="flex items-center gap-2 text-slate-200"><Brain className="h-4 w-4 text-purple-400" /><h3 className="text-xs font-extrabold uppercase tracking-widest">AI Verdict</h3></div>
                <div className="mt-1 flex flex-col items-center">
                  <SentimentGauge score={analysis.score} bias={analysis.bias} />
                  <div className="mt-1 flex items-center gap-2 rounded-full px-4 py-1.5" style={{ background: `${bcolor}1a`, border: `1px solid ${bcolor}55` }}>
                    <BiasIcon bias={analysis.bias} className="h-4 w-4" />
                    <span className="text-lg font-black tracking-wide" style={{ color: bcolor }}>{analysis.bias}</span>
                  </div>
                  <div className="mt-3 flex w-full items-center justify-between rounded-lg bg-slate-800/40 px-3 py-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Confidence</span>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-700/60"><div className="h-full rounded-full" style={{ width: `${analysis.confidence}%`, background: bcolor }} /></div>
                      <span className="text-xs font-black tabular-nums" style={{ color: bcolor }}>{analysis.confidence}%</span>
                    </div>
                  </div>
                </div>
              </Card>
              <Card className="lg:col-span-8" title="Why — Key Drivers" icon={<Crosshair className="h-4 w-4 text-sky-400" />} right={<span className="text-[10px] font-semibold text-slate-500">Ranked by impact</span>}>
                <p className="mb-3 rounded-lg border-l-2 px-3 py-2 text-sm font-semibold leading-snug text-slate-200" style={{ borderColor: bcolor, background: `${bcolor}0f` }}>{analysis.headline}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {analysis.drivers.slice(0, 6).map((d, i) => (
                    <div key={i} className="flex items-start gap-2.5 rounded-lg border border-slate-800/60 bg-slate-800/20 p-2.5">
                      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${toneDot(d.tone)}`} />
                      <div className="min-w-0"><div className={`text-xs font-bold ${toneClass(d.tone)}`}>{d.label}</div><div className="mt-0.5 text-[11px] leading-snug text-slate-400">{d.detail}</div></div>
                    </div>
                  ))}
                </div>
                {/* Volatility score */}
                <div className="mt-2 flex items-center gap-3 rounded-lg border border-slate-800/60 bg-slate-800/20 p-2.5">
                  <Flame className="h-4 w-4 shrink-0 text-orange-400" />
                  <span className="text-xs font-bold text-slate-300">Volatility Score</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-700/60">
                    <div className="h-full rounded-full" style={{ width: `${vol.score}%`, background: "linear-gradient(90deg,#10b981,#f59e0b,#f43f5e)" }} />
                  </div>
                  <span className={`text-xs font-black tabular-nums ${vol.tone === "bearish" ? "text-rose-400" : "text-emerald-400"}`}>{vol.score}</span>
                  <span className="hidden text-[10px] font-semibold text-slate-500 sm:inline">{vol.label}</span>
                </div>
              </Card>
            </div>

            {/* ============ INDIA VIX + EXPECTED MOVE + SESSION ============ */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Card title="India VIX Intelligence" subtitle="volatility regime · premium climate" icon={<Zap className="h-4 w-4 text-orange-400" />}>
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <div className="flex items-end gap-2">
                      <span className="text-4xl font-black tabular-nums" style={{ color: vix.color }}>{vix.value > 0 ? vix.value.toFixed(2) : "—"}</span>
                      {vix.value > 0 && (
                        <span className={`mb-1 text-sm font-bold ${vix.changePct >= 0 ? "text-rose-400" : "text-emerald-400"}`}>
                          {vix.changePct >= 0 ? "+" : ""}{vix.changePct.toFixed(2)}%
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: vix.color }}>Regime: {vix.regime}</div>
                  </div>
                </div>
                <div className="relative mt-3 h-2.5 w-full rounded-full" style={{ background: "linear-gradient(90deg,#10b981,#22c55e,#f59e0b,#f97316,#f43f5e)" }}>
                  {vix.value > 0 && <div className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950 bg-white shadow" style={{ left: `${vix.band}%`, transition: "left 700ms" }} />}
                </div>
                <div className="mt-1 flex justify-between text-[8px] font-bold uppercase tracking-wider text-slate-600"><span>Complacency</span><span>Balanced</span><span>Fear</span></div>
                <div className="mt-3 rounded-lg border-l-2 border-orange-500/50 bg-orange-500/[0.06] px-3 py-2 text-[11px] leading-snug text-slate-300">{vix.note}</div>
              </Card>

              <Card title="Expected Move" subtitle="ATM straddle implied range" icon={<Target className="h-4 w-4 text-sky-400" />}>
                <ExpectedMove spot={spot} high={analysis.expectedHigh} low={analysis.expectedLow} pct={analysis.expectedMovePct} straddle={analysis.atmStraddle} expiry={selectedExpiry} />
              </Card>

              <Card title="Session" subtitle="today's range & levels" icon={<Activity className="h-4 w-4 text-sky-400" />}>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <SessionCell label="Open" value={quote?.open} />
                  <SessionCell label="Prev Close" value={quote?.prevClose} />
                  <SessionCell label="Day High" value={quote?.dayHigh} tone="bull" />
                  <SessionCell label="Day Low" value={quote?.dayLow} tone="bear" />
                </div>
                <DayRangeBar low={quote?.dayLow} high={quote?.dayHigh} spot={spot} />
              </Card>
            </div>

            {/* ============ OI PROFILE (FULL WIDTH) ============ */}
            <Card title="Open Interest Profile" subtitle="live OI · ΔOI · volume · buildup (both sides)" icon={<Layers className="h-4 w-4 text-sky-400" />}
              right={<span className="text-[10px] font-semibold text-slate-500">{selectedExpiry} · ATM {analysis.atmStrike}</span>}>
              <OiProfileTable rows={visibleRows} spot={spot} atmStrike={analysis.atmStrike} maxPain={analysis.maxPain} underlyingUp={up} />
              <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-[10px] font-semibold text-slate-500">
                <Legend c="#10b981" t="Long Buildup" /><Legend c="#8b5cf6" t="Short Buildup" /><Legend c="#f43f5e" t="Short Cover" /><Legend c="#22d3ee" t="Long Unwinding" />
              </div>
            </Card>

            {/* ============ S/R LADDER + OI ACTION ============ */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card title="Support & Resistance (OI Walls)" icon={<ShieldCheck className="h-4 w-4 text-sky-400" />}>
                <div className="space-y-3">
                  <div>
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: CALL }}>Resistance · Call Walls</div>
                    {analysis.resistances.length ? analysis.resistances.map((l, i) => <LevelRow key={l.strike} tag={`R${i + 1}`} level={l} color={CALL} />) : <div className="text-xs text-slate-500">No data</div>}
                  </div>
                  <div className="border-t border-slate-800/60 pt-2">
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: PUT }}>Support · Put Walls</div>
                    {analysis.supports.length ? analysis.supports.map((l, i) => <LevelRow key={l.strike} tag={`S${i + 1}`} level={l} color={PUT} />) : <div className="text-xs text-slate-500">No data</div>}
                  </div>
                  <SpotPositionBar spot={spot} support={analysis.supports[0]?.strike} resistance={analysis.resistances[0]?.strike} />
                </div>
              </Card>
              <Card title="OI Action & Buildup" icon={<Radio className="h-4 w-4 text-sky-400" />}>
                <div className="grid grid-cols-2 gap-2.5">
                  <OiActionTile label="Total Call OI" value={fmtOi(analysis.totalCeOi)} delta={analysis.totalCeOiChg} color={CALL} />
                  <OiActionTile label="Total Put OI" value={fmtOi(analysis.totalPeOi)} delta={analysis.totalPeOiChg} color={PUT} />
                  <OiActionTile label="Top Call Writing" value={analysis.callWriting ? String(analysis.callWriting.strike) : "—"} delta={analysis.callWriting?.oiChg ?? 0} color={CALL} />
                  <OiActionTile label="Top Put Writing" value={analysis.putWriting ? String(analysis.putWriting.strike) : "—"} delta={analysis.putWriting?.oiChg ?? 0} color={PUT} />
                </div>
                <div className="mt-3 border-t border-slate-800/60 pt-3">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Strike Buildup Distribution</div>
                  <BuildupBar b={analysis.buildup} />
                </div>
              </Card>
            </div>

            {/* ============ SMART MONEY FOOTPRINT & RISK MATRIX ============ */}
            <Card title="Smart Money Footprint & Risk Matrix" subtitle="max pain · OI walls · institutional positioning · risk plan" icon={<Crosshair className="h-4 w-4 text-purple-400" />}>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="lg:col-span-1 space-y-2.5">
                  <SmartRow label="Institutional Bias" value={smart.bias} valueClass={toneClass(smart.biasTone)} bold />
                  <SmartRow label="Max Pain Strike" value={String(smart.maxPain)} />
                  <SmartRow label="PE Wall (Support)" value={String(smart.peWall)} valueClass="text-emerald-400" />
                  <SmartRow label="CE Wall (Resistance)" value={String(smart.ceWall)} valueClass="text-rose-400" />
                  <SmartRow label="Gamma / Pin Zone" value={String(smart.gammaZone)} valueClass="text-sky-300" />
                  <div className="rounded-lg border-l-2 border-sky-500/50 bg-sky-500/[0.06] px-3 py-2 text-[11px] leading-snug text-slate-300">{smart.note}</div>
                </div>
                <div className="lg:col-span-2">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">AI Positioning Read</div>
                  <div className="space-y-2">
                    {smart.insights.map((s, i) => (
                      <div key={i} className="flex items-start gap-2 rounded-lg border border-slate-800/60 bg-slate-800/20 p-2.5 text-[11px] leading-snug text-slate-300">
                        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-400" />{s}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-3 rounded-lg bg-slate-800/30 p-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Expected Band</span>
                    <div className="flex flex-1 items-center gap-2 text-xs font-black tabular-nums">
                      <span className="text-emerald-400">{smart.rangeLow}</span>
                      <div className="h-1.5 flex-1 rounded-full" style={{ background: `linear-gradient(90deg,${PUT}88,#64748b55,${CALL}88)` }} />
                      <span className="text-rose-400">{smart.rangeHigh}</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* ============ AI BUYER & SELLER ACTION PLAN ============ */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card title="Option Buyer's Action Plan" subtitle="momentum setups · breakout levels · targets" icon={<Rocket className="h-4 w-4 text-emerald-400" />}
                right={<span className={`rounded px-2 py-0.5 text-[10px] font-black ${toneClass(plan.buyer.biasTone)}`} style={{ background: "rgba(148,163,184,0.1)" }}>{plan.buyer.biasLabel}</span>}>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <PlanBox title="Bullish Breakout" head={`Above ${plan.buyer.bullTrigger}`} tone="bull" lines={[`Target ${plan.buyer.bullTarget}`, `Stop ${plan.buyer.bullStop}`]} />
                  <PlanBox title="Bearish Breakdown" head={`Below ${plan.buyer.bearTrigger}`} tone="bear" lines={[`Target ${plan.buyer.bearTarget}`, `Stop ${plan.buyer.bearStop}`]} />
                </div>
                <div className="mt-2.5 rounded-lg border-l-2 border-sky-500/50 bg-sky-500/[0.06] px-3 py-2 text-[11px] leading-snug text-slate-300">{plan.buyer.note}</div>
              </Card>
              <Card title="Option Seller's Action Plan" subtitle="theta harvest · premium & spreads" icon={<ShieldHalf className="h-4 w-4 text-sky-400" />}
                right={<span className={`rounded px-2 py-0.5 text-[10px] font-black uppercase ${toneClass(plan.seller.tone)}`} style={{ background: "rgba(148,163,184,0.1)" }}>{plan.seller.strategy}</span>}>
                <div className="rounded-lg border border-slate-800/60 bg-slate-800/20 p-3">
                  <div className="text-[10px] font-black uppercase tracking-wider" style={{ color: biasColor[plan.seller.tone === "bullish" ? "BULLISH" : plan.seller.tone === "bearish" ? "BEARISH" : "NEUTRAL"] }}>{plan.seller.strategy}</div>
                  <code className="mt-1.5 block rounded bg-slate-950/60 px-2.5 py-1.5 font-mono text-xs text-sky-300">{plan.seller.legs}</code>
                  <p className="mt-2 text-[11px] leading-snug text-slate-400">{plan.seller.note}</p>
                </div>
              </Card>
            </div>

            {/* ============ AI LIVE COMMENTARY ============ */}
            <LiveCommentary signals={signals} status={dataStatus} />

            {/* ============ AI NARRATIVE ============ */}
            <Card title="AI Market Read" icon={<Brain className="h-4 w-4 text-purple-400" />}>
              <div className="space-y-2.5">{analysis.narrative.map((p, i) => <p key={i} className="text-sm leading-relaxed text-slate-300">{p}</p>)}</div>
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-slate-800/60 bg-slate-800/20 p-2.5 text-[10px] leading-snug text-slate-500">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />Analytical read of live/EOD option-interest structure for {symbol}, for education only — not investment advice. Verify with your own risk framework.
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Building blocks ──────────────────────────────────────────────────────────
const Legend = ({ c, t }: { c: string; t: string }) => (
  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{t}</span>
);

function SessionCell({ label, value, tone }: { label: string; value?: number; tone?: "bull" | "bear" }) {
  return (
    <div className="rounded-lg bg-slate-800/30 p-2">
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-sm font-black tabular-nums ${tone === "bull" ? "text-emerald-400" : tone === "bear" ? "text-rose-400" : "text-slate-200"}`}>
        {value ? value.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
      </div>
    </div>
  );
}

function ExpectedMove({ spot, high, low, pct, straddle, expiry }: { spot: number; high: number; low: number; pct: number; straddle: number; expiry: string }) {
  if (!spot || !straddle) return <div className="py-4 text-center text-xs text-slate-500">Awaiting ATM premium…</div>;
  return (
    <div>
      <div className="text-center">
        <div className="text-3xl font-black tabular-nums text-sky-300">±{pct.toFixed(2)}%</div>
        <div className="text-[10px] font-semibold text-slate-500">implied by expiry {expiry || "—"}</div>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-3 py-2">
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400"><ArrowUpRight className="h-3.5 w-3.5" />Upside</span>
          <span className="text-sm font-black tabular-nums text-emerald-300">{Math.round(high).toLocaleString("en-IN")}</span>
          <span className="text-[10px] font-semibold tabular-nums text-emerald-400/80">+{Math.round(straddle)}</span>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-slate-800/40 px-3 py-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Spot</span>
          <span className="text-sm font-black tabular-nums text-slate-200">{spot.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-3 py-2">
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-rose-400"><ArrowDownRight className="h-3.5 w-3.5" />Downside</span>
          <span className="text-sm font-black tabular-nums text-rose-300">{Math.round(low).toLocaleString("en-IN")}</span>
          <span className="text-[10px] font-semibold tabular-nums text-rose-400/80">-{Math.round(straddle)}</span>
        </div>
      </div>
    </div>
  );
}

function DayRangeBar({ low, high, spot }: { low?: number; high?: number; spot: number }) {
  if (!low || !high || high <= low) return null;
  const pos = Math.min(100, Math.max(0, ((spot - low) / (high - low)) * 100));
  return (
    <div className="mt-3">
      <div className="relative h-2 w-full rounded-full bg-gradient-to-r from-rose-500/40 via-slate-600/40 to-emerald-500/40">
        <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950 bg-sky-400 shadow" style={{ left: `${pos}%`, transition: "left 600ms" }} />
      </div>
      <div className="mt-1 text-center text-[10px] font-semibold text-sky-400">{pos.toFixed(0)}% of day range</div>
    </div>
  );
}

function LevelRow({ tag, level, color }: { tag: string; level: { strike: number; oi: number; oiChg: number; strengthPct: number; distPct: number }; color: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="w-7 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-black" style={{ background: `${color}22`, color }}>{tag}</span>
      <span className="w-16 shrink-0 text-sm font-bold tabular-nums text-slate-200">{level.strike}</span>
      <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-slate-800/60"><div className="h-full rounded-full" style={{ width: `${level.strengthPct}%`, background: color }} /></div>
      <span className="w-16 shrink-0 text-right text-[10px] font-semibold tabular-nums text-slate-400">{fmtOi(level.oi)}</span>
      <span className="w-14 shrink-0 text-right text-[10px] font-semibold tabular-nums text-slate-500">{level.distPct >= 0 ? "+" : ""}{level.distPct.toFixed(1)}%</span>
    </div>
  );
}

function OiActionTile({ label, value, delta, color }: { label: string; value: string; delta: number; color: string }) {
  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-800/20 p-2.5">
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 text-base font-black tabular-nums" style={{ color }}>{value}</div>
      <div className={`text-[10px] font-bold tabular-nums ${delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{delta >= 0 ? "▲ +" : "▼ "}{fmtOi(delta)} ΔOI</div>
    </div>
  );
}

function BuildupBar({ b }: { b: ProAnalysis["buildup"] }) {
  const total = b.longBuildup + b.shortBuildup + b.shortCovering + b.longUnwinding + b.neutral || 1;
  const segs = [
    { k: "Long Buildup", v: b.longBuildup, c: "#10b981" },
    { k: "Short Covering", v: b.shortCovering, c: "#f43f5e" },
    { k: "Short Buildup", v: b.shortBuildup, c: "#8b5cf6" },
    { k: "Long Unwinding", v: b.longUnwinding, c: "#22d3ee" },
    { k: "Neutral", v: b.neutral, c: "#475569" },
  ];
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {segs.map((s) => s.v > 0 && <div key={s.k} style={{ width: `${(s.v / total) * 100}%`, background: s.c }} title={`${s.k}: ${s.v}`} />)}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
        {segs.map((s) => (
          <div key={s.k} className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
            <span className="h-2 w-2 rounded-sm" style={{ background: s.c }} />{s.k}<span className="ml-auto tabular-nums text-slate-300">{s.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SpotPositionBar({ spot, support, resistance }: { spot: number; support?: number; resistance?: number }) {
  if (!support || !resistance || resistance <= support || spot <= 0) return null;
  const pos = Math.min(100, Math.max(0, ((spot - support) / (resistance - support)) * 100));
  return (
    <div className="mt-1 border-t border-slate-800/60 pt-3">
      <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
        <span style={{ color: PUT }}>{support}</span><span>Spot position</span><span style={{ color: CALL }}>{resistance}</span>
      </div>
      <div className="relative h-2 w-full rounded-full" style={{ background: `linear-gradient(90deg, ${PUT}55, #64748b33, ${CALL}55)` }}>
        <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950 bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.6)]" style={{ left: `${pos}%`, transition: "left 600ms" }} />
      </div>
      <div className="mt-1 text-center text-[10px] font-semibold text-sky-400">Spot {spot.toFixed(2)} · {pos.toFixed(0)}% of the S–R range</div>
    </div>
  );
}

function SmartRow({ label, value, valueClass = "text-slate-200", bold }: { label: string; value: string; valueClass?: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800/40 pb-2">
      <span className="text-[11px] font-medium text-slate-400">{label}</span>
      <span className={`tabular-nums ${bold ? "text-sm font-black" : "text-sm font-bold"} ${valueClass}`}>{value}</span>
    </div>
  );
}

function PlanBox({ title, head, tone, lines }: { title: string; head: string; tone: "bull" | "bear"; lines: string[] }) {
  const c = tone === "bull" ? "#10b981" : "#f43f5e";
  return (
    <div className="rounded-lg border p-2.5" style={{ borderColor: `${c}33`, background: `${c}0c` }}>
      <div className="text-[10px] font-black uppercase tracking-wider" style={{ color: c }}>{title}</div>
      <div className="mt-0.5 text-sm font-black text-slate-100">{head}</div>
      <div className="mt-1 space-y-0.5">{lines.map((l, i) => <div key={i} className="text-[11px] font-semibold text-slate-400">{l}</div>)}</div>
    </div>
  );
}

// ─── AI Live Commentary ───────────────────────────────────────────────────────
const signalIconMap: Record<SignalIcon, React.ComponentType<{ className?: string }>> = {
  writing: Layers, surge: Flame, pain: Target, vix: Zap, gamma: Activity, pcr: GaugeIcon, bolt: Zap,
};

function LiveCommentary({ signals, status }: { signals: LiveSignal[]; status: DataStatus }) {
  const [filter, setFilter] = useState<"all" | "BULLISH" | "BEARISH" | "NEUTRAL" | "high">("all");
  const filtered = signals.filter((s) =>
    filter === "all" ? true : filter === "high" ? s.conviction >= 70 : s.bias === filter
  );
  const filters: { k: typeof filter; label: string; dot?: string }[] = [
    { k: "all", label: "All signals" },
    { k: "BULLISH", label: "Bullish", dot: "bg-emerald-400" },
    { k: "BEARISH", label: "Bearish", dot: "bg-rose-400" },
    { k: "NEUTRAL", label: "Neutral", dot: "bg-amber-400" },
    { k: "high", label: "High conviction" },
  ];
  const badge: Record<DataStatus, string> = {
    LIVE: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    EOD: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    FAIL: "border-rose-500/40 bg-rose-500/10 text-rose-400",
  };
  const dot: Record<DataStatus, string> = { LIVE: "bg-emerald-400 animate-pulse", EOD: "bg-amber-400", FAIL: "bg-rose-500" };
  return (
    <Card title="AI Live Commentary" subtitle="real-time option flow · buildup alerts · smart-money & gamma signals" icon={<Sparkles className="h-4 w-4 text-purple-400" />}
      right={<span className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${badge[status]}`}><span className={`h-2 w-2 rounded-full ${dot[status]}`} />{status} · {signals.length}</span>}>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <button key={f.k} onClick={() => setFilter(f.k)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold transition ${filter === f.k ? "bg-slate-700 text-white" : "bg-slate-800/50 text-slate-400 hover:text-slate-200"}`}>
            {f.dot && <span className={`h-2 w-2 rounded-full ${f.dot}`} />}{f.label}
          </button>
        ))}
      </div>
      <div className="space-y-2.5">
        {filtered.length ? filtered.map((s) => <SignalCard key={s.id} s={s} />) : <div className="py-6 text-center text-xs text-slate-500">No signals in this filter.</div>}
      </div>
    </Card>
  );
}

function SignalCard({ s }: { s: LiveSignal }) {
  const Icon = signalIconMap[s.icon] ?? Zap;
  const bc = biasColor[s.bias];
  return (
    <div className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-3" style={{ borderLeft: `3px solid ${bc}` }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${bc}1a`, color: bc }}><Icon className="h-4 w-4" /></div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-100">{s.title}</span>
              <span className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider" style={{ background: `${bc}1a`, color: bc }}>{s.bias}</span>
            </div>
            <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">
              AI Signal <span className="text-slate-600">·</span> <span className="tabular-nums text-sky-400/80">{s.time}</span>
            </span>
          </div>
        </div>
      </div>
      <p className="mt-2 text-[12px] leading-snug text-slate-300">{s.detail}</p>
      {(s.entry || s.target || s.sl) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold">
          {s.entry && <span className="text-sky-300">ENTRY: <span className="text-slate-300">{s.entry}</span></span>}
          {s.target && <span className="text-emerald-400">TARGET: <span className="text-slate-300">{s.target}</span></span>}
          {s.sl && <span className="text-rose-400">SL: <span className="text-slate-300">{s.sl}</span></span>}
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Conviction</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full" style={{ width: `${s.conviction}%`, background: bc }} /></div>
        <span className="text-xs font-black tabular-nums" style={{ color: bc }}>{s.conviction}%</span>
      </div>
      <p className="mt-1.5 flex items-center gap-1 text-[10px] italic text-slate-500"><AlertTriangle className="h-3 w-3" />{s.insight}</p>
    </div>
  );
}
