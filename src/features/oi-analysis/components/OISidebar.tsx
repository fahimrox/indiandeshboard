import { memo } from "react";
import type { OISnapshot, SentimentResult, IndexSymbol } from "../types";
import { RadialGauge } from "./RadialGauge";
import { SymbolSelector } from "./SymbolSelector";

interface Props {
  symbol: IndexSymbol;
  onSymbolChange: (s: IndexSymbol) => void;
  mode: "LIVE" | "HISTORICAL";
  onModeChange: (m: "LIVE" | "HISTORICAL") => void;
  expiries: string[];
  selectedExpiry: string;
  onExpiryChange: (e: string) => void;
  strikeDepth: number;
  onStrikeDepthChange: (n: number) => void;
  snapshot: OISnapshot;
  sentiment: SentimentResult;
}

const DEPTHS: ReadonlyArray<{ label: string; value: number }> = [
  { label: "All", value: 0 },
  { label: "ATM", value: 1 },
  { label: "5", value: 5 },
  { label: "10", value: 10 },
  { label: "20", value: 20 },
];

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div
    className={`rounded-2xl border border-slate-700/40 bg-slate-900/60 p-3 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset] ${className}`}
  >
    {children}
  </div>
);

function OISidebarBase(p: Props) {
  return (
    <aside className="flex w-full max-w-[280px] flex-col gap-3">
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wide text-slate-200">Settings</h2>
        </div>

        <SymbolSelector
          symbol={p.symbol}
          onSymbolChange={p.onSymbolChange}
          expiries={p.expiries}
          selectedExpiry={p.selectedExpiry}
          onExpiryChange={p.onExpiryChange}
        />

        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-slate-400">Mode</label>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-800/60 p-1">
            {(["LIVE", "HISTORICAL"] as const).map((m) => (
              <button
                key={m}
                onClick={() => p.onModeChange(m)}
                className={`rounded-lg py-1.5 text-xs font-medium transition-colors ${
                  p.mode === m ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-700/50"
                }`}
              >
                {m === "LIVE" ? "Live" : "Historical"}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-slate-400">
            Strikes above/below ATM
          </label>
          <div className="grid grid-cols-5 gap-1 rounded-xl bg-slate-800/60 p-1">
            {DEPTHS.map((d) => (
              <button
                key={d.label}
                onClick={() => p.onStrikeDepthChange(d.value)}
                className={`rounded-lg py-1.5 text-xs font-medium transition-colors ${
                  p.strikeDepth === d.value
                    ? "bg-sky-600 text-white"
                    : "text-slate-300 hover:bg-slate-700/50"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="mb-1 text-sm font-semibold text-slate-200">Market Sentiment</h3>
        <p className="mb-2 text-[11px] text-slate-500">(based on OI)</p>
        <div className="flex justify-center">
          <RadialGauge sentiment={p.sentiment} size={160} />
        </div>
        <div className="mt-3 rounded-xl border border-slate-700/40 bg-slate-800/40 px-3 py-2 text-center text-xs text-slate-300">
          <div>
            PCR: <span className="font-semibold text-slate-100">{p.snapshot.pcr.toFixed(2)}</span>{" "}
            <span className={p.snapshot.pcrChange >= 0 ? "text-emerald-400" : "text-rose-400"}>
              ({p.snapshot.pcrChange >= 0 ? "+" : ""}
              {p.snapshot.pcrChange.toFixed(2)})
            </span>
          </div>
          <div className="mt-1">
            PCR OI Change:{" "}
            <span className="font-semibold text-slate-100">
              {p.snapshot.pcrOIChange.toFixed(2)}
            </span>
          </div>
        </div>
      </Card>

      <Card className="border-sky-500/20 bg-sky-500/[0.04]">
        <div className="mb-1 flex items-center gap-2 text-sky-300">
          <span className="text-sm font-semibold">Market Insight</span>
        </div>
        <p className="text-xs leading-relaxed text-slate-300">{p.sentiment.insight}</p>
      </Card>

      <Card>
        <div className="mb-1 flex items-center gap-2 text-slate-200">
          <span className="text-sm font-semibold">AI Analysis</span>
        </div>
        <p className="text-xs leading-relaxed text-slate-400">{p.sentiment.analysis}</p>
      </Card>
    </aside>
  );
}

export const OISidebar = memo(OISidebarBase);
