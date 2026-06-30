import React, { useMemo } from 'react';
import { OIChainRow } from '../types/oi.types';
import { 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  Layers, 
  DollarSign, 
  Gauge, 
  Percent, 
  Zap, 
  LineChart 
} from 'lucide-react';

interface BottomAnalyticsProps {
  chain: OIChainRow[];
  spotPrice: number;
  pcr: number;
  showLot: boolean;
}

export const BottomAnalytics: React.FC<BottomAnalyticsProps> = React.memo(({
  chain,
  spotPrice,
  pcr,
  showLot
}) => {
  const lotDivider = showLot ? 75 : 1;

  // 1. Calculate Money Flow & Dominance metrics
  const stats = useMemo(() => {
    let totalCE_OI = 0;
    let totalPE_OI = 0;
    let totalCE_Change = 0;
    let totalPE_Change = 0;
    let bullishFlow = 0;
    let bearishFlow = 0;

    chain.forEach(row => {
      totalCE_OI += row.ce.oi;
      totalPE_OI += row.pe.oi;
      totalCE_Change += row.ce.oiChange;
      totalPE_Change += row.pe.oiChange;

      // Premium weighted money flow
      if (row.pe.oiChange > 0) bullishFlow += row.pe.oiChange * row.pe.price;
      if (row.ce.oiChange < 0) bullishFlow += Math.abs(row.ce.oiChange) * row.ce.price; // unwinding is bullish

      if (row.ce.oiChange > 0) bearishFlow += row.ce.oiChange * row.ce.price;
      if (row.pe.oiChange < 0) bearishFlow += Math.abs(row.pe.oiChange) * row.pe.price; // unwinding is bearish
    });

    const totalFlow = bullishFlow + bearishFlow;
    const bullishPercent = totalFlow > 0 ? Math.round((bullishFlow / totalFlow) * 100) : 50;

    // Expected Range based on 1-Standard Deviation Option Implied Volatility (IV)
    // Formula: Range = Spot * IV * Sqrt(DTE / 365)
    // Here we estimate average IV around ATM
    const atmRow = chain.find(r => r.isATM) || chain[Math.floor(chain.length / 2)];
    const avgIV = atmRow ? (atmRow.ce.iv + atmRow.pe.iv) / 2 : 13;
    const impliedMovePercent = (avgIV / 100) * Math.sqrt(2 / 365); // assuming 2 Days to Expiry (DTE)
    const expectedLower = Math.round(spotPrice * (1 - impliedMovePercent));
    const expectedUpper = Math.round(spotPrice * (1 + impliedMovePercent));

    // OI Concentration ratios
    const maxCallOI = Math.max(...chain.map(r => r.ce.oi));
    const maxPutOI = Math.max(...chain.map(r => r.pe.oi));
    const concentrationRatio = parseFloat((maxPutOI / (maxCallOI || 1)).toFixed(2));

    return {
      totalCE_OI,
      totalPE_OI,
      totalCE_Change,
      totalPE_Change,
      bullishPercent,
      expectedLower,
      expectedUpper,
      concentrationRatio,
      avgIV
    };
  }, [chain, spotPrice]);

  return (
    <div className="w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 select-none">
      
      {/* Card 1: Expected Range Card */}
      <div className="bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-4 flex flex-col justify-between">
        <div className="flex items-center justify-between border-b border-zinc-900 pb-2 mb-2">
          <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider flex items-center gap-1.5">
            <LineChart className="w-3.5 h-3.5 text-sky-400" />
            Implied Range (1-SD)
          </span>
          <span className="text-[10px] text-zinc-500 font-medium">DTE: 2d</span>
        </div>
        <div>
          <div className="flex items-baseline gap-2 mt-1">
            <h3 className="text-lg font-extrabold text-zinc-100 tabular-nums">
              ₹{stats.expectedLower} - ₹{stats.expectedUpper}
            </h3>
          </div>
          <p className="text-[10px] text-zinc-500 mt-2 leading-relaxed">
            Market-implied consolidation boundary based on ATM IV of <b className="text-zinc-400 font-semibold">{stats.avgIV.toFixed(1)}%</b>. 68% probability of expiration inside this range.
          </p>
        </div>
      </div>

      {/* Card 2: Smart Money Flow Index */}
      <div className="bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-4 flex flex-col justify-between">
        <div className="flex items-center justify-between border-b border-zinc-900 pb-2 mb-2">
          <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
            Institutional Net Flow
          </span>
          <span className={`text-[10px] font-bold ${stats.bullishPercent >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {stats.bullishPercent}% Bullish
          </span>
        </div>
        <div>
          <div className="h-2 w-full bg-zinc-900 rounded-full overflow-hidden flex mt-2">
            <div 
              style={{ width: `${stats.bullishPercent}%` }} 
              className="bg-emerald-500 h-full transition-all duration-500" 
            />
            <div 
              style={{ width: `${100 - stats.bullishPercent}%` }} 
              className="bg-rose-500 h-full transition-all duration-500" 
            />
          </div>
          <p className="text-[10px] text-zinc-500 mt-3 leading-relaxed">
            Premium-weighted options trading activity tracks net writing positions. Values above 55% indicate aggressive institutional support writing.
          </p>
        </div>
      </div>

      {/* Card 3: Call vs Put Dominance */}
      <div className="bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-4 flex flex-col justify-between">
        <div className="flex items-center justify-between border-b border-zinc-900 pb-2 mb-2">
          <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            OI Concentration Ratio
          </span>
          <span className="text-[10px] text-zinc-500 font-medium">PE / CE Max</span>
        </div>
        <div>
          <div className="flex items-baseline gap-2 mt-1">
            <h3 className={`text-lg font-extrabold tabular-nums ${stats.concentrationRatio >= 1.0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {stats.concentrationRatio}
            </h3>
            <span className="text-xs text-zinc-500 font-semibold">Skew</span>
          </div>
          <p className="text-[10px] text-zinc-500 mt-2 leading-relaxed">
            Ratios above 1.0 signify heavier overall concentration at Put strikes compared to Calls, reinforcing structural floor integrity.
          </p>
        </div>
      </div>

      {/* Card 4: Net Delta OI Accumulation */}
      <div className="bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-4 flex flex-col justify-between">
        <div className="flex items-center justify-between border-b border-zinc-900 pb-2 mb-2">
          <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-amber-400" />
            Net Intraday OI Delta
          </span>
          <span className="text-[10px] text-zinc-500 font-medium">CE vs PE Change</span>
        </div>
        <div>
          <div className="flex justify-between items-center mt-1">
            <div className="flex flex-col">
              <span className="text-[10px] text-zinc-500">Call Change</span>
              <span className="text-xs font-bold text-rose-400 tabular-nums">
                {stats.totalCE_Change >= 0 ? '+' : ''}{Math.round(stats.totalCE_Change / lotDivider).toLocaleString('en-IN')}
              </span>
            </div>
            <div className="h-6 w-[1px] bg-zinc-800" />
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-zinc-500">Put Change</span>
              <span className="text-xs font-bold text-emerald-400 tabular-nums">
                {stats.totalPE_Change >= 0 ? '+' : ''}{Math.round(stats.totalPE_Change / lotDivider).toLocaleString('en-IN')}
              </span>
            </div>
          </div>
          <p className="text-[10px] text-zinc-500 mt-2 leading-relaxed">
            Measures fresh session positions. Rising Put addition vs flat or falling Call additions builds an intraday bullish continuation signal.
          </p>
        </div>
      </div>

    </div>
  );
});

BottomAnalytics.displayName = 'BottomAnalytics';
