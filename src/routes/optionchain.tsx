import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { fmt } from "@/components/MarketBits";
import { optionChainQuery } from "@/lib/dashboard-query";

export const Route = createFileRoute("/optionchain")({
  head: () => ({ meta: [{ title: "Option Chain — Live | IndexMover" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(optionChainQuery("NIFTY")),
  component: Page,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

const SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"] as const;

function fmtN(n: number) {
  if (!isFinite(n)) return "—";
  if (Math.abs(n) >= 1e7) return (n / 1e7).toFixed(2) + "Cr";
  if (Math.abs(n) >= 1e5) return (n / 1e5).toFixed(2) + "L";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString("en-IN");
}

function pctOf(v: number, max: number) {
  return max ? (v / max) * 100 : 0;
}

function classifyReversal(side: "ce" | "pe", oiChgPct: number, volPct: number) {
  // Simple proxy: high vol & oi increasing => buildup; high vol & oi decreasing => break
  if (volPct > 50 && oiChgPct > 0) return side === "ce" ? "Break Out" : "Break Down";
  if (volPct > 50 && oiChgPct < 0) return side === "ce" ? "Break Down" : "Break Out";
  return "—";
}

function Page() {
  const [symbol, setSymbol] = useState<(typeof SYMBOLS)[number]>("NIFTY");
  const { data: oc } = useSuspenseQuery(optionChainQuery(symbol));

  const maxCeOi = Math.max(...oc.rows.map((r) => r.ce?.oi ?? 0), 1);
  const maxPeOi = Math.max(...oc.rows.map((r) => r.pe?.oi ?? 0), 1);
  const maxCeVol = Math.max(...oc.rows.map((r) => r.ce?.volume ?? 0), 1);
  const maxPeVol = Math.max(...oc.rows.map((r) => r.pe?.volume ?? 0), 1);
  const maxCeOiChg = Math.max(...oc.rows.map((r) => Math.abs(r.ce?.oiChg ?? 0)), 1);
  const maxPeOiChg = Math.max(...oc.rows.map((r) => Math.abs(r.pe?.oiChg ?? 0)), 1);

  // Compute support/resistance bands
  const peOiSorted = [...oc.rows].sort((a, b) => (b.pe?.oi ?? 0) - (a.pe?.oi ?? 0));
  const ceOiSorted = [...oc.rows].sort((a, b) => (b.ce?.oi ?? 0) - (a.ce?.oi ?? 0));
  const supportLow = Math.min(peOiSorted[0]?.strike ?? 0, peOiSorted[1]?.strike ?? 0);
  const supportHigh = Math.max(peOiSorted[0]?.strike ?? 0, peOiSorted[1]?.strike ?? 0);
  const resLow = Math.min(ceOiSorted[0]?.strike ?? 0, ceOiSorted[1]?.strike ?? 0);
  const resHigh = Math.max(ceOiSorted[0]?.strike ?? 0, ceOiSorted[1]?.strike ?? 0);

  // WTB / WTT / STRONG percentages (simple proxies from concentration)
  const totalCeOi = oc.totals.ceOi || 1;
  const totalPeOi = oc.totals.peOi || 1;
  const totalCeVol = oc.totals.ceVol || 1;
  const totalPeVol = oc.totals.peVol || 1;
  const ceWtb = ((ceOiSorted[0]?.ce?.oi ?? 0) + (ceOiSorted[1]?.ce?.oi ?? 0)) / totalCeOi * 100;
  const ceWtt = ([...oc.rows].sort((a, b) => (b.ce?.volume ?? 0) - (a.ce?.volume ?? 0))
    .slice(0, 2)
    .reduce((a, r) => a + (r.ce?.volume ?? 0), 0)) / totalCeVol * 100;
  const peWtb = ((peOiSorted[0]?.pe?.oi ?? 0) + (peOiSorted[1]?.pe?.oi ?? 0)) / totalPeOi * 100;
  const peStrong = ([...oc.rows].sort((a, b) => (b.pe?.volume ?? 0) - (a.pe?.volume ?? 0))
    .slice(0, 2)
    .reduce((a, r) => a + (r.pe?.volume ?? 0), 0)) / totalPeVol * 100;

  return (
    <DashboardShell
      title="Option Chain"
      subtitle={`${symbol} • Spot ${fmt(oc.spot)} • Expiry ${oc.expiry}`}
      updatedAt={oc.updatedAt}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
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
        {oc.source === "fallback" && (
          <span className="ml-auto rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
            NSE blocked — showing simulated chain. Live data resumes when NSE responds.
          </span>
        )}
      </div>

      {/* Resistance / Support banner */}
      <div className="mb-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-[var(--bull)]/40 bg-[var(--bull)]/10 px-4 py-3 text-sm">
          <span className="font-bold text-[var(--bull)]">RESISTANCE</span>{" "}
          <span className="text-foreground/90">VOLUME / OI Zone at {fmt(resLow, 0)} – {fmt(resHigh, 0)}</span>
        </div>
        <div className="rounded-xl border border-[var(--bear)]/40 bg-[var(--bear)]/10 px-4 py-3 text-sm">
          <span className="font-bold text-[var(--bear)]">SUPPORT</span>{" "}
          <span className="text-foreground/90">OI / VOLUME Zone at {fmt(supportLow, 0)} – {fmt(supportHigh, 0)}</span>
        </div>
      </div>

      {/* % strength bar */}
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <Pill label="CE WTB" value={ceWtb} tone="bull" />
        <Pill label="CE WTT" value={ceWtt} tone="bull" />
        <Pill label="PE STRONG" value={peStrong} tone="bear" />
        <Pill label="PE WTB" value={peWtb} tone="bear" />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[1100px] text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border bg-background/40">
              <th className="px-2 py-2 text-right">CE OI Chg</th>
              <th className="px-2 py-2 text-right">CE OI</th>
              <th className="px-2 py-2 text-right">CE Volume</th>
              <th className="px-2 py-2 text-right">CE LTP</th>
              <th className="px-2 py-2 text-right">Reversal</th>
              <th className="px-2 py-2 text-center text-foreground">STRIKE</th>
              <th className="px-2 py-2 text-left">Reversal</th>
              <th className="px-2 py-2 text-right">PE LTP</th>
              <th className="px-2 py-2 text-right">PE Volume</th>
              <th className="px-2 py-2 text-right">PE OI</th>
              <th className="px-2 py-2 text-right">PE OI Chg</th>
            </tr>
          </thead>
          <tbody>
            {oc.rows.map((r) => {
              const isAtm = Math.abs(r.strike - oc.spot) < (oc.symbol === "BANKNIFTY" ? 100 : 50);
              const itm = r.strike < oc.spot;
              const ceVol = r.ce?.volume ?? 0;
              const peVol = r.pe?.volume ?? 0;
              const ceOi = r.ce?.oi ?? 0;
              const peOi = r.pe?.oi ?? 0;

              const highlightCeOi =
                r.strike === oc.maxCeOiStrike
                  ? "bg-[var(--bear)]/30"
                  : r.strike === oc.second.ceOi
                    ? "bg-[var(--bear)]/15"
                    : "";
              const highlightCeVol =
                r.strike === oc.maxCeVolStrike
                  ? "bg-yellow-500/35"
                  : r.strike === oc.second.ceVol
                    ? "bg-yellow-500/15"
                    : "";
              const highlightPeOi =
                r.strike === oc.maxPeOiStrike
                  ? "bg-[var(--bull)]/30"
                  : r.strike === oc.second.peOi
                    ? "bg-[var(--bull)]/15"
                    : "";
              const highlightPeVol =
                r.strike === oc.maxPeVolStrike
                  ? "bg-yellow-500/35"
                  : r.strike === oc.second.peVol
                    ? "bg-yellow-500/15"
                    : "";

              return (
                <tr
                  key={r.strike}
                  className={`border-b border-border/40 ${isAtm ? "ring-1 ring-inset ring-[var(--neon)]/60" : ""}`}
                >
                  <td className={`px-2 py-1.5 text-right font-mono ${(r.ce?.oiChg ?? 0) >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                    {fmtN(r.ce?.oiChg ?? 0)}
                    <div className="text-[9px] opacity-70">{pctOf(Math.abs(r.ce?.oiChg ?? 0), maxCeOiChg).toFixed(1)}%</div>
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono ${highlightCeOi}`}>
                    {fmtN(ceOi)}
                    <div className="text-[9px] opacity-70">{pctOf(ceOi, maxCeOi).toFixed(1)}%</div>
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono ${highlightCeVol}`}>
                    {fmtN(ceVol)}
                    <div className="text-[9px] opacity-70">{pctOf(ceVol, maxCeVol).toFixed(1)}%</div>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmt(r.ce?.ltp ?? 0)}</td>
                  <td className="px-2 py-1.5 text-right text-[10px] text-muted-foreground">
                    {classifyReversal("ce", pctOf(r.ce?.oiChg ?? 0, maxCeOiChg), pctOf(ceVol, maxCeVol))}
                  </td>
                  <td
                    className={`px-2 py-1.5 text-center font-bold ${
                      isAtm
                        ? "bg-[var(--neon)]/20 text-[var(--neon)]"
                        : itm
                          ? "bg-background/60"
                          : "bg-background/30"
                    }`}
                  >
                    {fmt(r.strike, 0)}
                  </td>
                  <td className="px-2 py-1.5 text-left text-[10px] text-muted-foreground">
                    {classifyReversal("pe", pctOf(r.pe?.oiChg ?? 0, maxPeOiChg), pctOf(peVol, maxPeVol))}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmt(r.pe?.ltp ?? 0)}</td>
                  <td className={`px-2 py-1.5 text-right font-mono ${highlightPeVol}`}>
                    {fmtN(peVol)}
                    <div className="text-[9px] opacity-70">{pctOf(peVol, maxPeVol).toFixed(1)}%</div>
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono ${highlightPeOi}`}>
                    {fmtN(peOi)}
                    <div className="text-[9px] opacity-70">{pctOf(peOi, maxPeOi).toFixed(1)}%</div>
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono ${(r.pe?.oiChg ?? 0) >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                    {fmtN(r.pe?.oiChg ?? 0)}
                    <div className="text-[9px] opacity-70">{pctOf(Math.abs(r.pe?.oiChg ?? 0), maxPeOiChg).toFixed(1)}%</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr className="border-t border-border bg-background/40">
              <td className="px-2 py-2 text-right">
                <div>Total CE</div>
                <div className="font-mono text-foreground">{fmtN(oc.totals.ceOiChg)}</div>
              </td>
              <td className="px-2 py-2 text-right">
                <div>CE OI</div>
                <div className="font-mono text-foreground">{fmtN(oc.totals.ceOi)}</div>
              </td>
              <td className="px-2 py-2 text-right">
                <div>CE Vol</div>
                <div className="font-mono text-foreground">{fmtN(oc.totals.ceVol)}</div>
              </td>
              <td colSpan={2}></td>
              <td className="px-2 py-2 text-center">
                <div>PE-CE OI Chg</div>
                <div className="font-mono text-foreground">{fmtN(oc.totals.peOiChg - oc.totals.ceOiChg)}</div>
              </td>
              <td colSpan={2}></td>
              <td className="px-2 py-2 text-right">
                <div>PE Vol</div>
                <div className="font-mono text-foreground">{fmtN(oc.totals.peVol)}</div>
              </td>
              <td className="px-2 py-2 text-right">
                <div>PE OI</div>
                <div className="font-mono text-foreground">{fmtN(oc.totals.peOi)}</div>
              </td>
              <td className="px-2 py-2 text-right">
                <div>Total PE</div>
                <div className="font-mono text-foreground">{fmtN(oc.totals.peOiChg)}</div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </DashboardShell>
  );
}

function Pill({ label, value, tone }: { label: string; value: number; tone: "bull" | "bear" }) {
  const color = tone === "bull" ? "border-[var(--bull)]/50 text-[var(--bull)] bg-[var(--bull)]/10" : "border-[var(--bear)]/50 text-[var(--bear)] bg-[var(--bear)]/10";
  return (
    <div className={`rounded-md border px-3 py-1.5 font-semibold ${color}`}>
      {label} <span className="font-mono">{value.toFixed(2)}%</span>
    </div>
  );
}
