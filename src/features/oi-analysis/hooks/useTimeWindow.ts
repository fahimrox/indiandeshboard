import { useMemo, useState, useEffect, useRef } from "react";
import type { TimePresetId, TimeWindow } from "../types";

const MIN: Record<Exclude<TimePresetId, "all">, number> = {
  "3m": 3, "5m": 5, "10m": 10, "15m": 15, "30m": 30, "1h": 60, "2h": 120, "3h": 180,
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
}

export function useTimeWindow(
  mode: "LIVE" | "HISTORICAL",
  historicalDate?: string
): UseTimeWindowReturn {
  const [preset, setPreset] = useState<TimePresetId>("all");
  const [startFraction, setStartFraction] = useState(0);
  const [endFraction, setEndFraction] = useState(1);
  const [isManual, setIsManual] = useState(false);

  // In LIVE mode: baseTs must tick with real time so presets like "Last 5m" stay correct.
  // In HISTORICAL mode: baseTs is fixed at the EOD of the selected historical date.
  const [liveNow, setLiveNow] = useState(() => Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (mode === "LIVE") {
      // Tick every 60s to keep time-window presets accurate during long live sessions.
      intervalRef.current = setInterval(() => setLiveNow(Date.now()), 60_000);
    } else {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [mode]);

  const baseTs = useMemo(() => {
    if (mode === "HISTORICAL" && historicalDate) {
      return new Date(`${historicalDate}T15:30:00`).getTime();
    }
    return liveNow; // Updates every 60s in LIVE mode
  }, [mode, historicalDate, liveNow]);

  const { dayStart, dayEnd } = useMemo(
    () => tradingDayBoundaries(baseTs),
    [baseTs]
  );

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

  const start = fractionOfDay(
    window.fromTs ?? dayStart,
    dayStart,
    dayEnd
  );
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
  };
}
