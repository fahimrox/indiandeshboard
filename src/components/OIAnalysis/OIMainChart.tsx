import { useMemo, useRef, useEffect, useState } from "react";
import type { TimeRange } from "./OIAnalysisDashboard";
import type { OIDataPoint } from "./mockData";

interface OIMainChartProps {
  data: OIDataPoint[];
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
}

const TIME_RANGES: { label: string; value: TimeRange }[] = [
  { label: "Last 3m", value: "3min" },
  { label: "Last 5m", value: "5min" },
  { label: "Last 15m", value: "15min" },
  { label: "Last 30m", value: "30min" },
  { label: "Last 1H", value: "1hr" },
  { label: "Last 2H", value: "2hr" },
  { label: "Full Day", value: "all" },
];

const COLORS = {
  callOI: "#00DD99",
  putOI: "#FF7777",
  grid: "rgba(255,255,255,0.06)",
  text: "#A9B2BF",
  axisLine: "rgba(255,255,255,0.12)",
};

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

const CHART_PADDING = { top: 30, right: 20, bottom: 55, left: 70 };

export function OIMainChart({
  data,
  timeRange,
  onTimeRangeChange,
}: OIMainChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setDimensions((prev) => ({
          width: Math.max(400, width),
          height: prev.height,
        }));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const {
    chartW,
    chartH,
    maxVal,
    yTicks,
    renderedBars,
    spotIndex,
    maxPainIndex,
  } = useMemo(() => {
    const chartW = dimensions.width - CHART_PADDING.left - CHART_PADDING.right;
    const chartH = dimensions.height - CHART_PADDING.top - CHART_PADDING.bottom;

    const allValues = data.flatMap((d) => [
      d.callOI,
      d.putOI,
      d.callOI - d.callOIIncrease + d.callOIDecrease,
      d.putOI - d.putOIIncrease + d.putOIDecrease,
    ]);
    const maxRaw = Math.max(...allValues.filter(isFinite), 1);
    const maxVal = maxRaw * 1.25;

    const targetTicks = 5;
    const roughStep = maxVal / targetTicks;
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const niceStep = [1, 2, 2.5, 5, 10].find((m) => m * magnitude >= roughStep)!
      * magnitude;
    const niceMax = Math.ceil(maxVal / niceStep) * niceStep;
    const yTicks: number[] = [];
    for (let v = 0; v <= niceMax; v += niceStep) {
      yTicks.push(v);
    }

    const totalPairs = data.length;
    const barWidth = Math.min(14, Math.max(8, (chartW / totalPairs) * 0.6));
    const pairWidth = chartW / totalPairs;

    const spotStrike = 24050;
    const spotIndex = data.findIndex((d) => d.strike === spotStrike);
    const maxPainStrike = 24100;
    const maxPainIndex = data.findIndex((d) => d.strike === maxPainStrike);

    const renderedBars = data.map((d, idx) => {
      const cx = idx * pairWidth + pairWidth / 2;
      const callBarX = cx - barWidth;
      const putBarX = cx;
      const callBarW = barWidth;
      const putBarW = barWidth;

      const prevCallOI = d.callOI - d.callOIIncrease + d.callOIDecrease;
      const prevPutOI = d.putOI - d.putOIIncrease + d.putOIDecrease;

      const callSolidH = (Math.max(0, prevCallOI) / niceMax) * chartH;
      const callHatchH = (Math.max(0, d.callOIIncrease) / niceMax) * chartH;
      const callDecreaseH = (Math.max(0, d.callOIDecrease) / niceMax) * chartH;

      const putSolidH = (Math.max(0, prevPutOI) / niceMax) * chartH;
      const putHatchH = (Math.max(0, d.putOIIncrease) / niceMax) * chartH;
      const putDecreaseH = (Math.max(0, d.putOIDecrease) / niceMax) * chartH;

      const callTotalH = Math.max(callSolidH + callHatchH - callDecreaseH, 0);
      const putTotalH = Math.max(putSolidH + putHatchH - putDecreaseH, 0);

      const callHasIncrease = d.callOIIncrease > 0;
      const putHasIncrease = d.putOIIncrease > 0;
      const callHasDecrease = d.callOIDecrease > 0;
      const putHasDecrease = d.putOIDecrease > 0;

      return {
        strike: d.strike,
        cx,
        callBarX,
        putBarX,
        callBarW,
        putBarW,
        callSolidH,
        callHatchH,
        callDecreaseH,
        callTotalH,
        putSolidH,
        putHatchH,
        putDecreaseH,
        putTotalH,
        callHasIncrease,
        putHasIncrease,
        callHasDecrease,
        putHasDecrease,
        prevCallOI,
        prevPutOI,
      };
    });

    return {
      chartW,
      chartH,
      maxVal: niceMax,
      yTicks,
      renderedBars,
      spotIndex,
      maxPainIndex,
    };
  }, [data, dimensions]);

  const yBase = CHART_PADDING.top + chartH;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div ref={containerRef} style={{ width: "100%", height: dimensions.height }}>
        <svg
          width={dimensions.width}
          height={dimensions.height}
          className="w-full h-full"
          style={{ display: "block" }}
        >
          <defs>
            {["call", "put"].map((type) => {
              const color = type === "call" ? COLORS.callOI : COLORS.putOI;
              return (
                <pattern
                  key={type}
                  id={`hatch-${type}`}
                  patternUnits="userSpaceOnUse"
                  width="6"
                  height="6"
                  patternTransform="rotate(45)"
                >
                  <rect width="6" height="6" fill="transparent" />
                  <line
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="6"
                    stroke={color}
                    strokeWidth="2"
                    strokeOpacity="0.85"
                  />
                </pattern>
              );
            })}
          </defs>

          {/* Y-axis grid lines and labels */}
          {yTicks.map((tick) => {
            const y = CHART_PADDING.top + chartH - (tick / maxVal) * chartH;
            return (
              <g key={tick}>
                <line
                  x1={CHART_PADDING.left}
                  y1={y}
                  x2={CHART_PADDING.left + chartW}
                  y2={y}
                  stroke={COLORS.grid}
                  strokeWidth={1}
                />
                <text
                  x={CHART_PADDING.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  fill={COLORS.text}
                  fontSize={10}
                  fontFamily="ui-monospace, monospace"
                >
                  {fmtOI(tick)}
                </text>
              </g>
            );
          })}

          {/* Y-axis line */}
          <line
            x1={CHART_PADDING.left}
            y1={CHART_PADDING.top}
            x2={CHART_PADDING.left}
            y2={CHART_PADDING.top + chartH}
            stroke={COLORS.axisLine}
            strokeWidth={1}
          />

          {/* X-axis line */}
          <line
            x1={CHART_PADDING.left}
            y1={CHART_PADDING.top + chartH}
            x2={CHART_PADDING.left + chartW}
            y2={CHART_PADDING.top + chartH}
            stroke={COLORS.axisLine}
            strokeWidth={1}
          />

          {/* Bars */}
          {renderedBars.map((b) => {
            const callSolidTop = yBase - b.callSolidH;
            const callEffectiveTop = yBase - b.callTotalH;

            const putSolidTop = yBase - b.putSolidH;
            const putEffectiveTop = yBase - b.putTotalH;

            const callDrained = !b.callHasIncrease && b.callHasDecrease;
            const putDrained = !b.putHasIncrease && b.putHasDecrease;

            const callBodyOpacity = callDrained ? 0.25 : b.callHasDecrease ? 0.5 : 0.85;
            const putBodyOpacity = putDrained ? 0.25 : b.putHasDecrease ? 0.5 : 0.85;

            return (
              <g key={b.strike}>
                {/* Call bar - solid body */}
                {b.callSolidH > 0.5 && (
                  <rect
                    x={b.callBarX}
                    y={callSolidTop}
                    width={b.callBarW}
                    height={b.callSolidH}
                    fill={COLORS.callOI}
                    fillOpacity={callBodyOpacity}
                    className="transition-all duration-500 ease-out"
                  />
                )}
                {/* Call bar - hatched cap (increase) */}
                {b.callHasIncrease && b.callHatchH > 0.5 && (
                  <rect
                    x={b.callBarX}
                    y={callEffectiveTop}
                    width={b.callBarW}
                    height={b.callHatchH}
                    fill={`url(#hatch-call)`}
                    className="transition-all duration-500 ease-out"
                  />
                )}
                {/* Put bar - solid body */}
                {b.putSolidH > 0.5 && (
                  <rect
                    x={b.putBarX}
                    y={putSolidTop}
                    width={b.putBarW}
                    height={b.putSolidH}
                    fill={COLORS.putOI}
                    fillOpacity={putBodyOpacity}
                    className="transition-all duration-500 ease-out"
                  />
                )}
                {/* Put bar - hatched cap (increase) */}
                {b.putHasIncrease && b.putHatchH > 0.5 && (
                  <rect
                    x={b.putBarX}
                    y={putEffectiveTop}
                    width={b.putBarW}
                    height={b.putHatchH}
                    fill={`url(#hatch-put)`}
                    className="transition-all duration-500 ease-out"
                  />
                )}
              </g>
            );
          })}

          {/* Spot marker */}
          {spotIndex >= 0 && (
            <g>
              <line
                x1={renderedBars[spotIndex].cx}
                y1={CHART_PADDING.top}
                x2={renderedBars[spotIndex].cx}
                y2={CHART_PADDING.top + chartH}
                stroke="#3B82F6"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                opacity={0.7}
              />
              <rect
                x={renderedBars[spotIndex].cx - 38}
                y={CHART_PADDING.top + 2}
                width={76}
                height={18}
                rx={4}
                fill="rgba(15,23,42,0.9)"
                stroke="rgba(96,165,250,0.3)"
                strokeWidth={1}
              />
              <text
                x={renderedBars[spotIndex].cx}
                y={CHART_PADDING.top + 14}
                textAnchor="middle"
                fill="#60A5FA"
                fontSize={10}
                fontWeight="bold"
                fontFamily="ui-monospace, monospace"
              >
                Spot: 24,056
              </text>
            </g>
          )}

          {/* Max Pain marker */}
          {maxPainIndex >= 0 && (
            <g>
              <line
                x1={renderedBars[maxPainIndex].cx}
                y1={CHART_PADDING.top}
                x2={renderedBars[maxPainIndex].cx}
                y2={CHART_PADDING.top + chartH}
                stroke="#F59E0B"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                opacity={0.7}
              />
              <rect
                x={renderedBars[maxPainIndex].cx - 42}
                y={CHART_PADDING.top + 24}
                width={84}
                height={18}
                rx={4}
                fill="rgba(15,23,42,0.9)"
                stroke="rgba(251,191,36,0.3)"
                strokeWidth={1}
              />
              <text
                x={renderedBars[maxPainIndex].cx}
                y={CHART_PADDING.top + 36}
                textAnchor="middle"
                fill="#FBBF24"
                fontSize={10}
                fontWeight="bold"
                fontFamily="ui-monospace, monospace"
              >
                Max Pain: 24,100
              </text>
            </g>
          )}

          {/* X-axis labels (strike prices) */}
          {renderedBars.map((b) => (
            <text
              key={b.strike}
              x={b.cx}
              y={CHART_PADDING.top + chartH + 18}
              textAnchor="end"
              transform={`rotate(-35 ${b.cx} ${CHART_PADDING.top + chartH + 18})`}
              fill={COLORS.text}
              fontSize={10}
              fontFamily="ui-monospace, monospace"
              fontWeight={600}
            >
              {b.strike}
            </text>
          ))}
        </svg>
      </div>

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
