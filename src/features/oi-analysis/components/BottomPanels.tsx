import { memo } from "react";
import type { OISnapshot } from "../types";
import { CALL_COLOR, PUT_COLOR, formatIN } from "../utils";

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-4">
    <h4 className="mb-4 text-sm font-semibold text-slate-200">{title}</h4>
    {children}
  </div>
);

function MiniBars({ call, put, showBaseline = false }: { call: number; put: number; showBaseline?: boolean }) {
  const max = Math.max(Math.abs(call), Math.abs(put), 1);
  // Percentage height relative to the half-container (used when baseline can go negative)
  const pctHalf = (v: number) => `${Math.min(100, (Math.abs(v) / max) * 100)}%`;
  // Percentage height relative to the full container (used when values are all positive)
  const pctFull = (v: number) => `${Math.min(100, (Math.abs(v) / max) * 100)}%`;
  const hasNegative = showBaseline && (call < 0 || put < 0);

  const Col = ({ v, color, label }: { v: number; color: string; label: string }) => (
    <div className="flex flex-col items-center">
      <span className="mb-2 text-sm font-semibold text-slate-100">
        {v >= 0 ? "+" : ""}{formatIN(v)}
      </span>
      <div className="relative flex h-48 w-28 items-end justify-center overflow-visible">
        {hasNegative ? (
          <>
            {/* Baseline sits at the mid-point of the container */}
            <div className="absolute left-0 right-0 top-1/2 z-0 border-t border-slate-600/50" />
            {/* Bar grows up from mid-line when positive, down from mid-line when negative */}
            <div
              className={`absolute left-1/2 w-20 -translate-x-1/2 transition-[height] duration-700 ${
                v >= 0 ? "rounded-t-lg" : "rounded-b-lg"
              }`}
              style={{
                height: pctHalf(v),
                backgroundColor: color,
                top: v >= 0 ? undefined : "50%",
                bottom: v >= 0 ? "50%" : undefined,
                maxHeight: "50%",
              }}
            />
          </>
        ) : (
          <div
            className="w-20 rounded-t-lg transition-[height] duration-700"
            style={{ height: pctFull(v), backgroundColor: color }}
          />
        )}
      </div>
      <span className="mt-2 text-xs font-medium text-slate-400">{label}</span>
    </div>
  );

  return (
    <div className="flex items-end justify-center gap-6">
      <Col v={call} color={CALL_COLOR} label="CALL" />
      <Col v={put} color={PUT_COLOR} label="PUT" />
    </div>
  );
}

function PCRDonut({ pcr, callOI, putOI }: { pcr: number; callOI: number; putOI: number }) {
  const total = callOI + putOI || 1;
  const callPct = (callOI / total) * 100;
  const putPct = 100 - callPct;
  const r = 80;
  const c = 2 * Math.PI * r;
  const callDash = (callPct / 100) * c;
  const bullish = pcr >= 1;
  return (
    <div className="flex items-center justify-center">
      <svg width={200} height={200} className="-rotate-90">
        <circle cx={100} cy={100} r={r} fill="none" stroke={PUT_COLOR} strokeWidth={22} />
        <circle
          cx={100}
          cy={100}
          r={r}
          fill="none"
          stroke={CALL_COLOR}
          strokeWidth={22}
          strokeDasharray={`${callDash} ${c - callDash}`}
          style={{ transition: "stroke-dasharray 700ms ease" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-[11px] text-slate-400">PCR</span>
        <span className={`text-3xl font-bold ${bullish ? "text-emerald-400" : "text-rose-400"}`}>
          {pcr.toFixed(2)}
        </span>
        <span className="mt-2 text-[11px] text-slate-500">
          {callPct.toFixed(0)}% Call OI &middot; {putPct.toFixed(0)}% Put OI
        </span>
      </div>
    </div>
  );
}

function BottomPanelsBase({ snapshot }: { snapshot: OISnapshot }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title="Open Interest Change">
        <MiniBars call={snapshot.totalCallOIChange} put={snapshot.totalPutOIChange} showBaseline />
      </Card>
      <Card title="Total Open Interest">
        <MiniBars call={snapshot.totalCallOI} put={snapshot.totalPutOI} />
      </Card>
      <Card title="Put/Call Ratio">
        <div className="relative flex justify-center">
          <PCRDonut pcr={snapshot.pcr} callOI={snapshot.totalCallOI} putOI={snapshot.totalPutOI} />
        </div>
      </Card>
    </div>
  );
}

export const BottomPanels = memo(BottomPanelsBase);
