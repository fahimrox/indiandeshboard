import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { optionChainQuery, quotesQuery } from "@/lib/dashboard-query";
import type { OcRow } from "@/lib/nse.functions";

export const Route = createFileRoute("/optionchain")({
  head: () => ({
    meta: [
      { title: "Option Chain — NIFTY, BANKNIFTY, SENSEX Live | IndexMover" },
      {
        name: "description",
        content:
          "Live option chain for NIFTY, BANKNIFTY and SENSEX with IV, OI change, buildup signals, WTT/WTB/DF concentration and support/resistance.",
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

type Sym = "NIFTY" | "BANKNIFTY" | "SENSEX";
const INDEX_CFG: Record<Sym, { label: string; ySym: string; interval: number; lotSize: number; expiryType: string }> = {
  NIFTY: { label: "NIFTY 50", ySym: "^NSEI", interval: 50, lotSize: 75, expiryType: "Weekly (Thu)" },
  BANKNIFTY: { label: "BANK NIFTY", ySym: "^NSEBANK", interval: 100, lotSize: 35, expiryType: "Monthly (Last Thu)" },
  SENSEX: { label: "SENSEX", ySym: "^BSESN", interval: 100, lotSize: 20, expiryType: "Weekly (Fri)" },
};
const SYMBOLS: Sym[] = ["NIFTY", "BANKNIFTY", "SENSEX"];

type BuildupType = "Long Buildup" | "Short Buildup" | "Short Covering" | "Long Unwinding";
interface Buildup { strong: boolean; type: BuildupType }

// Per-side, per-strike buildup: direction from this leg's own OI-change sign +
// its price direction (a call tracks the index, a put moves inverse). Strength
// from the leg's own OI thrust confirmed by its relative volume — a strong
// signal is a big OI move and/or heavy volume on that exact leg.
function getBuildup(oiChgPct: number, priceDir: number, relVol = 0): Buildup {
  let type: BuildupType;
  if (oiChgPct > 0 && priceDir > 0) type = "Long Buildup";
  else if (oiChgPct > 0 && priceDir <= 0) type = "Short Buildup";
  else if (oiChgPct <= 0 && priceDir > 0) type = "Short Covering";
  else type = "Long Unwinding";
  const strong = Math.abs(oiChgPct) > 14 || (relVol > 0.7 && Math.abs(oiChgPct) > 6);
  return { strong, type };
}

function fmtVal(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e7) return (v / 1e7).toFixed(2) + " Cr";
  if (a >= 1e5) return (v / 1e5).toFixed(2) + " Lk";
  if (a >= 1000) return (v / 1000).toFixed(2) + " K";
  return v.toFixed(0);
}
const fmt = (n: number, d = 2) =>
  isFinite(n) ? n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";

// ─── Column concentration engine (WTT / WTB / DF + heat) ──────────────────────
interface CellStatus { pct: number; label: string; cls: string }
function getColStatuses(
  items: { strike: number; val: number }[],
  dfStrike: number,
  side: "call" | "put",
): Record<number, CellStatus> {
  const result: Record<number, CellStatus> = {};
  if (items.length === 0) return result;

  let maxItem = items[0];
  for (const it of items) if (it.val > maxItem.val) maxItem = it;
  const maxVal = maxItem.val;
  const maxStrike = maxItem.strike;

  let secItem: { strike: number; val: number } | null = null;
  for (const it of items) {
    if (it.strike === maxStrike) continue;
    if (!secItem || it.val > secItem.val) secItem = it;
  }
  const secVal = secItem ? secItem.val : 0;
  const secStrike = secItem ? secItem.strike : 0;
  const secPct = maxVal > 0 ? (secVal / maxVal) * 100 : 0;
  const hasWeakness = secPct >= 75; // concentration is splitting → wall may shift

  for (const it of items) {
    const pct = maxVal > 0 ? (it.val / maxVal) * 100 : 0;
    const isMax = it.strike === maxStrike;
    const isSecond = it.strike === secStrike;
    let label = "";
    let cls = "";

    if (isMax) {
      if (hasWeakness) {
        label = secStrike > maxStrike ? "WTT" : "WTB"; // weakness toward top / bottom
        cls = "bg-[#cc2929] text-white";
      } else {
        label = it.strike === dfStrike ? "DF" : "";
        cls = side === "call" ? "bg-[#cc2929] text-white" : "bg-[#107c41] text-white";
      }
    } else if (isSecond && hasWeakness) {
      label = it.strike === dfStrike ? "DF" : it.strike > maxStrike ? "WTT" : "WTB";
      cls = "bg-[#ffd700] text-black";
    } else if (pct >= 75) {
      cls = "bg-[#ffd700] text-black";
    } else if (pct >= 50) {
      cls = "bg-[#3c3722] text-[#ffd700]";
    }
    result[it.strike] = { pct, label, cls };
  }
  return result;
}

function HighlightCell({ status, abs, isOIChg = false }: { status?: CellStatus; abs: number; isOIChg?: boolean }) {
  if (!status) return null;
  const neg = isOIChg && abs < 0;
  let text = fmtVal(abs);
  if (isOIChg) text = (abs >= 0 ? "+" : "") + text;
  let textCls = "text-[#8aaabb]";
  if (status.cls) textCls = "text-inherit";
  else if (isOIChg) textCls = neg ? "text-[#ff5252]" : "text-[#00e5a0]";
  return (
    <div className={`flex min-h-[36px] w-full flex-col items-center justify-center rounded px-1 py-1 ${status.cls || "bg-transparent"}`}>
      <span className="flex items-center gap-0.5 text-[10px] font-black leading-tight">
        {status.label && (
          <span className={`rounded px-1 text-[8px] font-extrabold uppercase ${status.label === "DF" ? "bg-[#5e35b1] text-white" : "bg-[#d32f2f] text-white"}`}>
            {status.label}
          </span>
        )}
        <span>{status.pct.toFixed(1)}%</span>
      </span>
      <span className={`mt-0.5 text-[9px] font-semibold leading-tight ${textCls}`}>{text}</span>
    </div>
  );
}

// ─── Buildup badge: green (bullish) / red (bearish) only ──────────────────────
// Bullish flow = Long Buildup + Short Covering → green. Bearish = Short Buildup
// + Long Unwinding → red. Strong = darkest solid, Weak = lightest.
function buildupCls(type: BuildupType, strong: boolean): string {
  const bull = type === "Long Buildup" || type === "Short Covering";
  if (bull) return strong ? "bg-[#15803d] border-[#22c55e] text-white" : "bg-[#14532d]/40 border-[#22c55e]/40 text-[#86efac]";
  return strong ? "bg-[#b91c1c] border-[#ef4444] text-white" : "bg-[#7f1d1d]/40 border-[#ef4444]/40 text-[#fca5a5]";
}
function BuildupBadge({ b }: { b: Buildup }) {
  const cls = buildupCls(b.type, b.strong);
  const parts = b.type.split(" ");
  const w1 = parts[0]; // Long / Short
  const w2 = b.type === "Short Covering" ? "Cover" : parts[1]; // Buildup / Cover / Unwinding
  return (
    <div className={`inline-flex w-[104px] flex-col items-center justify-center rounded border px-2 py-1 text-center text-[9px] font-black leading-tight ${cls}`}>
      <span className="whitespace-nowrap">{b.strong ? "Strong" : "Weak"} {w1}</span>
      <span className="whitespace-nowrap">{w2}</span>
    </div>
  );
}

function IVCell({ iv, delta }: { iv: number; delta: number }) {
  return (
    <div className="flex flex-col items-center justify-center py-0.5">
      <span className="text-[10px] font-extrabold leading-tight text-[#c8dae8]">{iv.toFixed(2)}</span>
      <span className="text-[9px] leading-tight text-[#5a7a8a]">{delta.toFixed(2)}</span>
    </div>
  );
}
function LTPCell({ ltp, tv }: { ltp: number; tv: number }) {
  return (
    <div className="flex flex-col items-center justify-center py-0.5">
      <span className="text-[11px] font-extrabold leading-tight text-white">{ltp.toFixed(2)}</span>
      <span className="text-[9px] font-bold leading-tight text-[#8aaabb]">TV {tv.toFixed(2)}</span>
    </div>
  );
}
function LvlItem({ label, val }: { label: string; val: number }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-[#7a93a5]">{label}: </span>
      <span className="font-black text-white">{val ? val.toLocaleString("en-IN") : "—"}</span>
    </span>
  );
}

function Page() {
  const [symbol, setSymbol] = useState<Sym>("NIFTY");
  const [expiry, setExpiry] = useState<string | undefined>(undefined);
  const [mounted, setMounted] = useState(false);
  const [sortOrder, setSortOrder] = useState<"high-to-low" | "low-to-high">("high-to-low");

  const cfg = INDEX_CFG[symbol];
  const { data: oc, refetch, isFetching } = useSuspenseQuery(optionChainQuery(symbol, undefined, expiry));
  // Standard symbol so Upstox (auth, Cloudflare-friendly) can resolve the index,
  // with Yahoo as fallback — gives spot / day high-low / change for the H/L bar
  // and the buildup direction proxy.
  const { data: idxQuotes } = useQuery(quotesQuery([symbol]));

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const id = setInterval(() => refetch(), 10_000);
    return () => clearInterval(id);
  }, [refetch]);

  const idx = idxQuotes?.[0];
  const spot = oc.spot || idx?.price || 0;
  const idxChg = idx?.changePct ?? 0;
  const dayHigh = idx?.dayHigh || spot;
  const dayLow = idx?.dayLow || spot;
  const dayChange = idx?.change ?? 0;
  const interval = cfg.interval;
  const atm = Math.round(spot / interval) * interval;

  // rows sorted per toggle
  const rows: OcRow[] = useMemo(() => {
    const r = [...oc.rows].sort((a, b) => b.strike - a.strike);
    return sortOrder === "low-to-high" ? r.reverse() : r;
  }, [oc.rows, sortOrder]);

  // DF strikes = max total OI on each side
  const callDFStrike = useMemo(() => rows.reduce((a, b) => ((b.ce?.oi ?? 0) > (a.ce?.oi ?? 0) ? b : a), rows[0] ?? { strike: 0 } as OcRow).strike, [rows]);
  const putDFStrike = useMemo(() => rows.reduce((a, b) => ((b.pe?.oi ?? 0) > (a.pe?.oi ?? 0) ? b : a), rows[0] ?? { strike: 0 } as OcRow).strike, [rows]);

  const callOIStatuses = useMemo(() => getColStatuses(rows.map((r) => ({ strike: r.strike, val: r.ce?.oi ?? 0 })), callDFStrike, "call"), [rows, callDFStrike]);
  const callVolStatuses = useMemo(() => getColStatuses(rows.map((r) => ({ strike: r.strike, val: r.ce?.volume ?? 0 })), callDFStrike, "call"), [rows, callDFStrike]);
  const callOIChgStatuses = useMemo(() => getColStatuses(rows.map((r) => ({ strike: r.strike, val: Math.max(0, r.ce?.oiChg ?? 0) })), callDFStrike, "call"), [rows, callDFStrike]);
  const putOIStatuses = useMemo(() => getColStatuses(rows.map((r) => ({ strike: r.strike, val: r.pe?.oi ?? 0 })), putDFStrike, "put"), [rows, putDFStrike]);
  const putVolStatuses = useMemo(() => getColStatuses(rows.map((r) => ({ strike: r.strike, val: r.pe?.volume ?? 0 })), putDFStrike, "put"), [rows, putDFStrike]);
  const putOIChgStatuses = useMemo(() => getColStatuses(rows.map((r) => ({ strike: r.strike, val: Math.max(0, r.pe?.oiChg ?? 0) })), putDFStrike, "put"), [rows, putDFStrike]);

  const maxCeVol = useMemo(() => Math.max(1, ...rows.map((r) => r.ce?.volume ?? 0)), [rows]);
  const maxPeVol = useMemo(() => Math.max(1, ...rows.map((r) => r.pe?.volume ?? 0)), [rows]);

  // Live resistance/support scenario from the OI concentration engine: the
  // dominant Call-OI strike (resistance) and Put-OI strike (support) + their
  // current DF / WTT / WTB status (stable wall vs shifting).
  const resStrike = callDFStrike;
  const resLabel = callOIStatuses[callDFStrike]?.label || "DF";
  const supStrike = putDFStrike;
  const supLabel = putOIStatuses[putDFStrike]?.label || "DF";

  const pcr = oc.totals.ceOi ? oc.totals.peOi / oc.totals.ceOi : 0;
  const chgOIPCR = oc.totals.ceOiChg ? Math.abs(oc.totals.peOiChg) / Math.abs(oc.totals.ceOiChg || 1) : 0;
  const volPCR = oc.totals.ceVol ? oc.totals.peVol / oc.totals.ceVol : 0;

  const maxPain = useMemo(() => {
    let min = Infinity, mp = rows[0]?.strike ?? 0;
    for (const { strike } of rows) {
      const pain = rows.reduce((s, r) => s + (r.ce?.oi ?? 0) * Math.max(0, r.strike - strike) + (r.pe?.oi ?? 0) * Math.max(0, strike - r.strike), 0);
      if (pain < min) { min = pain; mp = strike; }
    }
    return mp;
  }, [rows]);

  // Spot-line side metrics (live). Risky = strongest OI wall, Moderate = 2nd OI
  // wall, Max Pain = index max-pain (shared), Max Gain = where fresh OI is
  // building (max OI-change strike) — the developing target on that side.
  const callRisky = oc.maxCeOiStrike;
  const callModerate = oc.second.ceOi;
  const putRisky = oc.maxPeOiStrike;
  const putModerate = oc.second.peOi;
  const maxGainCall = useMemo(() => (rows.length ? rows.reduce((a, b) => ((b.ce?.oiChg ?? 0) > (a.ce?.oiChg ?? 0) ? b : a)).strike : 0), [rows]);
  const maxGainPut = useMemo(() => (rows.length ? rows.reduce((a, b) => ((b.pe?.oiChg ?? 0) > (a.pe?.oiChg ?? 0) ? b : a)).strike : 0), [rows]);

  // R1/R2/S1/S2 from server levels, enriched with OI at each strike
  const findRow = (strike: number) => rows.find((r) => r.strike === strike);
  const levelInfo = (kind: "R1" | "R2" | "S1" | "S2") => {
    const lvl = oc.levels.find((l) => l.kind === kind);
    const strike = lvl?.strike ?? 0;
    const row = findRow(strike);
    const isR = kind.startsWith("R");
    return {
      strike,
      basis: lvl?.basis === "oiShift" ? "OI Shift" : "Max OI",
      oi: isR ? row?.ce?.oi ?? 0 : row?.pe?.oi ?? 0,
      oiChg: isR ? row?.ce?.oiChg ?? 0 : row?.pe?.oiChg ?? 0,
    };
  };
  const resLevels = [levelInfo("R1"), levelInfo("R2")];
  const supLevels = [levelInfo("S1"), levelInfo("S2")];

  const expiryKind = symbol === "BANKNIFTY" ? "Monthly" : "Weekly";
  const src = oc._metadata?.source ?? oc.source;
  const statusTxt = oc.isEod ? "EOD" : oc._metadata?.status === "live" ? "Live" : oc._metadata?.status ?? (isFetching ? "Refreshing" : "Live");

  const statCards = [
    { label: "PCR", value: pcr.toFixed(4), color: pcr >= 1 ? "#5ae05a" : "#e05a5a" },
    { label: "CHG OI PCR", value: chgOIPCR.toFixed(4), color: chgOIPCR >= 1 ? "#5ae05a" : "#e05a5a" },
    { label: "VOLUME PCR", value: volPCR.toFixed(4), color: "#f0c040" },
    { label: "MAX PAIN", value: maxPain.toLocaleString("en-IN"), color: "#e08040" },
    { label: "LOT SIZE", value: String(cfg.lotSize), color: "#8090c0" },
  ];

  return (
    <DashboardShell>
      <div className="flex flex-col gap-3">
        {/* Toolbar: tabs · expiry · sort · (change centred) · EOD · source */}
        <div className="relative flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-xl border border-[#1a2a3a] bg-[#080d18] p-1">
            {SYMBOLS.map((s) => {
              const active = symbol === s;
              return (
                <button key={s} onClick={() => { setSymbol(s); setExpiry(undefined); }}
                  className={`flex flex-col items-center rounded-lg px-3 py-1.5 transition-all ${active ? "border border-[#1a3a5a] bg-[#0f1e35]" : "hover:bg-[#0d1520]"}`}>
                  <span className={`text-[11px] font-extrabold tracking-wide ${active ? "text-white" : "text-[#4a6a80]"}`}>{INDEX_CFG[s].label}</span>
                  <span className={`text-[8px] ${active ? "text-[#3a8aaa]" : "text-[#2a4a5a]"}`}>{INDEX_CFG[s].expiryType}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-[#1a2a3a] bg-[#080d18] px-2 py-1.5">
            <span className="text-[9px] font-bold uppercase tracking-widest text-[#3a5070]">Expiry ({expiryKind})</span>
            {mounted ? (
              <select value={oc.expiry} onChange={(e) => setExpiry(e.target.value)}
                className="rounded bg-[#0f1e35] px-2 py-1 text-[11px] font-bold text-[#5aaabb] outline-none">
                {(oc.expiries ?? [oc.expiry]).map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            ) : <span className="rounded bg-[#0f1e35] px-2 py-1 text-[11px] font-bold text-[#5aaabb]">{oc.expiry}</span>}
          </div>

          <button onClick={() => setSortOrder((p) => (p === "high-to-low" ? "low-to-high" : "high-to-low"))}
            className="flex items-center gap-1.5 rounded-lg border border-[#2e7d32]/40 bg-[#1b3a24] px-3 py-1.5 text-[11px] font-black text-[#81c784] transition-all hover:bg-[#2e7d32]/20">
            <span className="text-[12px]">↑↓</span>
            <span>{sortOrder === "high-to-low" ? "High to Low" : "Low to High"}</span>
          </button>

          {/* Live resistance / support scenario — one line, centred above the strike column */}
          <div className="hidden flex-1 flex-wrap items-center justify-center gap-2 md:flex">
            <span className="rounded-full border border-[#22c55e]/40 bg-[#22c55e]/10 px-3 py-0.5 text-[10px] font-bold tracking-wide text-[#86efac]">
              RESISTANCE {resStrike.toLocaleString("en-IN")} – {resLabel}-{resStrike.toLocaleString("en-IN")}
            </span>
            <span className="rounded-full border border-[#ef4444]/40 bg-[#ef4444]/10 px-3 py-0.5 text-[10px] font-bold tracking-wide text-[#fca5a5]">
              SUPPORT {supStrike.toLocaleString("en-IN")} – {supLabel}-{supStrike.toLocaleString("en-IN")}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {oc.isEod && (
              <span className="rounded-md border border-[var(--neon)]/40 bg-[var(--neon)]/10 px-2 py-1 text-[10px] font-semibold text-[var(--neon)]">
                EOD · last trading day
              </span>
            )}
            <div className="flex items-center gap-1.5 rounded-full border border-[#1a2540] bg-[#0b0f1a] px-2.5 py-1 text-[11px]">
              <span className={`h-2 w-2 rounded-full ${statusTxt === "Live" ? "animate-pulse bg-[#00e5a0]" : "bg-[#4a6080]"}`} />
              <span className={`font-bold ${statusTxt === "Live" ? "text-[#00e5a0]" : statusTxt === "EOD" ? "text-amber-300" : "text-[#6b82a0]"}`}>{statusTxt}</span>
              <span className="text-[#3a5070]">·</span>
              <span className={`font-mono capitalize ${src === "synthetic" ? "font-bold text-rose-400" : "text-emerald-400"}`}>{src}</span>
            </div>
          </div>
        </div>
        {oc.fyersTokenStatus && !oc.fyersTokenStatus.ok && !oc.isEod && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
            FYERS warning: {oc.fyersTokenStatus.error || "token missing/expired"} — switched to backup feed ({oc.source}).
          </div>
        )}

        {/* ── MAIN OPTION CHAIN TABLE ── */}
        <div className="overflow-hidden rounded-xl border border-[#4a4f5d] bg-[#121214] shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] border-collapse" style={{ fontSize: "10px" }}>
              <thead>
                <tr>
                  <th colSpan={7} className="border-b border-r-2 border-[#4a4f5d] border-r-[#5e616b] bg-[#801c1c] px-2 py-2 text-center text-[10px] font-bold uppercase tracking-widest text-white">CALL OPTIONS</th>
                  <th className="border-b border-r-2 border-[#4a4f5d] border-r-[#5e616b] bg-[#1a5f7a] px-2 py-2 text-center text-[10px] font-bold text-white">Strike</th>
                  <th colSpan={7} className="border-b border-[#4a4f5d] bg-[#1b5e20] px-2 py-2 text-center text-[10px] font-bold uppercase tracking-widest text-white">PUT OPTIONS</th>
                </tr>
                <tr className="border-b border-[#4a4f5d] bg-[#1b1c22] text-[9px] font-black uppercase tracking-wider text-[#8899a6]">
                  <th className="w-[112px] border-r border-[#4a4f5d] px-1.5 py-2 text-center">Interpret Signal</th>
                  <th className="w-[62px] border-r border-[#4a4f5d] px-1 py-2 text-center">IV/delta</th>
                  <th className="w-[78px] border-r border-[#4a4f5d] px-1.5 py-2 text-center">OI Chg</th>
                  <th className="w-[78px] border-r border-[#4a4f5d] px-1.5 py-2 text-center">OI</th>
                  <th className="w-[82px] border-r border-[#4a4f5d] px-1.5 py-2 text-center">Volume</th>
                  <th className="w-[80px] border-r border-[#4a4f5d] px-1 py-2 text-center">LTP (TV)</th>
                  <th className="w-[72px] border-r-2 border-[#5e616b] px-1 py-2 text-center">R.Level</th>
                  <th className="w-[84px] border-r-2 border-[#5e616b] bg-[#12223c] px-1 py-2 text-center text-[#5aaabb]">
                    <div>Strike</div><div className="text-[8px] text-[#4a6b8a]">PCR OI/OIC</div>
                  </th>
                  <th className="w-[72px] border-r border-[#4a4f5d] px-1 py-2 text-center">S.Level</th>
                  <th className="w-[80px] border-r border-[#4a4f5d] px-1 py-2 text-center">LTP (TV)</th>
                  <th className="w-[82px] border-r border-[#4a4f5d] px-1.5 py-2 text-center">Volume</th>
                  <th className="w-[78px] border-r border-[#4a4f5d] px-1.5 py-2 text-center">OI</th>
                  <th className="w-[78px] border-r border-[#4a4f5d] px-1.5 py-2 text-center">OI Chg</th>
                  <th className="w-[62px] border-r border-[#4a4f5d] px-1 py-2 text-center">IV/delta</th>
                  <th className="w-[112px] px-1.5 py-2 text-center">Interpret Signal</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={15} className="bg-[#111215] py-12 text-center text-[12px] font-extrabold text-[#6b82a0]">
                    <div className="flex flex-col items-center gap-2">
                      <span className="h-2.5 w-2.5 animate-ping rounded-full bg-[#00e5a0]" />
                      <span>Connecting to live option chain feed…</span>
                    </div>
                  </td></tr>
                ) : rows.map((r, i) => {
                  const nextRow = rows[i + 1];
                  const showSpot = !!nextRow && (r.strike - spot) * (nextRow.strike - spot) < 0;
                  const dist = Math.abs(r.strike - atm) / interval;
                  const ceLtp = r.ce?.ltp ?? 0, peLtp = r.pe?.ltp ?? 0;
                  const ceTV = Math.max(0, ceLtp - Math.max(0, spot - r.strike));
                  const peTV = Math.max(0, peLtp - Math.max(0, r.strike - spot));
                  const rLevel = r.strike + ceTV;
                  const sLevel = r.strike - peTV;
                  const ceBuild = getBuildup(r.ce?.oiChgPct ?? 0, idxChg, (r.ce?.volume ?? 0) / maxCeVol);
                  const peBuild = getBuildup(r.pe?.oiChgPct ?? 0, -idxChg, (r.pe?.volume ?? 0) / maxPeVol);
                  const cDelta = Math.max(0.01, Math.min(0.99, 0.5 - dist * 0.08 + (r.strike < spot ? 0.25 : 0)));
                  const pDelta = Math.max(0.01, Math.min(0.99, 0.5 - dist * 0.08 + (r.strike > spot ? 0.25 : 0)));
                  const pcrOIC = Math.abs(r.ce?.oiChg ?? 0) ? Math.abs(r.pe?.oiChg ?? 0) / Math.abs(r.ce?.oiChg ?? 1) : 0;
                  const isATM = r.strike === atm;
                  const isCallITM = r.strike < spot;
                  const isPutITM = r.strike > spot;
                  const ceBg = isCallITM ? "bg-[#1b1c21]" : "bg-[#111215]";
                  const peBg = isPutITM ? "bg-[#1b1c21]" : "bg-[#111215]";
                  const strikeBg = isATM ? "bg-[#142d54]" : "bg-[#151f32]";
                  return (
                    <Fragment key={r.strike}>
                    <tr className="border-b border-[#31333c] transition-colors hover:bg-[#1f2230]/40">
                      <td className={`border-r border-[#31333c] px-1 py-1 text-center ${ceBg}`}><BuildupBadge b={ceBuild} /></td>
                      <td className={`border-r border-[#31333c] px-1 py-1 text-center ${ceBg}`}><IVCell iv={r.ce?.iv ?? 0} delta={cDelta} /></td>
                      <td className={`border-r border-[#31333c] px-0.5 py-1 text-center ${ceBg}`}><HighlightCell status={callOIChgStatuses[r.strike]} abs={r.ce?.oiChg ?? 0} isOIChg /></td>
                      <td className={`border-r border-[#31333c] px-0.5 py-1 text-center ${ceBg}`}><HighlightCell status={callOIStatuses[r.strike]} abs={r.ce?.oi ?? 0} /></td>
                      <td className={`border-r border-[#31333c] px-0.5 py-1 text-center ${ceBg}`}><HighlightCell status={callVolStatuses[r.strike]} abs={r.ce?.volume ?? 0} /></td>
                      <td className={`border-r border-[#31333c] px-1 py-1 text-center ${ceBg}`}><LTPCell ltp={ceLtp} tv={ceTV} /></td>
                      <td className={`border-r-2 border-[#5e616b] px-1 py-1 text-center ${ceBg}`}><span className="text-[10px] font-extrabold text-white">{rLevel.toFixed(2)}</span></td>

                      <td className={`border-x-2 border-[#5e616b] px-2 py-1 text-center ${strikeBg}`}>
                        <div className="flex flex-col items-center">
                          <span className={`text-[15px] font-black ${isATM ? "text-[#fdd835]" : "text-white"}`}>{r.strike}</span>
                          <span className="text-[9px] font-semibold text-[#5aaabb]">{r.pcr.toFixed(2)}/{pcrOIC.toFixed(2)}</span>
                        </div>
                      </td>

                      <td className={`border-r border-[#31333c] px-1 py-1 text-center ${peBg}`}><span className="text-[10px] font-extrabold text-white">{sLevel.toFixed(2)}</span></td>
                      <td className={`border-r border-[#31333c] px-1 py-1 text-center ${peBg}`}><LTPCell ltp={peLtp} tv={peTV} /></td>
                      <td className={`border-r border-[#31333c] px-0.5 py-1 text-center ${peBg}`}><HighlightCell status={putVolStatuses[r.strike]} abs={r.pe?.volume ?? 0} /></td>
                      <td className={`border-r border-[#31333c] px-0.5 py-1 text-center ${peBg}`}><HighlightCell status={putOIStatuses[r.strike]} abs={r.pe?.oi ?? 0} /></td>
                      <td className={`border-r border-[#31333c] px-0.5 py-1 text-center ${peBg}`}><HighlightCell status={putOIChgStatuses[r.strike]} abs={r.pe?.oiChg ?? 0} isOIChg /></td>
                      <td className={`border-r border-[#31333c] px-1 py-1 text-center ${peBg}`}><IVCell iv={r.pe?.iv ?? 0} delta={pDelta} /></td>
                      <td className={`px-1 py-1 text-center ${peBg}`}><BuildupBadge b={peBuild} /></td>
                    </tr>
                    {showSpot && (
                      <tr>
                        <td colSpan={15} className="border-y border-[#1b5e20] bg-[#0b1220] px-3 py-1">
                          <div className="flex items-center justify-between gap-3 text-[10px] font-semibold">
                            {/* CALL SIDE — left */}
                            <div className="flex items-center gap-3">
                              <span className="font-black tracking-wide text-[#e05a5a]">CALL SIDE</span>
                              <LvlItem label="Risky" val={callRisky} />
                              <LvlItem label="Moderate" val={callModerate} />
                              <LvlItem label="Max Pain" val={maxPain} />
                              <LvlItem label="Max Gain" val={maxGainCall} />
                            </div>
                            {/* CENTER — L / Spot / H */}
                            <div className="flex shrink-0 items-center gap-3 whitespace-nowrap text-[11.5px] font-bold">
                              <span className="text-[#8899a6]">L:</span>
                              <span className="font-black text-[#ff4a4a]">{fmt(dayLow)}</span>
                              <span className="rounded-full bg-[#007fff] px-3 py-0.5 text-[12px] font-extrabold tracking-wide text-white">{fmt(spot)}</span>
                              <span className="text-[#8899a6]">H:</span>
                              <span className="font-black text-[#00e5a0]">{fmt(dayHigh)}</span>
                            </div>
                            {/* PUT SIDE — right */}
                            <div className="flex items-center gap-3">
                              <LvlItem label="Risky" val={putRisky} />
                              <LvlItem label="Moderate" val={putModerate} />
                              <LvlItem label="Max Pain" val={maxPain} />
                              <LvlItem label="Max Gain" val={maxGainPut} />
                              <span className="font-black tracking-wide text-[#5ae05a]">PUT SIDE</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[9px] text-[#5a7a8a]">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#15803d]" /> Bullish buildup</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#b91c1c]" /> Bearish buildup</span>
          <span className="text-[#6b7280]">(dark = strong · light = weak)</span>
          <span className="flex items-center gap-1"><span className="rounded bg-[#5e35b1] px-1 text-[8px] font-bold text-white">DF</span> OI wall</span>
          <span className="flex items-center gap-1"><span className="rounded bg-[#d32f2f] px-1 text-[8px] font-bold text-white">WTT/WTB</span> wall shifting up/down</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#ffd700]" /> high concentration</span>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {statCards.map((s) => (
            <div key={s.label} className="rounded-xl border border-[#1a2a3a] bg-[#080d18] p-3 text-center">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-[#3a5a6a]">{s.label}</div>
              <div className="text-[15px] font-extrabold" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* R1/R2 · S1/S2 (shifted below, S/R-card polish) */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="overflow-hidden rounded-xl border border-[#1a2a3a] bg-[#080d18]">
            <div className="bg-[#3a0a0a] px-4 py-2 text-center text-[11px] font-bold uppercase tracking-widest text-[#ffaaaa]">Resistance (Call OI)</div>
            {resLevels.map((l, i) => (
              <div key={l.strike + "-" + i} className="flex items-center justify-between border-b border-[#1a2a3a] px-4 py-3 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-[#3a0a0a] px-1.5 py-0.5 text-[10px] font-bold text-[#e05a5a]">R{i + 1}</span>
                  <span className="text-[13px] font-extrabold text-white">{l.strike.toLocaleString("en-IN")}</span>
                  <span className="text-[9px] uppercase tracking-wide text-[#4a6070]">{l.basis}</span>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-[10px] text-[#8aaabb]">OI: <span className="font-bold text-[#c0d8e8]">{fmtVal(l.oi)}</span></span>
                  <span className={`text-[9px] ${l.oiChg >= 0 ? "text-[#5ae05a]" : "text-[#e05a5a]"}`}>Chg: {l.oiChg >= 0 ? "+" : ""}{fmtVal(l.oiChg)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-xl border border-[#1a2a3a] bg-[#080d18]">
            <div className="bg-[#0a3a0a] px-4 py-2 text-center text-[11px] font-bold uppercase tracking-widest text-[#aaffaa]">Support (Put OI)</div>
            {supLevels.map((l, i) => (
              <div key={l.strike + "-" + i} className="flex items-center justify-between border-b border-[#1a2a3a] px-4 py-3 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-[#0a3a0a] px-1.5 py-0.5 text-[10px] font-bold text-[#5ae05a]">S{i + 1}</span>
                  <span className="text-[13px] font-extrabold text-white">{l.strike.toLocaleString("en-IN")}</span>
                  <span className="text-[9px] uppercase tracking-wide text-[#4a6070]">{l.basis}</span>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-[10px] text-[#8aaabb]">OI: <span className="font-bold text-[#c0d8e8]">{fmtVal(l.oi)}</span></span>
                  <span className={`text-[9px] ${l.oiChg >= 0 ? "text-[#5ae05a]" : "text-[#e05a5a]"}`}>Chg: {l.oiChg >= 0 ? "+" : ""}{fmtVal(l.oiChg)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {!oc.isEod && (
          <div className="pb-2 text-center text-[11px] text-[#3a5070]">Auto-refresh 10s · {statusTxt === "Live" ? "live market data" : "latest available data"}</div>
        )}
      </div>
    </DashboardShell>
  );
}
