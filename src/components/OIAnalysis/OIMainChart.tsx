import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import type { ViewMode, TimeRange } from "./OIAnalysisDashboard";
import type { OIDataPoint } from "./mockData";

interface OIMainChartProps {
  data: OIDataPoint[];
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
}

const TIME_RANGES: { label: string; value: TimeRange }[] = [
  { label: "Last 3 min", value: "3min" },
  { label: "Last 5 min", value: "5min" },
  { label: "Last 10 min", value: "10min" },
  { label: "Last 15 min", value: "15min" },
  { label: "Last 30 min", value: "30min" },
  { label: "Last 1 hr", value: "1hr" },
  { label: "Last 2 hr", value: "2hr" },
  { label: "Last 3 hr", value: "3hr" },
  { label: "All", value: "all" },
];

const COLORS = {
  callOI: "#00DD99",
  putOI: "#FF7777",
  bg: "transparent",
  grid: "rgba(255,255,255,0.06)",
  text: "#A9B2BF",
};

function fmtOI(n: number): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  let s: string;
  if (abs >= 1e7) s = (abs / 1e7).toFixed(2) + " Cr";
  else if (abs >= 1e5) s = (abs / 1e5).toFixed(2) + " L";
  else if (abs >= 1e3) s = (abs / 1e3).toFixed(1) + " K";
  else s = abs.toLocaleString("en-IN");
  return n < 0 ? "−" + s : s;
}

// Create stripe pattern
function createStripePattern(color: string): CanvasPattern | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, 8, 8);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 8);
  ctx.lineTo(8, 0);
  ctx.stroke();
  return ctx.createPattern(canvas, "repeat");
}

export function OIMainChart({
  data,
  viewMode,
  onViewModeChange,
  timeRange,
  onTimeRangeChange,
}: OIMainChartProps) {
  const option = useMemo((): EChartsOption => {
    const strikes = data.map((d) => d.strike.toString());
    const maxVal = Math.max(
      ...data.map((d) =>
        Math.max(
          d.callOI + d.callOIIncrease + d.callOIDecrease,
          d.putOI + d.putOIIncrease + d.putOIDecrease
        )
      )
    ) * 1.2;

    const series: any[] = [];

    // Square bars configuration
    const barWidth = 8; // Fixed width in pixels for square shape
    const barGap = "20%";

    if (viewMode === "change+total" || viewMode === "total") {
      // Call OI (Solid)
      series.push({
        name: "Call OI",
        type: "bar",
        data: data.map((d) => d.callOI),
        barWidth,
        barGap,
        itemStyle: {
          color: COLORS.callOI,
          borderRadius: 0, // Square corners
        },
        stack: "call",
      });

      // Put OI (Solid)
      series.push({
        name: "Put OI",
        type: "bar",
        data: data.map((d) => d.putOI),
        barWidth,
        barGap,
        itemStyle: {
          color: COLORS.putOI,
          borderRadius: 0, // Square corners
        },
        stack: "put",
      });
    }

    if (viewMode === "change+total") {
      // Call OI Increase (Striped)
      series.push({
        name: "Call OI Increase",
        type: "bar",
        data: data.map((d) => d.callOIIncrease),
        barWidth,
        barGap,
        itemStyle: {
          color: {
            image: createStripePattern(COLORS.callOI) as any,
            repeat: "repeat",
          },
          borderRadius: 0,
        },
        stack: "call",
      });

      // Call OI Decrease (Outline)
      series.push({
        name: "Call OI Decrease",
        type: "bar",
        data: data.map((d) => d.callOIDecrease),
        barWidth,
        barGap,
        itemStyle: {
          color: "transparent",
          borderColor: COLORS.callOI,
          borderWidth: 2,
          borderRadius: 0,
        },
        stack: "call",
      });

      // Put OI Increase (Striped)
      series.push({
        name: "Put OI Increase",
        type: "bar",
        data: data.map((d) => d.putOIIncrease),
        barWidth,
        barGap,
        itemStyle: {
          color: {
            image: createStripePattern(COLORS.putOI) as any,
            repeat: "repeat",
          },
          borderRadius: 0,
        },
        stack: "put",
      });

      // Put OI Decrease (Outline)
      series.push({
        name: "Put OI Decrease",
        type: "bar",
        data: data.map((d) => d.putOIDecrease),
        barWidth,
        barGap,
        itemStyle: {
          color: "transparent",
          borderColor: COLORS.putOI,
          borderWidth: 2,
          borderRadius: 0,
        },
        stack: "put",
      });
    }

    // Spot Price marker
    const spotStrike = 24050;
    const spotIdx = data.findIndex((d) => d.strike === spotStrike);
    if (spotIdx >= 0) {
      series.push({
        name: "Spot",
        type: "line",
        data: strikes.map((s, i) => (i === spotIdx ? maxVal : null)),
        lineStyle: { color: "#3B82F6", type: "dashed", width: 2 },
        symbol: "none",
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#3B82F6", type: "dashed", width: 2 },
          data: [{ xAxis: spotIdx }],
          label: {
            show: true,
            position: "insideStartTop",
            formatter: "Spot: 24,056",
            color: "#60A5FA",
            fontSize: 10,
            fontWeight: "bold",
            backgroundColor: "rgba(15,23,42,0.9)",
            borderColor: "rgba(96,165,250,0.3)",
            borderWidth: 1,
            borderRadius: 4,
            padding: [3, 8],
          },
        },
      });
    }

    // Max Pain marker
    const maxPainStrike = 24100;
    const maxPainIdx = data.findIndex((d) => d.strike === maxPainStrike);
    if (maxPainIdx >= 0) {
      series.push({
        name: "Max Pain",
        type: "line",
        data: strikes.map((s, i) => (i === maxPainIdx ? maxVal : null)),
        lineStyle: { color: "#F59E0B", type: "dashed", width: 2 },
        symbol: "none",
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#F59E0B", type: "dashed", width: 2 },
          data: [{ xAxis: maxPainIdx }],
          label: {
            show: true,
            position: "insideStartTop",
            formatter: "Max Pain: 24,100",
            color: "#FBBF24",
            fontSize: 10,
            fontWeight: "bold",
            backgroundColor: "rgba(15,23,42,0.9)",
            borderColor: "rgba(251,191,36,0.3)",
            borderWidth: 1,
            borderRadius: 4,
            padding: [3, 8],
          },
        },
      });
    }

    return {
      backgroundColor: COLORS.bg,
      animation: true,
      animationDuration: 500,
      grid: { left: 60, right: 20, top: 40, bottom: 40 },
      xAxis: {
        type: "category",
        data: strikes,
        axisLine: { lineStyle: { color: COLORS.grid } },
        axisTick: { show: false },
        axisLabel: {
          color: COLORS.text,
          fontSize: 10,
          fontFamily: "ui-monospace, monospace",
          fontWeight: 600,
        },
      },
      yAxis: {
        type: "value",
        max: maxVal,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: COLORS.text,
          fontSize: 10,
          fontFamily: "ui-monospace, monospace",
          formatter: (v: number) => fmtOI(v),
        },
        splitLine: { lineStyle: { color: COLORS.grid } },
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(10,12,16,0.96)",
        borderColor: "rgba(255,255,255,0.08)",
        borderWidth: 1,
        textStyle: { color: "#E6E9EF", fontSize: 12 },
        formatter: (params: any) => {
          const idx = params[0]?.dataIndex ?? 0;
          const d = data[idx];
          if (!d) return "";
          return [
            `<div style="font-weight:bold;margin-bottom:8px;">Strike ${d.strike}</div>`,
            `<div style="color:#00DD99;">Call OI: ${fmtOI(d.callOI)}</div>`,
            `<div style="color:#FF7777;">Put OI: ${fmtOI(d.putOI)}</div>`,
            viewMode === "change+total" ? `<div style="color:#00DD99;font-size:11px;">Call Increase: ${fmtOI(d.callOIIncrease)}</div>` : "",
            viewMode === "change+total" ? `<div style="color:#00DD99;font-size:11px;">Call Decrease: ${fmtOI(d.callOIDecrease)}</div>` : "",
            viewMode === "change+total" ? `<div style="color:#FF7777;font-size:11px;">Put Increase: ${fmtOI(d.putOIIncrease)}</div>` : "",
            viewMode === "change+total" ? `<div style="color:#FF7777;font-size:11px;">Put Decrease: ${fmtOI(d.putOIDecrease)}</div>` : "",
          ].filter(Boolean).join("");
        },
      },
      series,
    } as EChartsOption;
  }, [data, viewMode]);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      {/* View Mode Tabs */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => onViewModeChange("change+total")}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            viewMode === "change+total"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          OI Change+Total
        </button>
        <button
          onClick={() => onViewModeChange("change")}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            viewMode === "change"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          OI Change
        </button>
        <button
          onClick={() => onViewModeChange("total")}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            viewMode === "total"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Total OI
        </button>
      </div>

      {/* Chart */}
      <ReactECharts
        option={option}
        style={{ height: 500, width: "100%" }}
        opts={{ renderer: "canvas" }}
        notMerge
      />

      {/* Time Range Selector */}
      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex flex-wrap gap-2">
          {TIME_RANGES.map((tr) => (
            <button
              key={tr.value}
              onClick={() => onTimeRangeChange(tr.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                timeRange === tr.value
                  ? "bg-blue-500 text-white"
                  : "bg-background border border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {tr.label}
            </button>
          ))}
        </div>

        {/* Timeline Slider */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono font-semibold text-muted-foreground">9:15 AM</span>
            <span className="text-xs font-mono font-semibold text-muted-foreground">3:30 PM</span>
          </div>
          <div className="relative w-full h-2 rounded-full bg-border">
            <div
              className="absolute top-0 left-0 h-full rounded-full"
              style={{
                width: "100%",
                background: "linear-gradient(90deg, rgba(34,197,94,0.4), rgba(34,197,94,0.6))",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
