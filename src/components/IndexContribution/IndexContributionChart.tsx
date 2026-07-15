import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

export type IndexContributionChartPoint = {
  time: number;
  positive: number;
  negative: number;
  index: number;
};

const numberFormat = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

export function IndexContributionChart({
  points,
  indexLabel,
}: {
  points: IndexContributionChartPoint[];
  indexLabel: string;
}) {
  const option = useMemo<EChartsOption>(() => {
    const positive = points.map((point) => [point.time, point.positive]);
    // Plot negative contribution as a positive magnitude so the red line
    // represents total selling pressure above the shared zero baseline.
    const negative = points.map((point) => [point.time, Math.abs(point.negative)]);
    const index = points.map((point) => [point.time, point.index]);

    return {
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 68, right: 62, top: 38, bottom: 38, containLabel: false },
      legend: {
        show: true,
        top: 0,
        left: 8,
        itemWidth: 8,
        itemHeight: 8,
        icon: "circle",
        textStyle: { color: "#8b96a7", fontSize: 10 },
        data: ["Positive Points", "Negative Points", indexLabel],
      },
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: "rgba(7, 13, 21, 0.96)",
        borderColor: "rgba(148, 163, 184, 0.22)",
        borderWidth: 1,
        padding: 10,
        textStyle: { color: "#e5e7eb", fontSize: 12 },
        axisPointer: {
          type: "cross",
          lineStyle: { color: "rgba(148, 163, 184, 0.6)", type: "dashed" },
          crossStyle: { color: "rgba(148, 163, 184, 0.6)", type: "dashed" },
        },
        formatter: (raw: unknown) => {
          const params = Array.isArray(raw) ? raw : [];
          const time = Number((params[0] as { value?: unknown[] } | undefined)?.value?.[0] ?? 0);
          const rows = params
            .map((item) => {
              const param = item as { seriesName?: string; color?: string; value?: unknown[] };
              const value = Number(param.value?.[1] ?? 0);
              return `<div style="display:flex;align-items:center;gap:8px;margin-top:5px"><span style="width:7px;height:7px;border-radius:50%;background:${param.color}"></span><span style="color:#9ca3af">${param.seriesName}</span><strong style="margin-left:auto;color:#f3f4f6">${numberFormat.format(value)}</strong></div>`;
            })
            .join("");
          return `<div style="min-width:190px"><strong>${formatTime(time)} IST</strong>${rows}</div>`;
        },
      },
      xAxis: {
        type: "time",
        boundaryGap: false,
        min: points[0]?.time,
        max: points.at(-1)?.time,
        axisLine: { lineStyle: { color: "rgba(148, 163, 184, 0.16)" } },
        axisTick: { show: false },
        axisLabel: {
          color: "#8b96a7",
          fontSize: 11,
          hideOverlap: true,
          formatter: (value: number) => formatTime(value),
        },
        splitLine: { show: true, lineStyle: { color: "rgba(148, 163, 184, 0.09)" } },
      },
      yAxis: [
        {
          type: "value",
          name: indexLabel,
          nameLocation: "end",
          nameGap: 12,
          nameTextStyle: { color: "#7f8a9b", fontSize: 11, align: "left" },
          scale: true,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: "#8b96a7",
            fontSize: 11,
            formatter: (value: number) => numberFormat.format(value),
          },
          splitLine: { show: true, lineStyle: { color: "rgba(148, 163, 184, 0.1)" } },
        },
        {
          type: "value",
          name: "Contribution Points",
          nameLocation: "end",
          nameGap: 12,
          nameTextStyle: { color: "#7f8a9b", fontSize: 11, align: "right" },
          scale: true,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: "#8b96a7",
            fontSize: 11,
            formatter: (value: number) => numberFormat.format(value),
          },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "Positive Points",
          type: "line",
          yAxisIndex: 1,
          data: positive,
          smooth: 0.18,
          showSymbol: false,
          lineStyle: { color: "#37e34c", width: 2.2 },
          itemStyle: { color: "#37e34c" },
          emphasis: { focus: "series" },
          markLine: {
            silent: true,
            symbol: "none",
            data: [{ yAxis: 0 }],
            lineStyle: { color: "rgba(148, 163, 184, 0.28)", width: 1 },
            label: { show: false },
          },
          z: 3,
        },
        {
          name: "Negative Points",
          type: "line",
          yAxisIndex: 1,
          data: negative,
          smooth: 0.18,
          showSymbol: false,
          lineStyle: { color: "#ff4148", width: 2.2 },
          itemStyle: { color: "#ff4148" },
          emphasis: { focus: "series" },
          z: 3,
        },
        {
          name: indexLabel,
          type: "line",
          yAxisIndex: 0,
          data: index,
          smooth: 0.1,
          showSymbol: false,
          lineStyle: { color: "rgba(174, 181, 191, 0.72)", width: 1, type: "dotted" },
          itemStyle: { color: "#c4c8ce" },
          emphasis: { focus: "series" },
          z: 2,
        },
      ],
      media: [
        {
          query: { maxWidth: 520 },
          option: {
            grid: { left: 52, right: 52, top: 38, bottom: 34 },
            legend: {
              left: 2,
              itemGap: 8,
              itemWidth: 7,
              itemHeight: 7,
              textStyle: { fontSize: 8 },
            },
            yAxis: [
              { name: "", axisLabel: { fontSize: 9 } },
              { name: "", axisLabel: { fontSize: 9 } },
            ],
          },
        },
      ],
    };
  }, [indexLabel, points]);

  return (
    <ReactECharts
      option={option}
      notMerge
      lazyUpdate
      style={{ height: "100%", width: "100%" }}
      opts={{ renderer: "canvas" }}
    />
  );
}
