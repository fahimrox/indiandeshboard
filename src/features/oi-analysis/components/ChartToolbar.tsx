import { memo } from "react";
import type { ChartMode } from "../types";

interface Props {
  mode: ChartMode;
  onModeChange: (m: ChartMode) => void;
  lastUpdated: string;
  brokerOnline: boolean;
  marketOpen: boolean;
}

const MODES: ReadonlyArray<{ id: ChartMode; label: string }> = [
  { id: "OI_CHANGE_TOTAL", label: "OI Change + Total" },
  { id: "OI_CHANGE", label: "OI Change" },
  { id: "TOTAL_OI", label: "Total OI" },
];

function ChartToolbarBase({ mode, onModeChange, lastUpdated, brokerOnline, marketOpen }: Props) {
  const time = new Date(lastUpdated);
  const timeStr = isNaN(time.getTime())
    ? lastUpdated
    : time.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-1 rounded-xl bg-slate-800/60 p-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => onModeChange(m.id)}
            className={`rounded-lg px-4 py-2 text-xs font-medium transition-colors ${
              mode === m.id ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-700/50"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-4 text-xs text-slate-300">
        {marketOpen ? (
          <span className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${brokerOnline ? "bg-emerald-400 animate-pulse" : "bg-rose-500"}`}
            />
            {brokerOnline ? "Live" : "Offline"}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-400">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            Market Closed
          </span>
        )}
        <span className="tabular-nums text-slate-400">{timeStr}</span>
      </div>
    </div>
  );
}

export const ChartToolbar = memo(ChartToolbarBase);
