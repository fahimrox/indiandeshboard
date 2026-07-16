import { memo } from "react";
import { INDEX_OPTIONS, type IndexSymbol } from "../types";

interface Props {
  symbol: IndexSymbol;
  onSymbolChange: (s: IndexSymbol) => void;
  expiries: string[];
  selectedExpiry: string;
  onExpiryChange: (e: string) => void;
}

function SymbolSelectorBase(p: Props) {
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Symbol</label>
        <div className="relative">
          <select
            value={p.symbol}
            onChange={(e) => p.onSymbolChange(e.target.value as IndexSymbol)}
            className="w-full appearance-none rounded-xl border border-slate-700/50 bg-slate-800/60 px-3 py-2.5 text-sm font-semibold text-slate-100 outline-none focus:border-sky-500"
          >
            {INDEX_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
            &#9662;
          </span>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Expiry</label>
        <select
          value={p.selectedExpiry}
          onChange={(e) => p.onExpiryChange(e.target.value)}
          className="w-full rounded-xl border border-slate-700/50 bg-slate-800/60 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-sky-500"
        >
          {p.expiries.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export const SymbolSelector = memo(SymbolSelectorBase);
