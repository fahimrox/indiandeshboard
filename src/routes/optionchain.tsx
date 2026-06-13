import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { fmt } from "@/components/MarketBits";
import { optionChainQuery } from "@/lib/dashboard-query";
import type { OcSignal } from "@/lib/nse.functions";

export const Route = createFileRoute("/optionchain")({
  head: () => ({
    meta: [
      { title: "Option Chain — NIFTY, BANKNIFTY, SENSEX Live | IndexMover" },
      {
        name: "description",
        content:
          "Live option chain for NIFTY, BANKNIFTY and SENSEX with straddle, IV, OI change, signal and 4-level support/resistance computed from live OI and volume.",
      },
      { property: "og:title", content: "Option Chain — NIFTY, BANKNIFTY, SENSEX Live" },
      { property: "og:url", content: "https://indiandeshboard.lovable.app/optionchain" },
    ],
    links: [{ rel: "canonical", href: "https://indiandeshboard.lovable.app/optionchain" }],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(optionChainQuery("NIFTY")),
  component: Page,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

const SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;

function fmtN(n: number) {
  if (!isFinite(n)) return "—";
  if (Math.abs(n) >= 1e7) return (n / 1e7).toFixed(2) + "Cr";
  if (Math.abs(n) >= 1e5) return (n / 1e5).toFixed(2) + "L";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString("en-IN");
}

const SIGNAL_STYLES: Record<OcSignal, string> = {
  "Strong Long Buildup": "bg-emerald-600/30 text-emerald-200 border-emerald-500/50",
  "Weak Long Buildup": "bg-emerald-600/15 text-emerald-300 border-emerald-500/30",
  "Strong Short Buildup": "bg-fuchsia-600/30 text-fuchsia-200 border-fuchsia-500/50",
  "Weak Short Buildup": "bg-fuchsia-600/15 text-fuchsia-300 border-fuchsia-500/30",
  "Strong Short Cover": "bg-rose-600/30 text-rose-200 border-rose-500/50",
  "Weak Short Cover": "bg-rose-600/15 text-rose-300 border-rose-500/30",
  "Strong Long Unwinding": "bg-amber-600/30 text-amber-200 border-amber-500/50",
  "Weak Long Unwinding": "bg-amber-600/15 text-amber-300 border-amber-500/30",
  Neutral: "bg-muted text-muted-foreground border-border",
};

function SignalChip({ s }: { s: OcSignal }) {
  if (s === "Neutral") return <span className="text-[10px] text-muted-foreground">—</span>;
  return (
    <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${SIGNAL_STYLES[s]}`}>
      {s.replace("Buildup", "B/up").replace("Cover", "Cov").replace("Unwinding", "Unw")}
    </span>
  );
}

function pctOf(v: number, max: number) {
  return max ? (v / max) * 100 : 0;
}

function Page() {
  const [symbol, setSymbol] = useState<(typeof SYMBOLS)[number]>("NIFTY");
  const { data: oc } = useSuspenseQuery(optionChainQuery(symbol));

  const maxCeOi = Math.max(...oc.rows.map((r) => r.ce?.oi ?? 0), 1);
  const maxPeOi = Math.max(...oc.rows.map((r) => r.pe?.oi ?? 0), 1);
  const maxCeVol = Math.max(...oc.rows.map((r) => r.ce?.volume ?? 0), 1);
  const maxPeVol = Math.max(...oc.rows.map((r) => r.pe?.volume ?? 0), 1);

  const pcr = oc.totals.ceOi ? oc.totals.peOi / oc.totals.ceOi : 0;
  const pcrChg = oc.totals.ceOiChg ? oc.totals.peOiChg / oc.totals.ceOiChg : 0;

  const r1 = oc.levels.find((l) => l.kind === "R1")?.strike ?? 0;
  const r2 = oc.levels.find((l) => l.kind === "R2")?.strike ?? 0;
  const s1 = oc.levels.find((l) => l.kind === "S1")?.strike ?? 0;
  const s2 = oc.levels.find((l) => l.kind === "S2")?.strike ?? 0;

  return (
    <DashboardShell
      title="Option Chain"
      subtitle={`${symbol} • Spot ${fmt(oc.spot)} • Expiry ${oc.expiry} • PCR ${pcr.toFixed(2)}`}
      updatedAt={oc.updatedAt}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {SYMBOLS.map((s) => (
          <button
            key={s}
            onClick={() => setSymbol(s)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              symbol === s
                ? "bg-[var(--neon)] text-background"
                : "border border-border bg-card text-foreground hover:border-[var(--neon)]/40"
            }`}
          >
            {s}
          </button>
        ))}
        <span className="ml-auto rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground">
          Live • Auto-refresh 10s during market hours
        </span>
      </div>

      {oc.source === "fallback" && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          Upstream blocked — showing simulated chain. Live data resumes when feed responds.
        </div>
      )}

      {/* 4 Levels */}
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <LevelCard label="R1 (Resistance)" sub="Max CE OI + Volume Zone" value={r1} tone="bear" />
        <LevelCard label="R2 (Resistance Shift)" sub="Live OI Shift on CE" value={r2} tone="bear" subtle />
        <LevelCard label="S1 (Support)" sub="Max PE OI + Volume Zone" value={s1} tone="bull" />
        <LevelCard label="S2 (Support Shift)" sub="Live OI Shift on PE" value={s2} tone="bull" subtle />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[1400px] text-xs">
          <thead className="bg-background/60 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th colSpan={2} className="border-b border-border px-2 py-2 text-center bg-rose-900/30 text-rose-200">CALL — Interpret</th>
              <th colSpan={6} className="border-b border-border px-2 py-2 text-center bg-rose-900/20 text-rose-200">CALL OPTIONS</th>
              <th className="border-b border-border bg-[var(--neon)]/15 px-2 py-2 text-center text-foreground">Strike</th>
              <th colSpan={6} className="border-b border-border px-2 py-2 text-center bg-emerald-900/20 text-emerald-200">PUT OPTIONS</th>
              <th colSpan={2} className="border-b border-border px-2 py-2 text-center bg-emerald-900/30 text-emerald-200">PUT — Interpret</th>
            </tr>
            <tr className="border-b border-border">
              <th className="px-2 py-2 text-right">Straddle</th>
              <th className="px-2 py-2 text-left">Signal</th>
              <th className="px-2 py-2 text-right">IV</th>
              <th className="px-2 py-2 text-right">OI Chg</th>
              <th className="px-2 py-2 text-right">OI</th>
              <th className="px-2 py-2 text-right">Volume</th>
              <th className="px-2 py-2 text-right">LTP</th>
              <th className="px-2 py-2 text-right">R.Lvl</th>
              <th className="px-2 py-2 text-center text-foreground">PCR OI</th>
              <th className="px-2 py-2 text-left">S.Lvl</th>
              <th className="px-2 py-2 text-right">LTP</th>
              <th className="px-2 py-2 text-right">Volume</th>
              <th className="px-2 py-2 text-right">OI</th>
              <th className="px-2 py-2 text-right">OI Chg</th>
              <th className="px-2 py-2 text-right">IV</th>
              <th className="px-2 py-2 text-right">Signal</th>
              <th className="px-2 py-2 text-right">Straddle</th>
            </tr>
          </thead>
          <tbody>
            {oc.rows.map((r) => {
              const isAtm = Math.abs(r.strike - oc.spot) < (oc.symbol === "BANKNIFTY" || oc.symbol === "SENSEX" ? 100 : 50);
              const itm = r.strike < oc.spot;
              const ceVol = r.ce?.volume ?? 0;
              const peVol = r.pe?.volume ?? 0;
              const ceOi = r.ce?.oi ?? 0;
              const peOi = r.pe?.oi ?? 0;
              const hlCeOi = r.strike === oc.maxCeOiStrike ? "bg-rose-600/40" : r.strike === oc.second.ceOi ? "bg-rose-600/15" : "";
              const hlCeVol = r.strike === oc.maxCeVolStrike ? "bg-amber-500/40" : r.strike === oc.second.ceVol ? "bg-amber-500/15" : "";
              const hlPeOi = r.strike === oc.maxPeOiStrike ? "bg-emerald-600/40" : r.strike === oc.second.peOi ? "bg-emerald-600/15" : "";
              const hlPeVol = r.strike === oc.maxPeVolStrike ? "bg-amber-500/40" : r.strike === oc.second.peVol ? "bg-amber-500/15" : "";
              return (
                <tr key={r.strike} className={`border-b border-border/40 ${isAtm ? "ring-1 ring-inset ring-[var(--neon)]/60" : ""}`}>
                  <td className="px-2 py-1.5 text-right font-mono text-foreground/90">{fmt(r.straddle)}</td>
                  <td className="px-2 py-1.5"><SignalChip s={r.ce?.signal ?? "Neutral"} /></td>
                  <td className="px-2 py-1.5 text-right font-mono">{(r.ce?.iv ?? 0).toFixed(2)}</td>
                  <td className={`px-2 py-1.5 text-right font-mono ${(r.ce?.oiChg ?? 0) >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                    {(r.ce?.oiChgPct ?? 0).toFixed(1)}%
                    <div className="text-[9px] opacity-70">{fmtN(r.ce?.oiChg ?? 0)}</div>
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono ${hlCeOi}`}>
                    {fmtN(ceOi)}
                    <div className="text-[9px] opacity-70">{pctOf(ceOi, maxCeOi).toFixed(0)}%</div>
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono ${hlCeVol}`}>
                    {fmtN(ceVol)}
                    <div className="text-[9px] opacity-70">{pctOf(ceVol, maxCeVol).toFixed(0)}%</div>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmt(r.ce?.ltp ?? 0)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-rose-300/80">{fmt(r.strike + (r.ce?.ltp ?? 0), 0)}</td>
                  <td className={`px-2 py-1.5 text-center font-bold ${isAtm ? "bg-[var(--neon)]/20 text-[var(--neon)]" : itm ? "bg-background/60" : "bg-background/30"}`}>
                    <div>{fmt(r.strike, 0)}</div>
                    <div className="text-[9px] font-normal opacity-70">{r.pcr.toFixed(2)}</div>
                  </td>
                  <td className="px-2 py-1.5 text-left font-mono text-emerald-300/80">{fmt(r.strike - (r.pe?.ltp ?? 0), 0)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmt(r.pe?.ltp ?? 0)}</td>
                  <td className={`px-2 py-1.5 text-right font-mono ${hlPeVol}`}>
                    {fmtN(peVol)}
                    <div className="text-[9px] opacity-70">{pctOf(peVol, maxPeVol).toFixed(0)}%</div>
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono ${hlPeOi}`}>
                    {fmtN(peOi)}
                    <div className="text-[9px] opacity-70">{pctOf(peOi, maxPeOi).toFixed(0)}%</div>
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono ${(r.pe?.oiChg ?? 0) >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                    {(r.pe?.oiChgPct ?? 0).toFixed(1)}%
                    <div className="text-[9px] opacity-70">{fmtN(r.pe?.oiChg ?? 0)}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{(r.pe?.iv ?? 0).toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-right"><SignalChip s={r.pe?.signal ?? "Neutral"} /></td>
                  <td className="px-2 py-1.5 text-right font-mono text-foreground/90">{fmt(r.straddle)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-background/50 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <td colSpan={3} className="px-2 py-2 text-right">Totals</td>
              <td className="px-2 py-2 text-right font-mono text-foreground">{fmtN(oc.totals.ceOiChg)}</td>
              <td className="px-2 py-2 text-right font-mono text-foreground">{fmtN(oc.totals.ceOi)}</td>
              <td className="px-2 py-2 text-right font-mono text-foreground">{fmtN(oc.totals.ceVol)}</td>
              <td colSpan={2}></td>
              <td className="px-2 py-2 text-center font-mono text-foreground">{pcr.toFixed(2)} / {pcrChg.toFixed(2)}</td>
              <td colSpan={2}></td>
              <td className="px-2 py-2 text-right font-mono text-foreground">{fmtN(oc.totals.peVol)}</td>
              <td className="px-2 py-2 text-right font-mono text-foreground">{fmtN(oc.totals.peOi)}</td>
              <td className="px-2 py-2 text-right font-mono text-foreground">{fmtN(oc.totals.peOiChg)}</td>
              <td colSpan={3}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </DashboardShell>
  );
}

function LevelCard({ label, sub, value, tone, subtle }: { label: string; sub: string; value: number; tone: "bull" | "bear"; subtle?: boolean }) {
  const ring = tone === "bear" ? "border-rose-500/40 bg-rose-500/10" : "border-emerald-500/40 bg-emerald-500/10";
  const dim = subtle ? "opacity-90" : "";
  const text = tone === "bear" ? "text-rose-300" : "text-emerald-300";
  return (
    <div className={`rounded-xl border px-4 py-3 ${ring} ${dim}`}>
      <div className={`text-[10px] font-bold uppercase tracking-widest ${text}`}>{label}</div>
      <div className="mt-1 font-mono text-2xl font-bold text-foreground">{fmt(value, 0)}</div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}
