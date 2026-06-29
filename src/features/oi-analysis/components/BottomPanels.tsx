import { memo } from "react";
import type { OISnapshot } from "../types";
import { CALL_COLOR, PUT_COLOR, formatIN } from "../utils";

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-4">
    <h4 className="mb-4 text-sm font-semibold text-slate-200">{title}</h4>
    {children}
  </div>
);

function MiniBars({ call, put }: { call: number; put: number }) {
  const max = Math.max(Math.abs(call), Math.abs(put), 1);
  const h = (v: number) => `${(Math.abs(v) / max) * 100}%`;

  const Col = ({ v, color, label }: { v: number; color: string; label: string }) => (
    <div className="flex flex-col items-center">
      <span className="mb-2 text-sm font-semibold text-slate-100">{formatIN(v)}</span>
      <div className="flex h-44 items-end">
        <div
          className="w-20 rounded-t-lg transition-[height] duration-700"
          style={{ height: h(v), backgroundColor: color }}
        />
      </div>
      <span className="mt-2 text-xs font-medium text-slate-400">{label}</span>
    </div>
  );

  return (
    <div className="flex items-end justify-center gap-3">
      <Col v={call} color={CALL_COLOR} label="CALL" />
      <Col v={put} color={PUT_COLOR} label="PUT" />
    </div>
  );
}

function PCRDonut({ pcr, callOI, putOI }: { pcr: number; callOI: number; putOI: number }) {
  const total = callOI + putOI || 1;
  const callPct = (callOI / total) * 100;
  const putPct = 100 - callPct;
  const r = 64;
  const c = 2 * Math.PI * r;
  const callDash = (callPct / 100) * c;
  const bullish = pcr >= 1;
  return (
    <div className="flex items-center justify-center">
      <svg width={160} height={160} className="-rotate-90">
        <circle cx={80} cy={80} r={r} fill="none" stroke={PUT_COLOR} strokeWidth={18} />
        <circle
          cx={80}
          cy={80}
          r={r}
          fill="none"
          stroke={CALL_COLOR}
          strokeWidth={18}
          strokeDasharray={`${callDash} ${c - callDash}`}
          style={{ transition: "stroke-dasharray 700ms ease" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-[11px] text-slate-400">PCR</span>
        <span className={`text-2xl font-semibold ${bullish ? "text-emerald-400" : "text-rose-400"}`}>
          {pcr.toFixed(2)}
        </span>
        <span className="mt-1 text-[10px] text-slate-500">
          {putPct.toFixed(0)}% Put &middot; {callPct.toFixed(0)}% Call
        </span>
      </div>
    </div>
  );
}

function BottomPanelsBase({ snapshot }: { snapshot: OISnapshot }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title="Open Interest Change">
        <MiniBars call={snapshot.totalCallOIChange} put={snapshot.totalPutOIChange} />
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
