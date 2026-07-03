import { memo, useMemo } from "react";
import type { OcRow } from "@/lib/nse.functions";
import { CALL, PUT, classifyLegBuildup } from "./analysis";

export function fmtOi(n: number): string {
  const v = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (v >= 1e7) return `${s}${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `${s}${(v / 1e5).toFixed(2)}L`;
  if (v >= 1e3) return `${s}${(v / 1e3).toFixed(1)}K`;
  return `${s}${Math.round(v)}`;
}

function BuildupBadge({ oiChgPct, priceUp, align }: { oiChgPct: number; priceUp: boolean; align: "left" | "right" }) {
  const b = classifyLegBuildup(oiChgPct, priceUp);
  return (
    <span
      className={`inline-block w-full max-w-[132px] truncate rounded-md px-2 py-1 text-[10px] font-extrabold ${align === "left" ? "text-left" : "text-right"}`}
      style={{ background: b.soft, color: b.color, border: `1px solid ${b.color}44` }}
      title={b.label}
    >
      {b.label}
    </span>
  );
}

interface Props {
  rows: OcRow[];
  spot: number;
  atmStrike: number;
  maxPain: number;
  underlyingUp: boolean;
}

// ─── Full-width professional Open-Interest profile / option-chain table ───────
function OiProfileTableBase({ rows, spot, atmStrike, maxPain, underlyingUp }: Props) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.strike - a.strike), [rows]);
  const maxOi = useMemo(() => Math.max(1, ...rows.map((r) => Math.max(r.ce?.oi ?? 0, r.pe?.oi ?? 0))), [rows]);
  const maxCe = useMemo(() => Math.max(1, ...rows.map((r) => r.ce?.oi ?? 0)), [rows]);
  const maxPe = useMemo(() => Math.max(1, ...rows.map((r) => r.pe?.oi ?? 0)), [rows]);

  const th = "px-2 py-2 text-[9px] font-black uppercase tracking-wider text-slate-500";
  const td = "px-2 py-1.5 tabular-nums";

  const oiChgTone = (v: number) => (v > 0 ? "text-emerald-400" : v < 0 ? "text-rose-400" : "text-slate-500");

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800/60">
      <table className="w-full min-w-[1000px] border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-slate-800">
            <th className={`${th} text-left`}>Interpretation</th>
            <th className={`${th} text-right`}>LTP</th>
            <th className={`${th} text-right`}>Volume</th>
            <th className={`${th} text-right`}>OI Chg (%)</th>
            <th className={`${th} text-right`} style={{ color: CALL }}>Call OI</th>
            <th className={`${th} text-center text-sky-400`}>Strike</th>
            <th className={`${th} text-left`} style={{ color: PUT }}>Put OI</th>
            <th className={`${th} text-left`}>OI Chg (%)</th>
            <th className={`${th} text-left`}>Volume</th>
            <th className={`${th} text-left`}>LTP</th>
            <th className={`${th} text-right`}>Interpretation</th>
          </tr>
          <tr className="text-[8px] font-black uppercase tracking-widest">
            <td colSpan={5} className="bg-rose-500/10 px-2 py-1 text-center" style={{ color: CALL }}>◄ CALLS (CE) — Resistance</td>
            <td className="bg-slate-800/40" />
            <td colSpan={5} className="bg-emerald-500/10 px-2 py-1 text-center" style={{ color: PUT }}>PUTS (PE) — Support ►</td>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const ce = r.ce, pe = r.pe;
            const ceOi = ce?.oi ?? 0, peOi = pe?.oi ?? 0;
            const ceW = (ceOi / maxOi) * 100, peW = (peOi / maxOi) * 100;
            const isAtm = r.strike === atmStrike;
            const isMaxPain = r.strike === maxPain;
            const isMaxCe = ceOi === maxCe;
            const isMaxPe = peOi === maxPe;
            const itmCe = r.strike < spot;
            const itmPe = r.strike > spot;
            return (
              <tr key={r.strike} className={`border-b border-slate-800/40 transition-colors ${isAtm ? "bg-sky-500/10" : "hover:bg-slate-800/25"}`}>
                {/* CE interpretation */}
                <td className={`${td} text-left`}><BuildupBadge oiChgPct={ce?.oiChgPct ?? 0} priceUp={underlyingUp} align="left" /></td>
                {/* CE LTP */}
                <td className={`${td} text-right font-bold text-slate-200`}>{(ce?.ltp ?? 0).toFixed(2)}</td>
                {/* CE Vol */}
                <td className={`${td} text-right text-slate-500`}>{fmtOi(ce?.volume ?? 0)}</td>
                {/* CE OI Chg (%) */}
                <td className={`${td} text-right ${oiChgTone(ce?.oiChg ?? 0)}`}>
                  {(ce?.oiChg ?? 0) >= 0 ? "+" : ""}{fmtOi(ce?.oiChg ?? 0)}
                  <span className="ml-1 text-[9px] opacity-80">({(ce?.oiChgPct ?? 0) >= 0 ? "+" : ""}{(ce?.oiChgPct ?? 0).toFixed(1)}%)</span>
                </td>
                {/* CE OI + bar (grows toward strike, right aligned) */}
                <td className="relative px-2 py-1.5" style={itmCe ? { background: "rgba(244,63,94,0.05)" } : undefined}>
                  <div className="absolute right-1 top-1/2 h-4 -translate-y-1/2 rounded-l-sm" style={{ width: `${ceW}%`, background: isMaxCe ? CALL : "rgba(244,63,94,0.4)" }} />
                  <span className="relative flex items-center justify-end gap-1 font-bold text-slate-100">
                    {isMaxCe && <span className="rounded bg-rose-500/30 px-1 text-[7px] font-black text-rose-200">MAX</span>}
                    {fmtOi(ceOi)}
                  </span>
                </td>
                {/* STRIKE */}
                <td className="px-2 py-1.5 text-center">
                  <div className={`relative mx-auto w-fit rounded px-2 py-0.5 text-[12px] font-black tabular-nums ${isAtm ? "bg-sky-500/25 text-sky-200 ring-1 ring-sky-400/50" : isMaxPain ? "text-amber-300" : "text-slate-200"}`}>
                    {r.strike}
                    {isMaxPain && <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-amber-500 px-1 text-[6px] font-black text-black">PAIN</span>}
                  </div>
                </td>
                {/* PE OI + bar (grows from strike outward, left aligned) */}
                <td className="relative px-2 py-1.5" style={itmPe ? { background: "rgba(16,185,129,0.05)" } : undefined}>
                  <div className="absolute left-1 top-1/2 h-4 -translate-y-1/2 rounded-r-sm" style={{ width: `${peW}%`, background: isMaxPe ? PUT : "rgba(16,185,129,0.4)" }} />
                  <span className="relative flex items-center gap-1 font-bold text-slate-100">
                    {isMaxPe && <span className="rounded bg-emerald-500/30 px-1 text-[7px] font-black text-emerald-200">MAX</span>}
                    {fmtOi(peOi)}
                  </span>
                </td>
                {/* PE OI Chg (%) */}
                <td className={`${td} text-left ${oiChgTone(pe?.oiChg ?? 0)}`}>
                  {(pe?.oiChg ?? 0) >= 0 ? "+" : ""}{fmtOi(pe?.oiChg ?? 0)}
                  <span className="ml-1 text-[9px] opacity-80">({(pe?.oiChgPct ?? 0) >= 0 ? "+" : ""}{(pe?.oiChgPct ?? 0).toFixed(1)}%)</span>
                </td>
                {/* PE Vol */}
                <td className={`${td} text-left text-slate-500`}>{fmtOi(pe?.volume ?? 0)}</td>
                {/* PE LTP */}
                <td className={`${td} text-left font-bold text-slate-200`}>{(pe?.ltp ?? 0).toFixed(2)}</td>
                {/* PE interpretation */}
                <td className={`${td} text-right`}><BuildupBadge oiChgPct={pe?.oiChgPct ?? 0} priceUp={!underlyingUp} align="right" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const OiProfileTable = memo(OiProfileTableBase);
