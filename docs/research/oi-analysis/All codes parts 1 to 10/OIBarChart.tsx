import React, { useMemo, useState } from 'react';
import { OIChainRow, S_R_Zone } from '../types/oi.types';

interface OIBarChartProps {
  chain: OIChainRow[];
  spotPrice: number;
  maxPain: number;
  srZones: S_R_Zone[];
  showLot: boolean;
  hideChurn: boolean;
}

export const OIBarChart: React.FC<OIBarChartProps> = React.memo(({
  chain,
  spotPrice,
  maxPain,
  srZones,
  showLot,
  hideChurn
}) => {
  const [hoveredStrike, setHoveredStrike] = useState<number | null>(null);
  const [hoverCoords, setHoverCoords] = useState<{ x: number; y: number } | null>(null);

  // Lot size factor (NIFTY standard is 75)
  const lotDivider = showLot ? 75 : 1;

  // Filter out high-churn strikes if enabled
  const processedChain = useMemo(() => {
    if (!hideChurn) return chain;
    return chain.filter(row => {
      const ceChurn = row.ce.volume > 0 && Math.abs(row.ce.oiChange) / row.ce.volume < 0.05;
      const peChurn = row.pe.volume > 0 && Math.abs(row.pe.oiChange) / row.pe.volume < 0.05;
      return !(ceChurn && peChurn);
    });
  }, [chain, hideChurn]);

  // Find max values to scale bars symmetrically
  const maxOIVal = useMemo(() => {
    let maxVal = 100000;
    processedChain.forEach(row => {
      const totalCE = row.ce.oi + Math.max(0, row.ce.oiChange);
      const totalPE = row.pe.oi + Math.max(0, row.pe.oiChange);
      if (totalCE > maxVal) maxVal = totalCE;
      if (totalPE > maxVal) maxVal = totalPE;
    });
    return maxVal;
  }, [processedChain]);

  // Support / Resistance strikes
  const supportStrike = useMemo(() => srZones.find(z => z.type === 'Support')?.strike || 0, [srZones]);
  const resistanceStrike = useMemo(() => srZones.find(z => z.type === 'Resistance')?.strike || 0, [srZones]);

  const handleMouseMove = (e: React.MouseEvent, strike: number) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredStrike(strike);
    setHoverCoords({
      x: e.clientX - rect.left + 15,
      y: e.clientY - rect.top - 20
    });
  };

  const handleMouseLeave = () => {
    setHoveredStrike(null);
    setHoverCoords(null);
  };

  const hoveredRow = useMemo(() => {
    if (hoveredStrike === null) return null;
    return chain.find(r => r.strike === hoveredStrike) || null;
  }, [hoveredStrike, chain]);

  return (
    <div className="w-full bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-5 relative select-none">
      {/* Chart Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-sm bg-[#22c55e]"></div>
          <span className="text-xs font-bold text-zinc-400 mr-4">PUT OI (Support)</span>
          <div className="w-2.5 h-2.5 rounded-sm bg-[#ef4444]"></div>
          <span className="text-xs font-bold text-zinc-400">CALL OI (Resistance)</span>
        </div>

        {/* Dynamic Indicators status */}
        <div className="flex items-center gap-4 text-[11px] text-zinc-500 font-medium">
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            <span>Max Pain: <b className="text-amber-500">{maxPain}</b></span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse"></span>
            <span>Spot: <b className="text-sky-400">{spotPrice}</b></span>
          </div>
        </div>
      </div>

      {/* SVG Pattern Definitions for Hatching / Stripes */}
      <svg className="absolute w-0 h-0">
        <defs>
          <pattern id="hatch-ce-up" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="#ef4444" strokeWidth="2.5" />
            <rect width="8" height="8" fill="#ef4444" fillOpacity="0.15" />
          </pattern>
          <pattern id="hatch-pe-up" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="#22c55e" strokeWidth="2.5" />
            <rect width="8" height="8" fill="#22c55e" fillOpacity="0.15" />
          </pattern>
          <pattern id="hatch-ce-down" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="#b91c1c" strokeWidth="1.5" />
            <rect width="8" height="8" fill="#b91c1c" fillOpacity="0.05" />
          </pattern>
          <pattern id="hatch-pe-down" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="#15803d" strokeWidth="1.5" />
            <rect width="8" height="8" fill="#15803d" fillOpacity="0.05" />
          </pattern>
        </defs>
      </svg>

      {/* Main Chart Body */}
      <div className="relative flex flex-col gap-[7px] w-full min-h-[420px]">
        {processedChain.map((row) => {
          const ceBase = row.ce.oi;
          const ceChange = row.ce.oiChange;
          const peBase = row.pe.oi;
          const peChange = row.pe.oiChange;

          // Normalize values relative to max
          const ceBaseWidth = (Math.max(0, ceBase) / maxOIVal) * 44;
          const ceChangeWidth = (Math.abs(ceChange) / maxOIVal) * 44;

          const peBaseWidth = (Math.max(0, peBase) / maxOIVal) * 44;
          const peChangeWidth = (Math.abs(peChange) / maxOIVal) * 44;

          const isATM = row.isATM;
          const isMaxPain = row.strike === maxPain;
          const isSupport = row.strike === supportStrike;
          const isResistance = row.strike === resistanceStrike;

          return (
            <div 
              key={row.strike}
              className={`group flex items-center h-[28px] relative rounded transition-all duration-150 ${
                isATM ? 'bg-sky-950/20 border-y border-sky-500/20' : 'hover:bg-zinc-900/30'
              }`}
              onMouseMove={(e) => handleMouseMove(e, row.strike)}
              onMouseLeave={handleMouseLeave}
            >
              {/* Put Side (PE - Green) */}
              <div className="flex-1 flex justify-end items-center pr-4 relative h-full">
                {/* Support Band Highlight overlay */}
                {isSupport && (
                  <div className="absolute inset-y-0 left-0 w-1.5 bg-emerald-500 rounded-r-sm"></div>
                )}

                <div className="flex items-center h-[16px] max-w-full justify-end">
                  {/* Hatched Change bar - Positive adds, Negative cuts */}
                  {peChange < 0 && (
                    <div 
                      className="h-full rounded-l-sm transition-all duration-300"
                      style={{ 
                        width: `${peChangeWidth}%`,
                        background: 'url(#hatch-pe-down)'
                      }}
                      title="Unwinding (Negative OI Change)"
                    />
                  )}
                  
                  {/* Solid Base OI bar */}
                  <div 
                    className="h-full bg-emerald-600/85 hover:bg-emerald-500 transition-all duration-300 rounded-sm relative"
                    style={{ width: `${peBaseWidth}%` }}
                  >
                    {/* Inner glowing core for high conviction */}
                    {peBase > maxOIVal * 0.7 && (
                      <div className="absolute inset-y-0 right-0 w-1 bg-emerald-300/40 blur-[1px]"></div>
                    )}
                  </div>

                  {peChange > 0 && (
                    <div 
                      className="h-full rounded-r-sm transition-all duration-300 border-l border-emerald-500/40"
                      style={{ 
                        width: `${peChangeWidth}%`,
                        background: 'url(#hatch-pe-up)'
                      }}
                      title="Fresh Writing (Positive OI Change)"
                    />
                  )}
                </div>
              </div>

              {/* Center Strike Column */}
              <div className="w-[84px] shrink-0 flex items-center justify-center h-full z-10">
                <div className={`px-2 py-0.5 rounded text-[11px] font-bold tracking-wider tabular-nums ${
                  isATM 
                    ? 'bg-sky-500/15 border border-sky-500 text-sky-400 shadow-sm shadow-sky-500/10' 
                    : isMaxPain
                    ? 'bg-amber-500/10 border border-amber-500/40 text-amber-500'
                    : 'bg-zinc-900 border border-zinc-800 text-zinc-300'
                }`}>
                  {row.strike}
                </div>
              </div>

              {/* Call Side (CE - Red) */}
              <div className="flex-1 flex justify-start items-center pl-4 relative h-full">
                {/* Resistance Band Highlight overlay */}
                {isResistance && (
                  <div className="absolute inset-y-0 right-0 w-1.5 bg-rose-500 rounded-l-sm"></div>
                )}

                <div className="flex items-center h-[16px] max-w-full justify-start">
                  {ceChange > 0 && (
                    <div 
                      className="h-full rounded-l-sm transition-all duration-300 border-r border-rose-500/40"
                      style={{ 
                        width: `${ceChangeWidth}%`,
                        background: 'url(#hatch-ce-up)'
                      }}
                      title="Fresh Writing (Positive OI Change)"
                    />
                  )}

                  {/* Solid Base OI bar */}
                  <div 
                    className="h-full bg-rose-600/85 hover:bg-rose-500 transition-all duration-300 rounded-sm relative"
                    style={{ width: `${ceBaseWidth}%` }}
                  >
                    {/* Inner glowing core for high conviction */}
                    {ceBase > maxOIVal * 0.7 && (
                      <div className="absolute inset-y-0 left-0 w-1 bg-rose-300/40 blur-[1px]"></div>
                    )}
                  </div>

                  {ceChange < 0 && (
                    <div 
                      className="h-full rounded-r-sm transition-all duration-300"
                      style={{ 
                        width: `${ceChangeWidth}%`,
                        background: 'url(#hatch-ce-down)'
                      }}
                      title="Unwinding (Negative OI Change)"
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Spot Price Live Overlay Lines */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0 pointer-events-none z-0">
          <div className="w-full border-b border-dashed border-sky-500/40 relative">
            <div className="absolute left-4 -top-5 px-1.5 py-0.5 bg-sky-950/80 border border-sky-500/40 rounded text-[9px] font-bold text-sky-400 uppercase tracking-wider">
              Spot Zone
            </div>
          </div>
        </div>
      </div>

      {/* Premium Multi-Metric Hover Tooltip */}
      {hoveredRow && hoverCoords && (
        <div 
          className="absolute z-50 bg-[#0e0e12] border border-zinc-700/80 rounded-lg p-3 shadow-xl max-w-sm pointer-events-none"
          style={{ left: `${hoverCoords.x}px`, top: `${hoverCoords.y}px` }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2 mb-2">
            <span className="text-xs font-bold text-zinc-200">Strike: <b className="text-zinc-50 font-extrabold">{hoveredRow.strike}</b></span>
            {hoveredRow.isATM && (
              <span className="text-[9px] uppercase font-extrabold tracking-wider text-sky-400 bg-sky-950 border border-sky-500/40 px-1 rounded">ATM</span>
            )}
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {/* Put Side */}
            <div className="flex flex-col border-r border-zinc-800/50 pr-2">
              <span className="text-[10px] text-emerald-500 font-extrabold uppercase tracking-wider">PUT (PE)</span>
              <span className="text-xs font-bold text-zinc-300 tabular-nums">
                OI: {Math.round(hoveredRow.pe.oi / lotDivider).toLocaleString('en-IN')} {showLot ? 'L' : ''}
              </span>
              <span className={`text-[10px] font-semibold tabular-nums ${hoveredRow.pe.oiChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                Chg: {hoveredRow.pe.oiChange >= 0 ? '+' : ''}{Math.round(hoveredRow.pe.oiChange / lotDivider).toLocaleString('en-IN')}
              </span>
              <span className="text-[10px] text-zinc-500 italic mt-0.5">
                {hoveredRow.pe.buildup}
              </span>
            </div>

            {/* Call Side */}
            <div className="flex flex-col pl-2">
              <span className="text-[10px] text-rose-500 font-extrabold uppercase tracking-wider">CALL (CE)</span>
              <span className="text-xs font-bold text-zinc-300 tabular-nums">
                OI: {Math.round(hoveredRow.ce.oi / lotDivider).toLocaleString('en-IN')} {showLot ? 'L' : ''}
              </span>
              <span className={`text-[10px] font-semibold tabular-nums ${hoveredRow.ce.oiChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                Chg: {hoveredRow.ce.oiChange >= 0 ? '+' : ''}{Math.round(hoveredRow.ce.oiChange / lotDivider).toLocaleString('en-IN')}
              </span>
              <span className="text-[10px] text-zinc-500 italic mt-0.5">
                {hoveredRow.ce.buildup}
              </span>
            </div>
          </div>

          {/* Bottom quick signal indicator */}
          <div className="mt-2 pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[10px] font-medium text-zinc-400">
            <span>PCR at Strike: <b className={`${hoveredRow.pcr >= 1 ? 'text-emerald-400' : 'text-rose-400'}`}>{hoveredRow.pcr}</b></span>
            <span>Flow: <b className={hoveredRow.moneyFlow >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {hoveredRow.moneyFlow >= 0 ? 'In' : 'Out'}
            </b></span>
          </div>
        </div>
      )}
    </div>
  );
});

OIBarChart.displayName = 'OIBarChart';
