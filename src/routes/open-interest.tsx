/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useRef, useCallback } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

// ─── Types ─────────────────────────────────────────────────────────────────

interface OIDataPoint {
  strike: number;
  callOI: number;
  putOI: number;
  callChange: number;
  putChange: number;
  volume: number;
}

type ViewMode = "change+total" | "change" | "total";
type StrikeCount = 10 | 15 | 20;
type IndexKey = "NIFTY" | "BANKNIFTY" | "MIDCPNIFTY" | "SENSEX";

const INDICES: IndexKey[] = ["NIFTY", "BANKNIFTY", "MIDCPNIFTY", "SENSEX"];

const EXPIRIES = [
  { label: "Current Weekly", value: "CW" },
  { label: "Next Weekly", value: "NW" },
  { label: "Monthly", value: "M" },
  { label: "All Expiries", value: "ALL" },
] as const;

// ─── Mock Data Generator ───────────────────────────────────────────────────

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function generateOIData(
  strikeCount: StrikeCount,
  index: IndexKey,
  expiry: string,
  timeSeed: number = 0,
): OIDataPoint[] {
  const spots: Record<IndexKey, number> = {
    NIFTY: 24050,
    BANKNIFTY: 51200,
    MIDCPNIFTY: 11200,
    SENSEX: 79800,
  };
  const spot = spots[index];
  const half = Math.floor(strikeCount / 2);
  const base = Math.round((spot - half * 50) / 50) * 50;
  // Use a deterministic seed based on inputs so re-renders don't reshuffle
  const seed = strikeCount * 1000 + spots[index] + timeSeed * 10 + expiry.charCodeAt(0);
  const rand = seededRandom(seed);

  return Array.from({ length: strikeCount }, (_, i) => {
    const strike = base + i * 50;
    const dist = (strike - spot) / 50;
    const callFactor = Math.exp(-Math.pow((dist + 0.5) / 4, 2));
    const putFactor = Math.exp(-Math.pow((dist - 0.5) / 4, 2));

    const scale =
      index === "BANKNIFTY" ? 3.5 : index === "SENSEX" ? 5 : index === "MIDCPNIFTY" ? 0.8 : 1;
    const callOI = Math.round((900000 + rand() * 500000) * (1 + callFactor * 2.5) * scale);
    const putOI = Math.round((750000 + rand() * 400000) * (1 + putFactor * 2.5) * scale);
    const callChange = Math.round((rand() - 0.35) * 350000 * scale);
    const putChange = Math.round((rand() - 0.65) * 300000 * scale);
    const volume = Math.round((rand() * 8000 + 500) * scale);

    return { strike, callOI, putOI, callChange, putChange, volume };
  });
}

interface DataSnapshot {
  data: OIDataPoint[];
  totals: ReturnType<typeof recalcTotals>;
}

const dataCache = new Map<string, DataSnapshot>();

function getCachedData(
  strikeCount: StrikeCount,
  index: IndexKey,
  expiry: string,
  timeSeed: number,
): DataSnapshot {
  const key = `${strikeCount}_${index}_${expiry}_${timeSeed}`;
  if (dataCache.has(key)) return dataCache.get(key)!;
  const data = generateOIData(strikeCount, index, expiry, timeSeed);
  const totals = recalcTotals(data);
  const entry = { data, totals };
  dataCache.set(key, entry);
  return entry;
}

function recalcTotals(data: OIDataPoint[]) {
  return {
    totalCallOI: data.reduce((s, d) => s + d.callOI, 0),
    totalPutOI: data.reduce((s, d) => s + d.putOI, 0),
    callChangeSum: data.reduce((s, d) => s + d.callChange, 0),
    putChangeSum: data.reduce((s, d) => s + d.putChange, 0),
    totalVolume: data.reduce((s, d) => s + d.volume, 0),
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────

const G = {
  call: "#22C55E",
  put: "#EF4444",
  callDim: "rgba(34,197,94,0.12)",
  putDim: "rgba(239,68,68,0.12)",
  text: "#A9B2BF",
  bg: "transparent",
  grid: "rgba(255,255,255,0.06)",
  tooltipBg: "rgba(10,12,16,0.96)",
};

// ─── Formatting ─────────────────────────────────────────────────────────────

function fmtOI(n: number): string {
  if (!isFinite(n)) return "\u2014";
  const abs = Math.abs(n);
  let s: string;
  if (abs >= 1e7) s = (abs / 1e7).toFixed(2) + " Cr";
  else if (abs >= 1e5) s = (abs / 1e5).toFixed(2) + " L";
  else if (abs >= 1e3) s = (abs / 1e3).toFixed(1) + " K";
  else s = abs.toLocaleString("en-IN");
  return n < 0 ? "\u2212" + s : s;
}

function fmtChange(n: number): string {
  return (n >= 0 ? "+" : "") + fmtOI(n);
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-IN");
}

// ─── Pattern Factories ──────────────────────────────────────────────────────

function createStripe(color: string): CanvasPattern {
  const c = document.createElement("canvas");
  c.width = 6;
  c.height = 6;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 6, 6);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.lineTo(6, 0);
  ctx.stroke();
  return ctx.createPattern(c, "repeat")!;
}

let callStripe: CanvasPattern | null = null;
let putStripe: CanvasPattern | null = null;

function getCallStripe() {
  if (!callStripe) callStripe = createStripe(G.call);
  return callStripe;
}
function getPutStripe() {
  if (!putStripe) putStripe = createStripe(G.put);
  return putStripe;
}

// ─── Segmented Button ───────────────────────────────────────────────────────

function SegBtn<T extends string | number>({
  options,
  value,
  onChange,
  size = "sm",
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "xs";
}) {
  return (
    <div className="flex items-center rounded-lg border border-border bg-background p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 font-semibold transition-all cursor-pointer ${
            size === "xs" ? "text-[11px]" : "text-xs"
          } ${
            value === o.value
              ? "bg-foreground text-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Sensibull-Style Tooltip ────────────────────────────────────────────────

function buildTooltipHtml(data: OIDataPoint[], idx: number, viewMode: ViewMode): string {
  const d = data[idx];
  if (!d) return "";
  const dist = d.strike - 24050;
  const distStr = dist === 0 ? "ATM" : (dist > 0 ? "+" : "") + dist;
  const pcr = (d.putOI / d.callOI).toFixed(2);
  // Determine put/call increase/decrease colors
  const callChgColor = d.callChange >= 0 ? G.call : G.put;
  const putChgColor = d.putChange >= 0 ? G.call : G.put;
  const callChgArrow = d.callChange >= 0 ? "\u25B2" : "\u25BC";
  const putChgArrow = d.putChange >= 0 ? "\u25B2" : "\u25BC";

  return [
    `<div style="font-size:11px;padding:0 0 6px 0;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:6px;">`,
    `  <div style="display:flex;align-items:center;justify-content:space-between;">`,
    `    <span style="font-size:14px;font-weight:700;color:#E6E9EF;">Strike ${d.strike}</span>`,
    `    <span style="font-size:11px;color:#8B949E;font-family:ui-monospace,monospace;">${distStr}</span>`,
    `  </div>`,
    `  <div style="font-size:10px;color:#8B949E;margin-top:2px;">${new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST</div>`,
    `</div>`,
    // Two-column layout
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">`,
    // PUT SIDE
    `  <div style="background:rgba(239,68,68,0.08);border-radius:6px;padding:8px;">`,
    `    <div style="font-size:10px;font-weight:700;color:#EF4444;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">PUT Side</div>`,
    `    <div style="display:flex;justify-content:space-between;font-size:11px;margin:3px 0;">`,
    `      <span style="color:#8B949E;">OI at Open</span>`,
    `      <span style="font-family:ui-monospace,monospace;font-weight:600;color:#E6E9EF;">${fmtOI(d.putOI - d.putChange)}</span>`,
    `    </div>`,
    `    <div style="display:flex;justify-content:space-between;font-size:11px;margin:3px 0;">`,
    `      <span style="color:#8B949E;">OI Change</span>`,
    `      <span style="font-family:ui-monospace,monospace;font-weight:700;color:${putChgColor};">${putChgArrow} ${fmtChange(d.putChange)}</span>`,
    `    </div>`,
    `    <div style="display:flex;justify-content:space-between;font-size:11px;margin:3px 0;padding-top:3px;border-top:1px solid rgba(255,255,255,0.06);">`,
    `      <span style="color:#E6E9EF;font-weight:600;">Current Put OI</span>`,
    `      <span style="font-family:ui-monospace,monospace;font-weight:700;color:#EF4444;">${fmtOI(d.putOI)}</span>`,
    `    </div>`,
    `  </div>`,
    // CALL SIDE
    `  <div style="background:rgba(34,197,94,0.08);border-radius:6px;padding:8px;">`,
    `    <div style="font-size:10px;font-weight:700;color:#22C55E;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">CALL Side</div>`,
    `    <div style="display:flex;justify-content:space-between;font-size:11px;margin:3px 0;">`,
    `      <span style="color:#8B949E;">OI at Open</span>`,
    `      <span style="font-family:ui-monospace,monospace;font-weight:600;color:#E6E9EF;">${fmtOI(d.callOI - d.callChange)}</span>`,
    `    </div>`,
    `    <div style="display:flex;justify-content:space-between;font-size:11px;margin:3px 0;">`,
    `      <span style="color:#8B949E;">OI Change</span>`,
    `      <span style="font-family:ui-monospace,monospace;font-weight:700;color:${callChgColor};">${callChgArrow} ${fmtChange(d.callChange)}</span>`,
    `    </div>`,
    `    <div style="display:flex;justify-content:space-between;font-size:11px;margin:3px 0;padding-top:3px;border-top:1px solid rgba(255,255,255,0.06);">`,
    `      <span style="color:#E6E9EF;font-weight:600;">Current Call OI</span>`,
    `      <span style="font-family:ui-monospace,monospace;font-weight:700;color:#22C55E;">${fmtOI(d.callOI)}</span>`,
    `    </div>`,
    `  </div>`,
    `</div>`,
    // Footer metrics
    `<div style="display:flex;justify-content:space-between;margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);font-size:10px;">`,
    `  <span style="color:#8B949E;">PCR <span style="font-family:ui-monospace,monospace;font-weight:600;color:#E6E9EF;">${pcr}</span></span>`,
    `  <span style="color:#8B949E;">Volume <span style="font-family:ui-monospace,monospace;font-weight:600;color:#E6E9EF;">${fmtNum(d.volume)}</span></span>`,
    `</div>`,
  ].join("\n");
}

// ─── OI Chart ───────────────────────────────────────────────────────────────

function OIChart({
  data,
  strikeCount,
  viewMode,
  index,
  expiry,
  timeSeed,
}: {
  data: OIDataPoint[];
  strikeCount: number;
  viewMode: ViewMode;
  index: IndexKey;
  expiry: string;
  timeSeed: number;
}) {
  const chartRef = useRef<ReactECharts | null>(null);
  const chartKey = `${strikeCount}_${viewMode}_${index}_${expiry}_${timeSeed}_${data.length}`;

  const option = useMemo((): EChartsOption => {
    const strikes = data.map((d) => d.strike.toString());
    const maxVal = Math.max(...data.map((d) => Math.max(d.callOI, d.putOI))) * 1.35;

    const callSeries: any[] = [];
    const putSeries: any[] = [];
    const markerSeries: any[] = [];

    const tooltipTrigger = {
      trigger: "axis" as const,
      backgroundColor: G.tooltipBg,
      borderColor: "rgba(255,255,255,0.08)",
      borderWidth: 1,
      textStyle: { color: "#E6E9EF", fontSize: 12 },
      axisPointer: { type: "shadow" as const, shadowStyle: { color: "rgba(255,255,255,0.03)" } },
      extraCssText:
        "border-radius:10px;padding:12px;box-shadow:0 8px 32px rgba(0,0,0,0.5);backdrop-filter:blur(8px);",
      formatter: (params: any) => {
        const idx = params[0]?.dataIndex ?? 0;
        return buildTooltipHtml(data, idx, viewMode);
      },
    };

    // Slim bar config
    const slimBarWidth = "22%";
    const slimBarGap = "80%";

    if (viewMode === "total") {
      callSeries.push({
        name: "Call OI",
        type: "bar",
        data: data.map((d) => d.callOI),
        barWidth: slimBarWidth,
        barGap: slimBarGap,
        itemStyle: { color: G.call, borderRadius: [3, 3, 0, 0] },
        tooltip: tooltipTrigger,
        z: 2,
      });
      putSeries.push({
        name: "Put OI",
        type: "bar",
        data: data.map((d) => d.putOI),
        barWidth: slimBarWidth,
        barGap: slimBarGap,
        itemStyle: { color: G.put, borderRadius: [3, 3, 0, 0] },
        tooltip: { show: false },
        z: 2,
      });
    } else if (viewMode === "change") {
      callSeries.push({
        name: "Call Change",
        type: "bar",
        data: data.map((d) => d.callChange),
        barWidth: slimBarWidth,
        barGap: slimBarGap,
        itemStyle: {
          color: (p: any) => (p.value >= 0 ? G.call : G.put),
          borderRadius: [3, 3, 0, 0],
        },
        tooltip: tooltipTrigger,
        z: 2,
      });
      putSeries.push({
        name: "Put Change",
        type: "bar",
        data: data.map((d) => d.putChange),
        barWidth: slimBarWidth,
        barGap: slimBarGap,
        itemStyle: {
          color: (p: any) => (p.value >= 0 ? G.call : G.put),
          borderRadius: [3, 3, 0, 0],
        },
        tooltip: { show: false },
        z: 2,
      });
    } else {
      // "change+total" — Sensibull-style layered bars
      const barW = "24%";
      const barG = "70%";
      callSeries.push(
        {
          name: "Call OI",
          type: "bar",
          stack: "call",
          data: data.map((d) => d.callOI),
          barWidth: barW,
          barGap: barG,
          itemStyle: { color: G.call, borderRadius: [3, 3, 0, 0] },
          tooltip: tooltipTrigger,
          z: 2,
        },
        {
          name: "Call OI Increase",
          type: "bar",
          stack: "call",
          data: data.map((d) => (d.callChange > 0 ? d.callChange : 0)),
          barWidth: barW,
          barGap: barG,
          itemStyle: { color: getCallStripe(), borderRadius: [3, 3, 0, 0] },
          tooltip: { show: false },
          z: 2,
        },
        {
          name: "Call OI Decrease",
          type: "bar",
          stack: "call",
          data: data.map((d) => (d.callChange < 0 ? Math.abs(d.callChange) : 0)),
          barWidth: barW,
          barGap: barG,
          itemStyle: {
            color: "transparent",
            borderColor: G.call,
            borderWidth: 1,
            borderType: "solid",
            borderRadius: [3, 3, 0, 0],
          },
          tooltip: { show: false },
          z: 2,
        },
      );
      putSeries.push(
        {
          name: "Put OI",
          type: "bar",
          stack: "put",
          data: data.map((d) => d.putOI),
          barWidth: barW,
          barGap: barG,
          itemStyle: { color: G.put, borderRadius: [3, 3, 0, 0] },
          tooltip: { show: false },
          z: 2,
        },
        {
          name: "Put OI Increase",
          type: "bar",
          stack: "put",
          data: data.map((d) => (d.putChange > 0 ? d.putChange : 0)),
          barWidth: barW,
          barGap: barG,
          itemStyle: { color: getPutStripe(), borderRadius: [3, 3, 0, 0] },
          tooltip: { show: false },
          z: 2,
        },
        {
          name: "Put OI Decrease",
          type: "bar",
          stack: "put",
          data: data.map((d) => (d.putChange < 0 ? Math.abs(d.putChange) : 0)),
          barWidth: barW,
          barGap: barG,
          itemStyle: {
            color: "transparent",
            borderColor: G.put,
            borderWidth: 1,
            borderType: "solid",
            borderRadius: [3, 3, 0, 0],
          },
          tooltip: { show: false },
          z: 2,
        },
      );
    }

    // Spot Price marker — dashed vertical line with badge label
    const spotIdx = data.findIndex((d) => d.strike === 24050);
    if (spotIdx >= 0 && viewMode !== "change") {
      markerSeries.push({
        name: "Spot",
        type: "line",
        data: [{ value: [strikes[spotIdx], 0] }, { value: [strikes[spotIdx], maxVal] }],
        coordinateSystem: "cartesian2d",
        lineStyle: { color: "#3B82F6", type: "dashed", width: 1.2 },
        symbol: "none",
        z: 5,
        tooltip: { show: false },
        label: {
          show: true,
          position: "insideStart",
          formatter: "Spot 24,050",
          color: "#60A5FA",
          fontSize: 10,
          fontWeight: 700,
          backgroundColor: "rgba(15,23,42,0.85)",
          borderColor: "rgba(96,165,250,0.3)",
          borderWidth: 1,
          borderRadius: 4,
          padding: [2, 6],
        },
      });
    }

    // Max Pain marker — dashed vertical line with badge label
    const painIdx = data.findIndex((d) => d.strike === 24100);
    if (painIdx >= 0 && viewMode !== "change") {
      markerSeries.push({
        name: "Max Pain",
        type: "line",
        data: [{ value: [strikes[painIdx], 0] }, { value: [strikes[painIdx], maxVal] }],
        coordinateSystem: "cartesian2d",
        lineStyle: { color: "#F59E0B", type: "dashed", width: 1.2 },
        symbol: "none",
        z: 5,
        tooltip: { show: false },
        label: {
          show: true,
          position: "insideStart",
          formatter: "Max Pain 24,100",
          color: "#FBBF24",
          fontSize: 10,
          fontWeight: 700,
          backgroundColor: "rgba(15,23,42,0.85)",
          borderColor: "rgba(251,191,36,0.3)",
          borderWidth: 1,
          borderRadius: 4,
          padding: [2, 6],
        },
      });
    }

    return {
      backgroundColor: "transparent",
      animation: true,
      animationDuration: 400,
      grid: { left: 58, right: 16, top: 8, bottom: 28 },
      xAxis: {
        type: "category",
        data: strikes,
        axisLine: { lineStyle: { color: G.grid } },
        axisTick: { show: false },
        axisLabel: {
          color: G.text,
          fontSize: 10,
          fontFamily: "ui-monospace, monospace",
          fontWeight: 600,
          margin: 8,
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        max: maxVal,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: G.text,
          fontSize: 9,
          fontFamily: "ui-monospace, monospace",
          formatter: (v: number) => fmtOI(v),
          margin: 6,
        },
        splitLine: { show: true, lineStyle: { color: G.grid } },
      },
      dataZoom: [{ type: "inside", orient: "horizontal", minSpan: 25 }],
      series: [...callSeries, ...putSeries, ...markerSeries],
    } as EChartsOption;
  }, [data, viewMode]);

  return (
    <ReactECharts
      key={chartKey}
      ref={chartRef}
      option={option}
      style={{ height: 420, width: "100%" }}
      opts={{ renderer: "canvas" }}
      notMerge
    />
  );
}

// ─── Dual Range Slider ─────────────────────────────────────────────────────

function DualRangeSlider({
  min,
  max,
  leftVal,
  rightVal,
  onChange,
}: {
  min: number;
  max: number;
  leftVal: number;
  rightVal: number;
  onChange: (left: number, right: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const rng = max - min || 1;
  const leftPct = ((leftVal - min) / rng) * 100;
  const rightPct = ((rightVal - min) / rng) * 100;

  const formatTime = (h: number) => {
    const hour = Math.floor(h);
    const min2 = Math.round((h - hour) * 60);
    const period = hour >= 12 ? "PM" : "AM";
    const h12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${h12}:${min2.toString().padStart(2, "0")} ${period}`;
  };

  const handleMouseDown = useCallback(
    (handle: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault();
      const track = trackRef.current;
      if (!track) return;
      const rng = max - min || 1;

      const onMove = (me: MouseEvent) => {
        const rect = track.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
        const val = min + pct * rng;
        if (handle === "left") {
          const newLeft = Math.min(val, rightVal - 0.25);
          onChange(Math.max(min, newLeft), rightVal);
        } else {
          const newRight = Math.max(val, leftVal + 0.25);
          onChange(leftVal, Math.min(max, newRight));
        }
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [leftVal, rightVal, min, max, onChange],
  );

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-mono font-semibold text-muted-foreground">
          {formatTime(leftVal)}
        </span>
        <span className="text-[10px] font-mono font-semibold text-muted-foreground">
          {formatTime(rightVal)}
        </span>
      </div>
      <div ref={trackRef} className="relative w-full h-2 rounded-full bg-border cursor-pointer">
        <div
          className="absolute top-0 h-full rounded-full"
          style={{
            left: `${leftPct}%`,
            width: `${rightPct - leftPct}%`,
            background: "linear-gradient(90deg, rgba(34,197,94,0.4), rgba(34,197,94,0.6))",
          }}
        />
        {/* Left handle */}
        <div
          onMouseDown={handleMouseDown("left")}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-4 rounded-full border-2 border-[var(--neon)] bg-background shadow-md cursor-ew-resize z-10 hover:scale-110 transition-transform"
          style={{ left: `${leftPct}%` }}
        />
        {/* Right handle */}
        <div
          onMouseDown={handleMouseDown("right")}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-4 rounded-full border-2 border-[var(--neon)] bg-background shadow-md cursor-ew-resize z-10 hover:scale-110 transition-transform"
          style={{ left: `${rightPct}%` }}
        />
      </div>
    </div>
  );
}

// ─── OI Summary Card ────────────────────────────────────────────────────────

function OISummaryCard({
  title,
  subtitle,
  callValue,
  putValue,
  callLabel,
  putLabel,
  callPct,
  putPct,
}: {
  title: string;
  subtitle?: string;
  callValue: string;
  putValue: string;
  callLabel: string;
  putLabel: string;
  callPct: number;
  putPct: number;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: G.call }} />
            {callLabel}
          </span>
          <span className="font-mono text-lg font-bold text-foreground">{callValue}</span>
        </div>
        <div className="h-8 rounded-lg overflow-hidden" style={{ background: G.callDim }}>
          <div
            className="h-full rounded-lg transition-all duration-500"
            style={{ width: `${callPct}%`, background: G.call }}
          />
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: G.put }} />
            {putLabel}
          </span>
          <span className="font-mono text-lg font-bold text-foreground">{putValue}</span>
        </div>
        <div className="h-8 rounded-lg overflow-hidden" style={{ background: G.putDim }}>
          <div
            className="h-full rounded-lg transition-all duration-500"
            style={{ width: `${putPct}%`, background: G.put }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Sentiment Gauge (SVG Circular) ────────────────────────────────────────

function MarketSentimentGauge({
  sentiment,
}: {
  sentiment: { label: string; score: number; color: string };
}) {
  const { label, score, color } = sentiment;
  const r = 64;
  const cx = 80;
  const cy = 80;
  const strokeWidth = 12;
  const arcLen = 180;
  const startAngle = 180;
  const endAngle = 360;
  const nf = score / 100;

  function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function describeArc(sAngle: number, eAngle: number) {
    const s = polarToCartesian(cx, cy, r, sAngle);
    const e = polarToCartesian(cx, cy, r, eAngle);
    const largeArc = eAngle - sAngle > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
  }

  const needleAngle = startAngle + nf * arcLen;
  const needleLen = r - 6;
  const needleEnd = polarToCartesian(cx, cy, needleLen, needleAngle);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col items-center">
      <h3 className="text-sm font-bold text-foreground mb-2">Market Sentiment</h3>
      <p className="text-[11px] text-muted-foreground mb-1">Based on OI</p>
      <svg width="160" height="104" viewBox="0 0 160 104">
        <defs>
          <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={G.put} />
            <stop offset="50%" stopColor="#EAB308" />
            <stop offset="100%" stopColor={G.call} />
          </linearGradient>
        </defs>
        <path
          d={describeArc(startAngle, endAngle)}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        <path
          d={describeArc(startAngle, startAngle + nf * arcLen)}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          style={{ transition: "all 0.8s ease" }}
        />
        <line
          x1={cx}
          y1={cy}
          x2={needleEnd.x}
          y2={needleEnd.y}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          style={{ transition: "all 0.8s ease" }}
        />
        <circle cx={cx} cy={cy} r={4} fill={color} />
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fill={color}
          fontSize="16"
          fontWeight="bold"
          fontFamily="ui-monospace,monospace"
        >
          {label}
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          fill={G.text}
          fontSize="13"
          fontWeight="bold"
          fontFamily="ui-monospace,monospace"
        >
          {score}%
        </text>
      </svg>
    </div>
  );
}

function PCRSentimentGauge({
  pcr,
  putPct,
  callPct,
}: {
  pcr: number;
  putPct: number;
  callPct: number;
}) {
  const r = 60;
  const cx = 80;
  const cy = 80;
  const sw = 22;
  const totalAngle = 360;
  const putAngle = (putPct / 100) * totalAngle;

  function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function describeArc(sAngle: number, eAngle: number) {
    const s = polarToCartesian(cx, cy, r, sAngle);
    const e = polarToCartesian(cx, cy, r, eAngle);
    const large = eAngle - sAngle > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  }

  const isBullish = pcr < 0.8;
  const isBearish = pcr > 1.2;
  const sentimentColor = isBullish ? G.call : isBearish ? G.put : "#EAB308";

  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col items-center">
      <h3 className="text-sm font-bold text-foreground mb-2">PCR Sentiment</h3>
      <svg width="160" height="120" viewBox="0 0 160 120">
        <path
          d={describeArc(0, putAngle < 1 ? 1 : putAngle)}
          fill="none"
          stroke={G.put}
          strokeWidth={sw}
          strokeLinecap="round"
        />
        <path
          d={describeArc(putAngle, totalAngle)}
          fill="none"
          stroke={G.call}
          strokeWidth={sw}
          strokeLinecap="round"
        />
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          fill={G.text}
          fontSize="10"
          fontFamily="ui-sans-serif"
          fontWeight="600"
        >
          PCR
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          fill={sentimentColor}
          fontSize="22"
          fontWeight="bold"
          fontFamily="ui-monospace,monospace"
        >
          {pcr.toFixed(2)}
        </text>
        <text
          x={12}
          y={114}
          textAnchor="start"
          fill={G.put}
          fontSize="10"
          fontFamily="ui-monospace,monospace"
          fontWeight="600"
        >
          PUT {putPct.toFixed(0)}%
        </text>
        <text
          x={148}
          y={114}
          textAnchor="end"
          fill={G.call}
          fontSize="10"
          fontFamily="ui-monospace,monospace"
          fontWeight="600"
        >
          CALL {callPct.toFixed(0)}%
        </text>
      </svg>
      <div className="mt-2 flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: sentimentColor }} />
        <span className="text-xs font-semibold" style={{ color: sentimentColor }}>
          {isBullish ? "Bullish" : isBearish ? "Bearish" : "Neutral"}
        </span>
      </div>
    </div>
  );
}

// ─── AI Analysis Card ───────────────────────────────────────────────────────

function AIAnalysisCard({
  pcr,
  totalCallOI,
  totalPutOI,
  callChange,
  putChange,
}: {
  pcr: number;
  totalCallOI: number;
  totalPutOI: number;
  callChange: number;
  putChange: number;
}) {
  const isBearish = pcr < 0.95;
  const isBullish = pcr > 1.1;
  const sentiment = isBullish ? "Bullish" : isBearish ? "Bearish" : "Neutral";
  const sentimentColor = isBullish ? G.call : isBearish ? G.put : "#EAB308";

  const confidence = useMemo(() => {
    const pcrScore = pcr < 0.8 ? 85 : pcr < 0.95 ? 75 : pcr > 1.2 ? 80 : pcr > 1.1 ? 70 : 60;
    const oiScore = totalCallOI > totalPutOI ? 75 : 65;
    const changeScore =
      callChange > 0 && putChange < 0 ? 80 : callChange < 0 && putChange > 0 ? 75 : 65;
    return Math.round((pcrScore + oiScore + changeScore) / 3);
  }, [pcr, totalCallOI, totalPutOI, callChange, putChange]);

  const analysis = useMemo(() => {
    const lines: string[] = [];
    if (sentiment === "Bearish") {
      lines.push(
        `NIFTY is showing mildly bearish sentiment. PCR remains below 1.0 at ${pcr.toFixed(2)} indicating stronger call positioning.`,
      );
      lines.push(
        `Significant call writing near 24100 and 24200 suggests overhead resistance, with total call OI at ${fmtOI(totalCallOI)} outweighing put OI at ${fmtOI(totalPutOI)}.`,
      );
      lines.push(
        `Put accumulation around 23900\u201323950 provides support, but put OI change of ${fmtChange(putChange)} lacks strong conviction compared to call activity.`,
      );
      lines.push(
        `Max Pain at 24,100 aligns with heavy call concentration, suggesting market may gravitate toward this level by expiry.`,
      );
      lines.push(
        `Overall market bias remains bearish-to-neutral unless spot crosses above major resistance zones near 24,200\u201324,300.`,
      );
    } else if (sentiment === "Bullish") {
      lines.push(
        `NIFTY is displaying bullish sentiment with PCR at ${pcr.toFixed(2)}, indicating stronger put positioning relative to calls.`,
      );
      lines.push(
        `Total put OI of ${fmtOI(totalPutOI)} provides solid support at key strikes, with fresh put writing adding to downside protection.`,
      );
      lines.push(
        `Call OI change of ${fmtChange(callChange)} reflects limited overhead resistance, suggesting room for upside move.`,
      );
      lines.push(
        `Max Pain at 24,100 serves as a magnet, but bullish momentum could push spot toward 24,200\u201324,300 if sustained.`,
      );
      lines.push(
        `Traders should watch for breakout above 24,150 for confirmation of bullish bias.`,
      );
    } else {
      lines.push(
        `NIFTY is in a neutral consolidation phase with PCR at ${pcr.toFixed(2)}, showing balanced call and put positioning.`,
      );
      lines.push(
        `Total OI is fairly distributed with calls at ${fmtOI(totalCallOI)} and puts at ${fmtOI(totalPutOI)}, indicating no clear directional bias.`,
      );
      lines.push(
        `OI change data shows mixed activity: call change at ${fmtChange(callChange)} and put change at ${fmtChange(putChange)}.`,
      );
      lines.push(`Max Pain at 24,100 acts as the key equilibrium point for expiry.`);
      lines.push(
        `Range-bound strategy is advisable with support at 23,900 and resistance at 24,200 until a breakout occurs.`,
      );
    }
    return lines.join(" ");
  }, [sentiment, pcr, totalCallOI, totalPutOI, callChange, putChange]);

  return (
    <div className="rounded-2xl border border-border bg-card p-6 relative overflow-hidden">
      <div
        className="absolute top-0 right-0 w-[180px] h-[180px]"
        style={{
          background: `radial-gradient(circle at top right, ${sentimentColor}15, transparent 70%)`,
          pointerEvents: "none",
        }}
      />
      <div className="flex items-center gap-2 mb-4">
        <div
          className="grid h-8 w-8 place-items-center rounded-lg"
          style={{ background: `${sentimentColor}20` }}
        >
          <svg
            className="h-4 w-4"
            style={{ color: sentimentColor }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
            />
          </svg>
        </div>
        <h2 className="text-base font-bold text-foreground">Overall OI Sentiment Analysis</h2>
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed mb-5">{analysis}</p>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Sentiment:</span>
          <span
            className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border"
            style={{
              color: sentimentColor,
              borderColor: `${sentimentColor}40`,
              background: `${sentimentColor}10`,
            }}
          >
            {sentiment}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Confidence:</span>
          <div className="flex items-center gap-1.5">
            <div
              className="h-2 w-20 rounded-full overflow-hidden"
              style={{ background: "rgba(255,255,255,0.08)" }}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${confidence}%`, background: sentimentColor }}
              />
            </div>
            <span className="text-xs font-bold font-mono" style={{ color: sentimentColor }}>
              {confidence}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Professional Chart Legend Component ────────────────────────────────────

function ChartLegend({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === "total") {
    return (
      <div className="flex items-center gap-5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
          <span className="h-3 w-3 rounded-sm" style={{ background: G.call }} />
          Call OI
        </span>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
          <span className="h-3 w-3 rounded-sm" style={{ background: G.put }} />
          Put OI
        </span>
      </div>
    );
  }
  if (viewMode === "change") {
    return (
      <div className="flex items-center gap-5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
          <span
            className="h-3 w-3"
            style={{
              background: `linear-gradient(135deg, ${G.call} 50%, ${G.put} 50%)`,
              borderRadius: 2,
            }}
          />
          Increase
        </span>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
          <span
            className="h-3 w-3 rounded-sm border"
            style={{ borderColor: G.put, background: "transparent" }}
          />
          Decrease
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px]">
      <span className="flex items-center gap-1.5 font-semibold text-foreground">
        <span className="h-3 w-3 rounded-sm" style={{ background: G.call }} />
        Call OI
      </span>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <canvas
          width="12"
          height="12"
          ref={(el) => {
            if (el) {
              const ctx = el.getContext("2d");
              if (ctx) {
                ctx.clearRect(0, 0, 12, 12);
                ctx.strokeStyle = G.call;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                for (let i = -4; i < 12; i += 6) {
                  ctx.moveTo(i, 12);
                  ctx.lineTo(i + 6, 0);
                }
                ctx.stroke();
              }
            }
          }}
          className="rounded-sm"
        />
        Call Increase
      </span>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span
          className="h-3 w-3 rounded-sm border border-solid"
          style={{ borderColor: G.call, background: "transparent" }}
        />
        Call Decrease
      </span>
      <span className="flex items-center gap-1.5 font-semibold text-foreground">
        <span className="h-3 w-3 rounded-sm" style={{ background: G.put }} />
        Put OI
      </span>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <canvas
          width="12"
          height="12"
          ref={(el) => {
            if (el) {
              const ctx = el.getContext("2d");
              if (ctx) {
                ctx.clearRect(0, 0, 12, 12);
                ctx.strokeStyle = G.put;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                for (let i = -4; i < 12; i += 6) {
                  ctx.moveTo(i, 12);
                  ctx.lineTo(i + 6, 0);
                }
                ctx.stroke();
              }
            }
          }}
          className="rounded-sm"
        />
        Put Increase
      </span>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span
          className="h-3 w-3 rounded-sm border border-solid"
          style={{ borderColor: G.put, background: "transparent" }}
        />
        Put Decrease
      </span>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

function Page() {
  const [strikeCount, setStrikeCount] = useState<StrikeCount>(10);
  const [viewMode, setViewMode] = useState<ViewMode>("change+total");
  const [selectedIndex, setSelectedIndex] = useState<IndexKey>("NIFTY");
  const [selectedExpiry, setSelectedExpiry] = useState("CW");

  // Time filter state
  const [selectedTime, setSelectedTime] = useState("Full Day");
  const [timelineLeft, setTimelineLeft] = useState(9.25); // 9:15 AM in hours
  const [timelineRight, setTimelineRight] = useState(15.5); // 3:30 PM in hours

  // Compute a timeSeed from the selected time filter to regenerate mock data
  const timeSeed = useMemo(() => {
    const map: Record<string, number> = {
      "Last 5 Min": 1,
      "Last 10 Min": 2,
      "Last 15 Min": 3,
      "Last 30 Min": 4,
      "Last 1 Hr": 5,
      "Last 2 Hr": 6,
      "Last 3 Hr": 7,
      "Full Day": 8,
    };
    return map[selectedTime] ?? 8;
  }, [selectedTime]);

  const snapshot = useMemo(
    () => getCachedData(strikeCount, selectedIndex, selectedExpiry, timeSeed),
    [strikeCount, selectedIndex, selectedExpiry, timeSeed],
  );

  const data = snapshot.data;
  const { totalCallOI, totalPutOI, callChangeSum, putChangeSum, totalVolume } = snapshot.totals;
  const pcr = totalPutOI / totalCallOI;

  const timeFilters = [
    "Last 5 Min",
    "Last 10 Min",
    "Last 15 Min",
    "Last 30 Min",
    "Last 1 Hr",
    "Last 2 Hr",
    "Last 3 Hr",
    "Full Day",
  ];

  const sentimentLabel = pcr < 0.8 ? "Bullish" : pcr > 1.2 ? "Bearish" : "Neutral";
  const sentimentScore = pcr < 0.8 ? 30 : pcr > 1.2 ? 70 : 50;
  const sentimentColor = pcr < 0.8 ? G.call : pcr > 1.2 ? G.put : "#EAB308";

  return (
    <DashboardShell
      title="Options Open Interest Analytics"
      subtitle={`Professional OI Analysis \u2014 ${selectedIndex} Options`}
    >
      {/* ── SECTION 1: OI Analytics Chart ──────────────────────────────── */}
      <div className="mb-5 rounded-2xl border border-border bg-card p-5">
        {/* Top controls bar */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {/* Index Selector */}
          <SegBtn
            options={INDICES.map((idx) => ({ label: idx, value: idx }))}
            value={selectedIndex}
            onChange={(v) => setSelectedIndex(v as IndexKey)}
            size="xs"
          />

          <div className="h-5 w-px bg-border" />

          {/* View mode */}
          <SegBtn
            options={[
              { label: "OI Change + Total", value: "change+total" },
              { label: "OI Change", value: "change" },
              { label: "Total OI", value: "total" },
            ]}
            value={viewMode}
            onChange={(v) => setViewMode(v)}
            size="xs"
          />

          <div className="h-5 w-px bg-border" />

          {/* Strike range */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-semibold text-muted-foreground">Strikes:</span>
            <SegBtn
              options={[
                { label: "10", value: 10 },
                { label: "15", value: 15 },
                { label: "20", value: 20 },
              ]}
              value={strikeCount}
              onChange={(v) => setStrikeCount(v as unknown as StrikeCount)}
              size="xs"
            />
          </div>

          <div className="h-5 w-px bg-border" />

          {/* Expiry Selector */}
          <select
            value={selectedExpiry}
            onChange={(e) => setSelectedExpiry(e.target.value)}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-semibold text-foreground outline-none cursor-pointer"
          >
            {EXPIRIES.map((ex) => (
              <option key={ex.value} value={ex.value}>
                {ex.label}
              </option>
            ))}
          </select>

          <div className="h-5 w-px bg-border" />

          {/* Spot / Max Pain Markers */}
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold border border-blue-500/30 bg-blue-500/15 text-blue-400 leading-none">
              <span className="h-1 w-2 rounded-full bg-blue-400" />
              Spot
            </span>
            <span className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold border border-amber-500/30 bg-amber-500/15 text-amber-400 leading-none">
              <span className="h-1 w-2 rounded-full bg-amber-400" />
              Max Pain
            </span>
          </div>
        </div>

        {/* Chart area */}
        <div className="relative">
          <div className="absolute top-0 left-0 z-10">
            <ChartLegend viewMode={viewMode} />
          </div>
          <div className="pt-6">
            <OIChart
              data={data}
              strikeCount={strikeCount}
              viewMode={viewMode}
              index={selectedIndex}
              expiry={selectedExpiry}
              timeSeed={timeSeed}
            />
          </div>
        </div>

        {/* Time filters */}
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {timeFilters.map((t) => (
              <button
                key={t}
                onClick={() => setSelectedTime(t)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all cursor-pointer ${
                  selectedTime === t
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground border border-border"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Dual-range timeline slider */}
          <DualRangeSlider
            min={9.25}
            max={15.5}
            leftVal={timelineLeft}
            rightVal={timelineRight}
            onChange={(l, r) => {
              setTimelineLeft(l);
              setTimelineRight(r);
            }}
          />
        </div>
      </div>

      {/* ── SECTION 2: OI Summary Cards ────────────────────────────────── */}
      <div className="mb-5 grid gap-4 md:grid-cols-2">
        <OISummaryCard
          title="Open Interest Change"
          subtitle="Today's net OI change"
          callLabel="Call OI Change"
          putLabel="Put OI Change"
          callValue={fmtChange(callChangeSum)}
          putValue={fmtChange(putChangeSum)}
          callPct={
            callChangeSum > 0
              ? Math.min(
                  100,
                  (callChangeSum / Math.max(callChangeSum, Math.abs(putChangeSum))) * 100,
                )
              : Math.min(
                  100,
                  (Math.abs(callChangeSum) /
                    Math.max(Math.abs(callChangeSum), Math.abs(putChangeSum))) *
                    100,
                )
          }
          putPct={
            putChangeSum > 0
              ? Math.min(
                  100,
                  (putChangeSum / Math.max(putChangeSum, Math.abs(callChangeSum))) * 100,
                )
              : Math.min(
                  100,
                  (Math.abs(putChangeSum) /
                    Math.max(Math.abs(callChangeSum), Math.abs(putChangeSum))) *
                    100,
                )
          }
        />
        <OISummaryCard
          title="Total Open Interest"
          subtitle="Aggregate OI across all strikes"
          callLabel="Call OI"
          putLabel="Put OI"
          callValue={fmtOI(totalCallOI)}
          putValue={fmtOI(totalPutOI)}
          callPct={Math.min(100, (totalCallOI / Math.max(totalCallOI, totalPutOI)) * 100)}
          putPct={Math.min(100, (totalPutOI / Math.max(totalCallOI, totalPutOI)) * 100)}
        />
      </div>

      {/* ── SECTION 3: Sentiment Gauges ────────────────────────────────── */}
      <div className="mb-5 grid gap-4 md:grid-cols-2">
        <MarketSentimentGauge
          sentiment={{ label: sentimentLabel, score: sentimentScore, color: sentimentColor }}
        />
        <PCRSentimentGauge
          pcr={pcr}
          putPct={(totalPutOI / (totalCallOI + totalPutOI)) * 100}
          callPct={(totalCallOI / (totalCallOI + totalPutOI)) * 100}
        />
      </div>

      {/* ── SECTION 4: AI Analysis ─────────────────────────────────────── */}
      <AIAnalysisCard
        pcr={pcr}
        totalCallOI={totalCallOI}
        totalPutOI={totalPutOI}
        callChange={callChangeSum}
        putChange={putChangeSum}
      />
    </DashboardShell>
  );
}

export const Route = createFileRoute("/open-interest")({
  head: () => ({
    meta: [
      {
        title: "Options Open Interest Analytics — Live OI Analysis | Market Dashboard",
      },
      {
        name: "description",
        content:
          "Professional NIFTY options open interest analytics. Track OI distribution by strike, layered OI change visualization, market sentiment, PCR, and AI-powered market insight.",
      },
      {
        property: "og:title",
        content: "Options Open Interest Analytics — Live OI Analysis",
      },
      {
        property: "og:url",
        content: "https://indiandeshboard.lovable.app/open-interest",
      },
    ],
    links: [{ rel: "canonical", href: "https://indiandeshboard.lovable.app/open-interest" }],
  }),
  component: Page,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});
