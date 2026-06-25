import React, { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

export function IndexContributionChart({
    times,
    positive,
    negative,
    reference,
    endpoints,
}: {
    times: string[];
    positive: number[];
    negative: number[];
    reference: number[];
    endpoints: number[];
}) {
    const option: EChartsOption = useMemo(() => {
        const x = times;

        const posData = positive.map((v, i) => [x[i], v]);
        const negData = negative.map((v, i) => [x[i], v]);
        const refData = reference.map((v, i) => [x[i], v]);

        const endPointCoords = endpoints
            .filter((i) => i >= 0 && i < x.length)
            .map((i) => [x[i], positive[i] ?? 0]);

        return {
            backgroundColor: "transparent",
            animation: false,
            grid: {
                left: 54,
                right: 22,
                top: 28,
                bottom: 38,
            },
            tooltip: {
                trigger: "axis",
                backgroundColor: "rgba(10, 12, 16, 0.92)",
                borderColor: "rgba(255,255,255,0.08)",
                borderWidth: 1,
                textStyle: {
                    color: "#E6E9EF",
                    fontSize: 12,
                },
                axisPointer: {
                    type: "cross",
                    crossStyle: {
                        color: "rgba(255,255,255,0.25)",
                        width: 1,
                    },
                },
                formatter: (params: any) => {
                    const p = params.find((q: any) => q.seriesName === "Positive Contribution");
                    const n = params.find((q: any) => q.seriesName === "Negative Contribution");
                    const r = params.find((q: any) => q.seriesName === "Reference");
                    const time = params?.[0]?.axisValue ?? "";
                    const pv = p?.data?.[1];
                    const nv = n?.data?.[1];
                    const rv = r?.data?.[1];
                    const fmt = (v: number) =>
                        Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                    return [
                        `<div style="font-weight:700; margin-bottom:6px;">${time}</div>`,
                        `<div style="display:flex; gap:10px; align-items:center; margin:4px 0;">`,
                        `<span style="width:10px; height:10px; background:#27d48a; display:inline-block; border:1px solid rgba(255,255,255,0.15)"></span>`,
                        `<span>Positive</span><span style="margin-left:auto; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; color:#27d48a; font-weight:700;">${fmt(
                            pv ?? 0
                        )}</span>`,
                        `</div>`,
                        `<div style="display:flex; gap:10px; align-items:center; margin:4px 0;">`,
                        `<span style="width:10px; height:10px; background:#ff4d4f; display:inline-block; border:1px solid rgba(255,255,255,0.15)"></span>`,
                        `<span>Negative</span><span style="margin-left:auto; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; color:#ff4d4f; font-weight:700;">${fmt(
                            nv ?? 0
                        )}</span>`,
                        `</div>`,
                        `<div style="display:flex; gap:10px; align-items:center; margin:4px 0;">`,
                        `<span style="width:10px; height:10px; background:rgba(200,200,200,0.7); display:inline-block; border:1px solid rgba(255,255,255,0.15)"></span>`,
                        `<span>Reference</span><span style="margin-left:auto; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; color:#A9B2BF; font-weight:700;">${fmt(
                            rv ?? 0
                        )}</span>`,
                        `</div>`,
                    ].join("");
                },
            },
            legend: { show: false },
            xAxis: {
                type: "category",
                boundaryGap: false,
                data: x,
                axisLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
                axisTick: { show: false },
                axisLabel: {
                    color: "rgba(230,233,239,0.70)",
                    fontSize: 11,
                    formatter: (value: string, idx: number) => {
                        // show fewer labels to keep market style
                        if (idx === 0) return value;
                        const step = Math.max(1, Math.floor(x.length / 6));
                        if (idx % step === 0 || idx === x.length - 1) return value;
                        return "";
                    },
                },
                splitLine: { show: true, lineStyle: { color: "rgba(255,255,255,0.06)" } },
            },
            yAxis: {
                type: "value",
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: {
                    color: "rgba(230,233,239,0.70)",
                    fontSize: 11,
                    formatter: (v: number) => v.toFixed(2),
                },
                splitLine: { show: true, lineStyle: { color: "rgba(255,255,255,0.06)" } },
            },
            series: [
                {
                    name: "Reference",
                    type: "line",
                    data: refData,
                    smooth: true,
                    showSymbol: false,
                    lineStyle: {
                        width: 1.5,
                        type: "dotted",
                        color: "rgba(160,170,190,0.75)",
                    },
                    emphasis: { disabled: true },
                    z: 1,
                },
                {
                    name: "Positive Contribution",
                    type: "line",
                    data: posData,
                    smooth: true,
                    showSymbol: false,
                    lineStyle: { width: 2.2, color: "rgba(39,212,138,1)" },
                    itemStyle: { color: "rgba(39,212,138,1)" },
                    emphasis: { focus: "series" },
                    z: 3,
                },
                {
                    name: "Negative Contribution",
                    type: "line",
                    data: negData,
                    smooth: true,
                    showSymbol: false,
                    lineStyle: { width: 2.2, color: "rgba(255,77,79,1)" },
                    itemStyle: { color: "rgba(255,77,79,1)" },
                    emphasis: { focus: "series" },
                    z: 3,
                },
                // Endpoint markers (positive endpoints, to satisfy "endpoint markers" requirement)
                {
                    name: "Endpoints",
                    type: "scatter",
                    data: endPointCoords.map((p) => ({ value: p })),
                    symbolSize: 7,
                    itemStyle: {
                        color: "rgba(39,212,138,1)",
                        borderColor: "rgba(255,255,255,0.25)",
                        borderWidth: 1,
                    },
                    tooltip: { show: false },
                    z: 5,
                },
            ],
        } satisfies EChartsOption;
    }, [endpoints, negative, positive, reference, times]);

    return (
        <div className="w-full">
            <ReactECharts
                option={option}
                style={{ height: 480, width: "100%" }}
                opts={{ renderer: "canvas" }}
            />
        </div>
    );
}
