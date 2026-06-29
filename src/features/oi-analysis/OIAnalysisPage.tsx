import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { generateMockSnapshot, getExpiries } from "./mockSnapshot";
import { transformOptionChainToSnapshot } from "./transformOptionChain";
import type { OISnapshot, IndexSymbol } from "./types";

interface OIAnalysisPageProps { brokerOnline: boolean; }

export default function OIAnalysisPage(props: OIAnalysisPageProps) {
  const [symbol, setSymbol] = useState<IndexSymbol>("NIFTY");
  const [mode, setMode] = useState<"LIVE" | "HISTORICAL">("LIVE");
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [historicalDate, setHistoricalDate] = useState<string | undefined>();
  const { window: timeWindow, setPreset, start, end, onRangeChange } = useTimeWindow(mode, historicalDate);

  const marketOpen = useMarketOpen();
  const showEod = mode === "LIVE" && !marketOpen;

  const mockExpiries = useMemo(() => getExpiries(symbol), [symbol]);

  const debouncedSymbol = useDebounce(symbol, 400);
  const debouncedExpiry = useDebounce(selectedExpiry, 400);

  const spot: number | undefined = undefined;
  const liveQuery = useQuery({
    ...optionChainQuery(debouncedSymbol, spot, debouncedExpiry),
    enabled: !showEod,
  });
  const cacheQuery = useQuery({
    ...cachedOptionChainQuery(debouncedSymbol, debouncedExpiry),
    enabled: showEod,
  });

  const optionChain = showEod ? cacheQuery.data : liveQuery.data;
  const isLoading = showEod ? cacheQuery.isLoading : liveQuery.isLoading;
  const error = showEod ? cacheQuery.error : liveQuery.error;

  const [liveExpiries, setLiveExpiries] = useState<string[] | null>(null);

  useEffect(() => {
    if (optionChain?.expiries?.length) {
      setLiveExpiries(optionChain.expiries);
    }
  }, [optionChain]);

  const expiries = liveExpiries ?? mockExpiries;

  useEffect(() => {
    if (expiries.length > 0 && !expiries.includes(selectedExpiry)) {
      setSelectedExpiry(expiries[0]);
    }
  }, [expiries, selectedExpiry]);

  const handleSymbolChange = (s: IndexSymbol) => {
    setSymbol(s);
    setLiveExpiries(null);
    const newExpiries = getExpiries(s);
    if (newExpiries.length > 0) setSelectedExpiry(newExpiries[0]);
  };

  const snapshot = useMemo<OISnapshot | null>(() => {
    if (optionChain) {
      try {
        return transformOptionChainToSnapshot(optionChain);
      } catch (e) {
        console.warn("OptionChain transform failed, falling back to mock:", e);
      }
    }
    return generateMockSnapshot(symbol);
  }, [optionChain, symbol]);

  const view = useOIAnalysis({ snapshot });

  if (isLoading && !snapshot) {
    return (
      <div className="flex h-[70vh] items-center justify-center text-slate-400">
        Loading option chain data&hellip;
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="flex h-[70vh] items-center justify-center text-slate-400">
        Failed to load data. Check broker connection.
      </div>
    );
  }

  if (!snapshot || !view.sentiment) {
    return (
      <div className="flex h-[70vh] items-center justify-center text-slate-400">
        Connecting to live market feed&hellip;
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 text-slate-200">
      <div className="flex flex-col gap-4 xl:flex-row">
        <OISidebar
          symbol={symbol} onSymbolChange={handleSymbolChange}
          mode={mode} onModeChange={setMode}
          expiries={expiries} selectedExpiry={selectedExpiry} onExpiryChange={setSelectedExpiry}
          strikeDepth={view.strikeDepth} onStrikeDepthChange={view.setStrikeDepth}
          snapshot={snapshot} sentiment={view.sentiment} />
        <main className="flex flex-1 flex-col gap-4">
          <section className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-4">
            <ChartToolbar mode={view.chartMode} onModeChange={view.setChartMode}
              lastUpdated={snapshot.lastUpdated} brokerOnline={props.brokerOnline} marketOpen={marketOpen} />
            <div className="mt-4">
              <OIChart snapshot={snapshot} strikes={view.visibleStrikes} mode={view.chartMode} />
            </div>
            <div className="mt-4 border-t border-slate-700/40 pt-4">
              <TimeControls activePreset={timeWindow.preset} onPreset={setPreset}
                start={start} end={end} onRangeChange={onRangeChange} mode={mode}
                historicalDate={historicalDate} onHistoricalDate={setHistoricalDate} />
            </div>
          </section>
          <BottomPanels snapshot={snapshot} />
        </main>
      </div>
    </div>
  );
}
