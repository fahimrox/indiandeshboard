import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { constituentsQuery } from "@/lib/dashboard-query";

type IndexKey = "nifty" | "banknifty" | "sensex";

// Canonical index membership sizes (index definitions, not market data):
// NIFTY 50 = 50 stocks, BANK NIFTY = 12 stocks, SENSEX = 30 stocks.
// The constituents query only returns quotes that actually resolved, so the
// displayed total must come from these canonical sizes — never from the count
// of successfully quoted stocks (which would understate the true index size).
const INDEX_META: Record<IndexKey, { label: string; total: number }> = {
  nifty: { label: "NIFTY 50", total: 50 },
  banknifty: { label: "BANK NIFTY", total: 12 },
  sensex: { label: "SENSEX", total: 30 },
};

function BreadthBlockSkeleton({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="text-xs uppercase tracking-widest text-muted-foreground">{label}</h3>
      <div className="mt-4 space-y-3 animate-pulse">
        <div className="h-8 w-full rounded-md bg-background/40" />
        <div className="h-8 w-full rounded-md bg-background/40" />
      </div>
    </div>
  );
}

function BreadthBlockError({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="text-xs uppercase tracking-widest text-muted-foreground">{label}</h3>
      <div className="mt-4 rounded-lg border border-[var(--bear)]/30 bg-[var(--bear)]/5 p-4 text-sm text-muted-foreground" role="alert">
        Data unavailable for {label} right now.
      </div>
    </div>
  );
}

function BreadthBlock({ index }: { index: IndexKey }) {
  const { label, total } = INDEX_META[index];
  const { data, isLoading, isError, isFetching } = useQuery({
    ...constituentsQuery(index),
    placeholderData: keepPreviousData,
  });

  if (isLoading) return <BreadthBlockSkeleton label={label} />;
  if (isError || !data) return <BreadthBlockError label={label} />;

  const { advance, decline, unchanged, stocks } = data;
  // Resolved = constituents we actually have quotes for. advance/decline/
  // unchanged are computed only from these. Missing = canonical index size
  // minus resolved (constituents with no live quote right now).
  const resolved = stocks.length || advance + decline + unchanged;
  const missing = Math.max(0, total - resolved);
  // Percentages/bars reflect breadth among resolved constituents (the sample
  // we actually have data for), so they stay meaningful when some are missing.
  const base = Math.max(1, resolved);
  const advPct = (advance / base) * 100;
  const decPct = (decline / base) * 100;
  const maxPct = Math.max(advPct, decPct, 1);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">{label}</h3>
        <div className="flex items-center gap-2">
          {isFetching && (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--neon)]" />
          )}
          <span className="text-[10px] text-muted-foreground">{total} constituents</span>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {/* Advances bar */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-semibold text-[var(--bull)]">Advances</span>
            <span className="font-mono font-bold text-[var(--bull)]">
              {advance} <span className="text-muted-foreground">({advPct.toFixed(0)}%)</span>
            </span>
          </div>
          <div className="h-8 w-full overflow-hidden rounded-md bg-background/40">
            <div
              className="h-full rounded-md bg-[var(--bull)] transition-all duration-500"
              style={{ width: `${(advPct / maxPct) * 100}%` }}
            />
          </div>
        </div>

        {/* Declines bar */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-semibold text-[var(--bear)]">Declines</span>
            <span className="font-mono font-bold text-[var(--bear)]">
              {decline} <span className="text-muted-foreground">({decPct.toFixed(0)}%)</span>
            </span>
          </div>
          <div className="h-8 w-full overflow-hidden rounded-md bg-background/40">
            <div
              className="h-full rounded-md bg-[var(--bear)] transition-all duration-500"
              style={{ width: `${(decPct / maxPct) * 100}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>{unchanged} unchanged</span>
        <span className="text-right font-medium text-foreground/70">{total} total</span>
        {missing > 0 ? (
          <>
            <span className="text-amber-400/80">{missing} missing</span>
            <span className="text-right">{resolved} resolved</span>
          </>
        ) : (
          <span className="col-span-2">{resolved} resolved</span>
        )}
      </div>
    </div>
  );
}

export function IndexBreadthBars() {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      <BreadthBlock index="nifty" />
      <BreadthBlock index="banknifty" />
      <BreadthBlock index="sensex" />
    </div>
  );
}
