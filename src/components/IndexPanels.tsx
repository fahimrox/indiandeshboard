import { fmt } from "./MarketBits";
import type { ContributorRow } from "@/lib/market.functions";

// ─── Market Breadth card (Bulls vs Bears) + per-index sentiment lines ─────────
function breadthNarrative(label: string, advance: number, decline: number, bullsPct: number, changePct: number): string[] {
  const total = advance + decline;
  const lines: string[] = [];

  // Line 1 — raw breadth
  const breadthWord = bullsPct >= 60 ? "strongly positive" : bullsPct >= 52 ? "positive" : bullsPct <= 40 ? "weak" : bullsPct <= 48 ? "negative" : "balanced";
  lines.push(
    `Breadth is ${breadthWord}: ${advance} of ${total} constituents advancing (${bullsPct.toFixed(1)}% bulls / ${(100 - bullsPct).toFixed(1)}% bears).`
  );

  // Line 2 — index sentiment vs breadth (detect divergence)
  const dir = changePct >= 0.05 ? "up" : changePct <= -0.05 ? "down" : "flat";
  if (dir === "up" && bullsPct >= 55) {
    lines.push(`${label} is trending up with broad participation — a healthy, bullish tape.`);
  } else if (dir === "up" && bullsPct < 50) {
    lines.push(`${label} is up while most stocks lag — a narrow, heavyweight-led rally; stay selective.`);
  } else if (dir === "down" && bullsPct <= 45) {
    lines.push(`${label} is under pressure with weak internals — a broad-based, bearish tone.`);
  } else if (dir === "down" && bullsPct > 50) {
    lines.push(`${label} is down even as most stocks hold up — index dragged by a few heavyweights.`);
  } else {
    lines.push(`${label} is range-bound with balanced internals — no clear directional edge yet.`);
  }

  // Line 3 — actionable read
  const tilt = bullsPct >= 55 && changePct >= 0 ? "buy-on-dips" : bullsPct <= 45 && changePct <= 0 ? "sell-on-rise" : "two-way / wait-for-trigger";
  lines.push(`Bias: ${changePct >= 0 ? "+" : ""}${fmt(changePct)}% on the index — favouring a ${tilt} approach.`);

  return lines;
}

export function IndexBreadthCard({
  label,
  advance,
  decline,
  changePct,
}: {
  label: string;
  advance: number;
  decline: number;
  changePct: number;
}) {
  const total = advance + decline;
  const bullsPct = total > 0 ? (advance / total) * 100 : 50;
  const bearsPct = 100 - bullsPct;
  const lines = breadthNarrative(label, advance, decline, bullsPct, changePct);

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">Market Breadth</div>
      <div className="mt-0.5 text-base font-bold">Bulls vs Bears</div>

      <div className="mt-2.5 flex items-center justify-between text-xs font-bold">
        <span className="text-[var(--bull)]">BULLS {bullsPct.toFixed(1)}%</span>
        <span className="text-[var(--bear)]">BEARS {bearsPct.toFixed(1)}%</span>
      </div>
      <div className="mt-1.5 flex h-2.5 w-full gap-0.5">
        <div className="h-full rounded-l-full bg-[var(--bull)]" style={{ width: `${bullsPct}%`, transition: "width 500ms ease" }} />
        <div className="h-full rounded-r-full bg-[var(--bear)]" style={{ width: `${bearsPct}%`, transition: "width 500ms ease" }} />
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <div className="rounded-xl border border-[var(--bull)]/25 bg-[var(--bull)]/10 p-2">
          <div className="text-xs text-muted-foreground">Advances</div>
          <div className="mt-0.5 font-mono text-2xl font-bold text-[var(--bull)]">{advance}</div>
        </div>
        <div className="rounded-xl border border-[var(--bear)]/25 bg-[var(--bear)]/10 p-2">
          <div className="text-xs text-muted-foreground">Declines</div>
          <div className="mt-0.5 font-mono text-2xl font-bold text-[var(--bear)]">{decline}</div>
        </div>
      </div>

      <div className="mt-2.5 space-y-1 border-t border-border/60 pt-2.5">
        {lines.map((l, i) => (
          <p key={i} className="text-xs leading-snug text-muted-foreground">{l}</p>
        ))}
      </div>
    </div>
  );
}

// ─── 3-table Contribution panel: Positive | Points Contribution | Negative ────
// Layout mirrors the reference (3 cards). Middle card uses a centre-diverging
// green/red bar with the contribution % inside; side cards are plain
// Symbol/Price/Chg% lists. Bigger bold fonts, no scrollbars — the tables extend
// full-length downward.
export function IndexContributionPanel({
  positive,
  negative,
}: {
  positive: ContributorRow[];
  negative: ContributorRow[];
}) {
  const totalPosPoints = positive.reduce((s, r) => s + r.contributionPoints, 0);
  const totalNegPoints = negative.reduce((s, r) => s + r.contributionPoints, 0);

  const SideTable = ({ rows, title, tone }: { rows: ContributorRow[]; title: string; tone: "bull" | "bear" }) => {
    const color = tone === "bull" ? "var(--bull)" : "var(--bear)";
    return (
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <h3 className="text-sm font-bold" style={{ color }}>{title}</h3>
          <span className="rounded-md px-2 py-0.5 text-xs font-bold tabular-nums" style={{ color, background: `${color}1a` }}>
            {rows.length}
          </span>
        </div>
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-background/20 text-[11px] uppercase tracking-wider text-muted-foreground">
          <span>Symbol</span>
          <div className="flex items-center gap-4">
            <span className="w-20 text-right">Price</span>
            <span className="w-16 text-right">Chg%</span>
          </div>
        </div>
        <div>
          {rows.map((r) => (
            <div key={r.symbol} className="flex items-center justify-between px-4 py-2 border-b border-border/25 hover:bg-background/30">
              <span className="truncate text-sm font-bold text-foreground">{r.symbol}</span>
              <div className="flex items-center gap-4 font-mono tabular-nums">
                <span className="w-20 text-right text-sm text-muted-foreground">{fmt(r.price, 2)}</span>
                <span className={`w-16 text-right text-sm font-bold ${r.changePct >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                  {r.changePct >= 0 ? "+" : ""}{fmt(r.changePct, 2)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const posSorted = [...positive].sort((a, b) => b.contributionPct - a.contributionPct);
  const negSorted = [...negative].sort((a, b) => Math.abs(b.contributionPct) - Math.abs(a.contributionPct));
  const count = Math.max(posSorted.length, negSorted.length);
  const pairs: { pos: ContributorRow | null; neg: ContributorRow | null }[] = [];
  for (let i = 0; i < count; i++) pairs.push({ pos: posSorted[i] ?? null, neg: negSorted[i] ?? null });
  const maxPosPct = Math.max(0.01, ...positive.map((r) => r.contributionPct));
  const maxNegPct = Math.max(0.01, ...negative.map((r) => Math.abs(r.contributionPct)));

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      {/* Positive */}
      <div className="lg:col-span-3">
        <SideTable rows={positive} title="Positive Contributors" tone="bull" />
      </div>

      {/* Points Contribution — centre-diverging green/red bars */}
      <div className="lg:col-span-6">
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-1 px-4 py-2.5 border-b border-border">
            <h3 className="text-sm font-bold text-foreground">Points Contribution</h3>
            <div className="flex items-center gap-3 font-mono text-sm font-bold tabular-nums">
              <span className="text-[var(--bull)]">+{fmt(totalPosPoints, 2)}</span>
              <span className="text-[var(--bear)]">{fmt(totalNegPoints, 2)}</span>
            </div>
          </div>
          <div>
            {pairs.map((pair, i) => {
              const gp = pair.pos ? Math.min((pair.pos.contributionPct / maxPosPct) * 100, 100) : 0;
              const rp = pair.neg ? Math.min((Math.abs(pair.neg.contributionPct) / maxNegPct) * 100, 100) : 0;
              return (
                <div key={i} className="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 hover:bg-background/30">
                  {/* left labels */}
                  <div className="flex w-[112px] shrink-0 items-center justify-end gap-1.5">
                    {pair.pos && (
                      <>
                        <span className="truncate text-sm font-bold text-foreground">{pair.pos.symbol}</span>
                        <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-[var(--bull)]">
                          {fmt(pair.pos.contributionPoints, 2)}
                        </span>
                      </>
                    )}
                  </div>
                  {/* green bar (grows toward centre) */}
                  <div className="flex flex-1 justify-end">
                    {pair.pos && (
                      <div className="flex h-5 items-center justify-end rounded-sm bg-[var(--bull)] px-1.5" style={{ width: `${Math.max(gp, 6)}%`, transition: "width 500ms ease" }}>
                        <span className="text-[11px] font-bold tabular-nums text-black/80 whitespace-nowrap">{fmt(pair.pos.contributionPct, 1)}%</span>
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 w-px h-6 bg-border/60" />
                  {/* red bar (grows toward centre) */}
                  <div className="flex flex-1 justify-start">
                    {pair.neg && (
                      <div className="flex h-5 items-center rounded-sm bg-[var(--bear)] px-1.5" style={{ width: `${Math.max(rp, 6)}%`, transition: "width 500ms ease" }}>
                        <span className="text-[11px] font-bold tabular-nums text-black/80 whitespace-nowrap">{fmt(Math.abs(pair.neg.contributionPct), 1)}%</span>
                      </div>
                    )}
                  </div>
                  {/* right labels */}
                  <div className="flex w-[112px] shrink-0 items-center gap-1.5">
                    {pair.neg && (
                      <>
                        <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-[var(--bear)]">
                          {fmt(pair.neg.contributionPoints, 2)}
                        </span>
                        <span className="truncate text-sm font-bold text-foreground">{pair.neg.symbol}</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Negative */}
      <div className="lg:col-span-3">
        <SideTable rows={negative} title="Negative Contributors" tone="bear" />
      </div>
    </div>
  );
}
