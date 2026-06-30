import React, { useMemo, useState } from 'react';
import { OIChainRow } from '../types/oi.types';
import { ArrowUpDown, HelpCircle, Shield, TrendingUp, TrendingDown, EyeOff } from 'lucide-react';

interface OIStrikeTableProps {
  chain: OIChainRow[];
  showLot: boolean;
  hideChurn: boolean;
}

type SortField = 'strike' | 'ceOI' | 'peOI' | 'ceChange' | 'peChange' | 'moneyFlow' | 'pcr';
type SortOrder = 'asc' | 'desc';

export const OIStrikeTable: React.FC<OIStrikeTableProps> = React.memo(({
  chain,
  showLot,
  hideChurn
}) => {
  const [sortField, setSortField] = useState<SortField>('strike');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Lot size divider (NIFTY standard = 75)
  const lotDivider = showLot ? 75 : 1;

  // Process data based on filters
  const processedChain = useMemo(() => {
    let result = [...chain];
    
    // Hide high churn (high volume, low OI change)
    if (hideChurn) {
      result = result.filter(row => {
        const ceChurn = row.ce.volume > 0 && Math.abs(row.ce.oiChange) / row.ce.volume < 0.05;
        const peChurn = row.pe.volume > 0 && Math.abs(row.pe.oiChange) / row.pe.volume < 0.05;
        return !(ceChurn && peChurn);
      });
    }

    // Apply sorting
    result.sort((a, b) => {
      let valA = 0;
      let valB = 0;

      switch (sortField) {
        case 'strike':
          valA = a.strike;
          valB = b.strike;
          break;
        case 'ceOI':
          valA = a.ce.oi;
          valB = b.ce.oi;
          break;
        case 'peOI':
          valA = a.pe.oi;
          valB = b.pe.oi;
          break;
        case 'ceChange':
          valA = a.ce.oiChange;
          valB = b.ce.oiChange;
          break;
        case 'peChange':
          valA = a.pe.oiChange;
          valB = b.pe.oiChange;
          break;
        case 'moneyFlow':
          valA = a.moneyFlow;
          valB = b.moneyFlow;
          break;
        case 'pcr':
          valA = a.pcr;
          valB = b.pcr;
          break;
      }

      if (valA === valB) return 0;
      const multiplier = sortOrder === 'asc' ? 1 : -1;
      return valA > valB ? multiplier : -multiplier;
    });

    return result;
  }, [chain, hideChurn, sortField, sortOrder]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc'); // Default to desc for metric sorting
    }
  };

  // Helper render for sorting header button
  const renderHeader = (label: string, field: SortField, align: 'left' | 'center' | 'right' = 'center') => {
    const isSorted = sortField === field;
    return (
      <button
        onClick={() => toggleSort(field)}
        className={`flex items-center gap-1 hover:text-zinc-100 font-bold tracking-wider text-[10px] uppercase w-full ${
          align === 'right' ? 'justify-end text-right' : align === 'left' ? 'justify-start text-left' : 'justify-center text-center'
        }`}
      >
        <span>{label}</span>
        <ArrowUpDown className={`w-3 h-3 transition-colors ${isSorted ? 'text-sky-400' : 'text-zinc-600'}`} />
      </button>
    );
  };

  return (
    <div className="w-full bg-[#0a0a0c] border border-zinc-800/80 rounded-lg overflow-hidden select-none">
      {/* Table Header Overlay metadata */}
      <div className="bg-zinc-950 px-4 py-2 border-b border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400">
        <span className="font-semibold text-zinc-300">OPTION CHAIN STRUCTURAL AUDIT</span>
        <span className="text-[10px] bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded text-zinc-400">
          Showing {processedChain.length} Strikes
        </span>
      </div>

      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
        <table className="w-full min-w-[1000px] text-left border-collapse">
          {/* Header Row */}
          <thead className="bg-zinc-950/80 sticky top-0 border-b border-zinc-800/80 z-20 backdrop-blur-md">
            <tr>
              <th className="py-2.5 px-3 text-zinc-500 w-[140px]">
                {renderHeader('CE BUILDUP', 'ceChange', 'left')}
              </th>
              <th className="py-2.5 px-3 text-zinc-500 w-[110px]">
                {renderHeader('CE CHANGE OI', 'ceChange', 'right')}
              </th>
              <th className="py-2.5 px-3 text-zinc-500 w-[100px]">
                {renderHeader('CE TOTAL OI', 'ceOI', 'right')}
              </th>
              <th className="py-2.5 px-3 text-zinc-500 w-[90px]">
                {renderHeader('STRIKE', 'strike', 'center')}
              </th>
              <th className="py-2.5 px-3 text-zinc-500 w-[100px]">
                {renderHeader('PE TOTAL OI', 'peOI', 'left')}
              </th>
              <th className="py-2.5 px-3 text-zinc-500 w-[110px]">
                {renderHeader('PE CHANGE OI', 'peChange', 'left')}
              </th>
              <th className="py-2.5 px-3 text-zinc-500 w-[140px]">
                {renderHeader('PE BUILDUP', 'peChange', 'left')}
              </th>
              <th className="py-2.5 px-3 text-zinc-500 w-[90px]">
                {renderHeader('PCR', 'pcr', 'right')}
              </th>
              <th className="py-2.5 px-3 text-zinc-500 w-[120px]">
                {renderHeader('MONEY FLOW', 'moneyFlow', 'right')}
              </th>
            </tr>
          </thead>

          {/* Table Body */}
          <tbody className="divide-y divide-zinc-900/60 font-mono">
            {processedChain.map((row) => {
              const ceChangeSign = row.ce.oiChange >= 0;
              const peChangeSign = row.pe.oiChange >= 0;

              const isATM = row.isATM;
              const ceChurnFlag = row.ce.volume > 0 && Math.abs(row.ce.oiChange) / row.ce.volume < 0.05;
              const peChurnFlag = row.pe.volume > 0 && Math.abs(row.pe.oiChange) / row.pe.volume < 0.05;

              return (
                <tr 
                  key={row.strike}
                  className={`hover:bg-zinc-900/20 transition duration-150 text-xs ${
                    isATM ? 'bg-sky-950/10 border-y border-sky-500/20' : ''
                  }`}
                >
                  {/* CE Buildup Badge column */}
                  <td className="py-2 px-3 border-r border-zinc-900/30">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold ${
                      row.ce.buildup === 'Long Buildup'
                        ? 'bg-emerald-950/50 border border-emerald-600/30 text-emerald-400'
                        : row.ce.buildup === 'Short Buildup'
                        ? 'bg-rose-950/50 border border-rose-600/30 text-rose-400'
                        : row.ce.buildup === 'Short Covering'
                        ? 'bg-sky-950/40 border border-sky-600/30 text-sky-400'
                        : row.ce.buildup === 'Long Unwinding'
                        ? 'bg-amber-950/40 border border-amber-600/30 text-amber-500'
                        : 'text-zinc-500'
                    }`}>
                      {row.ce.buildup}
                      {ceChurnFlag && <EyeOff className="w-3 h-3 text-amber-500" title="High volume low OI change churn alert" />}
                    </span>
                  </td>

                  {/* CE Change OI */}
                  <td className={`py-2 px-3 text-right font-semibold tabular-nums border-r border-zinc-900/30 ${
                    ceChangeSign ? 'text-emerald-500' : 'text-rose-500'
                  }`}>
                    {ceChangeSign ? '+' : ''}
                    {Math.round(row.ce.oiChange / lotDivider).toLocaleString('en-IN')}
                  </td>

                  {/* CE Total OI */}
                  <td className="py-2 px-3 text-right text-zinc-300 tabular-nums border-r border-zinc-900/30">
                    {Math.round(row.ce.oi / lotDivider).toLocaleString('en-IN')}
                  </td>

                  {/* Centered Strike column */}
                  <td className="py-2 px-3 text-center border-r border-zinc-900/30 z-10 sticky left-0 bg-[#0a0a0c]">
                    <span className={`inline-block px-2 py-0.5 rounded font-bold text-xs tabular-nums ${
                      isATM 
                        ? 'bg-sky-500/15 border border-sky-500/40 text-sky-400' 
                        : 'text-zinc-200'
                    }`}>
                      {row.strike}
                    </span>
                  </td>

                  {/* PE Total OI */}
                  <td className="py-2 px-3 text-left text-zinc-300 tabular-nums border-r border-zinc-900/30">
                    {Math.round(row.pe.oi / lotDivider).toLocaleString('en-IN')}
                  </td>

                  {/* PE Change OI */}
                  <td className={`py-2 px-3 text-left font-semibold tabular-nums border-r border-zinc-900/30 ${
                    peChangeSign ? 'text-emerald-500' : 'text-rose-500'
                  }`}>
                    {peChangeSign ? '+' : ''}
                    {Math.round(row.pe.oiChange / lotDivider).toLocaleString('en-IN')}
                  </td>

                  {/* PE Buildup Badge column */}
                  <td className="py-2 px-3 border-r border-zinc-900/30">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold ${
                      row.pe.buildup === 'Long Buildup'
                        ? 'bg-emerald-950/50 border border-emerald-600/30 text-emerald-400'
                        : row.pe.buildup === 'Short Buildup'
                        ? 'bg-rose-950/50 border border-rose-600/30 text-rose-400'
                        : row.pe.buildup === 'Short Covering'
                        ? 'bg-sky-950/40 border border-sky-600/30 text-sky-400'
                        : row.pe.buildup === 'Long Unwinding'
                        ? 'bg-amber-950/40 border border-amber-600/30 text-amber-500'
                        : 'text-zinc-500'
                    }`}>
                      {row.pe.buildup}
                      {peChurnFlag && <EyeOff className="w-3 h-3 text-amber-500" title="High volume low OI change churn alert" />}
                    </span>
                  </td>

                  {/* PCR */}
                  <td className={`py-2 px-3 text-right font-semibold border-r border-zinc-900/30 tabular-nums ${
                    row.pcr >= 1 ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {row.pcr}
                  </td>

                  {/* Money Flow column */}
                  <td className={`py-2 px-3 text-right font-bold tabular-nums ${
                    row.moneyFlow >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    ₹{(row.moneyFlow / 100000).toFixed(2)}L
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});

OIStrikeTable.displayName = 'OIStrikeTable';
