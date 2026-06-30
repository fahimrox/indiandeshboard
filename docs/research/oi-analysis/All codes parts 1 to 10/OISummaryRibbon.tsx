import React, { useMemo } from 'react';
import { OISummary } from '../types/oi.types';
import { ArrowUpRight, ArrowDownRight, Activity, TrendingUp, TrendingDown, RefreshCw, Layers } from 'lucide-react';

interface OISummaryRibbonProps {
  summary: OISummary | null;
  isLoading: boolean;
  onRefresh: () => void;
}

export const OISummaryRibbon: React.FC<OISummaryRibbonProps> = React.memo(({ 
  summary, 
  isLoading, 
  onRefresh 
}) => {
  const isPositive = summary ? summary.spotChange >= 0 : true;

  const biasBadgeColor = useMemo(() => {
    if (!summary) return 'bg-zinc-800 text-zinc-400';
    switch (summary.marketBias) {
      case 'Strong Bullish':
        return 'bg-emerald-950/80 border-emerald-500 text-emerald-400';
      case 'Bullish':
        return 'bg-emerald-950/40 border-emerald-600/50 text-emerald-500';
      case 'Strong Bearish':
        return 'bg-rose-950/80 border-rose-500 text-rose-400';
      case 'Bearish':
        return 'bg-rose-950/40 border-rose-600/50 text-rose-500';
      default:
        return 'bg-amber-950/50 border-amber-500/50 text-amber-500';
    }
  }, [summary]);

  if (!summary) {
    return (
      <div className="w-full h-16 bg-zinc-950 border-b border-zinc-800 animate-pulse flex items-center justify-between px-6">
        <div className="h-6 w-48 bg-zinc-800 rounded"></div>
        <div className="h-6 w-96 bg-zinc-800 rounded"></div>
      </div>
    );
  }

  return (
    <div className="w-full bg-[#0a0a0c] border-b border-zinc-800/80 px-4 py-3 flex flex-wrap gap-4 items-center justify-between select-none">
      {/* Symbol & Live Spot */}
      <div className="flex items-center gap-3">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-wider text-zinc-400">NIFTY SPOT</span>
            <span className={`text-base font-bold tabular-nums flex items-center ${isPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
              {summary.spotPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              {isPositive ? <ArrowUpRight className="w-4 h-4 ml-0.5" /> : <ArrowDownRight className="w-4 h-4 ml-0.5" />}
            </span>
          </div>
          <span className={`text-xs tabular-nums font-medium ${isPositive ? 'text-emerald-500/80' : 'text-rose-500/80'}`}>
            {isPositive ? '+' : ''}{summary.spotChange.toFixed(2)} ({isPositive ? '+' : ''}{summary.spotChangePercent}%)
          </span>
        </div>

        <div className="h-8 w-[1px] bg-zinc-800"></div>

        {/* ATM Strike */}
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">ATM Strike</span>
          <span className="text-sm font-bold text-zinc-200 tabular-nums">
            {summary.atmStrike}
          </span>
        </div>
      </div>

      {/* Core Options Metrics */}
      <div className="flex flex-wrap items-center gap-6">
        {/* PCR */}
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 flex items-center gap-1">
            PCR 
            {summary.pcrTrend === 'up' ? (
              <TrendingUp className="w-3 h-3 text-emerald-500" />
            ) : summary.pcrTrend === 'down' ? (
              <TrendingDown className="w-3 h-3 text-rose-500" />
            ) : null}
          </span>
          <span className={`text-sm font-bold tabular-nums ${summary.pcr >= 1 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {summary.pcr}
          </span>
        </div>

        {/* Max Pain */}
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">Max Pain</span>
          <span className="text-sm font-bold text-amber-500 tabular-nums">
            {summary.maxPain}
          </span>
        </div>

        {/* Highest OI Calls/Puts */}
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">Max OI (CE / PE)</span>
          <div className="flex items-center gap-1.5 text-xs font-semibold tabular-nums">
            <span className="text-rose-500">{summary.highestCallOIStrike}</span>
            <span className="text-zinc-600">/</span>
            <span className="text-emerald-500">{summary.highestPutOIStrike}</span>
          </div>
        </div>

        {/* Highest Writing (CE / PE) */}
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">Max Change (CE / PE)</span>
          <div className="flex items-center gap-1.5 text-xs font-semibold tabular-nums">
            <span className="text-rose-500/80">{summary.highestCallWritingStrike}</span>
            <span className="text-zinc-600">/</span>
            <span className="text-emerald-500/80">{summary.highestPutWritingStrike}</span>
          </div>
        </div>
      </div>

      {/* Market Sentiment Badge & AI Summary Inline */}
      <div className="flex items-center gap-4">
        {/* Bias Gauge Summary */}
        <div className={`border px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${biasBadgeColor}`}>
          <Activity className="w-3.5 h-3.5" />
          <span>{summary.marketBias}</span>
          <span className="text-[10px] opacity-80">({summary.confidence} Conf.)</span>
        </div>

        <div className="hidden lg:flex items-center gap-2 max-w-sm bg-zinc-900/40 border border-zinc-800/40 px-3 py-1 rounded">
          <Layers className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <p className="text-[11px] text-zinc-400 line-clamp-1 leading-normal">
            {summary.aiSummary}
          </p>
        </div>

        <div className="h-8 w-[1px] bg-zinc-800"></div>

        {/* Status indicator & manual refetch trigger */}
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400">{summary.dataSource}</span>
            </div>
            <span className="text-[10px] text-zinc-500">Updated: {summary.lastUpdate}</span>
          </div>

          <button 
            onClick={onRefresh}
            disabled={isLoading}
            className="p-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded transition duration-200 text-zinc-400 hover:text-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-500' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  );
});

OISummaryRibbon.displayName = 'OISummaryRibbon';
