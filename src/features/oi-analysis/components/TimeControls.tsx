import { memo } from "react";
import { TIME_PRESETS } from "../utils";

interface Props {
  activePreset: string;
  onPreset: (id: string) => void;
  /** 0..1 range selection for the slider */
  start: number;
  end: number;
  onRangeChange: (start: number, end: number) => void;
  onReset: () => void;
  mode: "LIVE" | "HISTORICAL";
  historicalDate?: string;
  onHistoricalDate?: (d: string) => void;
  disabled?: boolean;
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function TimeControlsBase(p: Props) {
  const isDisabled = p.disabled ?? false;

  return (
    <div className="space-y-2">
      <div className={`flex items-center gap-2 ${isDisabled ? "opacity-40 pointer-events-none" : ""}`}>
        <button
          onClick={p.onReset}
          disabled={isDisabled}
          className="rounded-lg border border-slate-600 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Reset
        </button>
        <span className="text-xs text-slate-400">9:15 AM</span>
        <div className="relative h-1.5 flex-1 rounded-full bg-slate-700/60">
          <div
            className="absolute top-0 h-1.5 rounded-full bg-sky-500"
            style={{ left: pct(p.start), right: pct(1 - p.end) }}
          />
          <input
            type="range"
            min={0}
            max={100}
            value={p.start * 100}
            onChange={(e) => p.onRangeChange(Number(e.target.value) / 100, p.end)}
            disabled={isDisabled}
            className="pointer-events-none absolute -top-1.5 h-4 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white disabled:[&::-webkit-slider-thumb]:opacity-50"
          />
          <input
            type="range"
            min={0}
            max={100}
            value={p.end * 100}
            onChange={(e) => p.onRangeChange(p.start, Number(e.target.value) / 100)}
            disabled={isDisabled}
            className="pointer-events-none absolute -top-1.5 h-4 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white disabled:[&::-webkit-slider-thumb]:opacity-50"
          />
        </div>
        <span className="text-xs text-slate-400">3:30 PM</span>
      </div>

      <div className={`flex flex-wrap gap-1 ${isDisabled ? "opacity-40" : ""}`}>
        {TIME_PRESETS.map((t) => (
          <button
            key={t.id}
            onClick={() => p.onPreset(t.id)}
            disabled={isDisabled}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
              p.activePreset === t.id
                ? "bg-sky-600 text-white"
                : "bg-slate-800/60 text-slate-300 hover:bg-slate-700/50"
            }`}
          >
            {t.label}
          </button>
        ))}
        {p.mode === "HISTORICAL" && p.onHistoricalDate && (
          <input
            type="date"
            value={p.historicalDate ?? ""}
            onChange={(e) => p.onHistoricalDate?.(e.target.value)}
            className="ml-auto rounded-lg border border-slate-700/50 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-500"
          />
        )}
      </div>
    </div>
  );
}

export const TimeControls = memo(TimeControlsBase);
