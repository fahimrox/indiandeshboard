import { useMemo, useState } from "react";
import type { TimePresetId, TimeWindow } from "../types";

const MIN: Record<Exclude<TimePresetId, "all">, number> = {
  "3m": 3,
  "5m": 5,
  "10m": 10,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "2h": 120,
  "3h": 180,
};

function tradingDayBoundaries(baseTs: number) {
  const start = new Date(baseTs);
  start.setHours(9, 15, 0, 0);
  const end = new Date(baseTs);
  end.setHours(15, 30, 0, 0);
  return { dayStart: start.getTime(), dayEnd: end.getTime() };
}

function fractionOfDay(ts: number, dayStart: number, dayEnd: number): number {
  const range = dayEnd - dayStart;
  if (range <= 0) return 0;
  return Math.max(0, Math.min(1, (ts - dayStart) / range));
}

interface UseTimeWindowReturn {
  window: TimeWindow;
  setPreset: (id: string) => void;
  start: number;
  end: number;
  onRangeChange: (s: number, e: number) => void;
  dayStart: number;
  dayEnd: number;
}

export function useTimeWindow(
  mode: "LIVE" | "HISTORICAL",
  historicalDate?: string,
  latestSnapshotTs?: number, // Actual timestamp from the most recent snapshot
): UseTimeWindowReturn {
  const [preset, setPreset] = useState<TimePresetId>("all");
  const [startFraction, setStartFraction] = useState(0);
  const [endFraction, setEndFraction] = useState(1);
  const [isManual, setIsManual] = useState(false);

  // baseTs is the reference point for time calculations.
  // CRITICAL: Must use actual snapshot timestamp, not wall clock time.
  // For LIVE/EOD mode: use the latest snapshot's timestamp
  // For HISTORICAL mode: use the latest snapshot from the selected date
  const baseTs = useMemo(() => {
    if (latestSnapshotTs && latestSnapshotTs > 0) {
      // Use actual snapshot timestamp - this works for both LIVE and HISTORICAL
      return latestSnapshotTs;
    }
    // Fallback only when no snapshot available yet
    if (mode === "HISTORICAL" && historicalDate) {
      return new Date(`${historicalDate}T15:30:00`).getTime();
    }
    return Date.now();
  }, [mode, historicalDate, latestSnapshotTs]);

  const { dayStart, dayEnd } = useMemo(() => tradingDayBoundaries(baseTs), [baseTs]);

  const window = useMemo<TimeWindow>(() => {
    if (isManual) {
      const range = dayEnd - dayStart;
      return {
        preset,
        fromTs: dayStart + startFraction * range,
        toTs: dayStart + endFraction * range,
      };
    }
    if (preset === "all") {
      return { preset, fromTs: dayStart, toTs: baseTs };
    }
    return {
      preset,
      fromTs: baseTs - MIN[preset] * 60_000,
      toTs: baseTs,
    };
  }, [preset, isManual, startFraction, endFraction, dayStart, dayEnd, baseTs]);

  const start = fractionOfDay(window.fromTs ?? dayStart, dayStart, dayEnd);
  const end = fractionOfDay(window.toTs ?? dayEnd, dayStart, dayEnd);

  const onRangeChange = (s: number, e: number) => {
    setStartFraction(s);
    setEndFraction(e);
    setIsManual(true);
  };

  const handlePreset = (id: string) => {
    setPreset(id as TimePresetId);
    setIsManual(false);
  };

  return {
    window,
    setPreset: handlePreset,
    start,
    end,
    onRangeChange,
    dayStart,
    dayEnd,
  };
}
