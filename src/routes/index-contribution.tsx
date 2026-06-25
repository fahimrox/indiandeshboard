import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { DashboardShell } from "@/components/DashboardShell";
import { dashboardQuery, indexContributionsQuery, quotesQuery } from "@/lib/dashboard-query";
import { fmt } from "@/components/MarketBits";
import type { Quote } from "@/lib/market.functions";

const ALL_INDEX_SYMBOLS = [
  { sym: "^NSEI", label: "NIFTY 50", key: "nifty" as const },
  { sym: "^NSEBANK", label: "BANK NIFTY", key: "banknifty" as const },
  { sym: "^BSESN", label: "SENSEX", key: "sensex" as const },
];

const PERIODS = ["Prev", "Intraday", "3m", "5m", "15m", "1h"] as const;
type Period = typeof PERIODS[number];

function generateIntradayTimes(intervalMinutes: number): string[] {
  const t: string[] = [];
  for (let h = 9; h <= 15; h++) {
    const sm = h === 9 ? 15 : 0;
    const em = h === 15 ? 30 : 55;
    for (let m = sm; m <= em; m += intervalMinutes) {
      t.push(`${h}:${m.toString().padStart(2, "0")}`);
    }
  }
  return t;
}

function stepsForPeriod(period: Period): number {
  switch (period) {
    case "Prev": return 76;
    case "Intraday": return 76;
    case "3m": return 125;
    case "5m": return 76;
    case "15m": return 25;
    case "1h": return 7;
  }
}

function labelsForPeriod(period: Period): string[] {
  switch (period) {
    case "Prev": return generateIntradayTimes(5);
    case "Intraday": return generateIntradayTimes(5);
    case "3m": return generateIntradayTimes(3);
    case "5m": return generateIntradayTimes(5);
    case "15m": return generateIntradayTimes(15);
    case "1h": return generateIntradayTimes(60);
  }
}

export const Route = createFileRoute("/index-contribution")({
  head: () => ({
    meta: [
      { title: "Index Contribution — Live Constituent Movers | IndexMover" },
      { name: "description", content: "See which stocks are driving each index — positive and negative contribution breakdown with live data." },
      { property: "og:title", content: "Index Contribution — Live Constituent Movers" },
      { property: "og:description", content: "See which stocks are driving each index — positive and negative contribution breakdown." },
    ],
  }),
  loader: ({ context }) => Promise.all([
    context.queryClient.ensureQueryData(dashboardQuery),
    context.queryClient.ensureQueryData(indexContributionsQuery("nifty")),
  ]),
  component: Page,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
});

function CountdownTimer() {
  const s = useRef(30);
  const [v, setV] = useState(30);
  useEffect(() => {
    const id = setInterval(() => { s.current = s.current <= 1 ? 30 : s.current - 1; setV(s.current); }, 1000);
    return () => clearInterval(id);
  }, []);
  const dash = ((30 - v) / 30) * 113;
  return (
    <div className="relative w-[34px] h-[34px] flex items-center justify-center">
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="18" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
        <circle cx="20" cy="20" r="18" fill="none" stroke="rgba(230,233,239,0.35)" strokeWidth="3" strokeDasharray="113" strokeDashoffset={dash} strokeLinecap="round" />
      </svg>
      <span className="text-[10px] font-mono tabular-nums text-muted-foreground">{v}</span>
    </div>
  );
}

function generatePriceSeries(prev: number, cur: number, steps: number): number[] {
  const diff = cur - prev;
  const absDiff = Math.abs(diff);
  const drift = diff / steps;
  const baseVol = Math.max(absDiff * 0.04, Math.abs(prev) * 0.0003, 0.5);
  const s: number[] = [prev];
  for (let i = 1; i < steps - 1; i++) {
    const stepDrift = drift + (Math.random() - 0.5) * baseVol * 0.5;
    const spike = (Math.random() < 0.12 ? (Math.random() - 0.5) * baseVol * 4 : 0);
    let v = s[i - 1] + stepDrift + (Math.random() - 0.5) * baseVol * 2 + spike;
    const maxChg = absDiff * 1.5 + baseVol * 6;
    const prevChg = v - s[0];
    if (Math.abs(prevChg) > maxChg) {
      v = s[0] + Math.sign(prevChg) * maxChg * 0.9;
    }
    s.push(v);
  }
  s.push(cur);
  return s;
}

function generateContributionSeries(target: number, steps: number): number[] {
  const absT = Math.abs(target);
  const drift = target / steps;
  const baseVol = Math.max(absT * 0.06, 0.15);
  const s: number[] = [0];
  for (let i = 1; i < steps - 1; i++) {
    const stepDrift = drift + (Math.random() - 0.5) * baseVol * 0.3;
    const spike = Math.random() < 0.08 ? (Math.random() - 0.5) * baseVol * 3 : 0;
    let v = s[i - 1] + stepDrift + (Math.random() - 0.5) * baseVol * 1.8 + spike;
    if (target > 0) v = Math.max(v, -absT * 0.08);
    else if (target < 0) v = Math.min(v, absT * 0.08);
    s.push(v);
  }
  s.push(target);
  return s;
}

function Page() {
  const [activeIndex, setActiveIndex] = useState<"nifty" | "banknifty" | "sensex">("nifty");
  const [period, setPeriod] = useState<Period>("Intraday");
  const { data: dash } = useSuspenseQuery(dashboardQuery);
  const { data: allQuotes } = useSuspenseQuery(
    quotesQuery(ALL_INDEX_SYMBOLS.map((i) => i.sym))
  );
  const { data } = useSuspenseQuery(indexContributionsQuery(activeIndex));

  const allQuoteMap = useMemo(() => {
    const m = new Map<string, Quote>();
    for (const q of allQuotes) if (q) m.set(q.symbol, q);
    return m;
  }, [allQuotes]);

  const totalPosPoints = data.positive.reduce((s, r) => s + r.contributionPoints, 0);
  const totalNegPoints = data.negative.reduce((s, r) => s + r.contributionPoints, 0);

  const times = useMemo(() => labelsForPeriod(period), [period]);
  const steps = times.length;

  const { posSeries, negSeries, idxSeries } = useMemo(() => {
    const pos = generateContributionSeries(totalPosPoints, steps);
    const neg = generateContributionSeries(totalNegPoints, steps);
    const idx = data.indexQuote
      ? generatePriceSeries(data.indexQuote.prevClose, data.indexQuote.price, steps)
      : generatePriceSeries(100, 101, steps);
    return { posSeries: pos, negSeries: neg, idxSeries: idx };
  }, [totalPosPoints, totalNegPoints, data.indexQuote, steps]);

  const chartOption: EChartsOption = useMemo(() => {
    const posD = posSeries.map((v, i) => [times[i], v] as [string, number]);
    const negD = negSeries.map((v, i) => [times[i], v] as [string, number]);
    const idxD = idxSeries.map((v, i) => [times[i], v] as [string, number]);

    const allVals = [...posSeries, ...negSeries];
    const contribMin = Math.min(0, ...allVals);
    const contribMax = Math.max(0, ...allVals);
    const contribPad = Math.max(Math.abs(contribMax - contribMin) * 0.15, 5);

    const idxMin = Math.min(...idxSeries);
    const idxMax = Math.max(...idxSeries);
    const idxPad = Math.max((idxMax - idxMin) * 0.15, 20);

    return {
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 60, right: 60, top: 24, bottom: 36 },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(10,12,16,0.92)",
        borderColor: "rgba(255,255,255,0.08)",
        borderWidth: 1,
        textStyle: { color: "#E6E9EF", fontSize: 12 },
        axisPointer: { type: "cross", crossStyle: { color: "rgba(255,255,255,0.25)", width: 1 } },
        formatter: (ps: any) => {
          const p = ps.find((q: any) => q.seriesName === "Positive");
          const n = ps.find((q: any) => q.seriesName === "Negative");
          const ix = ps.find((q: any) => q.seriesName === "NIFTY");
          const t = ps?.[0]?.axisValue ?? "";
          const f = (v: number) => v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return [
            `<div style="font-weight:700;margin-bottom:6px;">${t}</div>`,
            `<div style="display:flex;gap:10px;align-items:center;margin:4px 0;">`,
            `<span style="width:10px;height:10px;background:#9aa0a8;display:inline-block;"></span>`,
            `<span>NIFTY</span><span style="margin-left:auto;font-family:monospace;color:#e8eaed;font-weight:700;">${f(ix?.data?.[1] ?? 0)}</span></div>`,
            `<div style="display:flex;gap:10px;align-items:center;margin:4px 0;">`,
            `<span style="width:10px;height:10px;background:#27d48a;display:inline-block;"></span>`,
            `<span>Positive</span><span style="margin-left:auto;font-family:monospace;color:#27d48a;font-weight:700;">${f(p?.data?.[1] ?? 0)}</span></div>`,
            `<div style="display:flex;gap:10px;align-items:center;margin:4px 0;">`,
            `<span style="width:10px;height:10px;background:#ff4d4f;display:inline-block;"></span>`,
            `<span>Negative</span><span style="margin-left:auto;font-family:monospace;color:#ff4d4f;font-weight:700;">${f(n?.data?.[1] ?? 0)}</span></div>`,
          ].join("");
        },
      },
      legend: { show: false },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: times,
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
        axisTick: { show: false },
        axisLabel: { color: "rgba(230,233,239,0.65)", fontSize: 10, interval: 5 },
        splitLine: { show: true, lineStyle: { color: "rgba(255,255,255,0.05)" } },
      },
      yAxis: [
        {
          type: "value",
          min: contribMin - contribPad,
          max: contribMax + contribPad,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: "rgba(230,233,239,0.65)", fontSize: 10, formatter: (v: number) => v.toFixed(1) },
          splitLine: { show: true, lineStyle: { color: "rgba(255,255,255,0.05)" } },
          name: "Contribution Points",
          nameTextStyle: { color: "rgba(230,233,239,0.4)", fontSize: 9 },
        },
        {
          type: "value",
          min: idxMin - idxPad,
          max: idxMax + idxPad,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: "rgba(230,233,239,0.65)", fontSize: 10, formatter: (v: number) => v.toFixed(0) },
          splitLine: { show: false },
          name: "NIFTY",
          nameTextStyle: { color: "rgba(230,233,239,0.4)", fontSize: 9 },
        },
      ],
      series: [
        {
          name: "NIFTY",
          type: "line",
          yAxisIndex: 1,
          data: idxD,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 1.5, color: "rgba(232,234,237,0.7)", type: "dashed" as const },
          emphasis: { focus: "series" },
          z: 1,
        },
        {
          name: "Positive",
          type: "line",
          yAxisIndex: 0,
          data: posD,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2.5, color: "#4ade4a" },
          emphasis: { focus: "series" },
          z: 3,
        },
        {
          name: "Negative",
          type: "line",
          yAxisIndex: 0,
          data: negD,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2.5, color: "#ff4d4f" },
          emphasis: { focus: "series" },
          z: 3,
        },
        {
          name: "EP",
          type: "scatter",
          yAxisIndex: 1,
          data: [
            { value: idxD[0] as [string, number] },
            { value: idxD[idxD.length - 1] as [string, number] },
          ],
          symbolSize: 7,
          itemStyle: { color: "rgba(232,234,237,0.85)", borderColor: "rgba(255,255,255,0.25)", borderWidth: 1 },
          tooltip: { show: false },
          z: 5,
        },
      ],
    } satisfies EChartsOption;
  }, [times, posSeries, negSeries, idxSeries]);

  return (
    <DashboardShell title="Index Contribution" subtitle="Constituent-wise contribution breakdown" updatedAt={data.updatedAt}>
      {/* TOP: Sidebar + Chart (2-col StockMojo) */}
      <div className="flex flex-col lg:flex-row gap-3 mb-3">
        {/* LEFT SIDEBAR */}
        <div className="lg:w-[260px] lg:flex-shrink-0">
          <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col h-[410px]">
            <div className="px-3 py-2 border-b border-border bg-background/40 space-y-1.5 flex-shrink-0">
              <h2 className="text-xs font-semibold text-foreground tracking-wide">Index Contribution</h2>
              <div className="inline-flex select-none items-center overflow-hidden rounded-md border border-border bg-background/40">
                {PERIODS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`px-1.5 py-0.5 text-[9px] font-medium border-r border-border last:border-r-0 transition-colors ${
                      p === period ? "bg-background/60 text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between px-3 py-1 bg-background/20 border-b border-border text-[10px] text-muted-foreground tracking-wider flex-shrink-0">
              <span>Index</span>
              <div className="flex items-center gap-2">
                <span className="w-[52px] text-right">Price</span>
                <span className="w-[44px] text-right">Chg%</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {ALL_INDEX_SYMBOLS.map(({ sym, label, key }) => {
                const q = allQuoteMap.get(sym) ?? null;
                const up = q ? q.changePct >= 0 : false;
                const active = activeIndex === key;
                return (
                  <div
                    key={sym}
                    onClick={() => setActiveIndex(key)}
                    className={`flex items-center justify-between px-3 py-1 border-b border-border/20 text-xs cursor-pointer transition-colors ${
                      active ? "bg-background/40" : "hover:bg-card/70"
                    }`}
                  >
                    <span className={`text-[11px] font-semibold uppercase tracking-wider ${active ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
                    {q ? (
                      <div className="flex items-center gap-2 font-mono tabular-nums">
                        <span className="w-[52px] text-right">{fmt(q.price, 2)}</span>
                        <span className={`w-[44px] text-right ${up ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                          {q.changePct >= 0 ? "+" : ""}{fmt(q.changePct, 2)}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* CHART */}
        <div className="flex-1 min-w-0">
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-3 py-2 border-b border-border bg-background/40 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-foreground tracking-wide">Index Contribution</h2>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground select-none">Replay</span>
                <CountdownTimer />
              </div>
            </div>
            <div className="p-1">
              {data.rows.length > 0 ? (
                <ReactECharts option={chartOption} style={{ height: 500, width: "100%" }} opts={{ renderer: "canvas" }} />
              ) : (
                <div className="flex items-center justify-center h-[500px] text-xs text-muted-foreground">No chart data</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM: 3-col grid (Positive | Points | Negative) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Positive Contributors */}
        <div className="lg:col-span-3">
          <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col h-fit">
            <div className="px-3 py-2 border-b border-border bg-card flex items-center justify-between">
              <h3 className="text-xs font-semibold text-[var(--bull)]">Positive Contributors</h3>
              <span className="text-[10px] text-[var(--bull)] uppercase tracking-wider font-medium bg-[var(--bull)]/10 px-1.5 py-0.5 rounded border border-[var(--bull)]/20">
                {data.positive.length}
              </span>
            </div>
            <div className="flex items-center justify-between px-3 py-1 bg-background/20 border-b border-border text-[10px] text-muted-foreground tracking-wider">
              <span>Symbol</span>
              <div className="flex items-center gap-2 text-right">
                <span className="w-12">Price</span>
                <span className="w-12">Chg%</span>
              </div>
            </div>
            <div className="overflow-y-auto max-h-[520px]">
              {data.positive.map((r) => (
                <div key={r.symbol} className="flex items-center justify-between px-3 py-1 border-b border-border/20 hover:bg-card/70 text-xs">
                  <span className="font-semibold">{r.symbol}</span>
                  <div className="flex items-center gap-2 text-right font-mono tabular-nums">
                    <span className="w-12">{fmt(r.price, 2)}</span>
                    <span className={`w-12 ${r.changePct >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                      {r.changePct >= 0 ? "+" : ""}{fmt(r.changePct, 2)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Points Contribution — Building shape layout */}
        <div className="lg:col-span-6">
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-3 py-2 border-b border-border bg-card flex flex-wrap items-center justify-between gap-1">
              <h3 className="text-xs font-semibold text-foreground">Points Contribution</h3>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono font-bold tabular-nums text-[var(--bull)]">+{fmt(totalPosPoints, 2)}</span>
                <span className="font-mono font-bold tabular-nums text-[var(--bear)]">{fmt(totalNegPoints, 2)}</span>
              </div>
            </div>
            <div className="overflow-y-auto max-h-[520px]">
              <div className="min-w-[600px]">
                {(() => {
                  const posSorted = [...data.positive].sort((a, b) => b.contributionPct - a.contributionPct);
                  const negSorted = [...data.negative].sort((a, b) => Math.abs(b.contributionPct) - Math.abs(a.contributionPct));
                  const count = Math.max(posSorted.length, negSorted.length);
                  const pairs: { pos: typeof posSorted[0] | null; neg: typeof negSorted[0] | null }[] = [];
                  for (let i = 0; i < count; i++) pairs.push({ pos: posSorted[i] ?? null, neg: negSorted[i] ?? null });
                  const maxPosPct = Math.max(0.01, ...data.positive.map(r => r.contributionPct));
                  const maxNegPct = Math.max(0.01, ...data.negative.map(r => Math.abs(r.contributionPct)));
                  return pairs.map((pair, i) => {
                    const gp = pair.pos ? Math.min(pair.pos.contributionPct / maxPosPct * 100, 100) : 0;
                    const rp = pair.neg ? Math.min(Math.abs(pair.neg.contributionPct) / maxNegPct * 100, 100) : 0;
                    return (
                      <div key={i} className="flex items-center h-[22px] px-2 border-b border-border/10 hover:bg-card/50">
                        <div className="w-[190px] flex-shrink-0 flex items-center justify-end gap-1.5 pr-2">
                          {pair.pos && (
                            <>
                              <span className="text-[11px] font-semibold text-muted-foreground truncate">{pair.pos.symbol}</span>
                              <span className="text-[11px] font-mono tabular-nums text-[var(--bull)] font-medium">
                                +{fmt(pair.pos.contributionPoints, 2)}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="flex-1 flex items-center justify-end min-w-0">
                          {pair.pos && (
                            <div
                              className="bg-[var(--bull)] h-3.5 flex items-center justify-end px-1 shrink-0"
                              style={{ width: `${Math.max(gp, 2)}%`, borderRadius: 0 }}
                            >
                              <span className="text-[9px] font-mono tabular-nums text-white font-bold leading-none whitespace-nowrap">
                                {fmt(pair.pos.contributionPct, 1)}%
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 w-px h-5 mx-1 bg-border/30" />
                        <div className="flex-1 flex items-center min-w-0">
                          {pair.neg && (
                            <div
                              className="bg-[var(--bear)] h-3.5 flex items-center px-1 shrink-0"
                              style={{ width: `${Math.max(rp, 2)}%`, borderRadius: 0 }}
                            >
                              <span className="text-[9px] font-mono tabular-nums text-white font-bold leading-none whitespace-nowrap">
                                {fmt(Math.abs(pair.neg.contributionPct), 1)}%
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="w-[190px] flex-shrink-0 flex items-center gap-1.5 pl-2">
                          {pair.neg && (
                            <>
                              <span className="text-[11px] font-mono tabular-nums text-[var(--bear)] font-medium">
                                {fmt(pair.neg.contributionPoints, 2)}
                              </span>
                              <span className="text-[11px] font-semibold text-muted-foreground truncate">{pair.neg.symbol}</span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </div>

        {/* Negative Contributors */}
        <div className="lg:col-span-3">
          <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col h-fit">
            <div className="px-3 py-2 border-b border-border bg-card flex items-center justify-between">
              <h3 className="text-xs font-semibold text-[var(--bear)]">Negative Contributors</h3>
              <span className="text-[10px] text-[var(--bear)] uppercase tracking-wider font-medium bg-[var(--bear)]/10 px-1.5 py-0.5 rounded border border-[var(--bear)]/20">
                {data.negative.length}
              </span>
            </div>
            <div className="flex items-center justify-between px-3 py-1 bg-background/20 border-b border-border text-[10px] text-muted-foreground tracking-wider">
              <span>Symbol</span>
              <div className="flex items-center gap-2 text-right">
                <span className="w-12">Price</span>
                <span className="w-12">Chg%</span>
              </div>
            </div>
            <div className="overflow-y-auto max-h-[520px]">
              {data.negative.map((r) => (
                <div key={r.symbol} className="flex items-center justify-between px-3 py-1 border-b border-border/20 hover:bg-card/70 text-xs">
                  <span className="font-semibold">{r.symbol}</span>
                  <div className="flex items-center gap-2 text-right font-mono tabular-nums">
                    <span className="w-12">{fmt(r.price, 2)}</span>
                    <span className={`w-12 ${r.changePct >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                      {r.changePct >= 0 ? "+" : ""}{fmt(r.changePct, 2)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
