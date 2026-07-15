import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { candlesQuery, cepeVolQuery, optionChainQuery, eodOiSnapshotQuery } from "@/lib/dashboard-query";
import { CHART_INDICES, CHART_STOCKS, resolveTypedSymbol, type ChartSymbol } from "@/lib/chartSymbols";
import { isMarketOpenIst } from "@/lib/market-hours";
import { Search, X, Eye, EyeOff, Database } from "lucide-react";
import type { EodOiRow } from "@/lib/chart.functions";

const TIMEFRAMES = ["1m", "2m", "3m", "5m", "15m", "30m", "1h", "1D", "1W"];
const UP = "#22c55e";
const DOWN = "#ef4444";
const IST_OFFSET = 19800; // seconds

function getTodayIST(): string {
  const now = new Date(Date.now() + IST_OFFSET * 1000);
  return now.toISOString().slice(0, 10);
}

function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

type OiCtx = {
  mode: "oi" | "change";
  callColor: string;
  putColor: string;
  maxOI: number;
  maxChg: number;
  MAXW: number;
};
type OiRowData = { callOI: number; putOI: number; callChg: number; putChg: number };

const INTRADAY_SECONDS: Record<string, number> = {
  "1m": 60,
  "2m": 120,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
};

type ChartVolumePoint = { time: number; value: number; color: string };

function buildChartVolumeData(
  candles: Array<{ time: number; open: number; close: number; volume: number }>,
  optionVolume: Array<{ time: number; ceVol: number; peVol: number }>,
  timeframe: string
): { source: "native" | "options" | "none"; points: ChartVolumePoint[] } {
  if (!candles.length) return { source: "none", points: [] };

  if (candles.some((c) => c.volume > 0)) {
    return {
      source: "native",
      points: candles.map((c) => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)",
      })),
    };
  }

  const bucketSeconds = INTRADAY_SECONDS[timeframe];
  if (!bucketSeconds || optionVolume.length < 2) {
    return { source: "none", points: [] };
  }

  const candlesByBucket = new Map<number, (typeof candles)[number]>();
  for (const candle of candles) {
    candlesByBucket.set(Math.floor(candle.time / bucketSeconds), candle);
  }

  const volumeByBucket = new Map<number, number>();
  let previous: { ceVol: number; peVol: number } | null = null;

  for (const point of [...optionVolume].sort((a, b) => a.time - b.time)) {
    if (!previous) {
      if (point.ceVol > 0 || point.peVol > 0) {
        previous = { ceVol: point.ceVol, peVol: point.peVol };
      }
      continue;
    }

    const incrementalVolume =
      Math.max(0, point.ceVol - previous.ceVol) +
      Math.max(0, point.peVol - previous.peVol);
    previous = { ceVol: point.ceVol, peVol: point.peVol };

    if (incrementalVolume <= 0) continue;
    const bucket = Math.floor(point.time / bucketSeconds);
    volumeByBucket.set(bucket, (volumeByBucket.get(bucket) ?? 0) + incrementalVolume);
  }

  const points: ChartVolumePoint[] = [];
  for (const [bucket, value] of volumeByBucket) {
    const candle = candlesByBucket.get(bucket);
    if (!candle) continue;
    points.push({
      time: candle.time,
      value,
      color: candle.close >= candle.open ? "rgba(34,197,94,0.55)" : "rgba(239,68,68,0.55)",
    });
  }

  points.sort((a, b) => a.time - b.time);
  return { source: points.length ? "options" : "none", points };
}

// Dhan-style OI bars: Call (top) + Put (bottom), right-anchored per strike.
// The server supplies the final saved refresh delta; during market hours the
// client replaces it with the observed delta between consecutive live payloads.
function buildOiRowHtml(r: OiRowData, ctx: OiCtx, cDelta: number, pDelta: number): string {
  const H = 10, GAP = 0;
  const { mode, callColor, putColor, maxOI, maxChg, MAXW } = ctx;
  const norm = (v: number, max: number) =>
    v === 0
      ? 0
      : Math.min(MAXW, Math.max(8, Math.sqrt(Math.abs(v) / Math.max(1, max)) * MAXW));
  // Compact same-colour hatch: visible as a texture without looking detached.
  const hatchOf = (hex: string) =>
    `repeating-linear-gradient(45deg,${rgba(hex, 1)} 0,${rgba(hex, 1)} 2px,${rgba(hex, 0.46)} 2px,${rgba(hex, 0.46)} 4px)`;

  const callDelta = cDelta || r.callChg;
  const putDelta = pDelta || r.putChg;

  // ── Change-in-OI mode: diverge from a centre line ──
  if (mode === "change") {
    const center = MAXW / 2;
    const seg = (top: number, chg: number, color: string) => {
      const w = norm(chg, maxChg);
      if (!w) return "";
      const building = chg >= 0;
      const bg = building
        ? `background:${hatchOf(color)};`
        : `background:${rgba(color, 0.16)};border:1px solid ${rgba(color, 0.85)};box-sizing:border-box;`;
      const rightOff = building ? center : Math.max(0, center - w);
      return `<div style="position:absolute;top:${top}px;height:${H}px;right:${rightOff}px;width:${w}px;${bg}"></div>`;
    };
    const line = `<div style="position:absolute;top:0;height:${H * 2 + GAP}px;right:${center}px;width:1px;background:rgba(255,255,255,0.25);"></div>`;
    return line + seg(0, callDelta, callColor) + seg(H + GAP, putDelta, putColor);
  }

  // ── OI mode ──
  // Match the broker profile: a flat muted body, a same-colour hatched building
  // inset, and a sharp chart-background hollow box for draining OI.
  const bar = (top: number, oi: number, delta: number, color: string) => {
    const w = norm(oi, maxOI);
    if (!w) return "";
    const building = delta >= 0;
    let inner = "";
    if (delta) {
      const rawChangeWidth = norm(Math.abs(delta), maxOI);
      const cw = Math.min(
        w,
        Math.max(5, Math.min(rawChangeWidth, w * 0.36))
      );
      inner = building
        ? `<div style="position:absolute;inset:0 auto 0 0;width:${cw}px;background:${hatchOf(color)};"></div>`
        : `<div style="position:absolute;inset:0 auto 0 0;width:${cw}px;background:#0b0f17;border:1px solid ${rgba(color, 0.9)};box-sizing:border-box;"></div>`;
    }
    return `<div style="position:absolute;top:${top}px;right:0;height:${H}px;width:${w}px;background:${rgba(color, 0.72)};overflow:hidden;">${inner}</div>`;
  };
  return bar(0, r.callOI, callDelta, callColor) + bar(H + GAP, r.putOI, putDelta, putColor);
}

export default function ChartLabPage() {
  const [sym, setSym] = useState<ChartSymbol>(CHART_INDICES[0]);
  const [tf, setTf] = useState("5m");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showOI, setShowOI] = useState(true);
  const [showCepeVol, setShowCepeVol] = useState(true);
  const [oiMode, setOiMode] = useState<"oi" | "change">("oi");
  const [callColor, setCallColor] = useState("#ef4444");
  const [putColor, setPutColor] = useState("#22c55e");
  const [oiExpiry, setOiExpiry] = useState<string>("");

  const showOIRef = useRef(true);
  const rafRef = useRef(0);
  const prevSymTfRef = useRef("");

  // ── Queries ────────────────────────────────────────────────────────────────
  const marketOpen = isMarketOpenIst();
  const today = getTodayIST();

  const { data: cd, isFetching } = useQuery(candlesQuery(sym.yahoo, tf));

  // Live option chain (only when market open + index)
  const { data: liveOc } = useQuery({
    ...optionChainQuery(sym.optSym ?? "NIFTY", undefined, oiExpiry || undefined),
    enabled: !!sym.optSym && marketOpen,
  });

  // EOD OI snapshot (always fetched for indices — GPT's correct fallback logic)
  const { data: eodOi } = useQuery({
    ...eodOiSnapshotQuery(sym.optSym ?? "NIFTY", today),
    enabled: !!sym.optSym,
  });

  const { data: cepeVol = [] } = useQuery({
    ...cepeVolQuery(sym.optSym ?? "NIFTY", today),
    enabled: !!sym.optSym,
  });

  // ── Determine which OI data to use: live → EOD snapshot → nothing ──────────
  // GPT's correct logic: market open → live, closed → last saved snapshot
  const activeOiRows: EodOiRow[] | null = useMemo(() => {
    if (!sym.optSym) return null;

    // If live OI has rows → use it
    if (marketOpen && liveOc?.rows?.length) {
      return liveOc.rows.map((r: any) => ({
        strike: r.strike,
        callOI: r.ce?.oi ?? 0,
        putOI: r.pe?.oi ?? 0,
        // Exchange oiChg is a session/day change, not a refresh delta.
        // Live refresh deltas are calculated below from consecutive payloads.
        callChg: 0,
        putChg: 0,
        callVol: r.ce?.volume ?? 0,
        putVol: r.pe?.volume ?? 0,
      }));
    }

    // Otherwise → EOD saved snapshot (DB or eod_cache)
    if (eodOi?.rows?.length) {
      return eodOi.rows;
    }

    return null;
  }, [liveOc, eodOi, marketOpen, sym.optSym]);

  const oiIsEod = !marketOpen || (!liveOc?.rows?.length && !!eodOi?.rows?.length);
  const activeOiSource: "live" | "eod" | "none" =
    marketOpen && liveOc?.rows?.length
      ? "live"
      : eodOi?.rows?.length
        ? "eod"
        : "none";

  // ── Chart refs ─────────────────────────────────────────────────────────────
  const chartElRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const strikeAxisRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleRef = useRef<any>(null);
  const volRef = useRef<any>(null);
  const barNodesRef = useRef<
    { strike: number; el: HTMLDivElement; labelEl: HTMLDivElement }[]
  >([]);
  const ltpAxisLabelRef = useRef<HTMLDivElement | null>(null);
  const lastPriceRef = useRef(0);
  const lastPriceUpRef = useRef(true);
  // Per-refresh OI delta tracking (for the incremental hatched/hollow accent)
  const prevOiRef = useRef<Map<number, { c: number; p: number }>>(new Map());
  const deltaRef = useRef<Map<number, { c: number; p: number }>>(new Map());
  const lastRowsRef = useRef<unknown>(null);
  const lastOiSourceRef = useRef<"live" | "eod" | "none">("none");

  useEffect(() => { showOIRef.current = showOI; }, [showOI]);

  // ── Create chart (fresh instance per symbol) ───────────────────────────────
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    prevSymTfRef.current = "";
    (async () => {
      const LWC = await import("lightweight-charts");
      if (disposed || !chartElRef.current) return;

      const chart = LWC.createChart(chartElRef.current, {
        autoSize: true,
        layout: {
          background: { type: LWC.ColorType.Solid, color: "#0b0f17" },
          textColor: "#8aa0b6",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: "#151d2b" },
          horzLines: { color: "#151d2b" },
        },
        crosshair: { mode: LWC.CrosshairMode.Normal },
        rightPriceScale: {
          borderColor: "#1c2636",
          scaleMargins: { top: 0.06, bottom: 0.32 },
        },
        leftPriceScale: { visible: false },
        timeScale: {
          borderColor: "#1c2636",
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 8,
        },
      });

      // Main candlestick
      const candle = chart.addSeries(LWC.CandlestickSeries, {
        upColor: UP, downColor: DOWN,
        borderVisible: false,
        wickUpColor: UP, wickDownColor: DOWN,
        priceLineStyle: LWC.LineStyle.Dashed,
        priceScaleId: "right",
      });

      // Volume — single histogram, coloured green (up candle) / red (down candle)
      const vol = chart.addSeries(LWC.HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale("vol").applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
        borderVisible: false,
      });

      chartRef.current = chart;
      candleRef.current = candle;
      volRef.current = vol;
      setReady(true);

      const loop = () => {
        positionOI();
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafRef.current);
      chartRef.current?.remove?.();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym.yahoo]);

  // ── Apply candle data ──────────────────────────────────────────────────────
  useEffect(() => {
    const candle = candleRef.current;
    if (!ready || !candle || !cd?.candles?.length) return;

    // Guard: with keepPreviousData the response might still carry the *previous*
    // symbol's data while the new fetch is loading. Never apply stale data.
    if (cd.symbol !== sym.yahoo) return;

    try {
      candle.setData(
        cd.candles.map((c) => ({
          time: c.time as any,
          open: c.open, high: c.high, low: c.low, close: c.close,
        }))
      );
    } catch (e) { console.warn("[ChartLab] candle setData error:", e); }

    // Re-fit whenever the symbol+tf combination changes and correct data arrives.
    const key = `${sym.yahoo}|${tf}`;
    if (prevSymTfRef.current !== key) {
      prevSymTfRef.current = key;
      try { chartRef.current?.timeScale?.().fitContent?.(); } catch { /* noop */ }
    }
  }, [cd, ready, sym.yahoo, tf]);

  const chartVolume = useMemo(
    () => buildChartVolumeData(cd?.candles ?? [], cepeVol, tf),
    [cd?.candles, cepeVol, tf]
  );

  // ── Apply volume histogram (cash volume, or real CE+PE activity for indices) ──
  useEffect(() => {
    const vol = volRef.current;
    if (!ready || !vol) return;
    // Same stale-data guard as candle series
    if (cd?.symbol !== sym.yahoo) return;
    try {
      vol.setData(chartVolume.points.map((point) => ({ ...point, time: point.time as any })));
    } catch (e) { console.warn("[ChartLab] volume setData error:", e); }
  }, [cd?.symbol, chartVolume.points, ready, sym.yahoo]);

  // ── Volume visibility ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    try { volRef.current?.applyOptions({ visible: showCepeVol }); } catch { /* noop */ }
  }, [showCepeVol, ready]);

  // ── Build OI overlay DOM nodes ─────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    const layer = overlayRef.current;
    const strikeAxis = strikeAxisRef.current;
    if (!layer || !strikeAxis) return;
    layer.innerHTML = "";
    strikeAxis.innerHTML = "";
    strikeAxis.style.display = "none";
    barNodesRef.current = [];
    ltpAxisLabelRef.current = null;

    // Never compare the first live payload with an EOD/cache snapshot.
    // A source transition starts a fresh consecutive-refresh sequence.
    if (lastOiSourceRef.current !== activeOiSource) {
      prevOiRef.current = new Map();
      deltaRef.current = new Map();
      lastRowsRef.current = null;
      lastOiSourceRef.current = activeOiSource;
    }

    const rows = activeOiRows;
    if (!rows?.length) return;

    // Recompute the per-refresh delta ONLY when the underlying data actually
    // changed (not on colour/mode toggles), so the hatched/hollow reflects the
    // change since the last refresh — not the whole day's OI change.
    if (lastRowsRef.current !== activeOiRows) {
      const d = new Map<number, { c: number; p: number }>();
      for (const r of rows) {
        const prev = prevOiRef.current.get(r.strike);
        d.set(r.strike, { c: prev ? r.callOI - prev.c : 0, p: prev ? r.putOI - prev.p : 0 });
      }
      deltaRef.current = d;
      const np = new Map<number, { c: number; p: number }>();
      for (const r of rows) np.set(r.strike, { c: r.callOI, p: r.putOI });
      prevOiRef.current = np;
      lastRowsRef.current = activeOiRows;
    }

    const chartWidth = chartElRef.current?.clientWidth ?? 1200;
    const MAXW = Math.min(600, Math.max(280, chartWidth - 80));
    const maxOI = Math.max(1, ...rows.flatMap((r) => [r.callOI, r.putOI]));
    const maxChg = Math.max(
      1,
      ...rows.flatMap((r) => {
        const delta = deltaRef.current.get(r.strike) ?? { c: 0, p: 0 };
        return [Math.abs(delta.c || r.callChg), Math.abs(delta.p || r.putChg)];
      })
    );
    const ctx: OiCtx = { mode: oiMode, callColor, putColor, maxOI, maxChg, MAXW };

    for (const r of rows) {
      const dl = deltaRef.current.get(r.strike) ?? { c: 0, p: 0 };
      const row = document.createElement("div");
      row.style.cssText =
        "position:absolute;height:20px;display:none;pointer-events:none;transform:translateY(-50%);";
      row.innerHTML = buildOiRowHtml(r, ctx, dl.c, dl.p);
      layer.appendChild(row);

      const strikeLabel = document.createElement("div");
      strikeLabel.textContent = String(r.strike);
      strikeLabel.style.cssText =
        "position:absolute;left:0;width:100%;display:none;transform:translateY(-50%);padding-right:6px;text-align:right;font:600 11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#d8e4ee;line-height:18px;white-space:nowrap;";
      strikeAxis.appendChild(strikeLabel);
      barNodesRef.current.push({ strike: r.strike, el: row, labelEl: strikeLabel });
    }

    const ltpLabel = document.createElement("div");
    ltpLabel.style.cssText =
      "position:absolute;right:0;z-index:2;display:none;transform:translateY(-50%);padding:2px 5px;font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace;color:white;line-height:16px;white-space:nowrap;";
    strikeAxis.appendChild(ltpLabel);
    ltpAxisLabelRef.current = ltpLabel;
  }, [activeOiRows, activeOiSource, ready, oiMode, callColor, putColor, oiIsEod]);

  // Reset per-refresh delta tracking when the symbol changes
  useEffect(() => {
    prevOiRef.current = new Map();
    deltaRef.current = new Map();
    lastRowsRef.current = null;
    lastOiSourceRef.current = "none";
  }, [sym.optSym]);

  // ── rAF: reposition OI bars each frame ────────────────────────────────────
  const positionOI = useCallback(() => {
    const candle = candleRef.current;
    const chart = chartRef.current;
    if (!candle || !chart) return;
    if (!barNodesRef.current.length) return;

    const visible = showOIRef.current;
    let axisW = 60;
    try { axisW = chart.priceScale("right").width() || 60; } catch { /* noop */ }
    axisW = Math.max(68, axisW);
    const h = chartElRef.current?.clientHeight ?? 0;
    const strikeAxis = strikeAxisRef.current;
    if (strikeAxis) {
      strikeAxis.style.display = visible ? "block" : "none";
      strikeAxis.style.width = `${axisW}px`;
    }

    for (const { strike, el, labelEl } of barNodesRef.current) {
      if (!visible) {
        el.style.display = "none";
        labelEl.style.display = "none";
        continue;
      }
      let y: number | null = null;
      try { y = candle.priceToCoordinate(strike); } catch { /* noop */ }
      if (y == null || y < 12 || y > h - 12) {
        el.style.display = "none";
        labelEl.style.display = "none";
      } else {
        el.style.display = "block";
        el.style.top = `${y}px`;
        el.style.right = `${axisW + 2}px`;
        labelEl.style.display = "block";
        labelEl.style.top = `${y}px`;
      }
    }

    const ltpLabel = ltpAxisLabelRef.current;
    if (ltpLabel) {
      let ltpY: number | null = null;
      try { ltpY = candle.priceToCoordinate(lastPriceRef.current); } catch { /* noop */ }
      if (!visible || !lastPriceRef.current || ltpY == null || ltpY < 10 || ltpY > h - 10) {
        ltpLabel.style.display = "none";
      } else {
        ltpLabel.style.display = "block";
        ltpLabel.style.top = `${ltpY}px`;
        ltpLabel.style.background = lastPriceUpRef.current ? UP : DOWN;
        ltpLabel.textContent = lastPriceRef.current.toFixed(2);
      }
    }
  }, []);

  // ── LTP + change ───────────────────────────────────────────────────────────
  const last = cd?.candles?.[cd.candles.length - 1];
  const prevClose = cd?.meta?.prevClose ?? cd?.candles?.[0]?.open ?? 0;
  const ltp = last?.close ?? 0;
  const chg = ltp - prevClose;
  const chgPct = prevClose ? (chg / prevClose) * 100 : 0;
  const up = chg >= 0;
  lastPriceRef.current = ltp;
  lastPriceUpRef.current = last ? last.close >= last.open : up;

  // ── Symbol picker filter ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return {
      idx: CHART_INDICES.filter((s) => !q || s.label.toUpperCase().includes(q)),
      stk: CHART_STOCKS.filter((s) => !q || s.label.toUpperCase().includes(q)),
    };
  }, [query]);

  const pick = (s: ChartSymbol) => { setSym(s); setPickerOpen(false); setQuery(""); };

  // ── EOD badge label ────────────────────────────────────────────────────────
  const eodBadge = useMemo(() => {
    if (!sym.optSym) return null;
    if (marketOpen && liveOc?.rows?.length) return null; // live data — no badge
    if (!eodOi) return null;
    return `EOD Snapshot · ${eodOi.lastTimeStr} IST`;
  }, [sym.optSym, marketOpen, liveOc, eodOi]);

  return (
    <DashboardShell>
      <div className="-mt-3 flex h-[calc(100dvh-124px)] min-h-0 flex-col gap-1 overflow-hidden">
        {/* ── Toolbar ── */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Symbol picker */}
          <div className="relative">
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg border border-[#1c2636] bg-[#0b0f17] px-3 py-1.5 hover:border-[#2a3a52]"
            >
              <Search className="h-3.5 w-3.5 text-[#5a7088]" />
              <span className="text-sm font-bold text-slate-100">{sym.label}</span>
              <span className="rounded bg-[#12223c] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#5aaabb]">
                {sym.kind === "index" ? "Index" : "Stock"}
              </span>
            </button>

            {pickerOpen && (
              <div className="absolute z-50 mt-1 max-h-[440px] w-[320px] overflow-hidden rounded-xl border border-[#1c2636] bg-[#0b0f17] shadow-2xl">
                <div className="flex items-center gap-2 border-b border-[#1c2636] px-3 py-2">
                  <Search className="h-3.5 w-3.5 text-[#5a7088]" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && query.trim()) pick(resolveTypedSymbol(query));
                    }}
                    placeholder="Search index / stock…"
                    className="flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-[#4a6070]"
                  />
                  {query && (
                    <button onClick={() => setQuery("")}>
                      <X className="h-3.5 w-3.5 text-[#5a7088]" />
                    </button>
                  )}
                </div>
                <div className="scroll-dark max-h-[388px] overflow-y-auto py-1">
                  {query.trim() && (
                    <button
                      onClick={() => pick(resolveTypedSymbol(query))}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[#5aaabb] hover:bg-[#12223c]"
                    >
                      <Search className="h-3 w-3" /> Use "{query.trim().toUpperCase()}" (NSE)
                    </button>
                  )}
                  {filtered.idx.length > 0 && (
                    <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-[#3a5070]">Indices</div>
                  )}
                  {filtered.idx.map((s) => (
                    <button
                      key={s.yahoo}
                      onClick={() => pick(s)}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-[#12223c]"
                    >
                      <span className="font-semibold">{s.label}</span>
                      <span className="text-[9px] text-[#4a6070]">{s.yahoo}</span>
                    </button>
                  ))}
                  {filtered.stk.length > 0 && (
                    <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-[#3a5070]">Stocks (F&O)</div>
                  )}
                  {filtered.stk.map((s) => (
                    <button
                      key={s.yahoo}
                      onClick={() => pick(s)}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-slate-200 hover:bg-[#12223c] text-xs"
                    >
                      <span className="font-semibold">{s.label}</span>
                      <span className="text-[9px] text-[#4a6070]">NSE</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* LTP */}
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-lg font-extrabold text-slate-100">
              {ltp ? ltp.toFixed(2) : "—"}
            </span>
            <span className="font-mono text-xs font-bold" style={{ color: up ? UP : DOWN }}>
              {up ? "+" : ""}{chg.toFixed(2)} ({up ? "+" : ""}{chgPct.toFixed(2)}%)
            </span>
            {isFetching && <span className="text-[10px] text-[#3a5070]">updating…</span>}
          </div>

          {/* EOD badge */}
          {eodBadge && (
            <div className="flex items-center gap-1 rounded border border-[#2a3060] bg-[#0d1530] px-2 py-0.5 text-[10px] text-[#6688cc]">
              <Database className="h-3 w-3" />
              {eodBadge}
            </div>
          )}

          {/* Timeframes */}
          <div className="ml-auto flex gap-0.5 rounded-lg border border-[#1c2636] bg-[#0b0f17] p-0.5">
            {TIMEFRAMES.map((t) => (
              <button
                key={t}
                onClick={() => setTf(t)}
                className={`rounded-md px-2 py-1 text-[11px] font-bold transition-colors ${
                  tf === t ? "bg-[#12223c] text-[#5aaabb]" : "text-[#5a7088] hover:text-[#8aa0b6]"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* ── Chart + OI overlay ── */}
        <div
          className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-[#1c2636] bg-[#0b0f17]"
        >
          <div ref={chartElRef} className="h-full w-full" />
          <div ref={overlayRef} className="pointer-events-none absolute inset-0 z-[3] overflow-hidden" />
          <div
            ref={strikeAxisRef}
            className="pointer-events-none absolute bottom-0 right-0 top-0 z-[4] hidden border-l border-[#1c2636] bg-[#0b0f17]"
          />

          {/* ── OI settings panel (Dhan-style) ── */}
          <div className="absolute left-2 top-2 z-10 flex flex-col gap-1.5 rounded-lg border border-[#1c2636] bg-[#0b0f17]/92 p-1.5 text-[10px] backdrop-blur">
            {/* Row: OI on/off · source · OI/Change toggle */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowOI((v) => !v)}
                disabled={!sym.optSym}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold ${sym.optSym ? "text-[#c8dae8] hover:text-white" : "cursor-not-allowed text-[#3a5070]"}`}
                title={sym.optSym ? "Toggle OI bars" : "OI overlay: index symbols only"}
              >
                {showOI && sym.optSym ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                OI
              </button>
              {sym.optSym && activeOiRows && (
                <span className={`rounded px-1 py-0 text-[8px] font-bold ${oiIsEod ? "bg-[#1a2050] text-[#6688cc]" : "bg-[#0d2010] text-[#3aaa60]"}`}>
                  {oiIsEod ? "EOD" : "LIVE"}
                </span>
              )}
              <div className="ml-1 flex overflow-hidden rounded border border-[#1c2636]">
                <button
                  onClick={() => setOiMode("oi")}
                  className={`px-2 py-0.5 font-bold ${oiMode === "oi" ? "bg-[#12223c] text-[#5aaabb]" : "text-[#5a7088] hover:text-[#8aa0b6]"}`}
                >
                  OI
                </button>
                <button
                  onClick={() => setOiMode("change")}
                  title="Change in OI since the immediately preceding refresh"
                  className={`px-2 py-0.5 font-bold ${oiMode === "change" ? "bg-[#12223c] text-[#5aaabb]" : "text-[#5a7088] hover:text-[#8aa0b6]"}`}
                >
                  Change in OI
                </button>
              </div>
            </div>

            {/* Row: expiry · colours */}
            <div className="flex items-center gap-2">
              <select
                value={oiExpiry}
                onChange={(e) => setOiExpiry(e.target.value)}
                disabled={!marketOpen}
                className="rounded border border-[#1c2636] bg-[#0b0f17] px-1.5 py-0.5 text-[10px] text-[#c8dae8] outline-none disabled:text-[#3a5070]"
                title={marketOpen ? "Expiry" : "Expiry switch: live market only (EOD uses saved snapshot)"}
              >
                <option value="">Expiry{oiIsEod && eodOi?.expiry ? `: ${eodOi.expiry}` : ""}</option>
                {((liveOc?.expiries as string[] | undefined) ?? []).map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
              <label className="flex cursor-pointer items-center gap-1 text-[#8aa0b6]" title="Call OI colour">
                <span className="text-[9px]">Call</span>
                <input type="color" value={callColor} onChange={(e) => setCallColor(e.target.value)} className="h-4 w-5 cursor-pointer border-0 bg-transparent p-0" />
              </label>
              <label className="flex cursor-pointer items-center gap-1 text-[#8aa0b6]" title="Put OI colour">
                <span className="text-[9px]">Put</span>
                <input type="color" value={putColor} onChange={(e) => setPutColor(e.target.value)} className="h-4 w-5 cursor-pointer border-0 bg-transparent p-0" />
              </label>
            </div>

            {/* Row: CE/PE vol toggle + live stats */}
            <button
              onClick={() => setShowCepeVol((v) => !v)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-[#c8dae8] hover:text-white"
              title="Toggle volume"
            >
              {showCepeVol ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              Volume
              {chartVolume.source === "options" && (
                <span className="ml-1 text-[8px] text-[#4a6070]">(CE+PE activity)</span>
              )}
              {sym.kind === "index" && chartVolume.source === "none" && (
                <span className="ml-1 text-[8px] text-[#4a6070]">(no saved history)</span>
              )}
            </button>

            {sym.optSym && !activeOiRows && (
              <div className="text-[9px] text-[#4a6070]">No OI snapshot available</div>
            )}
          </div>

          {/* Loading */}
          {!cd?.candles?.length && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-[#5a7088]">
              {isFetching ? `Loading ${sym.label} chart…` : `No data for ${sym.label}`}
            </div>
          )}
        </div>

        {/* ── Legend ── */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[#5a7088]">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-5" style={{ background: callColor }} /> Call OI
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-5" style={{ background: putColor }} /> Put OI
          </span>
          <span className="mx-1 text-[#2a3a52]">|</span>
          {oiMode === "change" ? (
            <>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-5" style={{ background: `repeating-linear-gradient(45deg,${callColor} 0,${callColor} 3px,${callColor}66 3px,${callColor}66 6px)` }} /> Building (hatched)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-5 border" style={{ borderColor: callColor }} /> Draining (hollow)
              </span>
              <span className="text-[#4a6070]">· diverge from centre</span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-5" style={{ background: `repeating-linear-gradient(45deg,${callColor} 0,${callColor} 3px,${callColor}66 3px,${callColor}66 6px)` }} /> Building (hatched)
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-5 border"
                  style={{
                    background: "#0b0f17",
                    borderColor: rgba(callColor, 0.9),
                  }}
                /> Draining (hollow)
              </span>
              <span className="text-[#4a6070]">· latest refresh change</span>
            </>
          )}
          <span className="mx-1 text-[#2a3a52]">|</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 bg-[#22c55e]" /> Volume up</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 bg-[#ef4444]" /> Volume down</span>
          {chartVolume.source === "options" && <span className="text-[#3a5070]">(real CE+PE activity)</span>}
          {sym.kind === "index" && chartVolume.source === "none" && <span className="text-[#3a5070]">(no saved index volume history)</span>}
        </div>
      </div>
    </DashboardShell>
  );
}
