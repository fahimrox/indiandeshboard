import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/DashboardShell";
import { optionChainQuery, quotesQuery } from "@/lib/dashboard-query";
import { TickingNumber } from "@/components/TickingNumber";
import type { IndexSymbol } from "@/features/oi-analysis/types";
import React from "react";
import { 
  Activity,
  SlidersHorizontal,
  ChevronDown,
  TrendingUp,
  Brain,
  Shield,
  Percent,
  Compass,
  LineChart,
  Grid,
  Clock,
  Database,
  ArrowUpRight,
  ArrowDownRight,
  Play,
  Pause,
  SkipBack
} from "lucide-react";

// Symbol quote mappings
const quoteSymbolMap: Record<IndexSymbol, string> = {
  NIFTY: "^NSEI",
  BANKNIFTY: "^NSEBANK",
  MIDCPNIFTY: "^NSEMIDCAP",
  SENSEX: "^BSESN",
};

// Data source label mappings
const sourceLabelMap: Record<string, string> = {
  nse: "NSE Scraper",
  fallback: "NSE Fallback",
  fyers: "FYERS API v3",
  angelone: "Angel One API",
};

// Formatting helpers
function fmtN(n: number) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  if (Math.abs(n) >= 1e7) return (n / 1e7).toFixed(2) + "Cr";
  if (Math.abs(n) >= 1e5) return (n / 1e5).toFixed(2) + "L";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString("en-IN");
}

// BUILDFILE DETECTOR FOR INSTITUTIONAL WRITING
function detectBuildup(leg: any, isCall: boolean): string {
  if (!leg) return "";
  const sig = leg.signal || "";
  if (sig.includes("Short Buildup")) {
    return isCall ? "CALL WRITING" : "PUT WRITING";
  }
  if (sig.includes("Long Buildup")) {
    return "LONG BUILDUP";
  }
  if (sig.includes("Short Cover")) {
    return "SHORT COVERING";
  }
  if (sig.includes("Long Unwinding")) {
    return "LONG UNWINDING";
  }
  return "";
}

// COMPACT BUILDUP BADGES HELPER
const renderBuildupBadge = (buildup: string) => {
  if (!buildup) return null;
  let label = "";
  let className = "";
  let fullName = "";
  
  if (buildup === "LONG BUILDUP") {
    label = "LB";
    fullName = "Long Build-up";
    className = "bg-emerald-950/60 border border-emerald-500/35 text-emerald-400";
  } else if (buildup === "SHORT BUILDUP" || buildup === "CALL WRITING" || buildup === "PUT WRITING") {
    label = "SB";
    fullName = buildup === "CALL WRITING" ? "Call Writing (Short Build-up)" : buildup === "PUT WRITING" ? "Put Writing (Short Build-up)" : "Short Build-up";
    className = "bg-rose-950/60 border border-rose-500/35 text-rose-400";
  } else if (buildup === "SHORT COVERING") {
    label = "SC";
    fullName = "Short Covering";
    className = "bg-sky-950/60 border border-sky-500/35 text-sky-400";
  } else if (buildup === "LONG UNWINDING") {
    label = "LU";
    fullName = "Long Unwinding";
    className = "bg-amber-950/60 border border-amber-500/35 text-amber-400";
  } else {
    return null;
  }
  
  return (
    <span 
      title={fullName} 
      className={`text-[8px] font-black px-1 py-0.5 rounded cursor-help transition-all hover:scale-105 select-none ${className}`}
    >
      {label}
    </span>
  );
};

// ─── OI PROFILE CHART COMPONENT (Version 2 - Original Symmetrical Horizontal Chart) ───
interface OIProfileChartProps {
  rows: any[];
  sortedRows: any[];
  spotPrice: number;
  atmStrike: number | null;
  maxPain: number | null;
  displayMode: string;
}

const OIProfileChart: React.FC<OIProfileChartProps> = React.memo(({
  rows,
  sortedRows,
  spotPrice,
  atmStrike,
  maxPain,
  displayMode
}) => {
  const [hoveredRow, setHoveredRow] = useState<any | null>(null);
  const [hoverCoords, setHoverCoords] = useState<{ x: number; y: number } | null>(null);
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollIndicators, setScrollIndicators] = useState({
    showAtmTop: false,
    showAtmBottom: false,
    showPainTop: false,
    showPainBottom: false,
  });

  const keyLevels = useMemo(() => {
    if (!sortedRows.length) return { r1: null, r2: null, s1: null, s2: null };
    
    const ceSorted = [...sortedRows]
      .filter(r => r.ce?.oi)
      .sort((a, b) => (b.ce?.oi ?? 0) - (a.ce?.oi ?? 0));
      
    const peSorted = [...sortedRows]
      .filter(r => r.pe?.oi)
      .sort((a, b) => (b.pe?.oi ?? 0) - (a.pe?.oi ?? 0));
      
    return {
      r1: ceSorted[0]?.strike ?? null,
      r2: ceSorted[1]?.strike ?? null,
      s1: peSorted[0]?.strike ?? null,
      s2: peSorted[1]?.strike ?? null,
    };
  }, [sortedRows]);

  const { maxCE, maxPE, maxChgCE, maxChgPE } = useMemo(() => {
    let ceMax = 1, peMax = 1, ceChgMax = 1, peChgMax = 1;
    for (const r of rows) {
      const ceOI = r.ce?.oi ?? 0;
      const peOI = r.pe?.oi ?? 0;
      const ceChg = Math.abs(r.ce?.oiChg ?? 0);
      const peChg = Math.abs(r.pe?.oiChg ?? 0);
      if (ceOI > ceMax) ceMax = ceOI;
      if (peOI > peMax) peMax = peOI;
      if (ceChg > ceChgMax) ceChgMax = ceChg;
      if (peChg > peChgMax) peChgMax = peChg;
    }
    return {
      maxCE: ceMax,
      maxPE: peMax,
      maxChgCE: ceChgMax,
      maxChgPE: peChgMax,
    };
  }, [rows]);

  const maxVal = useMemo(() => {
    if (displayMode === "Total OI") {
      return Math.max(maxCE, maxPE);
    } else if (displayMode === "Change OI") {
      return Math.max(maxChgCE, maxChgPE);
    } else {
      return Math.max(maxCE, maxPE);
    }
  }, [displayMode, maxCE, maxPE, maxChgCE, maxChgPE]);

  const handleMouseMove = useCallback((e: React.MouseEvent, row: any) => {
    const containerRect = e.currentTarget.closest(".relative")?.getBoundingClientRect();
    if (!containerRect) return;

    setHoveredRow(row);
    setHoverCoords({
      x: e.clientX - containerRect.left + 15,
      y: e.clientY - containerRect.top - 20
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredRow(null);
    setHoverCoords(null);
  }, []);

  const updateScrollIndicators = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const scrollTop = el.scrollTop;
    const clientHeight = el.clientHeight;
    const children = Array.from(el.children);
    
    let atmOffsetTop = -1;
    let painOffsetTop = -1;
    
    children.forEach((child) => {
      const strikeStr = child.getAttribute("data-strike");
      if (!strikeStr) return;
      const strikeNum = parseInt(strikeStr, 10);
      if (strikeNum === atmStrike) {
        atmOffsetTop = (child as HTMLElement).offsetTop;
      }
      if (strikeNum === maxPain) {
        painOffsetTop = (child as HTMLElement).offsetTop;
      }
    });

    const pad = 10;
    setScrollIndicators({
      showAtmTop: atmOffsetTop !== -1 && atmOffsetTop < scrollTop - pad,
      showAtmBottom: atmOffsetTop !== -1 && atmOffsetTop > (scrollTop + clientHeight - 28 + pad),
      showPainTop: painOffsetTop !== -1 && painOffsetTop < scrollTop - pad,
      showPainBottom: painOffsetTop !== -1 && painOffsetTop > (scrollTop + clientHeight - 28 + pad),
    });
  }, [atmStrike, maxPain]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    
    updateScrollIndicators();
    el.addEventListener("scroll", updateScrollIndicators, { passive: true });
    
    const resizeObserver = new ResizeObserver(() => updateScrollIndicators());
    resizeObserver.observe(el);
    
    return () => {
      el.removeEventListener("scroll", updateScrollIndicators);
      resizeObserver.disconnect();
    };
  }, [updateScrollIndicators, rows]);

  const chartElements = useMemo(() => {
    const list: Array<{ type: "row" | "spot"; strike?: number; data?: any }> = [];
    if (!rows.length) return [];
    
    let spotInserted = false;
    for (let i = 0; i < rows.length; i++) {
      const curr = rows[i];
      const next = rows[i + 1];
      
      list.push({ type: "row", strike: curr.strike, data: curr });
      
      if (!spotInserted && spotPrice && next && curr.strike < spotPrice && next.strike > spotPrice) {
        list.push({ type: "spot" });
        spotInserted = true;
      }
    }
    
    if (!spotInserted && spotPrice) {
      if (spotPrice < rows[0].strike) {
        list.unshift({ type: "spot" });
      } else if (spotPrice > rows[rows.length - 1].strike) {
        list.push({ type: "spot" });
      }
    }
    
    return list;
  }, [rows, spotPrice]);

  return (
    <div className="w-full relative select-none">
      
      {(scrollIndicators.showAtmTop || scrollIndicators.showPainTop) && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 flex gap-2 pointer-events-none">
          {scrollIndicators.showAtmTop && (
            <span className="bg-sky-500 border border-sky-400 text-zinc-950 font-extrabold text-[8px] px-2 py-0.5 rounded shadow shadow-sky-500/20 uppercase tracking-wider animate-pulse">
              ATM ▲
            </span>
          )}
          {scrollIndicators.showPainTop && (
            <span className="bg-amber-500 border border-amber-400 text-zinc-950 font-extrabold text-[8px] px-2 py-0.5 rounded shadow shadow-amber-500/20 uppercase tracking-wider animate-pulse">
              Max Pain ▲
            </span>
          )}
        </div>
      )}

      {(scrollIndicators.showAtmBottom || scrollIndicators.showPainBottom) && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-30 flex gap-2 pointer-events-none">
          {scrollIndicators.showAtmBottom && (
            <span className="bg-sky-500 border border-sky-400 text-zinc-950 font-extrabold text-[8px] px-2 py-0.5 rounded shadow shadow-sky-500/20 uppercase tracking-wider animate-pulse">
              ATM ▼
            </span>
          )}
          {scrollIndicators.showPainBottom && (
            <span className="bg-amber-500 border border-amber-400 text-zinc-950 font-extrabold text-[8px] px-2 py-0.5 rounded shadow shadow-amber-500/20 uppercase tracking-wider animate-pulse">
              Max Pain ▼
            </span>
          )}
        </div>
      )}

      {/* Static column headers for Open Interest Profile */}
      <div className="flex items-center h-8 text-[9px] font-black uppercase tracking-widest text-zinc-500 border-b border-zinc-900/60 px-1 select-none mb-1.5">
        <div className="flex-1 flex items-center relative pl-3">
          <span>Buildup</span>
          <span className="ml-auto pr-[15%]">Call OI (CE)</span>
        </div>
        <div className="w-20 text-center shrink-0">Strike</div>
        <div className="flex-1 flex items-center relative pr-3">
          <span className="pl-[15%]">Put OI (PE)</span>
          <span className="ml-auto">Buildup</span>
        </div>
      </div>

      <div 
        ref={scrollContainerRef}
        className="flex flex-col gap-[3px] max-h-[580px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent relative"
      >
        {chartElements.map((item, idx) => {
          if (item.type === "spot") {
            const nextStrike = sortedRows[idx + 1]?.strike;
            const prevStrike = sortedRows[idx - 1]?.strike;
            const atmIsAbove = nextStrike === atmStrike;
            const atmIsBelow = prevStrike === atmStrike;

            return (
              <div key="spot-marker-row" className="flex items-center h-6 relative w-full my-1 pointer-events-none">
                <div className="flex-1 border-t border-dashed border-sky-500/40" />
                <div className="px-2.5 py-0.5 rounded bg-sky-950 border border-sky-500/35 text-[9px] font-extrabold text-sky-400 tracking-wider uppercase shadow shadow-sky-500/10 mx-2 relative flex items-center justify-center">
                  Spot: {spotPrice.toFixed(2)}
                  {atmIsAbove && (
                    <div className="absolute w-[2px] h-[6px] bg-sky-500/60 top-[-6px] left-1/2 -translate-x-1/2" />
                  )}
                  {atmIsBelow && (
                    <div className="absolute w-[2px] h-[6px] bg-sky-500/60 bottom-[-6px] left-1/2 -translate-x-1/2" />
                  )}
                </div>
                <div className="flex-1 border-t border-dashed border-sky-500/40" />
              </div>
            );
          }

          const row = item.data;
          const isATM = row.strike === atmStrike;
          const isMaxPain = row.strike === maxPain;

          const isR1 = row.strike === keyLevels.r1;
          const isR2 = row.strike === keyLevels.r2;
          const isS1 = row.strike === keyLevels.s1;
          const isS2 = row.strike === keyLevels.s2;

          const ceBuildup = detectBuildup(row.ce, true);
          const peBuildup = detectBuildup(row.pe, false);

          const ceOI = row.ce?.oi ?? 0;
          const peOI = row.pe?.oi ?? 0;
          const ceChg = Math.abs(row.ce?.oiChg ?? 0);
          const peChg = Math.abs(row.pe?.oiChg ?? 0);

          const callWidthPct = (ceOI / maxVal) * 100;
          const putWidthPct = (peOI / maxVal) * 100;
          const callChgWidthPct = (ceChg / maxVal) * 100;
          const putChgWidthPct = (peChg / maxVal) * 100;

          const isCeConcentration = ceOI === maxCE && ceOI > 0.8 * maxVal;
          const isPeConcentration = peOI === maxPE && peOI > 0.8 * maxVal;

          return (
            <div
              key={row.strike}
              data-strike={row.strike}
              className={`group flex items-center h-[32px] relative rounded transition-all duration-150 ${
                isATM 
                  ? "bg-sky-950/15 border-y border-sky-500/25 ring-1 ring-sky-500/10" 
                  : isMaxPain 
                  ? "bg-amber-950/5 border-y border-amber-500/15" 
                  : "hover:bg-zinc-900/30"
              }`}
              onMouseMove={(e) => handleMouseMove(e, row)}
              onMouseLeave={handleMouseLeave}
            >
              {/* --- CALL SIDE (LEFT) --- */}
              <div className="flex-1 flex items-center justify-end h-full relative pr-4">
                {row.strike < spotPrice && (
                  <div className="absolute inset-0 bg-amber-500/[0.018] pointer-events-none rounded-l" />
                )}

                {/* Compact Buildup Badges Aligned Vertically (Far Left) */}
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-8 flex justify-start z-20">
                  {ceBuildup && renderBuildupBadge(ceBuildup)}
                </div>

                {/* Key Resistance Levels placed near Center Strike (Right) */}
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 z-20">
                  {isR1 && <span className="bg-rose-950 border border-rose-500 text-rose-400 font-extrabold text-[8px] px-1 rounded uppercase tracking-wider">R1</span>}
                  {isR2 && <span className="bg-rose-950/40 border border-rose-600/30 text-rose-500 font-extrabold text-[8px] px-1 rounded uppercase tracking-wider">R2</span>}
                </div>

                {row.ce?.oiChg !== 0 && (
                  <span className={`text-[9px] font-bold mr-2 tabular-nums ${
                    row.ce?.oiChg > 0 ? "text-emerald-500" : "text-rose-500"
                  }`}>
                    {row.ce?.oiChg > 0 ? "+" : ""}{fmtN(row.ce?.oiChg)}
                  </span>
                )}

                <span className="text-[10px] text-zinc-400 font-bold mr-3 tabular-nums z-10">
                  {fmtN(displayMode === "Change OI" ? row.ce?.oiChg : ceOI)}
                </span>

                <div className="flex items-center justify-end w-1/2 h-full">
                  {displayMode === "Total OI" && (
                    <div 
                      className={`h-[15px] bg-rose-600/80 hover:bg-rose-500 rounded-sm relative flex justify-end transition-all duration-300 ${
                        isCeConcentration ? "bg-gradient-to-l from-rose-500 to-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.25)] border-l border-amber-400" : ""
                      }`}
                      style={{ width: `${Math.max(1, callWidthPct)}%` }}
                    >
                      {isCeConcentration && (
                        <div className="absolute left-1 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-amber-200 animate-ping" />
                      )}
                    </div>
                  )}

                  {displayMode === "Change OI" && (
                    <div 
                      className="h-[15px] rounded-sm relative flex justify-end transition-all duration-300 bg-rose-600/80 hover:bg-rose-500"
                      style={{ width: `${Math.max(1, callChgWidthPct)}%` }}
                    />
                  )}

                  {displayMode === "Combined" && (
                    <div className="w-full flex justify-end items-center h-full relative">
                      <div 
                        className="h-[15px] bg-rose-950/30 border border-rose-900/20 rounded-sm transition-all duration-300"
                        style={{ width: `${Math.max(1, callWidthPct)}%` }}
                      />
                      <div 
                        className="h-[7px] absolute right-0 rounded-sm transition-all duration-300 bg-rose-500"
                        style={{ width: `${Math.max(1, callChgWidthPct)}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* --- CENTER STRIKE COLUMN --- */}
              <div className="w-20 shrink-0 flex items-center justify-center h-full z-10 relative">
                {isMaxPain && (
                  <>
                    <div className="absolute left-[-2px] top-0 bottom-0 w-[3px] bg-amber-500 rounded-full" />
                    <div className="absolute right-[-2px] top-0 bottom-0 w-[3px] bg-amber-500 rounded-full" />
                    <div className="absolute -top-[11px] left-1/2 -translate-x-1/2 bg-amber-500 text-zinc-950 text-[6.5px] font-extrabold px-1 rounded uppercase tracking-wider shadow">
                      Pain
                    </div>
                  </>
                )}

                <div className={`px-2 py-0.5 rounded text-[11px] font-bold tracking-wider tabular-nums transition-all ${
                  isATM 
                    ? "bg-sky-500/20 border border-sky-400 text-sky-400 shadow shadow-sky-500/20" 
                    : isMaxPain
                    ? "bg-amber-500/20 border border-amber-400 text-amber-400 shadow shadow-amber-500/10"
                    : "bg-zinc-900 border border-zinc-800/80 text-zinc-300"
                }`}>
                  {row.strike}
                </div>
              </div>

              {/* --- PUT SIDE (RIGHT) --- */}
              <div className="flex-1 flex items-center justify-start h-full relative pl-4">
                {row.strike > spotPrice && (
                  <div className="absolute inset-0 bg-amber-500/[0.018] pointer-events-none rounded-r" />
                )}

                {/* Key Support Levels placed near Center Strike (Left) */}
                <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1 z-20">
                  {isS1 && <span className="bg-emerald-950 border border-emerald-500 text-emerald-400 font-extrabold text-[8px] px-1 rounded uppercase tracking-wider">S1</span>}
                  {isS2 && <span className="bg-emerald-950/40 border border-emerald-600/30 text-emerald-500 font-extrabold text-[8px] px-1 rounded uppercase tracking-wider">S2</span>}
                </div>

                <div className="flex items-center justify-start w-1/2 h-full">
                  {displayMode === "Total OI" && (
                    <div 
                      className={`h-[15px] bg-emerald-600/80 hover:bg-emerald-500 rounded-sm relative flex transition-all duration-300 ${
                        isPeConcentration ? "bg-gradient-to-r from-emerald-500 to-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.25)] border-r border-amber-400" : ""
                      }`}
                      style={{ width: `${Math.max(1, putWidthPct)}%` }}
                    >
                      {isPeConcentration && (
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-amber-200 animate-ping" />
                      )}
                    </div>
                  )}

                  {displayMode === "Change OI" && (
                    <div 
                      className="h-[15px] rounded-sm relative flex transition-all duration-300 bg-emerald-600/80 hover:bg-emerald-500"
                      style={{ width: `${Math.max(1, putChgWidthPct)}%` }}
                    />
                  )}

                  {displayMode === "Combined" && (
                    <div className="w-full flex justify-start items-center h-full relative">
                      <div 
                        className="h-[15px] bg-emerald-950/30 border border-emerald-900/20 rounded-sm transition-all duration-300"
                        style={{ width: `${Math.max(1, putWidthPct)}%` }}
                      />
                      <div 
                        className="h-[7px] absolute left-0 rounded-sm transition-all duration-300 bg-emerald-500"
                        style={{ width: `${Math.max(1, putChgWidthPct)}%` }}
                      />
                    </div>
                  )}
                </div>

                <span className="text-[10px] text-zinc-400 font-bold ml-3 tabular-nums z-10">
                  {fmtN(displayMode === "Change OI" ? row.pe?.oiChg : peOI)}
                </span>

                {row.pe?.oiChg !== 0 && (
                  <span className={`text-[9px] font-bold ml-2 tabular-nums ${
                    row.pe?.oiChg > 0 ? "text-emerald-500" : "text-rose-500"
                  }`}>
                    {row.pe?.oiChg > 0 ? "+" : ""}{fmtN(row.pe?.oiChg)}
                  </span>
                )}

                {/* Compact Buildup Badges Aligned Vertically (Far Right) */}
                <div className="absolute right-3 top-1/2 -translate-y-1/2 w-8 flex justify-end z-20">
                  {peBuildup && renderBuildupBadge(peBuildup)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {hoveredRow && hoverCoords && (
        <div 
          className="absolute z-50 bg-[#0c0c0f] border border-zinc-700/80 rounded-lg p-3.5 shadow-2xl max-w-sm pointer-events-none text-xs space-y-2.5 backdrop-blur-md"
          style={{ left: `${hoverCoords.x}px`, top: `${hoverCoords.y}px` }}
        >
          <div className="border-b border-zinc-800/80 pb-1.5 flex justify-between items-center gap-6 font-bold">
            <span className="text-zinc-200">Strike Option: {hoveredRow.strike}</span>
            <div className="flex gap-1">
              {hoveredRow.strike === atmStrike && <span className="text-sky-400 font-extrabold text-[7.5px] bg-sky-950/60 border border-sky-500/30 px-1 rounded tracking-wider uppercase">ATM</span>}
              {hoveredRow.strike === maxPain && <span className="text-amber-500 font-extrabold text-[7.5px] bg-amber-950/60 border border-amber-500/30 px-1 rounded tracking-wider uppercase">Max Pain</span>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 pt-0.5 font-semibold text-zinc-400">
            <div className="bg-rose-950/10 border border-rose-950/30 rounded p-1.5">
              <p className="text-[9.5px] text-rose-400 uppercase font-extrabold tracking-wider">CALL (CE)</p>
              <p className="mt-1 text-zinc-300">OI: {fmtN(hoveredRow.ce?.oi ?? 0)}</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">Chg: {hoveredRow.ce?.oiChg >= 0 ? "+" : ""}{fmtN(hoveredRow.ce?.oiChg ?? 0)}</p>
              {hoveredRow.ce?.signal && (
                <p className="text-[8px] text-rose-400 font-bold mt-1 uppercase truncate">{hoveredRow.ce.signal}</p>
              )}
            </div>
            <div className="bg-emerald-950/10 border border-emerald-950/30 rounded p-1.5">
              <p className="text-[9.5px] text-emerald-400 uppercase font-extrabold tracking-wider">PUT (PE)</p>
              <p className="mt-1 text-zinc-300">OI: {fmtN(hoveredRow.pe?.oi ?? 0)}</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">Chg: {hoveredRow.pe?.oiChg >= 0 ? "+" : ""}{fmtN(hoveredRow.pe?.oiChg ?? 0)}</p>
              {hoveredRow.pe?.signal && (
                <p className="text-[8px] text-emerald-400 font-bold mt-1 uppercase truncate">{hoveredRow.pe.signal}</p>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
});

OIProfileChart.displayName = "OIProfileChart";


// ─── STOLO VERTICAL COLUMN CHART COMPONENT (Version 3 - Square Bars & Side Skew Panel) ───
interface VerticalColumnChartProps {
  rows: any[];
  sortedRows: any[];
  spotPrice: number;
  atmStrike: number | null;
  maxPain: number | null;
  displayMode: string;
  isChangeChart: boolean;
  expiryDate: string;
  symbol: string;
}

const VerticalColumnChart: React.FC<VerticalColumnChartProps> = React.memo(({
  rows,
  sortedRows,
  spotPrice,
  atmStrike,
  maxPain,
  displayMode,
  isChangeChart,
  expiryDate,
  symbol
}) => {
  const [hoveredRow, setHoveredRow] = useState<any | null>(null);
  const [hoverCoords, setHoverCoords] = useState<{ x: number; y: number } | null>(null);
  
  // Calculate Support / Resistance Key Levels based on all sorted rows (global)
  const keyLevels = useMemo(() => {
    if (!sortedRows.length) return { r1: null, r2: null, s1: null, s2: null };
    
    const ceSorted = [...sortedRows]
      .filter(r => r.ce?.oi)
      .sort((a, b) => (b.ce?.oi ?? 0) - (a.ce?.oi ?? 0));
      
    const peSorted = [...sortedRows]
      .filter(r => r.pe?.oi)
      .sort((a, b) => (b.pe?.oi ?? 0) - (a.pe?.oi ?? 0));
      
    return {
      r1: ceSorted[0]?.strike ?? null,
      r2: ceSorted[1]?.strike ?? null,
      s1: peSorted[0]?.strike ?? null,
      s2: peSorted[1]?.strike ?? null,
    };
  }, [sortedRows]);

  // Compute numerical values for columns based on display mode & change chart
  const processedData = useMemo(() => {
    return rows.map((r) => {
      let ceVal = 0;
      let peVal = 0;
      
      if (isChangeChart) {
        // Value terms: LTP * Change in OI
        ceVal = (r.ce?.oiChg ?? 0) * (r.ce?.ltp ?? 1);
        peVal = (r.pe?.oiChg ?? 0) * (r.pe?.ltp ?? 1);
      } else {
        if (displayMode === "Total OI") {
          ceVal = r.ce?.oi ?? 0;
          peVal = r.pe?.oi ?? 0;
        } else if (displayMode === "Change OI") {
          ceVal = r.ce?.oiChg ?? 0;
          peVal = r.pe?.oiChg ?? 0;
        } else {
          // Combined uses Total OI
          ceVal = r.ce?.oi ?? 0;
          peVal = r.pe?.oi ?? 0;
        }
      }
      return { strike: r.strike, ceVal, peVal, raw: r };
    });
  }, [rows, displayMode, isChangeChart]);

  // Compute total skew aggregation
  const { totalCE, totalPE, maxTotalSkew } = useMemo(() => {
    let ceTot = 0;
    let peTot = 0;
    
    if (isChangeChart) {
      ceTot = sortedRows.reduce((sum, r) => sum + Math.abs((r.ce?.oiChg ?? 0) * (r.ce?.ltp ?? 1)), 0);
      peTot = sortedRows.reduce((sum, r) => sum + Math.abs((r.pe?.oiChg ?? 0) * (r.pe?.ltp ?? 1)), 0);
    } else {
      if (displayMode === "Change OI") {
        ceTot = sortedRows.reduce((sum, r) => sum + Math.abs(r.ce?.oiChg ?? 0), 0);
        peTot = sortedRows.reduce((sum, r) => sum + Math.abs(r.pe?.oiChg ?? 0), 0);
      } else {
        ceTot = sortedRows.reduce((sum, r) => sum + (r.ce?.oi ?? 0), 0);
        peTot = sortedRows.reduce((sum, r) => sum + (r.pe?.oi ?? 0), 0);
      }
    }
    return { totalCE: ceTot, totalPE: peTot, maxTotalSkew: Math.max(ceTot, peTot, 1) };
  }, [sortedRows, displayMode, isChangeChart]);

  // Compute scaling maximum value
  const maxVal = useMemo(() => {
    let maxNum = 1;
    for (const d of processedData) {
      const ceAbs = Math.abs(d.ceVal);
      const peAbs = Math.abs(d.peVal);
      if (ceAbs > maxNum) maxNum = ceAbs;
      if (peAbs > maxNum) maxNum = peAbs;
    }
    return maxNum;
  }, [processedData]);

  // Y-axis grid ticks
  const yTicks = useMemo(() => {
    if (isChangeChart || displayMode === "Change OI") {
      // Symmetrical ticks: +Max, +Half, 0, -Half, -Max
      return [maxVal, maxVal * 0.5, 0, -maxVal * 0.5, -maxVal];
    }
    // Normal positive ticks
    return [maxVal, maxVal * 0.75, maxVal * 0.5, maxVal * 0.25, 0];
  }, [maxVal, isChangeChart, displayMode]);

  const handleMouseMove = useCallback((e: React.MouseEvent, row: any) => {
    const containerRect = e.currentTarget.closest(".relative")?.getBoundingClientRect();
    if (!containerRect) return;

    setHoveredRow(row);
    setHoverCoords({
      x: e.clientX - containerRect.left + 15,
      y: e.clientY - containerRect.top - 20
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredRow(null);
    setHoverCoords(null);
  }, []);

  const spotIndex = useMemo(() => {
    if (!spotPrice || !processedData.length) return -1;
    // Find closest index where spotPrice sits between strike and strike+1
    for (let i = 0; i < processedData.length - 1; i++) {
      if (processedData[i].strike < spotPrice && processedData[i+1].strike > spotPrice) {
        return i;
      }
    }
    return -1;
  }, [processedData, spotPrice]);

  return (
    <div className="bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-5 flex flex-col justify-between min-h-[460px] relative">
      
      {/* Title Header */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800/40 mb-3">
        <div className="flex items-center gap-2">
          <LineChart className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-extrabold uppercase tracking-widest text-zinc-300">
            {isChangeChart 
              ? `Open Interest Change in Value Terms (LTP * Change in OI) - ${expiryDate || "Expiry"}`
              : `Open Interest - ${expiryDate || "Expiry"}`
            }
          </span>
          {/* PCR Badge at top left */}
          <span className="text-[10px] font-black text-sky-400 bg-sky-950/80 border border-sky-500/35 px-2 py-0.5 rounded uppercase tracking-wider ml-1">
            PCR: {totalCE > 0 ? (totalPE / totalCE).toFixed(2) : "0.00"}
          </span>
        </div>
        <div className="flex items-center gap-4 text-[10px] font-bold text-zinc-500">
          {/* PCR Badge near legend */}
          <span className="text-[9.5px] font-extrabold text-sky-400 pr-1">
            PCR: {totalCE > 0 ? (totalPE / totalCE).toFixed(2) : "0.00"}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 bg-emerald-600"></span>
            <span>{isChangeChart ? "Put Change" : "Put OI (PE)"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 bg-rose-600"></span>
            <span>{isChangeChart ? "Call Change" : "Call OI (CE)"}</span>
          </div>
        </div>
      </div>
      
      <div className="flex items-stretch gap-1 relative w-full h-[320px]">
        {/* Y-axis Ticks */}
        <div className="w-12 shrink-0 flex flex-col justify-between h-[280px] text-[8.5px] font-black text-zinc-500 text-right pr-2 select-none border-r border-zinc-900/60 pb-1 pt-1.5 tabular-nums">
          {yTicks.map((t, idx) => (
            <span key={idx}>{fmtN(t)}</span>
          ))}
        </div>

        {/* Scrollable Column bars */}
        <div className="flex-1 overflow-x-auto flex items-end h-[320px] pb-1 relative border-b border-zinc-900/60 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
          
          {/* Horizontal grid lines */}
          <div className="absolute inset-0 h-[280px] flex flex-col justify-between pointer-events-none z-0 pr-4 pl-1">
            {yTicks.map((_, idx) => (
              <div key={idx} className="w-full border-t border-zinc-900/50 last:border-b last:border-t-0" />
            ))}
          </div>

          {processedData.map((d, idx) => {
            const row = d.raw;
            const isATM = d.strike === atmStrike;
            const isMaxPain = d.strike === maxPain;
            const isR1 = d.strike === keyLevels.r1;
            const isS1 = d.strike === keyLevels.s1;

            const isDiff = isChangeChart || displayMode === "Change OI";
            
            let ceHeight = 0;
            let peHeight = 0;
            let ceTop = "auto";
            let peTop = "auto";
            let ceBottom = "0px";
            let peBottom = "0px";

            if (isDiff) {
              const factor = 135;
              ceHeight = (Math.abs(d.ceVal) / maxVal) * factor;
              peHeight = (Math.abs(d.peVal) / maxVal) * factor;

              if (d.ceVal >= 0) {
                ceBottom = "140px";
              } else {
                ceTop = "140px";
                ceBottom = "auto";
              }

              if (d.peVal >= 0) {
                peBottom = "140px";
              } else {
                peTop = "140px";
                peBottom = "auto";
              }
            } else {
              const factor = 270;
              ceHeight = (d.ceVal / maxVal) * factor;
              peHeight = (d.peVal / maxVal) * factor;
            }

            return (
              <React.Fragment key={d.strike}>
                <div 
                  className={`flex flex-col items-center h-full min-w-[70px] flex-1 relative px-0.5 transition duration-150 rounded ${
                    isATM ? "bg-sky-500/[0.02] border-x border-sky-500/10" : ""
                  }`}
                  onMouseMove={(e) => handleMouseMove(e, row)}
                  onMouseLeave={handleMouseLeave}
                >
                  {/* Column bars */}
                  <div className="w-full h-[280px] relative flex items-end justify-center gap-0.5 z-10">
                    {/* Zero line */}
                    {isDiff && (
                      <div className="absolute left-0 right-0 top-[140px] border-t border-zinc-800/40 z-0 pointer-events-none" />
                    )}

                    {/* Put OI bar (Green, Left) */}
                    <div 
                      className="w-4 bg-emerald-600 hover:bg-emerald-500 transition-all duration-300"
                      style={{
                        height: `${Math.max(1.5, peHeight)}px`,
                        position: isDiff ? "absolute" : "relative",
                        right: isDiff ? "calc(50% + 0.5px)" : "auto",
                        top: peTop,
                        bottom: peBottom,
                        borderRadius: "0px" // SQUARE CORNERS (NO ROUNDED)
                      }}
                    />

                    {/* Call OI bar (Red, Right) */}
                    <div 
                      className="w-4 bg-rose-600 hover:bg-rose-500 transition-all duration-300"
                      style={{
                        height: `${Math.max(1.5, ceHeight)}px`,
                        position: isDiff ? "absolute" : "relative",
                        left: isDiff ? "calc(50% + 0.5px)" : "auto",
                        top: ceTop,
                        bottom: ceBottom,
                        borderRadius: "0px" // SQUARE CORNERS (NO ROUNDED)
                      }}
                    />

                    {/* SR Labels */}
                    {isR1 && !isDiff && <span className="absolute top-1 text-[7px] font-black bg-rose-950/80 border border-rose-500 text-rose-400 px-0.5 rounded shadow">R1</span>}
                    {isS1 && !isDiff && <span className="absolute top-1 text-[7px] font-black bg-emerald-950/80 border border-emerald-500 text-emerald-400 px-0.5 rounded shadow">S1</span>}
                  </div>

                  {/* Strike Labels */}
                  <div className="h-[35px] flex flex-col items-center justify-center pt-1 w-full border-t border-zinc-900/60 z-10">
                    <span className={`text-[9.5px] font-extrabold tracking-tight tabular-nums px-1 rounded ${
                      isATM 
                        ? "text-sky-400 bg-sky-950/80 border border-sky-500/30" 
                        : isMaxPain 
                        ? "text-amber-400 bg-amber-950/80 border border-amber-500/20" 
                        : "text-zinc-400"
                    }`}>
                      {d.strike}
                    </span>
                  </div>
                </div>

                {/* Spot Price Visual Line */}
                {idx === spotIndex && (
                  <div className="w-[1.5px] h-[280px] border-l border-dashed border-sky-500/50 relative mx-0.5 shrink-0 self-end z-20">
                    <div className="absolute top-[-22px] left-1/2 -translate-x-1/2 bg-sky-950 border border-sky-500/40 text-[9px] font-black text-sky-400 px-1.5 py-0.5 rounded shadow whitespace-nowrap">
                      {symbol} {spotPrice.toFixed(1)}
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* ─── STOLO RIGHT SUMMARY PANEL WITH TWO BIG SQUARE BARS (DOUBLE SIZE) ─── */}
        <div className="w-[180px] shrink-0 border-l border-zinc-900/60 pl-3 flex flex-col justify-between h-[315px] relative pt-2">
          
          <div className="flex-1 flex items-end justify-center gap-2 pb-2 relative mt-4">
            {/* Total Put OI (PE) */}
            <div className="flex flex-col items-center">
              <span className="text-[8.5px] font-extrabold text-emerald-400 mb-1.5 tabular-nums">
                {fmtN(totalPE)}
              </span>
              <div 
                className="bg-emerald-600 transition-all duration-300"
                style={{
                  width: "54px",
                  height: `${(totalPE / maxTotalSkew) * 185}px`,
                  borderRadius: "0px" // SQUARE CORNERS
                }}
              />
              <span className="text-[8.5px] font-black text-zinc-500 mt-1.5">PE</span>
            </div>
            {/* Total Call OI (CE) */}
            <div className="flex flex-col items-center">
              <span className="text-[8.5px] font-extrabold text-rose-400 mb-1.5 tabular-nums">
                {fmtN(totalCE)}
              </span>
              <div 
                className="bg-rose-600 transition-all duration-300"
                style={{
                  width: "54px",
                  height: `${(totalCE / maxTotalSkew) * 185}px`,
                  borderRadius: "0px" // SQUARE CORNERS
                }}
              />
              <span className="text-[8.5px] font-black text-zinc-500 mt-1.5">CE</span>
            </div>
          </div>
          
          <div className="text-[9px] font-bold space-y-0.5 border-t border-zinc-900/80 pt-1.5 text-center">
            <div className="flex justify-between gap-1 text-sky-400 border-t border-zinc-900/60 pt-0.5">
              <span>PCR:</span>
              <span>
                {totalCE > 0 ? (totalPE / totalCE).toFixed(2) : "0.00"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* --- FLOATING TOOLTIP --- */}
      {hoveredRow && hoverCoords && (
        <div 
          className="absolute z-50 bg-[#0c0c0f] border border-zinc-700/80 rounded-lg p-3.5 shadow-2xl max-w-sm pointer-events-none text-xs space-y-2.5 backdrop-blur-md"
          style={{ left: `${hoverCoords.x}px`, top: `${hoverCoords.y}px` }}
        >
          <div className="border-b border-zinc-800/80 pb-1.5 flex justify-between items-center gap-6 font-bold">
            <span className="text-zinc-200">Strike Option: {hoveredRow.strike}</span>
            <div className="flex gap-1">
              {hoveredRow.strike === atmStrike && <span className="text-sky-400 font-extrabold text-[7.5px] bg-sky-950/60 border border-sky-500/30 px-1 rounded tracking-wider uppercase">ATM</span>}
              {hoveredRow.strike === maxPain && <span className="text-amber-500 font-extrabold text-[7.5px] bg-amber-950/60 border border-amber-500/30 px-1 rounded tracking-wider uppercase">Max Pain</span>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 pt-0.5 font-semibold text-zinc-400">
            <div className="bg-rose-950/10 border border-rose-950/30 rounded p-1.5">
              <p className="text-[9.5px] text-rose-400 uppercase font-extrabold tracking-wider">CALL (CE)</p>
              <p className="mt-1 text-zinc-300">OI: {fmtN(hoveredRow.ce?.oi ?? 0)}</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">Chg: {hoveredRow.ce?.oiChg >= 0 ? "+" : ""}{fmtN(hoveredRow.ce?.oiChg ?? 0)}</p>
              {hoveredRow.ce?.signal && (
                <p className="text-[8px] text-rose-400 font-bold mt-1 uppercase truncate">{hoveredRow.ce.signal}</p>
              )}
            </div>
            <div className="bg-emerald-950/10 border border-emerald-950/30 rounded p-1.5">
              <p className="text-[9.5px] text-emerald-400 uppercase font-extrabold tracking-wider">PUT (PE)</p>
              <p className="mt-1 text-zinc-300">OI: {fmtN(hoveredRow.pe?.oi ?? 0)}</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">Chg: {hoveredRow.pe?.oiChg >= 0 ? "+" : ""}{fmtN(hoveredRow.pe?.oiChg ?? 0)}</p>
              {hoveredRow.pe?.signal && (
                <p className="text-[8px] text-emerald-400 font-bold mt-1 uppercase truncate">{hoveredRow.pe.signal}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

VerticalColumnChart.displayName = "VerticalColumnChart";


// ─── MAIN PAGE ───────────────────────────────────────────────────────────────
function Page() {
  // ── STATE ───────────────────────────────────────────────────
  const [symbol, setSymbol] = useState<IndexSymbol>("NIFTY");
  const [selectedExpiry, setSelectedExpiry] = useState<string>("");
  const [liveExpiries, setLiveExpiries] = useState<string[]>([]);
  const [strikeRange, setStrikeRange] = useState<string>("10");
  const [displayMode, setDisplayMode] = useState<string>("Total OI");

  // ── DATA QUERIES ─────────────────────────────────────────────
  const optionChainResult = useQuery({
    ...optionChainQuery(symbol, undefined, selectedExpiry),
    placeholderData: keepPreviousData,
  });
  const oc = optionChainResult.data;

  const activeQuoteSymbol = quoteSymbolMap[symbol];
  const quoteResult = useQuery({
    ...quotesQuery([activeQuoteSymbol]),
    placeholderData: keepPreviousData,
  });
  const quote = quoteResult.data?.[0];

  // ── SYNC EXPIRIES ───────────────────────────────────────────
  useEffect(() => {
    if (oc?.expiries?.length) {
      setLiveExpiries(oc.expiries);
    } else {
      setLiveExpiries([]);
    }
  }, [oc]);

  useEffect(() => {
    if (liveExpiries.length > 0) {
      if (!selectedExpiry || !liveExpiries.includes(selectedExpiry)) {
        setSelectedExpiry(liveExpiries[0]);
      }
    }
  }, [liveExpiries, selectedExpiry]);

  // ── LIVE METRIC COMPUTATIONS ────────────────────────────────
  const spotPrice = quote?.price ?? oc?.spot ?? 0;
  const changePct = quote?.changePct ?? 0;
  const changeVal = quote?.change ?? 0;
  const isPositive = changeVal >= 0;

  const sortedRows = useMemo(() => {
    if (!oc?.rows) return [];
    return [...oc.rows].sort((a, b) => a.strike - b.strike);
  }, [oc?.rows]);

  const atmStrike = useMemo(() => {
    if (!sortedRows.length || !spotPrice) return null;
    const atmRow = sortedRows.reduce((prev, curr) =>
      Math.abs(curr.strike - spotPrice) < Math.abs(prev.strike - spotPrice) ? curr : prev
    );
    return atmRow.strike;
  }, [sortedRows, spotPrice]);

  const pcr = useMemo(() => {
    if (!oc) return null;
    return oc.totals.ceOi ? oc.totals.peOi / oc.totals.ceOi : 0;
  }, [oc]);

  const pcrText = useMemo(() => {
    if (pcr === null) return "Neutral";
    if (pcr > 1.2) return "Strong Bullish";
    if (pcr > 0.95) return "Bullish";
    if (pcr < 0.6) return "Strong Bearish";
    if (pcr < 0.8) return "Bearish";
    return "Neutral";
  }, [pcr]);

  const maxPain = useMemo(() => {
    if (!oc?.rows) return null;
    let minVal = Infinity;
    let maxPainStrike = oc.rows[0]?.strike ?? 0;
    for (const r of oc.rows) {
      const ceVal = (r.ce?.oi ?? 0) * (r.ce?.ltp ?? 0);
      const peVal = (r.pe?.oi ?? 0) * (r.pe?.ltp ?? 0);
      const total = ceVal + peVal;
      if (total < minVal) {
        minVal = total;
        maxPainStrike = r.strike;
      }
    }
    return maxPainStrike;
  }, [oc]);

  // Filter strikes based on selected strike range
  const visibleRows = useMemo(() => {
    if (!sortedRows.length) return [];
    if (strikeRange === "All") return sortedRows;
    const num = parseInt(strikeRange, 10);
    if (isNaN(num)) return sortedRows;

    const atmIdx = sortedRows.findIndex(r => r.strike === atmStrike);
    if (atmIdx === -1) return sortedRows;

    const startIdx = Math.max(0, atmIdx - num);
    const endIdx = Math.min(sortedRows.length, atmIdx + num + 1);
    return sortedRows.slice(startIdx, endIdx);
  }, [sortedRows, strikeRange, atmStrike]);

  const lastUpdatedTime = useMemo(() => {
    if (!oc?.updatedAt) return "--:--:--";
    const date = new Date(oc.updatedAt);
    return date.toLocaleTimeString("en-IN", { hour12: false });
  }, [oc]);

  const sourceLabel = oc?.source ? (sourceLabelMap[oc.source] ?? oc.source) : "Disconnect";

  return (
    <DashboardShell>
      <div className="flex flex-col w-full min-h-screen bg-[#070709] text-zinc-100 font-sans p-4 space-y-4 select-none">
        
        {/* ==================== 1. LIVE TOP SUMMARY RIBBON ==================== */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 w-full bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-3">
          
          {/* Symbol & Spot Price */}
          <div className="flex flex-col justify-center px-2 py-1 border-r border-zinc-800/40 last:border-none">
            <span className="text-[9px] uppercase font-extrabold text-zinc-500 tracking-wider">
              {symbol} Index
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              {spotPrice ? (
                <TickingNumber
                  value={spotPrice}
                  className={`text-sm font-extrabold tabular-nums ${
                    isPositive ? "text-emerald-400" : "text-rose-500"
                  }`}
                />
              ) : (
                <span className="text-sm font-extrabold text-zinc-500">--.--</span>
              )}
              {isPositive ? (
                <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <ArrowDownRight className="w-3.5 h-3.5 text-rose-500 shrink-0" />
              )}
            </div>
          </div>

          {/* Spot Change % */}
          <div className="flex flex-col justify-center px-2 py-1 border-r border-zinc-800/40 last:border-none">
            <span className="text-[9px] uppercase font-extrabold text-zinc-500 tracking-wider">Net Change</span>
            <div className={`flex items-baseline gap-1 mt-0.5 text-xs font-bold tabular-nums ${
              isPositive ? "text-emerald-400" : "text-rose-500"
            }`}>
              <span>{isPositive ? "+" : ""}{changeVal.toFixed(2)}</span>
              <span className="text-[10px] font-semibold text-zinc-500">
                ({isPositive ? "+" : ""}{changePct.toFixed(2)}%)
              </span>
            </div>
          </div>

          {/* ATM Strike */}
          <div className="flex flex-col justify-center px-2 py-1 border-r border-zinc-800/40 last:border-none">
            <span className="text-[9px] uppercase font-extrabold text-zinc-500 tracking-wider">ATM Strike</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-sm font-extrabold text-zinc-300 tabular-nums">
                {atmStrike ?? "—"}
              </span>
              <span className="text-[9px] font-extrabold text-zinc-500 uppercase">Straddle</span>
            </div>
          </div>

          {/* PCR */}
          <div className="flex flex-col justify-center px-2 py-1 border-r border-zinc-800/40 last:border-none">
            <span className="text-[9px] uppercase font-extrabold text-zinc-500 tracking-wider">PCR Ratio</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-sm font-extrabold text-zinc-300 tabular-nums">
                {pcr !== null ? pcr.toFixed(2) : "—.——"}
              </span>
              <span className={`text-[9px] font-extrabold uppercase ${
                pcrText.includes("Bullish") ? "text-emerald-400" : pcrText.includes("Bearish") ? "text-rose-500" : "text-zinc-500"
              }`}>
                {pcrText}
              </span>
            </div>
          </div>

          {/* Max Pain */}
          <div className="flex flex-col justify-center px-2 py-1 border-r border-zinc-800/40 last:border-none">
            <span className="text-[9px] uppercase font-extrabold text-zinc-500 tracking-wider">Max Pain</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-sm font-extrabold text-zinc-300 tabular-nums">
                {maxPain ?? "—"}
              </span>
              <span className="text-[9px] font-extrabold text-zinc-500 uppercase">Pin strike</span>
            </div>
          </div>

          {/* Max Call & Put Wall */}
          <div className="flex flex-col justify-center px-2 py-1 border-r border-zinc-800/40 last:border-none">
            <span className="text-[9px] uppercase font-extrabold text-zinc-500 tracking-wider">OI Max Walls</span>
            <div className="flex flex-col text-[10px] font-bold mt-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-rose-500">CE Wall</span>
                <span className="text-zinc-300 tabular-nums">{oc?.maxCeOiStrike ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-emerald-400">PE Wall</span>
                <span className="text-zinc-300 tabular-nums">{oc?.maxPeOiStrike ?? "—"}</span>
              </div>
            </div>
          </div>

          {/* Total OI Call / Put */}
          <div className="flex flex-col justify-center px-2 py-1 border-r border-zinc-800/40 last:border-none">
            <span className="text-[9px] uppercase font-extrabold text-zinc-500 tracking-wider">Total OI (L/Cr)</span>
            <div className="flex flex-col text-[10px] font-bold mt-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-rose-500">Calls</span>
                <span className="text-zinc-400 tabular-nums">{oc?.totals.ceOi ? fmtN(oc.totals.ceOi) : "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-emerald-400">Puts</span>
                <span className="text-zinc-400 tabular-nums">{oc?.totals.peOi ? fmtN(oc.totals.peOi) : "—"}</span>
              </div>
            </div>
          </div>

          {/* Source & Last Updated */}
          <div className="flex flex-col justify-center px-2 py-1 last:border-none">
            <span className="text-[9px] uppercase font-extrabold text-zinc-500 tracking-wider">Terminal Feed</span>
            <div className="flex flex-col text-[10px] font-bold mt-0.5 text-zinc-500">
              <div className="flex items-center gap-1">
                <Database className="w-2.5 h-2.5 text-zinc-600 shrink-0" />
                <span className="truncate flex items-center gap-1">
                  <span className={`capitalize ${oc?._metadata?.source === 'synthetic' ? 'text-rose-400 font-bold font-mono' : ''}`}>{oc?._metadata?.source || oc?.source || "Disconnect"}</span>
                  {oc?._metadata && (
                    <span className={`px-1 py-0.2 text-[8px] font-extrabold uppercase rounded ${
                      oc._metadata.source === 'synthetic'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                        : oc._metadata.status === 'live'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : oc._metadata.status === 'fallback'
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                    }`}>
                      {oc._metadata.source === 'synthetic' ? 'Estimated' : oc._metadata.status}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <Clock className="w-2.5 h-2.5 text-zinc-600 shrink-0" />
                <span className="tabular-nums flex items-center gap-1">
                  {lastUpdatedTime}
                  {oc?._metadata?.latencyMs !== undefined && (
                    <span className="text-[8px] text-zinc-600 font-mono">({oc._metadata.latencyMs}ms)</span>
                  )}
                </span>
              </div>
            </div>
          </div>

        </div>

        {/* ==================== 2. MAIN WORKSPACE (3-COLUMN LAYOUT) ==================== */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 w-full">
          
          {/* ---------------- LEFT PANEL (Control Settings) ---------------- */}
          <aside className="lg:col-span-2 space-y-4">
            <div className="bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-3.5 space-y-4">
              
              {/* Header Title */}
              <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/60">
                <SlidersHorizontal className="w-3.5 h-3.5 text-sky-400" />
                <span className="text-[10px] font-black uppercase tracking-wider text-zinc-300">Terminal Panel</span>
              </div>

              {/* Symbol Selector */}
              <div className="space-y-1.5">
                <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Symbol</label>
                <div className="grid grid-cols-2 gap-1">
                  {(["NIFTY", "BANKNIFTY", "MIDCPNIFTY", "SENSEX"] as IndexSymbol[]).map((sym) => (
                    <button
                      key={sym}
                      onClick={() => {
                        setSymbol(sym);
                        setSelectedExpiry("");
                        setLiveExpiries([]);
                      }}
                      className={`text-[10px] font-black px-1.5 py-1.5 rounded border transition-all duration-150 ${
                        symbol === sym
                          ? "bg-zinc-700/85 border-zinc-500 text-zinc-100 shadow-sm"
                          : "bg-zinc-900/30 border-zinc-800/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                      }`}
                    >
                      {sym === "MIDCPNIFTY" ? "MIDCAP" : sym}
                    </button>
                  ))}
                </div>
              </div>

              {/* Expiry Selector */}
              <div className="space-y-1.5">
                <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Select Expiry</label>
                <div className="relative">
                  {liveExpiries.length > 0 ? (
                    <select
                      value={selectedExpiry}
                      onChange={(e) => setSelectedExpiry(e.target.value)}
                      className="w-full text-[10px] font-bold bg-zinc-900/60 border border-zinc-800/80 rounded px-2 py-1.5 text-zinc-300 focus:outline-none focus:border-zinc-600 appearance-none cursor-pointer"
                    >
                      {liveExpiries.map((exp) => (
                        <option key={exp} value={exp} className="bg-[#0e0e12]">
                          {exp}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex items-center justify-between w-full text-[10px] font-bold bg-zinc-900/30 border border-zinc-800/80 rounded px-2 py-1.5 text-zinc-500">
                      <span>Loading expiries...</span>
                    </div>
                  )}
                  {liveExpiries.length > 0 && (
                    <div className="absolute right-2 top-2 pointer-events-none">
                      <ChevronDown className="w-3 h-3 text-zinc-400" />
                    </div>
                  )}
                </div>
              </div>

              {/* Strike Range Selector */}
              <div className="space-y-1.5">
                <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Strike Range</label>
                <div className="grid grid-cols-3 gap-1">
                  {["5", "10", "15", "20", "All"].map((range) => (
                    <button
                      key={range}
                      onClick={() => setStrikeRange(range)}
                      className={`text-[10px] font-black py-1 rounded border transition ${
                        strikeRange === range
                          ? "bg-sky-950/40 border-sky-600/50 text-sky-400 shadow-sm"
                          : "bg-zinc-900/30 border-zinc-800/60 text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {range}
                    </button>
                  ))}
                </div>
              </div>

              {/* Display Mode */}
              <div className="space-y-1.5">
                <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Display Mode</label>
                <div className="flex flex-col gap-1 bg-zinc-950/80 border border-zinc-800/80 rounded p-1">
                  {["Total OI", "Change OI", "Combined"].map((m) => (
                    <button
                      key={m}
                      onClick={() => setDisplayMode(m)}
                      className={`text-[9.5px] font-extrabold py-1 rounded transition text-center ${
                        displayMode === m
                          ? "bg-zinc-700/85 text-zinc-100 shadow-sm"
                          : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/30"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live / Historical Toggle */}
              <div className="space-y-1.5">
                <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Trading Mode</label>
                <div className="grid grid-cols-2 gap-1 bg-zinc-950/80 border border-zinc-800/80 rounded p-1">
                  <div className="flex items-center justify-center gap-1 py-1 text-[9.5px] font-bold text-zinc-400 bg-zinc-900/40 rounded shadow-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>Live</span>
                  </div>
                  <div className="py-1 text-[9.5px] font-bold text-zinc-500 cursor-not-allowed text-center flex items-center justify-center">
                    Hist
                  </div>
                </div>
              </div>

              {/* Replay Controls Placeholder */}
              <div className="border-t border-zinc-800/60 pt-3 space-y-2">
                <span className="text-[9px] uppercase font-black text-zinc-500 tracking-wider block">Replay Controller</span>
                <div className="flex items-center justify-between bg-zinc-950/40 border border-zinc-800/40 rounded p-2 text-zinc-600">
                  <div className="flex gap-2">
                    <SkipBack className="w-3 h-3 cursor-not-allowed" />
                    <Play className="w-3 h-3 cursor-not-allowed" />
                    <Pause className="w-3 h-3 cursor-not-allowed" />
                  </div>
                  <span className="text-[9px] font-extrabold tabular-nums">1x</span>
                </div>
              </div>

            </div>
          </aside>

          {/* ---------------- CENTER PANEL (Visualizations) ---------------- */}
          <main className="lg:col-span-7 space-y-4">
            
            {/* 1. Open Interest Profile (Sensibull Horizontal Paired Bars Chart Restored) */}
            <div className="bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-5 flex flex-col justify-between min-h-[440px] relative">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800/40 relative">
                <div className="flex items-center gap-2">
                  <LineChart className="w-4 h-4 text-sky-400" />
                </div>
                
                {/* Centered Title */}
                <div className="absolute left-1/2 -translate-x-1/2 text-xs font-extrabold uppercase tracking-widest text-zinc-300">
                  Open Interest Profile
                </div>

                <div className="flex gap-4 text-[10px] font-bold text-zinc-500">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-rose-600"></span>
                    <span>Call OI (CE)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600"></span>
                    <span>Put OI (PE)</span>
                  </div>
                </div>
              </div>

              <div className="flex-1 flex flex-col justify-center my-4 min-h-[300px]">
                {oc && visibleRows.length > 0 ? (
                  <OIProfileChart
                    rows={visibleRows}
                    sortedRows={sortedRows}
                    spotPrice={spotPrice}
                    atmStrike={atmStrike}
                    maxPain={maxPain}
                    displayMode={displayMode}
                  />
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-zinc-800/60 rounded p-6">
                    <span className="inline-block p-1 bg-zinc-900 border border-zinc-800 rounded">
                      <Grid className="w-6 h-6 text-zinc-600 animate-pulse" />
                    </span>
                    <p className="text-xs font-bold text-zinc-400 mt-2">Connecting to broker feed...</p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between text-[9px] font-bold text-zinc-600 border-t border-zinc-800/40 pt-2">
                <span>Left: Call OI (Resistance)</span>
                <span>Center: Strike price (ATM)</span>
                <span>Right: Put OI (Support)</span>
              </div>
            </div>



            {/* Timeline Scrubber Container Placeholder */}
            <div className="bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-sky-400" />
                  <span>Timeline Scrubber</span>
                </div>
                <span>09:15 AM - 03:30 PM</span>
              </div>
              
              <div className="w-full h-1.5 bg-zinc-900/60 border border-zinc-800/60 rounded-full relative">
                <div className="absolute left-0 w-2.5 h-2.5 bg-zinc-700 border border-zinc-800 rounded-full -top-0.5 shadow"></div>
              </div>
              <div className="flex justify-between text-[9px] font-bold text-zinc-600 mt-2">
                <span>09:15 AM</span>
                <span>12:00 PM</span>
                <span>03:30 PM</span>
              </div>
            </div>

          </main>

          {/* ---------------- RIGHT PANEL (AI & Risk Insights) ---------------- */}
          <aside className="lg:col-span-3 space-y-4">
            
            {/* AI Decision Panel Placeholder */}
            <div className="bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/60">
                <Brain className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-extrabold uppercase tracking-widest text-zinc-300">AI Decision Radar</span>
              </div>
              <div className="bg-zinc-950/40 border border-zinc-800/60 rounded p-3 text-center space-y-1">
                <span className="text-[10px] font-extrabold text-zinc-500 uppercase tracking-widest block">AI Sentiment Bias</span>
                <span className="text-sm font-extrabold text-zinc-600 block mt-1">NO DATA ACTIVE</span>
                <div className="w-full bg-zinc-900/60 rounded-full h-1.5 mt-2">
                  <div className="bg-zinc-800 h-1.5 rounded-full w-1/2"></div>
                </div>
              </div>
            </div>

            {/* Key Levels Placeholder */}
            <div className="bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/60">
                <Shield className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-extrabold uppercase tracking-widest text-zinc-300">Support / Resistance</span>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] p-2 bg-zinc-900/30 border border-zinc-800/40 rounded">
                  <span className="font-bold text-rose-500">Resistance Zone</span>
                  <span className="font-extrabold text-zinc-500">--.--</span>
                </div>
                <div className="flex items-center justify-between text-[11px] p-2 bg-zinc-900/30 border border-zinc-800/40 rounded">
                  <span className="font-bold text-emerald-400">Support Zone</span>
                  <span className="font-extrabold text-zinc-500">--.--</span>
                </div>
              </div>
            </div>

            {/* Market Structure Placeholder */}
            <div className="bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/60">
                <TrendingUp className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-extrabold uppercase tracking-widest text-zinc-300">Option Distribution</span>
              </div>
              <div className="space-y-1.5 text-center">
                <div className="flex justify-between text-[10px] font-bold text-zinc-500 mb-1">
                  <span>CE Writing</span>
                  <span>PE Writing</span>
                </div>
                <div className="w-full bg-zinc-900/60 rounded h-3 overflow-hidden flex">
                  <div className="bg-zinc-800 h-full w-1/2 border-r border-zinc-900"></div>
                  <div className="bg-zinc-800 h-full w-1/2"></div>
                </div>
                <span className="text-[9px] font-bold text-zinc-600 block mt-1">Equidistant open interest structure</span>
              </div>
            </div>

          </aside>

        </div>

        {/* ==================== 3. STACKED VERTICAL COLUMN CHARTS (FULLSCREEN WIDTH) ==================== */}
        <div className="w-full space-y-4 my-2">
          {/* 2. Open Interest Total Columns Chart (Stolo Vertical Paired Chart with Side-Skew Panel) */}
          {oc && visibleRows.length > 0 ? (
            <VerticalColumnChart
              rows={visibleRows}
              sortedRows={sortedRows}
              spotPrice={spotPrice}
              atmStrike={atmStrike}
              maxPain={maxPain}
              displayMode="Total OI"
              isChangeChart={false}
              expiryDate={selectedExpiry}
              symbol={symbol}
            />
          ) : null}

          {/* 3. Open Interest Change in Value Terms Columns Chart (Stolo Vertical Paired Chart with Side-Skew Panel) */}
          {oc && visibleRows.length > 0 ? (
            <VerticalColumnChart
              rows={visibleRows}
              sortedRows={sortedRows}
              spotPrice={spotPrice}
              atmStrike={atmStrike}
              maxPain={maxPain}
              displayMode="Change OI"
              isChangeChart={true}
              expiryDate={selectedExpiry}
              symbol={symbol}
            />
          ) : null}
        </div>

        {/* ==================== 4. BOTTOM ANALYTICS ROW ==================== */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 w-full">
          
          {/* Card 1: Implied Range */}
          <div className="bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/40">
              <Compass className="w-4 h-4 text-sky-400" />
              <span className="text-xs font-extrabold uppercase tracking-widest text-zinc-300">Implied Range</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-zinc-500 font-bold">
                <span>Expected Range High:</span>
                <span className="text-zinc-400 tabular-nums">--</span>
              </div>
              <div className="flex justify-between text-zinc-500 font-bold">
                <span>Expected Range Low:</span>
                <span className="text-zinc-400 tabular-nums">--</span>
              </div>
              <div className="flex justify-between text-zinc-500 font-bold">
                <span>Implied Volatility (IV):</span>
                <span className="text-zinc-400 tabular-nums">--%</span>
              </div>
            </div>
          </div>

          {/* Card 2: Institutional Flow */}
          <div className="bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/40">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-extrabold uppercase tracking-widest text-zinc-300">Institutional Flow</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-zinc-500 font-bold">
                <span>Net FII Option Action:</span>
                <span className="text-zinc-400 tabular-nums">--</span>
              </div>
              <div className="flex justify-between text-zinc-500 font-bold">
                <span>Pro Writer Momentum:</span>
                <span className="text-zinc-400 tabular-nums">--</span>
              </div>
              <div className="flex justify-between text-zinc-500 font-bold">
                <span>Smart Money Skew:</span>
                <span className="text-zinc-400 tabular-nums">--</span>
              </div>
            </div>
          </div>

          {/* Card 3: OI Concentration */}
          <div className="bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/40">
              <Percent className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-extrabold uppercase tracking-widest text-zinc-300">OI Concentration</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-zinc-500 font-bold">
                <span>Dominant Striking Zone:</span>
                <span className="text-zinc-400 tabular-nums">--</span>
              </div>
              <div className="flex justify-between text-zinc-500 font-bold">
                <span>Gamma Risk Cluster:</span>
                <span className="text-zinc-400 tabular-nums">--</span>
              </div>
              <div className="flex justify-between text-zinc-500 font-bold">
                <span>Uncovered Risk Zone:</span>
                <span className="text-zinc-400 tabular-nums">--</span>
              </div>
            </div>
          </div>

          {/* Card 4: Intraday OI Delta */}
          <div className="bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/40">
              <Activity className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-extrabold uppercase tracking-widest text-zinc-300">Intraday OI Delta</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-zinc-500 font-bold">
                <span>Accumulation Velocity:</span>
                <span className="text-zinc-400 tabular-nums">--</span>
              </div>
              <div className="flex justify-between text-zinc-500 font-bold">
                <span>Unwinding Rate:</span>
                <span className="text-zinc-400 tabular-nums">--</span>
              </div>
              <div className="flex justify-between text-zinc-500 font-bold">
                <span>Call vs Put Divergence:</span>
                <span className="text-zinc-400 tabular-nums">--</span>
              </div>
            </div>
          </div>

        </div>

      </div>
    </DashboardShell>
  );
}

export const Route = createFileRoute("/oi-analysis-pro")({
  head: () => ({
    meta: [
      {
        title: "OI Analysis Pro — Advanced Option Interest Terminal",
      },
      {
        name: "description",
        content: "Advanced Open Interest visualizer, sentiment analysis and volume profiles.",
      },
    ],
  }),
  component: Page,
});
