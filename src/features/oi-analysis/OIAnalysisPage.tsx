import { useState, useMemo, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/useDebounce";
import { useMarketOpen } from "@/hooks/useMarketOpen";
import { optionChainQuery, cachedOptionChainQuery } from "@/lib/dashboard-query";
import { OISidebar } from "./components/OISidebar";
import { ChartToolbar } from "./components/ChartToolbar";
import { OIChart } from "./components/OIChart";
import { TimeControls } from "./components/TimeControls";
import { BottomPanels } from "./components/BottomPanels";
import { useOIAnalysis } from "./hooks/useOIAnalysis";
import { useTimeWindow } from "./hooks/useTimeWindow";
import { transformOptionChainToSnapshot } from "./transformOptionChain";
import { scaleSnapshotForWindow } from "./utils";
import { recordOISnapshot, buildWindowedSnapshot } from "./oiHistoryStore";
import type { OISnapshot, IndexSymbol, DataStatus } from "./types";

interface OIAnalysisPageProps { brokerOnline: boolean; }

export default function OIAnalysisPage(props: OIAnalysisPageProps) {
  const [symbol, setSymbol] = useState<IndexSymbol>("NIFTY");
  const [mode, setMode] = useState<"LIVE" | "HISTORICAL">("LIVE");
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [historicalDate, setHistoricalDate] = useState<string | undefined>();
  const [showLot, setShowLot] = useState(false);
  const { window: timeWindow, setPreset, start, end, onRangeChange, dayStart, dayEnd } = useTimeWindow(mode, historicalDate);

  const marketOpen = useMarketOpen();
  const showEod = mode === "LIVE" && !marketOpen;

  const debouncedSymbol = useDebounce(symbol, 400);
  const debouncedExpiry = useDebounce(selectedExpiry, 400);

  const spot: number | undefined = undefined;
  const liveQuery = useQuery({
    ...optionChainQuery(debouncedSymbol, spot, debouncedExpiry),
    enabled: !showEod,
    placeholderData: keepPreviousData,
  });
  const cacheQuery = useQuery({
    ...cachedOptionChainQuery(debouncedSymbol, debouncedExpiry),
    enabled: showEod,
    placeholderData: keepPreviousData,
  });

  const optionChain = showEod ? cacheQuery.data : liveQuery.data;
  const isPending = showEod ? cacheQuery.isPending : liveQuery.isPending;
  const error = showEod ? cacheQuery.error : liveQuery.error;

  const [liveExpiries, setLiveExpiries] = useState<string[] | null>(null);

  useEffect(() => {
    if (optionChain?.expiries?.length) {
      setLiveExpiries(optionChain.expiries);
    }
  }, [optionChain]);

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

  // REAL data only. If there's no usable option chain (all sources + EOD failed),
  // snapshot is null and the page shows a FAIL state — never fabricated data.
  const snapshot = useMemo<OISnapshot | null>(() => {
    if (!optionChain || !optionChain.rows?.length) return null;
    try {
      return transformOptionChainToSnapshot(optionChain);
    } catch (e) {
      console.warn("OptionChain transform failed:", e);
      return null;
    }
  }, [optionChain]);

  // Data source status for the badge: LIVE (real live feed), EOD (cached
  // end-of-day data while market is closed), or FAIL (no real data available).
  const dataStatus = useMemo<DataStatus>(() => {
    if (!snapshot || !optionChain) return "FAIL";
    const meta = (optionChain as { _metadata?: { source?: string } })._metadata;
    const isEodData =
      (optionChain as { isEod?: boolean }).isEod === true || meta?.source === "cache";
    if (marketOpen) return isEodData ? "FAIL" : "LIVE";
    return isEodData ? "EOD" : "LIVE";
  }, [snapshot, optionChain, marketOpen]);

  // Auto-save every fresh snapshot into the session OI-history buffer so the
  // time-window presets can compute real OI change over the selected window.
  const historyKey = `${symbol}|${selectedExpiry}`;
  useEffect(() => {
    if (snapshot) recordOISnapshot(historyKey, snapshot);
  }, [snapshot, historyKey]);

  // Reflect the selected time window (e.g. "Last 5m") in the change bars.
  // Prefer REAL recorded history; fall back to a linear approximation when the
  // buffer hasn't accumulated enough ticks yet (e.g. page just opened).
  const windowedSnapshot = useMemo<OISnapshot | null>(() => {
    if (!snapshot) return null;
    // Full day ("All" preset / slider at the far left) → show the snapshot as-is.
    if (timeWindow.fromTs === null || timeWindow.fromTs <= dayStart) return snapshot;
    const real = buildWindowedSnapshot(historyKey, snapshot, timeWindow.fromTs, timeWindow.toTs);
    if (real) return real;
    return scaleSnapshotForWindow(snapshot, timeWindow.fromTs, timeWindow.toTs, dayStart, dayEnd);
  }, [snapshot, historyKey, timeWindow.fromTs, timeWindow.toTs, dayStart, dayEnd]);

  const view = useOIAnalysis({ snapshot: windowedSnapshot });

  if (isPending && !windowedSnapshot) {
    return (
      <div className="flex h-[70vh] items-center justify-center text-slate-400">
        Loading option chain data&hellip;
      </div>
    );
  }

  // No real data available (all live sources + EOD cache failed, or transform
  // failed). Show an explicit FAIL state instead of any fabricated data.
  if (!windowedSnapshot || !view.sentiment) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-3 text-center">
        <span className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-sm font-bold uppercase tracking-wider text-rose-400">
          FAIL
        </span>
        <p className="text-sm text-slate-400">
          {marketOpen
            ? "Live option-chain feed unavailable from all sources."
            : "No end-of-day (EOD) data available for this symbol/expiry."}
        </p>
        <p className="text-xs text-slate-600">
          {error ? "Broker/feed error. Retrying automatically." : "Waiting for a valid data source\u2026"}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-slate-950 p-4 text-slate-200">
      <div className="flex w-full min-w-0 flex-col gap-4 xl:flex-row">
        <OISidebar
          symbol={symbol} onSymbolChange={handleSymbolChange}
          mode={mode} onModeChange={setMode}
          expiries={expiries} selectedExpiry={selectedExpiry} onExpiryChange={setSelectedExpiry}
          strikeDepth={view.strikeDepth} onStrikeDepthChange={view.setStrikeDepth}
          snapshot={windowedSnapshot} sentiment={view.sentiment} />
        <main className="flex min-w-0 flex-1 flex-col gap-4">
          <section className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-4">
            <ChartToolbar mode={view.chartMode} onModeChange={view.setChartMode}
              lastUpdated={windowedSnapshot.lastUpdated} dataStatus={dataStatus}
              showLot={showLot} onShowLotChange={setShowLot} />
            <div className="mt-4">
              <OIChart snapshot={windowedSnapshot} strikes={view.visibleStrikes} mode={view.chartMode} />
            </div>
            <div className="mt-4 border-t border-slate-700/40 pt-4">
              <TimeControls activePreset={timeWindow.preset} onPreset={setPreset}
                start={start} end={end} onRangeChange={onRangeChange}
                onReset={() => { setPreset("all"); }}
                mode={mode}
                historicalDate={historicalDate} onHistoricalDate={setHistoricalDate} />
            </div>
          </section>
          <BottomPanels snapshot={windowedSnapshot} />
        </main>
      </div>
    </div>
  );
}
