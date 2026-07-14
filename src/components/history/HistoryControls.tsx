// ─── HistoryControls (Phase 2B-A1) ────────────────────────────────────────────
// Reusable, fully-controlled Live/Historical control bar. It renders UI only —
// no data fetching, no page-specific logic, and it never fabricates historical
// data. Pages own the state (typically via `useHistoryControls`) and pass values
// + change handlers down. Expiry options are always supplied by the page; nothing
// here is hardcoded.

import { memo } from "react";
import { Radio, CalendarClock, Database, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HistoricalDataSource, HistoryInterval } from "@/lib/history-types";
import { HISTORY_INTERVALS, isHistoryInterval, type HistoryMode } from "@/hooks/useHistoryControls";

export interface HistoryControlsProps {
  mode: HistoryMode;
  onModeChange: (mode: HistoryMode) => void;

  /** Selected trading date (YYYY-MM-DD); shown/edited only in HISTORICAL mode. */
  date?: string;
  onDateChange: (date: string) => void;
  /** Optional bounds for the date input (page supplies, e.g. today IST). */
  minDate?: string;
  maxDate?: string;

  interval: HistoryInterval;
  onIntervalChange: (interval: HistoryInterval) => void;

  /** Expiry is optional; the select renders only when options are provided. */
  expiry?: string;
  expiryOptions?: string[];
  onExpiryChange?: (expiry: string) => void;

  /** Lineage badge (from a history query's parsed metadata). */
  source?: HistoricalDataSource | null;
  /** The date the user asked for — used to flag a requested/actual mismatch. */
  requestedDate?: string | null;
  /** Trading dates actually returned by the backend. */
  actualDates?: string[];

  disabled?: boolean;
  variant?: "normal" | "compact";
  className?: string;
}

const SOURCE_LABEL: Record<HistoricalDataSource, string> = {
  supabase: "Supabase",
  sqlite: "SQLite",
  mixed: "Mixed",
};

const SOURCE_CLASS: Record<HistoricalDataSource, string> = {
  supabase: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  sqlite: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  mixed: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

function HistoryControlsBase({
  mode,
  onModeChange,
  date,
  onDateChange,
  minDate,
  maxDate,
  interval,
  onIntervalChange,
  expiry,
  expiryOptions,
  onExpiryChange,
  source,
  requestedDate,
  actualDates,
  disabled = false,
  variant = "normal",
  className,
}: HistoryControlsProps) {
  const compact = variant === "compact";
  const isHistorical = mode === "HISTORICAL";
  const showExpiry = !!expiryOptions?.length && !!onExpiryChange;

  const controlText = compact ? "text-[11px]" : "text-xs";
  const controlPad = compact ? "px-2 py-1" : "px-2.5 py-1.5";
  const fieldClass = cn(
    "rounded-sm border border-input bg-background text-foreground outline-none",
    "focus:border-ring disabled:cursor-not-allowed disabled:opacity-50",
    controlText,
    controlPad,
  );

  // Flag when the requested date is not among the trading dates the backend
  // actually returned. The backend only reports which dates it returned — it does
  // not guarantee it picked the "nearest" date — so wording must stay factual.
  const effectiveActual =
    actualDates && actualDates.length ? actualDates[actualDates.length - 1] : null;
  const showMismatch =
    isHistorical &&
    !!requestedDate &&
    !!effectiveActual &&
    !!actualDates?.length &&
    !actualDates.includes(requestedDate);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-sm border border-border bg-card",
        compact ? "p-1.5" : "p-2",
        className,
      )}
      role="group"
      aria-label="Historical data controls"
    >
      {/* Live / Historical toggle */}
      <div
        className="flex overflow-hidden rounded-sm border border-border bg-background/50 p-0.5"
        role="tablist"
        aria-label="Data mode"
      >
        {(["LIVE", "HISTORICAL"] as const).map((m) => {
          const active = mode === m;
          const Icon = m === "LIVE" ? Radio : CalendarClock;
          return (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={disabled}
              onClick={() => onModeChange(m)}
              className={cn(
                "flex items-center gap-1.5 rounded-none font-semibold transition-colors",
                controlText,
                compact ? "px-2 py-1" : "px-3 py-1.5",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {m === "LIVE" ? "Live" : "Historical"}
            </button>
          );
        })}
      </div>

      {isHistorical && (
        <>
          {/* Date */}
          <label className="flex items-center gap-1.5">
            <span className={cn("font-medium text-muted-foreground", controlText)}>Date</span>
            <input
              type="date"
              value={date ?? ""}
              min={minDate}
              max={maxDate}
              disabled={disabled}
              aria-label="Historical trading date"
              onChange={(e) => onDateChange(e.target.value)}
              className={cn(fieldClass, "[color-scheme:dark]")}
            />
          </label>

          {/* Interval */}
          <label className="flex items-center gap-1.5">
            <span className={cn("font-medium text-muted-foreground", controlText)}>Interval</span>
            <select
              value={interval}
              disabled={disabled}
              aria-label="Historical data interval in minutes"
              onChange={(e) => {
                const next = Number(e.target.value);
                if (isHistoryInterval(next)) onIntervalChange(next);
              }}
              className={fieldClass}
            >
              {HISTORY_INTERVALS.map((iv) => (
                <option key={iv} value={iv}>
                  {iv}m
                </option>
              ))}
            </select>
          </label>

          {/* Expiry (only when the page supplies options) */}
          {showExpiry && (
            <label className="flex items-center gap-1.5">
              <span className={cn("font-medium text-muted-foreground", controlText)}>Expiry</span>
              <select
                value={expiry ?? ""}
                disabled={disabled}
                aria-label="Historical option expiry"
                onChange={(e) => onExpiryChange?.(e.target.value)}
                className={fieldClass}
              >
                {/* Explicit placeholder so the browser never visually selects the
                    first real expiry while the controlled value is still empty. */}
                <option value="" disabled>
                  Select expiry
                </option>
                {expiryOptions!.map((ex) => (
                  <option key={ex} value={ex}>
                    {ex}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Source lineage badge */}
          {source && (
            <span
              className={cn(
                "ml-auto flex items-center gap-1 rounded-sm border px-2 py-0.5 font-bold uppercase tracking-wide",
                compact ? "text-[9px]" : "text-[10px]",
                SOURCE_CLASS[source],
              )}
              title={`Data source: ${SOURCE_LABEL[source]}`}
            >
              <Database className="h-3 w-3" />
              {SOURCE_LABEL[source]}
            </span>
          )}

          {/* Requested vs actual date mismatch */}
          {showMismatch && (
            <span
              className={cn(
                "flex items-center gap-1 rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-200",
                compact ? "text-[9px]" : "text-[10px]",
                !source && "ml-auto",
              )}
              title={`No data returned for ${requestedDate}. Available data date: ${effectiveActual}.`}
            >
              <Info className="h-3 w-3" />
              Showing {effectiveActual}
            </span>
          )}
        </>
      )}
    </div>
  );
}

export const HistoryControls = memo(HistoryControlsBase);
export default HistoryControls;
