import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/DashboardShell";
import { dashboardQuery, optionChainQuery } from "@/lib/dashboard-query";
import { saveIntradaySnapshot, listIntradayDates, getIntradayHistory } from "@/lib/nse.functions";

function Page() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  
  // Modes & State
  const [mode, setMode] = useState<"LIVE" | "REPLAY">("LIVE");
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [historyTicks, setHistoryTicks] = useState<any[]>([]);
  const [currentTickIndex, setCurrentTickIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Fetch live indices quotes, VIX, sectors and breadth
  const { data: dashData } = useQuery({
    ...dashboardQuery,
    enabled: mode === "LIVE",
  });

  // Fetch option chains (only in live mode)
  const { data: niftyChain } = useQuery({
    ...optionChainQuery("NIFTY"),
    enabled: mode === "LIVE",
  });
  const { data: bankniftyChain } = useQuery({
    ...optionChainQuery("BANKNIFTY"),
    enabled: mode === "LIVE",
  });
  const { data: sensexChain } = useQuery({
    ...optionChainQuery("SENSEX"),
    enabled: mode === "LIVE",
  });
  const { data: midcapChain } = useQuery({
    ...optionChainQuery("MIDCAPNIFTY"),
    enabled: mode === "LIVE",
  });

  // Fetch available dates when switching to replay mode
  useEffect(() => {
    if (mode === "REPLAY") {
      listIntradayDates().then((dates) => {
        setAvailableDates(dates);
        if (dates.length > 0) {
          // Default to latest date
          setSelectedDate(dates[dates.length - 1]);
        }
      });
    } else {
      setIsPlaying(false);
    }
  }, [mode]);

  // Load history ticks when date changes
  useEffect(() => {
    if (mode === "REPLAY" && selectedDate) {
      getIntradayHistory({ data: { date: selectedDate } }).then((ticks) => {
        if (ticks && ticks.length > 0) {
          setHistoryTicks(ticks);
          setCurrentTickIndex(0);
        } else {
          setHistoryTicks([]);
        }
      });
    }
  }, [mode, selectedDate]);

  // Handle Play/Pause interval
  useEffect(() => {
    let interval: any = null;
    if (isPlaying && historyTicks.length > 0) {
      interval = setInterval(() => {
        setCurrentTickIndex((prev) => {
          if (prev >= historyTicks.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 2000); // Playback speed (2s per tick)
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, historyTicks]);

  // Helper: transform option chain data rows
  const transformChain = (oc: any) => {
    if (!oc || !oc.rows) return [];
    return oc.rows.map((r: any) => ({
      strike: r.strike,
      ceLtp: r.ce?.ltp ?? 0,
      ceOI: r.ce?.oi ?? 0,
      ceOIc: r.ce?.oiChg ?? 0,
      ceVol: r.ce?.volume ?? 0,
      peLtp: r.pe?.ltp ?? 0,
      peOI: r.pe?.oi ?? 0,
      peOIc: r.pe?.oiChg ?? 0,
      peVol: r.pe?.volume ?? 0,
    }));
  };

  // 1. Send live updates to iframe (LIVE mode)
  useEffect(() => {
    if (mode !== "LIVE" || !iframeRef.current || !dashData) return;

    const formattedData = {
      type: "UPDATE_DATA",
      data: {
        lastUpdate: new Date().toLocaleTimeString("en-IN"),
        expiry: niftyChain?.expiry || dashData.expiry || "--",
        breadth: {
          adv: dashData.advance ?? 0,
          dec: dashData.decline ?? 0,
          unchanged: dashData.unchanged ?? 0,
        },
        vix: {
          value: dashData.vix?.price ?? 13.42,
          prevClose: dashData.vix?.prevClose ?? 12.85,
          high: dashData.vix?.dayHigh ?? 14.6,
          low: dashData.vix?.dayLow ?? 11.2,
        },
        sectors: (dashData.sectors ?? []).map((s: any) => ({
          name: s.label ?? s.symbol,
          ch: s.changePct ?? 0,
        })),
        indices: {
          NIFTY: {
            ltp: dashData.nifty?.price ?? niftyChain?.spot ?? 0,
            prevClose: dashData.nifty?.prevClose ?? 0,
            dayHigh: dashData.nifty?.dayHigh ?? 0,
            dayLow: dashData.nifty?.dayLow ?? 0,
            vwap: dashData.nifty?.price ?? 0,
            chain: transformChain(niftyChain),
          },
          BANKNIFTY: {
            ltp: dashData.bankNifty?.price ?? bankniftyChain?.spot ?? 0,
            prevClose: dashData.bankNifty?.prevClose ?? 0,
            dayHigh: dashData.bankNifty?.dayHigh ?? 0,
            dayLow: dashData.bankNifty?.dayLow ?? 0,
            vwap: dashData.bankNifty?.price ?? 0,
            chain: transformChain(bankniftyChain),
          },
          MIDCAPNIFTY: {
            ltp: midcapChain?.spot ?? 0,
            prevClose: midcapChain?.spot ?? 0,
            dayHigh: midcapChain?.spot ?? 0,
            dayLow: midcapChain?.spot ?? 0,
            vwap: midcapChain?.spot ?? 0,
            chain: transformChain(midcapChain),
          },
          SENSEX: {
            ltp: dashData.sensex?.price ?? sensexChain?.spot ?? 0,
            prevClose: dashData.sensex?.prevClose ?? 0,
            dayHigh: dashData.sensex?.dayHigh ?? 0,
            dayLow: dashData.sensex?.dayLow ?? 0,
            vwap: dashData.sensex?.price ?? 0,
            chain: transformChain(sensexChain),
          },
        },
      },
    };

    // Post to iframe
    iframeRef.current.contentWindow?.postMessage(formattedData, "*");

    // Auto-record intraday snapshot (EOD backtesting)
    if (formattedData.data.indices.NIFTY.ltp > 0) {
      const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      const time = new Date().toLocaleTimeString("en-IN");
      saveIntradaySnapshot({
        data: {
          date: today,
          timestamp: time,
          data: formattedData.data,
        },
      }).catch((e) => console.error("Error auto-recording tick:", e));
    }
  }, [mode, dashData, niftyChain, bankniftyChain, sensexChain, midcapChain]);

  // 2. Send history ticks to iframe (REPLAY mode)
  useEffect(() => {
    if (mode === "REPLAY" && historyTicks.length > 0 && iframeRef.current) {
      const activeTick = historyTicks[currentTickIndex];
      if (activeTick && activeTick.data) {
        iframeRef.current.contentWindow?.postMessage(
          { type: "UPDATE_DATA", data: activeTick.data },
          "*"
        );
      }
    }
  }, [mode, historyTicks, currentTickIndex]);

  return (
    <DashboardShell>
      <div className="flex flex-col gap-3 h-full">
        {/* Controbar for Live vs Replay */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-md">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-200">AI Lab Dashboard Mode:</span>
            <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800">
              <button
                type="button"
                onClick={() => setMode("LIVE")}
                className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-all ${
                  mode === "LIVE"
                    ? "bg-sky-600 text-white shadow-md"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                🔴 Live Feed
              </button>
              <button
                type="button"
                onClick={() => setMode("REPLAY")}
                className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-all ${
                  mode === "REPLAY"
                    ? "bg-sky-600 text-white shadow-md"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                📼 Replay Playback
              </button>
            </div>
          </div>

          {/* Replay Controls (Only visible in REPLAY mode) */}
          {mode === "REPLAY" && (
            <div className="flex flex-1 flex-wrap items-center justify-end gap-3 min-w-[280px]">
              {/* Date dropdown */}
              <select
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-300 focus:outline-none focus:border-sky-500"
              >
                <option value="">Select Date...</option>
                {availableDates.map((date) => (
                  <option key={date} value={date}>
                    {date}
                  </option>
                ))}
              </select>

              {/* Playback Buttons */}
              {historyTicks.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsPlaying(false);
                      setCurrentTickIndex((prev) => Math.max(0, prev - 1));
                    }}
                    disabled={currentTickIndex === 0}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Previous Snapshot"
                  >
                    ⏮
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="flex h-7 px-3 items-center justify-center rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-bold text-white shadow-sm"
                  >
                    {isPlaying ? "⏸ Pause" : "▶ Play"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsPlaying(false);
                      setCurrentTickIndex((prev) => Math.min(historyTicks.length - 1, prev + 1));
                    }}
                    disabled={currentTickIndex === historyTicks.length - 1}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Next Snapshot"
                  >
                    ⏭
                  </button>

                  {/* Scrubber / Slider */}
                  <div className="flex items-center gap-2 pl-2">
                    <input
                      type="range"
                      min={0}
                      max={historyTicks.length - 1}
                      value={currentTickIndex}
                      onChange={(e) => {
                        setIsPlaying(false);
                        setCurrentTickIndex(parseInt(e.target.value, 10));
                      }}
                      className="w-32 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
                    />
                    <span className="text-[10px] font-mono text-slate-400 min-w-[90px] text-right">
                      {historyTicks[currentTickIndex]?.timestamp || "--:--:--"} ({currentTickIndex + 1}/{historyTicks.length})
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Dashboard iFrame */}
        <div className="w-full h-[calc(100vh-190px)] min-h-[500px] overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
          <iframe
            ref={iframeRef}
            src="/ai-analysis.html"
            className="w-full h-full border-none"
            title="AI Analysis"
            onLoad={() => {
              // Trigger initial render if live data exists
              if (mode === "LIVE" && iframeRef.current && dashData) {
                const formattedData = {
                  type: "UPDATE_DATA",
                  data: {
                    lastUpdate: new Date().toLocaleTimeString("en-IN"),
                    expiry: niftyChain?.expiry || dashData.expiry || "--",
                    breadth: {
                      adv: dashData.advance ?? 0,
                      dec: dashData.decline ?? 0,
                      unchanged: dashData.unchanged ?? 0,
                    },
                    vix: {
                      value: dashData.vix?.price ?? 13.42,
                      prevClose: dashData.vix?.prevClose ?? 12.85,
                      high: dashData.vix?.dayHigh ?? 14.6,
                      low: dashData.vix?.dayLow ?? 11.2,
                    },
                    sectors: (dashData.sectors ?? []).map((s: any) => ({
                      name: s.label ?? s.symbol,
                      ch: s.changePct ?? 0,
                    })),
                    indices: {
                      NIFTY: {
                        ltp: dashData.nifty?.price ?? niftyChain?.spot ?? 0,
                        prevClose: dashData.nifty?.prevClose ?? 0,
                        dayHigh: dashData.nifty?.dayHigh ?? 0,
                        dayLow: dashData.nifty?.dayLow ?? 0,
                        vwap: dashData.nifty?.price ?? 0,
                        chain: transformChain(niftyChain),
                      },
                      BANKNIFTY: {
                        ltp: dashData.bankNifty?.price ?? bankniftyChain?.spot ?? 0,
                        prevClose: dashData.bankNifty?.prevClose ?? 0,
                        dayHigh: dashData.bankNifty?.dayHigh ?? 0,
                        dayLow: dashData.bankNifty?.dayLow ?? 0,
                        vwap: dashData.bankNifty?.price ?? 0,
                        chain: transformChain(bankniftyChain),
                      },
                      MIDCAPNIFTY: {
                        ltp: midcapChain?.spot ?? 0,
                        prevClose: midcapChain?.spot ?? 0,
                        dayHigh: midcapChain?.spot ?? 0,
                        dayLow: midcapChain?.spot ?? 0,
                        vwap: midcapChain?.spot ?? 0,
                        chain: transformChain(midcapChain),
                      },
                      SENSEX: {
                        ltp: dashData.sensex?.price ?? sensexChain?.spot ?? 0,
                        prevClose: dashData.sensex?.prevClose ?? 0,
                        dayHigh: dashData.sensex?.dayHigh ?? 0,
                        dayLow: dashData.sensex?.dayLow ?? 0,
                        vwap: dashData.sensex?.price ?? 0,
                        chain: transformChain(sensexChain),
                      },
                    },
                  },
                };
                iframeRef.current.contentWindow?.postMessage(formattedData, "*");
              }
            }}
          />
        </div>
      </div>
    </DashboardShell>
  );
}

export const Route = createFileRoute("/ai-analysis")({
  component: Page,
});
