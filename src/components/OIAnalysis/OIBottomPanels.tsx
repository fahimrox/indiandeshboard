import { BarChart3, PieChart } from "lucide-react";
import { DonutChart } from "./DonutChart";

interface OIBottomPanelsProps {
  callChange: number;
  putChange: number;
  totalCallOI: number;
  totalPutOI: number;
  pcr: number;
}

function fmtOI(n: number): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  let s: string;
  if (abs >= 1e7) s = (abs / 1e7).toFixed(2) + "Cr";
  else if (abs >= 1e5) s = (abs / 1e5).toFixed(2) + "L";
  else if (abs >= 1e3) s = (abs / 1e3).toFixed(1) + "K";
  else s = abs.toLocaleString("en-IN");
  return n < 0 ? "−" + s : s;
}

export function OIBottomPanels({
  callChange,
  putChange,
  totalCallOI,
  totalPutOI,
  pcr,
}: OIBottomPanelsProps) {
  const callChangePct = Math.abs(callChange) / Math.max(Math.abs(callChange), Math.abs(putChange)) * 100;
  const putChangePct = Math.abs(putChange) / Math.max(Math.abs(callChange), Math.abs(putChange)) * 100;
  
  const callTotalPct = totalCallOI / (totalCallOI + totalPutOI) * 100;
  const putTotalPct = totalPutOI / (totalCallOI + totalPutOI) * 100;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      {/* Panel 1: Open Interest Change */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-4 w-4 text-blue-400" />
          <h3 className="text-sm font-bold text-foreground">Open Interest Change</h3>
        </div>

        <div className="space-y-6">
          {/* Call Change Bar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground uppercase">CALL</span>
              <span className="text-lg font-bold font-mono text-foreground">{fmtOI(callChange)}</span>
            </div>
            <div className="relative h-24 bg-[#00DD99]/10 rounded-lg overflow-hidden">
              <div
                className="absolute bottom-0 left-0 right-0 bg-[#00DD99] transition-all duration-500 rounded-t-lg"
                style={{ height: `${callChangePct}%` }}
              />
            </div>
          </div>

          {/* Put Change Bar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground uppercase">PUT</span>
              <span className="text-lg font-bold font-mono text-foreground">{fmtOI(putChange)}</span>
            </div>
            <div className="relative h-24 bg-[#FF7777]/10 rounded-lg overflow-hidden">
              <div
                className="absolute bottom-0 left-0 right-0 bg-[#FF7777] transition-all duration-500 rounded-t-lg"
                style={{ height: `${putChangePct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Panel 2: Total Open Interest */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-4 w-4 text-blue-400" />
          <h3 className="text-sm font-bold text-foreground">Total Open Interest</h3>
        </div>

        <div className="space-y-6">
          {/* Call Total Bar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground uppercase">CALL</span>
              <span className="text-lg font-bold font-mono text-foreground">{fmtOI(totalCallOI)}</span>
            </div>
            <div className="relative h-24 bg-[#00DD99]/10 rounded-lg overflow-hidden">
              <div
                className="absolute bottom-0 left-0 right-0 bg-[#00DD99] transition-all duration-500 rounded-t-lg"
                style={{ height: `${callTotalPct}%` }}
              />
            </div>
          </div>

          {/* Put Total Bar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground uppercase">PUT</span>
              <span className="text-lg font-bold font-mono text-foreground">{fmtOI(totalPutOI)}</span>
            </div>
            <div className="relative h-24 bg-[#FF7777]/10 rounded-lg overflow-hidden">
              <div
                className="absolute bottom-0 left-0 right-0 bg-[#FF7777] transition-all duration-500 rounded-t-lg"
                style={{ height: `${putTotalPct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Panel 3: Put/Call Ratio */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <PieChart className="h-4 w-4 text-blue-400" />
          <h3 className="text-sm font-bold text-foreground">Put/Call Ratio</h3>
        </div>

        <div className="flex flex-col items-center justify-center">
          <DonutChart
            segments={[
              { value: putTotalPct, color: "#FF7777", label: "Put OI" },
              { value: callTotalPct, color: "#00DD99", label: "Call OI" },
            ]}
            centerText="PCR"
            centerValue={pcr.toFixed(2)}
            size={160}
          />

          <div className="mt-4 flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-sm bg-[#FF7777]" />
              <span className="text-muted-foreground">
                Put OI <span className="font-bold text-foreground">{putTotalPct.toFixed(0)}%</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-sm bg-[#00DD99]" />
              <span className="text-muted-foreground">
                Call OI <span className="font-bold text-foreground">{callTotalPct.toFixed(0)}%</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
