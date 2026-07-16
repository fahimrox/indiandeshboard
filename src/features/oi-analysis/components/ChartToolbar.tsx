import { memo } from "react";
import type { ChartMode, DataStatus } from "../types";

interface Props {
  mode: ChartMode;
  onModeChange: (m: ChartMode) => void;
  lastUpdated: string;
  dataStatus: DataStatus;
  showLot: boolean;
  onShowLotChange: (v: boolean) => void;
}

const STATUS_STYLES: Record<DataStatus, { label: string; dot: string; box: string }> = {
  LIVE: {
    label: "LIVE",
    dot: "bg-emerald-400 animate-pulse",
    box: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  },
  EOD: {
    label: "EOD",
    dot: "bg-amber-400",
    box: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  },
  HISTORICAL: {
    label: "HISTORICAL",
    dot: "bg-blue-400",
    box: "border-blue-500/40 bg-blue-500/10 text-blue-400",
  },
  FAIL: {
    label: "FAIL",
    dot: "bg-rose-500",
    box: "border-rose-500/40 bg-rose-500/10 text-rose-400",
  },
};

const MODES: ReadonlyArray<{ id: ChartMode; label: string }> = [
  { id: "OI_CHANGE_TOTAL", label: "OI Change + Total" },
  { id: "OI_CHANGE", label: "OI Change" },
  { id: "TOTAL_OI", label: "Total OI" },
];

function ChartToolbarBase({
  mode,
  onModeChange,
  lastUpdated,
  dataStatus,
  showLot,
  onShowLotChange,
}: Props) {
  const time = new Date(lastUpdated);
  const timeStr = isNaN(time.getTime())
    ? lastUpdated
    : time.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
  const status = STATUS_STYLES[dataStatus];

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex gap-1 rounded-xl bg-slate-800/60 p-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => onModeChange(m.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === m.id ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-700/50"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 text-xs text-slate-300">
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-slate-400">Show Lot</span>
          <button
            onClick={() => onShowLotChange(!showLot)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${showLot ? "bg-sky-600" : "bg-slate-600"}`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${showLot ? "translate-x-4.5" : "translate-x-0.5"}`}
            />
          </button>
        </label>
        <span
          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 font-bold uppercase tracking-wider ${status.box}`}
        >
          <span className={`h-2 w-2 rounded-full ${status.dot}`} />
          {status.label}
        </span>
        <span className="tabular-nums text-slate-400">{timeStr}</span>
      </div>
    </div>
  );
}

export const ChartToolbar = memo(ChartToolbarBase);
