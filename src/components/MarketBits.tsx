import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { Quote } from "@/lib/market.functions";
import { isMarketOpenIst } from "@/lib/market-hours";
import { TickingNumber } from "./TickingNumber";

export function fmt(n: number | null | undefined, d = 2) {
  if (n === null || n === undefined || typeof n !== "number" || !isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function ChangePill({ pct, change }: { pct: number; change?: number }) {
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${
        up
          ? "bg-[var(--bull)]/15 text-[var(--bull)]"
          : "bg-[var(--bear)]/15 text-[var(--bear)]"
      }`}
    >
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {change !== undefined && <span>{up ? "+" : ""}{fmt(change)}</span>}
      <span>({up ? "+" : ""}{fmt(pct)}%)</span>
    </span>
  );
}

function useMarketOpenStatus() {
  const [open, setOpen] = useState(() => isMarketOpenIst());
  useEffect(() => {
    const id = setInterval(() => setOpen(isMarketOpenIst()), 30_000);
    return () => clearInterval(id);
  }, []);
  return open;
}

export function IndexHeroCard({ q, label }: { q: Quote; label: string }) {
  const up = q.changePct >= 0;
  const marketOpen = useMarketOpenStatus();
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6">
      <div
        className={`pointer-events-none absolute inset-0 opacity-20 ${
          up
            ? "bg-[radial-gradient(circle_at_top_right,var(--bull),transparent_60%)]"
            : "bg-[radial-gradient(circle_at_top_right,var(--bear),transparent_60%)]"
        }`}
      />
      <div className="relative">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              {label} {marketOpen ? "LIVE" : "LAST PRICE"}
            </div>
            <div className="mt-1 font-mono text-4xl font-bold tabular-nums">
              <TickingNumber value={q.price} />
            </div>
            <div className="mt-2">
              <ChangePill pct={q.changePct} change={q.change} />
            </div>
          </div>
          <div className="rounded-md border border-border bg-background/40 px-2 py-1 text-[10px] uppercase tracking-wider">
            {marketOpen ? (
              <span className="text-[var(--bull)] animate-pulse">● LIVE</span>
            ) : (
              <span className="text-muted-foreground">● Market Closed</span>
            )}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-4 gap-3 text-xs">
          {[
            ["Open", q.open],
            ["High", q.dayHigh],
            ["Low", q.dayLow],
            ["Prev Close", q.prevClose],
          ].map(([l, v]) => (
            <div key={l as string} className="rounded-lg bg-background/40 p-3">
              <div className="text-muted-foreground">{l as string}</div>
              <div className="mt-1 font-mono font-semibold">{fmt(v as number)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "bull" | "bear" | "neutral";
}) {
  const color =
    tone === "bull"
      ? "text-[var(--bull)]"
      : tone === "bear"
        ? "text-[var(--bear)]"
        : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-2 font-mono text-3xl font-bold ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function StockRow({ q, max }: { q: Quote; max: number }) {
  const up = q.changePct >= 0;
  const pctW = Math.min(100, (Math.abs(q.changePct) / max) * 100);
  const short = q.symbol.replace(".NS", "").replace(".BO", "");
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-24 truncate text-sm font-semibold">{short}</div>
      <div className="flex-1">
        <div className="h-2 w-full overflow-hidden rounded-full bg-background/60">
          <div
            className={`h-full ${up ? "bg-[var(--bull)]" : "bg-[var(--bear)]"}`}
            style={{ width: `${pctW}%` }}
          />
        </div>
      </div>
      <div className="w-20 text-right font-mono text-xs tabular-nums">{fmt(q.price)}</div>
      <div className="w-20 text-right">
        <ChangePill pct={q.changePct} />
      </div>
    </div>
  );
}

export function SectorTile({ name, pct }: { name: string; pct: number }) {
  const up = pct >= 0;
  const intensity = Math.min(1, Math.abs(pct) / 2.5);
  const bg = up
    ? `color-mix(in oklab, var(--bull) ${20 + intensity * 50}%, transparent)`
    : `color-mix(in oklab, var(--bear) ${20 + intensity * 50}%, transparent)`;
  return (
    <div
      className="flex flex-col justify-between rounded-xl border border-border p-4"
      style={{ background: bg }}
    >
      <div className="text-sm font-semibold">{name}</div>
      <div className="mt-3 flex items-end justify-between">
        <div className={`font-mono text-xl font-bold ${up ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
          {up ? "+" : ""}{fmt(pct)}%
        </div>
      </div>
    </div>
  );
}
