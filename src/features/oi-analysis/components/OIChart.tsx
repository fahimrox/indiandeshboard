import { memo, useMemo, useCallback, useRef, useState } from "react";
import type { ChartMode, OISnapshot, StrikeOI } from "../types";
import { CALL_COLOR, PUT_COLOR, formatIN } from "../utils";

interface Props {
  snapshot: OISnapshot;
  strikes: StrikeOI[];
  mode: ChartMode;
  height?: number;
}

interface HoverState {
  strike: StrikeOI;
  x: number;
  y: number;
}

function Bar({
  x,
  width,
  baseY,
  total,
  change,
  maxValue,
  chartHeight,
  color,
  hatchId,
  decorate,
}: {
  x: number;
  width: number;
  baseY: number;
  total: number;
  change: number;
  maxValue: number;
  chartHeight: number;
  color: string;
  hatchId: string;
  /** When false (Total OI mode) draw a plain solid bar with no change decoration. */
  decorate: boolean;
}) {
  const scale = (v: number) => (maxValue <= 0 ? 0 : (v / maxValue) * chartHeight);

  const totalH = scale(total);
  const prevTotal = Math.max(total - change, 0);
  const prevH = scale(prevTotal);
  const rx = 1.5;

  // Plain solid bar (Total OI mode) — no hatch/outline.
  if (!decorate) {
    return (
      <rect
        x={x}
        y={baseY - totalH}
        width={width}
        height={Math.max(totalH, 0)}
        rx={rx}
        fill={color}
        style={{ transition: "height 600ms ease, y 600ms ease" }}
      />
    );
  }

  if (change >= 0) {
    // OI INCREASE: solid base = previous OI, hatched top = today's increase.
    // A single transparent outline wraps the whole bar so there is no internal seam.
    const solidH = prevH;
    const topH = Math.max(totalH - solidH, 0);
    return (
      <g style={{ transition: "height 600ms ease, y 600ms ease" }}>
        {/* solid base (previous OI) */}
        <rect
          x={x}
          y={baseY - solidH}
          width={width}
          height={Math.max(solidH, 0)}
          fill={color}
          style={{ transition: "height 600ms ease, y 600ms ease" }}
        />
        {/* hatched top (the increase) */}
        {topH > 0 && (
          <rect
            x={x}
            y={baseY - totalH}
            width={width}
            height={topH}
            fill={`url(#${hatchId})`}
            style={{ transition: "height 600ms ease, y 600ms ease" }}
          />
        )}
        {/* single clean outer border around the full bar */}
        <rect
          x={x}
          y={baseY - totalH}
          width={width}
          height={Math.max(totalH, 0)}
          rx={rx}
          fill="none"
          stroke={color}
          strokeWidth={1}
          style={{ transition: "height 600ms ease, y 600ms ease" }}
        />
      </g>
    );
  }

  // OI DECREASE: solid base = current OI, hollow outline extends up to previous OI.
  return (
    <g style={{ transition: "height 600ms ease, y 600ms ease" }}>
      {/* solid base (current OI) */}
      <rect
        x={x}
        y={baseY - totalH}
        width={width}
        height={Math.max(totalH, 0)}
        fill={color}
        style={{ transition: "height 600ms ease, y 600ms ease" }}
      />
      {/* hollow outline covering the full previous height — the removed part reads as an empty bordered box */}
      <rect
        x={x}
        y={baseY - prevH}
        width={width}
        height={Math.max(prevH, 0)}
        rx={rx}
        fill="none"
        stroke={color}
        strokeWidth={1}
        strokeOpacity={0.9}
        style={{ transition: "height 600ms ease, y 600ms ease" }}
      />
    </g>
  );
}

function ChangeBar({
  x, width, zeroY, value, maxValue, halfH, color,
}: {
  x: number; width: number; zeroY: number; value: number;
  maxValue: number; halfH: number; color: string;
}) {
  const h = (Math.abs(value) / maxValue) * halfH;
  const up = value >= 0;
  const rectY = up ? zeroY - h : zeroY;
  return (
    <rect
      x={x}
      y={rectY}
      width={width}
      height={Math.max(h, 0)}
      rx={3}
      fill={color}
      fillOpacity={up ? 1 : 0.55}
      stroke={color}
      strokeWidth={1}
      style={{ transition: "height 600ms ease, y 600ms ease" }}
    />
  );
}

function ChartLegend({ mode }: { mode: ChartMode }) {
  if (mode === "OI_CHANGE_TOTAL") {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: CALL_COLOR }} />Call OI</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-2" style={{ borderColor: CALL_COLOR, backgroundColor: "transparent" }} />Call OI Decrease</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: CALL_COLOR, backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)" }} />Call OI Increase</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: PUT_COLOR }} />Put OI</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-2" style={{ borderColor: PUT_COLOR, backgroundColor: "transparent" }} />Put OI Decrease</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: PUT_COLOR, backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)" }} />Put OI Increase</span>
      </div>
    );
  }
  if (mode === "OI_CHANGE") {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: CALL_COLOR }} />Call OI Change</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: PUT_COLOR }} />Put OI Change</span>
      </div>
    );
  }
  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-[11px] text-slate-400">
      <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: CALL_COLOR }} />Call OI Total</span>
      <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: PUT_COLOR }} />Put OI Total</span>
    </div>
  );
}

function OIChartBase({ snapshot, strikes, mode, height = 500 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  // Memoize padding so downstream memos don't re-run on every render
  const padding = useMemo(() => ({ top: 24, right: 24, bottom: 40, left: 56 }), []);
  const isChangeMode = mode === "OI_CHANGE";
  const innerW = Math.max(strikes.length * 64, 640);
  const chartHeight = height - padding.top - padding.bottom;
  const baseY = padding.top + chartHeight;
  const zeroY = isChangeMode ? padding.top + chartHeight / 2 : baseY;
  const halfH = chartHeight / 2;
  const groupW = innerW / Math.max(strikes.length, 1);
  const barW = Math.min(groupW * 0.34, 22);

  // Stable function — only recreated when layout params change.
  // Memoized so spotX/maxPainX memos can correctly declare it as a dependency
  // without risking stale closures.
  const xOf = useCallback(
    (i: number) => padding.left + i * groupW + groupW / 2,
    [padding.left, groupW]
  );

  const maxValue = useMemo(() => {
    let m = 0;
    for (const s of strikes) {
      if (isChangeMode) {
        m = Math.max(m, Math.abs(s.callOIChange), Math.abs(s.putOIChange));
      } else {
        m = Math.max(m, s.callTotalOI, s.putTotalOI);
      }
    }
    return (m || 1) * 1.1;
  }, [strikes, isChangeMode]);

  const yTicks = useMemo(() => {
    const ticks = 5;
    return Array.from({ length: ticks + 1 }, (_, i) => (maxValue / ticks) * i);
  }, [maxValue]);


  const spotX = useMemo(() => {
    const sorted = strikes;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i].strike;
      const b = sorted[i + 1].strike;
      if (snapshot.spot >= a && snapshot.spot <= b) {
        const t = (snapshot.spot - a) / (b - a);
        return xOf(i) + t * groupW;
      }
    }
    return null;
  }, [strikes, snapshot.spot, xOf, groupW]);

  const maxPainX = useMemo(() => {
    const i = strikes.findIndex((s) => s.strike === snapshot.maxPain);
    return i >= 0 ? xOf(i) : null;
  }, [strikes, snapshot.maxPain, xOf]);

  const totalW = padding.left + innerW + padding.right;

  return (
    <div ref={wrapRef} className="relative overflow-x-auto">
      <svg width={totalW} height={height} className="block">
        <defs>
          <pattern
            id="hatch-call"
            patternUnits="userSpaceOnUse"
            width="7"
            height="7"
            patternTransform="rotate(45)"
          >
            <rect width="7" height="7" fill={CALL_COLOR} fillOpacity={0.32} />
            <line x1="0" y1="0" x2="0" y2="7" stroke={CALL_COLOR} strokeWidth="3" />
          </pattern>
          <pattern
            id="hatch-put"
            patternUnits="userSpaceOnUse"
            width="7"
            height="7"
            patternTransform="rotate(45)"
          >
            <rect width="7" height="7" fill={PUT_COLOR} fillOpacity={0.32} />
            <line x1="0" y1="0" x2="0" y2="7" stroke={PUT_COLOR} strokeWidth="3" />
          </pattern>
        </defs>

        {/* grid + y labels */}
        {(isChangeMode ? yTicks.map((t) => -t).concat(yTicks.slice(1)).sort((a, b) => a - b) : yTicks).map((t, i) => {
          const yPos = isChangeMode
            ? zeroY - (t / maxValue) * halfH
            : baseY - (t / maxValue) * chartHeight;
          if (isChangeMode && Math.abs(t) < 0.001) return null;
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={yPos}
                x2={padding.left + innerW}
                y2={yPos}
                stroke="rgba(148,163,184,0.12)"
              />
              <text x={padding.left - 10} y={yPos + 4} textAnchor="end" fontSize={10} fill="#64748b">
                {formatIN(Math.abs(t))}
              </text>
            </g>
          );
        })}

        {/* spot & max pain lines */}
        {spotX !== null && (
          <g>
            <line
              x1={spotX}
              y1={padding.top}
              x2={spotX}
              y2={isChangeMode ? padding.top + chartHeight : baseY}
              stroke="#e2e8f0"
              strokeDasharray="4 4"
              strokeOpacity={0.7}
            />
            <rect x={spotX - 42} y={padding.top - 18} width={84} height={16} rx={4} fill="#334155" />
            <text x={spotX} y={padding.top - 6} textAnchor="middle" fontSize={10} fill="#e2e8f0">
              Spot: {snapshot.spot}
            </text>
          </g>
        )}
        {maxPainX !== null && (
          <g>
            <line
              x1={maxPainX}
              y1={padding.top}
              x2={maxPainX}
              y2={isChangeMode ? padding.top + chartHeight : baseY}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              strokeOpacity={0.8}
            />
            <rect x={maxPainX - 50} y={padding.top + 2} width={100} height={16} rx={4} fill="#92400e" />
            <text x={maxPainX} y={padding.top + 14} textAnchor="middle" fontSize={10} fill="#fde68a">
              Max Pain: {snapshot.maxPain}
            </text>
          </g>
        )}

        {/* zero baseline for change mode */}
        {isChangeMode && (
          <g>
            <line
              x1={padding.left}
              y1={zeroY}
              x2={padding.left + innerW}
              y2={zeroY}
              stroke="rgba(148,163,184,0.45)"
              strokeWidth={1}
            />
            <text x={padding.left - 10} y={zeroY + 4} textAnchor="end" fontSize={10} fill="#94a3b8">0</text>
          </g>
        )}

        {/* bars + strike labels */}
        {strikes.map((s, i) => {
          const cx = xOf(i);
          const isATM = s.strike === snapshot.atmStrike;

          return (
            <g
              key={s.strike}
              onMouseEnter={(e) => {
                const rect = wrapRef.current?.getBoundingClientRect();
                setHover({
                  strike: s,
                  x: e.clientX - (rect?.left ?? 0),
                  y: e.clientY - (rect?.top ?? 0),
                });
              }}
              onMouseMove={(e) => {
                const rect = wrapRef.current?.getBoundingClientRect();
                setHover((h) =>
                  h ? { ...h, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) } : h
                );
              }}
              onMouseLeave={() => setHover(null)}
            >
              {isATM && (
                <rect
                  x={cx - groupW / 2}
                  y={isChangeMode ? padding.top : padding.top}
                  width={groupW}
                  height={isChangeMode ? chartHeight : chartHeight}
                  fill="rgba(56,189,248,0.06)"
                />
              )}

              {isChangeMode ? (
                <>
                  <ChangeBar x={cx - barW - 2} width={barW} zeroY={zeroY}
                    value={s.callOIChange} maxValue={maxValue} halfH={halfH} color={CALL_COLOR} />
                  <ChangeBar x={cx + 2} width={barW} zeroY={zeroY}
                    value={s.putOIChange} maxValue={maxValue} halfH={halfH} color={PUT_COLOR} />
                </>
              ) : (
                <>
                  <Bar x={cx - barW - 2} width={barW} baseY={baseY}
                    total={s.callTotalOI} change={s.callOIChange}
                    maxValue={maxValue} chartHeight={chartHeight}
                    color={CALL_COLOR} hatchId="hatch-call" decorate={mode === "OI_CHANGE_TOTAL"} />
                  <Bar x={cx + 2} width={barW} baseY={baseY}
                    total={s.putTotalOI} change={s.putOIChange}
                    maxValue={maxValue} chartHeight={chartHeight}
                    color={PUT_COLOR} hatchId="hatch-put" decorate={mode === "OI_CHANGE_TOTAL"} />
                </>
              )}

              <text
                x={cx}
                y={(isChangeMode ? padding.top + chartHeight : baseY) + 16}
                textAnchor="middle"
                fontSize={10}
                fontWeight={isATM ? 700 : 400}
                fill={isATM ? "#38bdf8" : "#94a3b8"}
              >
                {s.strike}
              </text>
            </g>
          );
        })}
      </svg>

      {hover && <OITooltip hover={hover} snapshot={snapshot} />}
      <ChartLegend mode={mode} />
    </div>
  );
}

function OITooltip({ hover, snapshot }: { hover: HoverState; snapshot: OISnapshot }) {
  const s = hover.strike;
  const pcr = s.callTotalOI > 0 ? s.putTotalOI / s.callTotalOI : 0;
  const Row = ({ k, v, c }: { k: string; v: string; c?: string }) => (
    <div className="flex justify-between gap-6">
      <span className="text-slate-400">{k}</span>
      <span className={`font-medium ${c ?? "text-slate-100"}`}>{v}</span>
    </div>
  );
  return (
    <div
      className="pointer-events-none absolute z-20 w-52 rounded-xl border border-slate-700/60 bg-slate-900/95 p-3 text-[11px] shadow-xl backdrop-blur"
      style={{ left: hover.x + 14, top: hover.y - 10 }}
    >
      <div className="mb-2 text-xs font-semibold text-slate-100">Strike {s.strike}</div>
      <div className="space-y-1">
        <Row k="Call OI" v={formatIN(s.callTotalOI)} c="text-emerald-400" />
        <Row k="Put OI" v={formatIN(s.putTotalOI)} c="text-rose-400" />
        <Row
          k="Call \u0394OI"
          v={`${s.callOIChange >= 0 ? "+" : ""}${formatIN(s.callOIChange)}`}
          c={s.callOIChange >= 0 ? "text-emerald-400" : "text-rose-400"}
        />
        <Row
          k="Put \u0394OI"
          v={`${s.putOIChange >= 0 ? "+" : ""}${formatIN(s.putOIChange)}`}
          c={s.putOIChange >= 0 ? "text-emerald-400" : "text-rose-400"}
        />
        {s.callVolume !== undefined && <Row k="Call Vol" v={formatIN(s.callVolume)} />}
        {s.putVolume !== undefined && <Row k="Put Vol" v={formatIN(s.putVolume)} />}
        <Row k="PCR" v={pcr.toFixed(2)} />
        {s.callIV !== undefined && <Row k="Call IV" v={`${s.callIV.toFixed(1)}%`} />}
        {s.putIV !== undefined && <Row k="Put IV" v={`${s.putIV.toFixed(1)}%`} />}
        <Row
          k="Support"
          v={s.strike <= snapshot.spot ? "Yes" : "\u2014"}
          c="text-emerald-400"
        />
        <Row
          k="Resistance"
          v={s.strike >= snapshot.spot ? "Yes" : "\u2014"}
          c="text-rose-400"
        />
      </div>
    </div>
  );
}

export const OIChart = memo(OIChartBase);
