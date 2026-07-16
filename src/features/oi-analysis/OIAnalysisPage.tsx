import { useState, useMemo, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/useDebounce";
import { useMarketOpen } from "@/hooks/useMarketOpen";
import {
  optionChainQuery,
  cachedOptionChainQuery,
  historicalOptionQuery,
  historicalOiActivityQuery,
} from "@/lib/dashboard-query";
import { OISidebar } from "./components/OISidebar";
import { ChartToolbar } from "./components/ChartToolbar";
import { OIChart } from "./components/OIChart";
import { TimeControls } from "./components/TimeControls";
import { BottomPanels } from "./components/BottomPanels";
import { useOIAnalysis } from "./hooks/useOIAnalysis";
import { useTimeWindow } from "./hooks/useTimeWindow";
import {
  transformOptionChainToSnapshot,
  transformHistoricalToSnapshot,
  selectHistoricalSnapshots,
} from "./transformOptionChain";
import type { OISnapshot, IndexSymbol, DataStatus } from "./types";

interface OIAnalysisPageProps {
  brokerOnline: boolean;
}

export default function OIAnalysisPage(props: OIAnalysisPageProps) {
  const [symbol, setSymbol] = useState<IndexSymbol>("NIFTY");
  const [mode, setMode] = useState<"LIVE" | "HISTORICAL">("LIVE");
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [historicalDate, setHistoricalDate] = useState<string | undefined>();
  const [showLot, setShowLot] = useState(false);
  const marketOpen = useMarketOpen();
  const showEod = mode === "LIVE" && !marketOpen;

  const debouncedSymbol = useDebounce(symbol, 400);
  const debouncedExpiry = useDebounce(selectedExpiry, 400);
  const debouncedHistoricalDate = useDebounce(historicalDate, 400);

  // LIVE mode queries
  const liveQuery = useQuery({
    ...optionChainQuery(debouncedSymbol, undefined, debouncedExpiry),
    enabled: mode === "LIVE" && !showEod,
    placeholderData: keepPreviousData,
  });
  const cacheQuery = useQuery({
    ...cachedOptionChainQuery(debouncedSymbol, debouncedExpiry),
    enabled: mode === "LIVE" && showEod,
    placeholderData: keepPreviousData,
  });

  // HISTORICAL mode queries
  const historicalOptionQueryResult = useQuery({
    ...historicalOptionQuery(
      debouncedSymbol,
      debouncedHistoricalDate ?? "",
      debouncedExpiry,
      undefined, // Could add interval support later
    ),
    enabled: mode === "HISTORICAL" && !!debouncedHistoricalDate,
    placeholderData: keepPreviousData,
  });

  const historicalOiQueryResult = useQuery({
    ...historicalOiActivityQuery(
      debouncedSymbol,
      debouncedHistoricalDate ?? "",
      debouncedExpiry,
      undefined,
    ),
    enabled: mode === "HISTORICAL" && !!debouncedHistoricalDate,
    placeholderData: keepPreviousData,
  });

  // For LIVE mode: fetch today's historical snapshots to hydrate the buffer
  // This provides comparison snapshots even after page reload or market close
  const todayDate = useMemo(() => {
    const now = new Date();
    return now.toISOString().split("T")[0]; // YYYY-MM-DD
  }, []);

  const liveModeHistoryQuery = useQuery({
    ...historicalOptionQuery(
      debouncedSymbol,
      todayDate,
      debouncedExpiry,
      undefined,
    ),
    enabled: mode === "LIVE",
    staleTime: 60_000, // Cache for 1 minute
    placeholderData: keepPreviousData,
  });

  const liveModeOiQuery = useQuery({
    ...historicalOiActivityQuery(
      debouncedSymbol,
      todayDate,
      debouncedExpiry,
      undefined,
    ),
    enabled: mode === "LIVE",
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  // Build a REACTIVE chronological snapshot series for LIVE-mode windowing.
  // Each entry is a real backend parent snapshot (unique trading_time) transformed
  // into an OISnapshot with strike-level OI. This replaces the old silently-mutated
  // module Map so React recomputes windows whenever the series changes.
  const liveHistorySnapshots = useMemo<OISnapshot[]>(() => {
    if (mode !== "LIVE") return [];
    const optData = liveModeHistoryQuery.data;
    const oiData = liveModeOiQuery.data;
    if (!optData?.success || !optData.data?.length) return [];
    if (!oiData?.success || !oiData.data?.length) return [];

    // Index OI activity rows by the true parent-snapshot identity for O(1) lookup.
    const oiByKey = new Map<string, any[]>();
    for (const row of oiData.data) {
      const k = `${row.trading_date}|${row.trading_time}|${row.symbol}|${row.expiry}`;
      const bucket = oiByKey.get(k);
      if (bucket) bucket.push(row);
      else oiByKey.set(k, [row]);
    }

    const out: OISnapshot[] = [];
    for (const snap of optData.data) {
      // Only include snapshots matching the current selection.
      if (snap.symbol !== debouncedSymbol) continue;
      if (debouncedExpiry && snap.expiry !== debouncedExpiry) continue;

      const k = `${snap.trading_date}|${snap.trading_time}|${snap.symbol}|${snap.expiry}`;
      const rows = oiByKey.get(k);
      if (!rows?.length) continue;

      try {
        out.push(transformHistoricalToSnapshot(snap, rows, undefined));
      } catch {
        // skip malformed snapshot
      }
    }

    // Chronological ascending by real timestamp (IST-derived epoch ms).
    out.sort(
      (a, b) => new Date(a.lastUpdated).getTime() - new Date(b.lastUpdated).getTime(),
    );
    return out;
  }, [mode, liveModeHistoryQuery.data, liveModeOiQuery.data, debouncedSymbol, debouncedExpiry]);

  // Determine latest snapshot timestamp for time window calculations.
  // CRITICAL: must use the real data timestamp, never Date.now().
  const latestSnapshotTs = useMemo(() => {
    if (mode === "LIVE") {
      // Freshest live tick uses OptionChain.updatedAt (epoch ms).
      const optionChain = showEod ? cacheQuery.data : liveQuery.data;
      let latest = 0;
      const liveTs = optionChain?.updatedAt ? Number(optionChain.updatedAt) : 0;
      if (isFinite(liveTs) && liveTs > latest) latest = liveTs;
      // Also consider the latest backend snapshot in the series.
      const lastSeries = liveHistorySnapshots[liveHistorySnapshots.length - 1];
      if (lastSeries) {
        const ts = new Date(lastSeries.lastUpdated).getTime();
        if (isFinite(ts) && ts > latest) latest = ts;
      }
      return latest > 0 ? latest : undefined;
    } else if (mode === "HISTORICAL") {
      const optData = historicalOptionQueryResult.data;
      if (optData?.success && optData.data?.length) {
        // Use the real epoch-ms timestamp of the newest snapshot.
        const last = optData.data[optData.data.length - 1];
        const ts = Number(last?.timestamp);
        if (isFinite(ts) && ts > 0) return ts;
      }
    }
    return undefined;
  }, [
    mode,
    showEod,
    liveQuery.data,
    cacheQuery.data,
    liveHistorySnapshots,
    historicalOptionQueryResult.data,
  ]);

  const {
    window: timeWindow,
    setPreset,
    start,
    end,
    onRangeChange,
    dayStart,
    dayEnd,
  } = useTimeWindow(mode, historicalDate, latestSnapshotTs);

  // Select active query based on mode
  const activeQuery =
    mode === "HISTORICAL" ? historicalOptionQueryResult : showEod ? cacheQuery : liveQuery;
  const isPending = activeQuery.isPending;
  const isFetching = activeQuery.isFetching;
  const error = activeQuery.error;

  // Detect if we're changing selection (symbol/date/expiry mismatch with data)
  const isChangingSelection = useMemo(() => {
    if (mode === "LIVE") {
      const optionChain = showEod ? cacheQuery.data : liveQuery.data;
      if (!optionChain) return false;
      return (
        optionChain.symbol !== debouncedSymbol ||
        (debouncedExpiry && optionChain.expiry !== debouncedExpiry)
      );
    } else if (mode === "HISTORICAL") {
      const optData = historicalOptionQueryResult.data;
      if (!optData?.success || !optData.data?.length) return false;
      const firstSnap = optData.data[0];
      return (
        firstSnap.symbol !== debouncedSymbol ||
        firstSnap.trading_date !== debouncedHistoricalDate ||
        (debouncedExpiry && firstSnap.expiry !== debouncedExpiry)
      );
    }
    return false;
  }, [
    mode,
    showEod,
    liveQuery.data,
    cacheQuery.data,
    historicalOptionQueryResult.data,
    debouncedSymbol,
    debouncedExpiry,
    debouncedHistoricalDate,
  ]);

  const [liveExpiries, setLiveExpiries] = useState<string[] | null>(null);

  useEffect(() => {
    if (mode === "LIVE") {
      const optionChain = showEod ? cacheQuery.data : liveQuery.data;
      if (optionChain?.expiries?.length) {
        setLiveExpiries(optionChain.expiries);
      }
    } else if (mode === "HISTORICAL" && historicalOptionQueryResult.data?.success) {
      // Extract unique expiries from historical data
      const histExpiries = Array.from(
        new Set(historicalOptionQueryResult.data.data.map((s: any) => s.expiry)),
      ).sort();
      if (histExpiries.length > 0) {
        setLiveExpiries(histExpiries as string[]);
      }
    }
  }, [mode, liveQuery.data, cacheQuery.data, showEod, historicalOptionQueryResult.data]);

  // Expiries come strictly from real option-chain data — no hardcoded/mock list.
  const expiries = liveExpiries ?? [];

  useEffect(() => {
    if (expiries.length > 0 && !expiries.includes(selectedExpiry)) {
      setSelectedExpiry(expiries[0]);
    }
  }, [expiries, selectedExpiry]);

  const handleSymbolChange = (s: IndexSymbol) => {
    setSymbol(s);
    setLiveExpiries(null);
    setSelectedExpiry("");
  };

  // REAL data only. Transform live or historical data into OISnapshot format.
  // Never fabricate data — show FAIL state when no real data available.
  // Validate that data matches current selection to prevent stale data display.
  const snapshot = useMemo<OISnapshot | null>(() => {
    // If actively changing selection, don't transform stale data
    if (isChangingSelection && isFetching) return null;

    if (mode === "LIVE") {
      const optionChain = showEod ? cacheQuery.data : liveQuery.data;
      if (!optionChain || !optionChain.rows?.length) return null;

      // Validate data matches current selection
      if (optionChain.symbol !== debouncedSymbol) return null;
      if (debouncedExpiry && optionChain.expiry && optionChain.expiry !== debouncedExpiry)
        return null;

      try {
        return transformOptionChainToSnapshot(optionChain);
      } catch (e) {
        console.warn("OptionChain transform failed:", e);
        return null;
      }
    } else if (mode === "HISTORICAL") {
      // Historical mode: use real saved snapshots
      const optData = historicalOptionQueryResult.data;
      const oiData = historicalOiQueryResult.data;

      if (!optData?.success || !optData.data?.length) return null;
      if (!oiData?.success || !oiData.data?.length) return null;

      // Validate both datasets match current selection
      const firstOptSnap = optData.data[0];
      const firstOiRow = oiData.data[0];

      if (
        firstOptSnap.symbol !== debouncedSymbol ||
        firstOptSnap.trading_date !== debouncedHistoricalDate
      )
        return null;
      if (
        firstOiRow.symbol !== debouncedSymbol ||
        firstOiRow.trading_date !== debouncedHistoricalDate
      )
        return null;

      // Select snapshots for the time window
      const [currentSnap, comparisonSnap] = selectHistoricalSnapshots(
        optData.data,
        timeWindow.fromTs,
        timeWindow.toTs,
      );

      if (!currentSnap) return null;

      // Validate current snapshot matches selection
      if (currentSnap.symbol !== debouncedSymbol) return null;
      if (debouncedExpiry && currentSnap.expiry !== debouncedExpiry) return null;

      // Filter OI activity rows for the current snapshot
      // Match by trading_date, trading_time, symbol, and expiry
      const currentOiRows = oiData.data.filter(
        (row: any) =>
          row.trading_date === currentSnap.trading_date &&
          row.trading_time === currentSnap.trading_time &&
          row.symbol === currentSnap.symbol &&
          row.expiry === currentSnap.expiry,
      );

      if (!currentOiRows.length) return null;

      try {
        return transformHistoricalToSnapshot(
          currentSnap,
          currentOiRows,
          comparisonSnap ?? undefined,
        );
      } catch (e) {
        console.warn("Historical transform failed:", e);
        return null;
      }
    }

    return null;
  }, [
    mode,
    showEod,
    liveQuery.data,
    cacheQuery.data,
    historicalOptionQueryResult.data,
    historicalOiQueryResult.data,
    timeWindow.fromTs,
    timeWindow.toTs,
    debouncedSymbol,
    debouncedExpiry,
    debouncedHistoricalDate,
    isChangingSelection,
    isFetching,
  ]);

  // Data source status for the badge: LIVE, EOD, HISTORICAL, or FAIL
  const dataStatus = useMemo<DataStatus>(() => {
    if (!snapshot) return "FAIL";

    if (mode === "HISTORICAL") {
      return "HISTORICAL";
    }

    const optionChain = showEod ? cacheQuery.data : liveQuery.data;
    if (!optionChain) return "FAIL";

    const meta = (optionChain as { _metadata?: { source?: string } })._metadata;
    const isEodData =
      (optionChain as { isEod?: boolean }).isEod === true || meta?.source === "cache";
    if (marketOpen) return isEodData ? "FAIL" : "LIVE";
    return isEodData ? "EOD" : "LIVE";
  }, [snapshot, mode, showEod, cacheQuery.data, liveQuery.data, marketOpen]);

  // Reflect the selected time window in the change bars.
  // Both modes now derive the baseline from the REAL reactive backend snapshot
  // series (no mutable module store, no synthetic scaling).
  const windowedResult = useMemo<{
    snapshot: OISnapshot | null;
    hasInsufficientHistory: boolean;
  }>(() => {
    if (!snapshot) return { snapshot: null, hasInsufficientHistory: false };

    // HISTORICAL mode: snapshot is already windowed by selectHistoricalSnapshots.
    // Report insufficient history when no valid comparison snapshot exists.
    if (mode === "HISTORICAL") {
      const optData = historicalOptionQueryResult.data;
      if (!optData?.success || !optData.data?.length)
        return { snapshot, hasInsufficientHistory: false };

      const [, comparisonSnap] = selectHistoricalSnapshots(
        optData.data,
        timeWindow.fromTs,
        timeWindow.toTs,
      );

      const insufficientHistory =
        timeWindow.fromTs !== null && timeWindow.fromTs > dayStart && !comparisonSnap;

      return { snapshot, hasInsufficientHistory: insufficientHistory };
    }

    // LIVE mode:
    // Full day ("All" preset) → show the snapshot as-is.
    if (timeWindow.fromTs === null || timeWindow.fromTs <= dayStart) {
      return { snapshot, hasInsufficientHistory: false };
    }

    // Select baseline from the reactive series: nearest snapshot at-or-before the
    // window start, strictly older than the current snapshot.
    const currentTs = new Date(snapshot.lastUpdated).getTime();
    let baseline: OISnapshot | null = null;
    for (const s of liveHistorySnapshots) {
      const ts = new Date(s.lastUpdated).getTime();
      if (ts <= timeWindow.fromTs && ts < currentTs) baseline = s;
      else if (ts > timeWindow.fromTs) break;
    }

    // No valid comparison snapshot → honest insufficient-history state.
    if (!baseline) {
      return { snapshot, hasInsufficientHistory: true };
    }

    // Compute real signed OI change = current − baseline, per strike and totals.
    const baseCall = new Map(baseline.strikes.map((s) => [s.strike, s.callTotalOI]));
    const basePut = new Map(baseline.strikes.map((s) => [s.strike, s.putTotalOI]));
    const strikes = snapshot.strikes.map((s) => {
      const bc = baseCall.get(s.strike);
      const bp = basePut.get(s.strike);
      return {
        ...s,
        callOIChange: bc !== undefined ? s.callTotalOI - bc : s.callOIChange,
        putOIChange: bp !== undefined ? s.putTotalOI - bp : s.putOIChange,
      };
    });

    return {
      snapshot: {
        ...snapshot,
        strikes,
        totalCallOIChange: snapshot.totalCallOI - baseline.totalCallOI,
        totalPutOIChange: snapshot.totalPutOI - baseline.totalPutOI,
      },
      hasInsufficientHistory: false,
    };
  }, [
    mode,
    snapshot,
    liveHistorySnapshots,
    timeWindow.fromTs,
    timeWindow.toTs,
    dayStart,
    historicalOptionQueryResult.data,
  ]);

  const windowedSnapshot = windowedResult.snapshot;
  const hasInsufficientHistory = windowedResult.hasInsufficientHistory;

  const view = useOIAnalysis({ snapshot: windowedSnapshot });

  // Show loading state for first load or when changing selection
  const showLoadingOverlay = (isPending && !windowedSnapshot) || (isChangingSelection && isFetching);

  if (showLoadingOverlay) {
    return (
      <div className="flex h-[70vh] items-center justify-center text-slate-400">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-700 border-t-sky-500" />
          <span className="text-sm">
            {isChangingSelection ? "Changing selection..." : "Loading option chain data..."}
          </span>
        </div>
      </div>
    );
  }

  // No real data available (all live sources + EOD cache failed, or transform
  // failed, or no historical data for selected date). Show an explicit FAIL state.
  if (!windowedSnapshot || !view.sentiment) {
    let errorTitle = "FAIL";
    let errorMessage = "Data unavailable.";
    let errorDetail = "Waiting for a valid data source\u2026";

    if (mode === "HISTORICAL") {
      errorTitle = "NO DATA";
      errorMessage = !historicalDate
        ? "Please select a historical trading date above."
        : `No historical data available for ${symbol} on ${historicalDate}.`;
      errorDetail =
        "Historical data is collected during market hours. Earlier dates may not have saved snapshots.";
    } else if (marketOpen) {
      errorMessage = "Live option-chain feed unavailable from all sources.";
      errorDetail = error
        ? "Broker/feed error. Retrying automatically."
        : "Waiting for a valid data source\u2026";
    } else {
      errorMessage = "No end-of-day (EOD) data available for this symbol/expiry.";
      errorDetail = error
        ? "Cache read error. Check data integrity."
        : "Waiting for cached data\u2026";
    }

    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-3 text-center">
        <span className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-sm font-bold uppercase tracking-wider text-rose-400">
          {errorTitle}
        </span>
        <p className="text-sm text-slate-400">{errorMessage}</p>
        <p className="text-xs text-slate-600">{errorDetail}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-slate-950 p-3 text-slate-200">
      <div className="flex w-full min-w-0 flex-col gap-3 xl:flex-row">
        <OISidebar
          symbol={symbol}
          onSymbolChange={handleSymbolChange}
          mode={mode}
          onModeChange={setMode}
          expiries={expiries}
          selectedExpiry={selectedExpiry}
          onExpiryChange={setSelectedExpiry}
          strikeDepth={view.strikeDepth}
          onStrikeDepthChange={view.setStrikeDepth}
          snapshot={windowedSnapshot}
          sentiment={view.sentiment}
        />
        <main className="flex min-w-0 flex-1 flex-col gap-3">
          <section className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-3">
            <ChartToolbar
              mode={view.chartMode}
              onModeChange={view.setChartMode}
              lastUpdated={windowedSnapshot.lastUpdated}
              dataStatus={dataStatus}
              showLot={showLot}
              onShowLotChange={setShowLot}
            />
            {hasInsufficientHistory && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                <svg
                  className="h-4 w-4 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <span>
                  <strong>Insufficient History:</strong> Not enough snapshots recorded for selected
                  time window. Showing current data without window comparison.
                </span>
              </div>
            )}
            <div className="mt-3">
              <OIChart
                snapshot={windowedSnapshot}
                strikes={view.visibleStrikes}
                mode={view.chartMode}
                height={420}
              />
            </div>
            <div className="mt-3 border-t border-slate-700/40 pt-3">
              <TimeControls
                activePreset={timeWindow.preset}
                onPreset={setPreset}
                start={start}
                end={end}
                onRangeChange={onRangeChange}
                onReset={() => {
                  setPreset("all");
                }}
                mode={mode}
                historicalDate={historicalDate}
                onHistoricalDate={setHistoricalDate}
                disabled={
                  mode === "HISTORICAL" &&
                  (!historicalDate ||
                    !historicalOptionQueryResult.data?.success ||
                    historicalOptionQueryResult.data.data.length === 0)
                }
              />
            </div>
          </section>
          <BottomPanels snapshot={windowedSnapshot} />
        </main>
      </div>
    </div>
  );
}
