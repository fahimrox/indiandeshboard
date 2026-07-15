import { useMemo, useState } from "react";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import {
  IndexContributionChart,
  type IndexContributionChartPoint,
} from "@/components/IndexContribution/IndexContributionChart";
import {
  indexContributionHistoryQuery,
  quotesQuery,
} from "@/lib/dashboard-query";
import type {
  IndexContributionHistory,
  IndexContributionKey,
} from "@/lib/index-contribution.functions";
import type { Quote } from "@/lib/market.functions";

const INDEX_OPTIONS = [
  { key: "nifty" as const, symbol: "^NSEI", label: "NIFTY 50", chartLabel: "NIFTY" },
  { key: "banknifty" as const, symbol: "^NSEBANK", label: "BANK NIFTY", chartLabel: "BANKNIFTY" },
  { key: "sensex" as const, symbol: "^BSESN", label: "SENSEX", chartLabel: "SENSEX" },
];

const PERIODS = ["Prev", "Intraday", "3m", "5m", "15m", "1h"] as const;
type Period = (typeof PERIODS)[number];

type ContributionRow = {
  rank: number;
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  contributionPct: number;
  contributionPoints: number;
};

type ContributionView = {
  chartPoints: IndexContributionChartPoint[];
  positive: ContributionRow[];
  negative: ContributionRow[];
  totalPositive: number;
  totalNegative: number;
  baselineIndex: number;
  currentIndex: number;
  indexChange: number;
  indexChangePct: number;
};

const priceFormat = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const Route = createFileRoute("/index-contribution")({
  head: () => ({
    meta: [
      { title: "Index Contribution - Live Index Movers | BazaarMood" },
      {
        name: "description",
        content:
          "Live NIFTY 50, BANK NIFTY and SENSEX contribution points calculated from real constituent prices and free-float index weights.",
      },
    ],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(
        quotesQuery(INDEX_OPTIONS.map((item) => item.symbol)),
      ),
      context.queryClient.ensureQueryData(indexContributionHistoryQuery("nifty")),
    ]),
  component: IndexContributionPage,
  errorComponent: ({ error }) => (
    <DashboardShell>
      <div className="border border-destructive/40 bg-destructive/10 p-5 text-sm text-destructive">
        {error.message}
      </div>
    </DashboardShell>
  ),
});

function baselineForPeriod(period: Period, timestamps: number[]): number {
  const lastIndex = timestamps.length - 1;
  if (period === "Prev") return 0;
  if (period === "Intraday") return Math.min(1, lastIndex);
  const minutes = period === "1h" ? 60 : Number.parseInt(period, 10);
  const cutoff = timestamps[lastIndex] - minutes * 60;
  for (let position = lastIndex; position >= 1; position -= 1) {
    if (timestamps[position] <= cutoff) return position;
  }
  return Math.min(1, lastIndex);
}

function reconcileContributions(
  actualIndexMove: number,
  rows: Array<{ symbol: string; value: number }>,
): Array<{ symbol: string; value: number }> {
  const rawTotal = rows.reduce((sum, row) => sum + row.value, 0);
  const residual = actualIndexMove - rawTotal;
  if (Math.abs(residual) < 0.0001) return rows;

  const hasResidualSign = (value: number) => (residual > 0 ? value > 0 : value < 0);
  const matchingTotal = rows.reduce(
    (sum, row) => sum + (hasResidualSign(row.value) ? Math.abs(row.value) : 0),
    0,
  );
  if (matchingTotal === 0) return rows;

  return rows.map((row) => ({
    ...row,
    value:
      row.value +
      (hasResidualSign(row.value)
        ? (Math.abs(row.value) / matchingTotal) * residual
        : 0),
  }));
}

function buildContributionView(
  data: IndexContributionHistory | undefined,
  period: Period,
): ContributionView | null {
  if (!data || data.timestamps.length < 3 || data.indexPrices.length !== data.timestamps.length) {
    return null;
  }

  const lastIndex = data.timestamps.length - 1;
  const baselineIndexPosition = baselineForPeriod(period, data.timestamps);
  const baselineIndex = data.indexPrices[baselineIndexPosition];
  const currentIndex = data.indexPrices[lastIndex];
  if (!Number.isFinite(baselineIndex) || baselineIndex <= 0) return null;

  const calculateAt = (position: number) => {
    const raw = data.stocks
      .map((stock) => {
        const baselinePrice = stock.prices[baselineIndexPosition];
        const currentPrice = stock.prices[position];
        if (
          !Number.isFinite(baselinePrice) ||
          !Number.isFinite(currentPrice) ||
          baselinePrice <= 0
        ) {
          return null;
        }
        return {
          symbol: stock.symbol,
          value:
            ((currentPrice - baselinePrice) / baselinePrice) *
            stock.weight *
            baselineIndex,
        };
      })
      .filter((row): row is { symbol: string; value: number } => row !== null);

    return reconcileContributions(data.indexPrices[position] - baselineIndex, raw);
  };

  const chartPoints: IndexContributionChartPoint[] = [];
  for (let position = 1; position <= lastIndex; position += 1) {
    const adjusted = calculateAt(position);
    let positive = 0;
    let negative = 0;
    for (const row of adjusted) {
      if (row.value >= 0) positive += row.value;
      else negative += row.value;
    }
    chartPoints.push({
      time: data.timestamps[position] * 1000,
      positive,
      negative,
      index: data.indexPrices[position],
    });
  }

  const currentBySymbol = new Map(
    calculateAt(lastIndex).map((row) => [row.symbol, row.value]),
  );
  const grossContribution = Array.from(currentBySymbol.values()).reduce(
    (sum, value) => sum + Math.abs(value),
    0,
  );

  const rows = data.stocks
    .map((stock) => {
      const baselinePrice = stock.prices[baselineIndexPosition];
      const price = stock.prices[lastIndex];
      const contributionPoints = currentBySymbol.get(stock.symbol);
      if (
        !Number.isFinite(baselinePrice) ||
        !Number.isFinite(price) ||
        baselinePrice <= 0 ||
        contributionPoints == null
      ) {
        return null;
      }
      const change = price - baselinePrice;
      const changePct = (change / baselinePrice) * 100;
      return {
        rank: 0,
        symbol: stock.symbol,
        price,
        change,
        changePct,
        contributionPct:
          grossContribution > 0
            ? (contributionPoints / grossContribution) * 100
            : 0,
        contributionPoints,
      };
    })
    .filter((row): row is ContributionRow => row !== null);

  const positive = rows
    .filter((row) => row.contributionPoints >= 0)
    .sort((left, right) => right.contributionPoints - left.contributionPoints)
    .map((row, rank) => ({ ...row, rank: rank + 1 }));
  const negative = rows
    .filter((row) => row.contributionPoints < 0)
    .sort((left, right) => left.contributionPoints - right.contributionPoints)
    .map((row, rank) => ({ ...row, rank: rank + 1 }));

  const indexChange = currentIndex - baselineIndex;
  return {
    chartPoints,
    positive,
    negative,
    totalPositive: positive.reduce((sum, row) => sum + row.contributionPoints, 0),
    totalNegative: negative.reduce((sum, row) => sum + row.contributionPoints, 0),
    baselineIndex,
    currentIndex,
    indexChange,
    indexChangePct: (indexChange / baselineIndex) * 100,
  };
}

function IndexContributionPage() {
  const [activeIndex, setActiveIndex] = useState<IndexContributionKey>("nifty");
  const [period, setPeriod] = useState<Period>("Intraday");
  const { data: indexQuotes } = useSuspenseQuery(
    quotesQuery(INDEX_OPTIONS.map((item) => item.symbol)),
  );
  const historyQuery = useSuspenseQuery(indexContributionHistoryQuery(activeIndex));
  const selectedIndex = INDEX_OPTIONS.find((item) => item.key === activeIndex) ?? INDEX_OPTIONS[0];
  const view = useMemo(
    () => buildContributionView(historyQuery.data, period),
    [historyQuery.data, period],
  );

  const quoteMap = useMemo(() => {
    const map = new Map<string, Quote>();
    for (const quote of indexQuotes) map.set(quote.symbol, quote);
    const current = historyQuery.data.indexPrices.at(-1);
    const previous = historyQuery.data.indexPrices[0];
    if (current != null && previous != null && previous > 0) {
      const existing = map.get(selectedIndex.symbol);
      map.set(selectedIndex.symbol, {
        symbol: selectedIndex.symbol,
        name: selectedIndex.label,
        price: current,
        prevClose: previous,
        change: current - previous,
        changePct: ((current - previous) / previous) * 100,
        dayHigh: existing?.dayHigh ?? current,
        dayLow: existing?.dayLow ?? current,
        open: existing?.open ?? current,
        marketState: existing?.marketState ?? "EOD",
        currency: existing?.currency ?? "INR",
        exchange: existing?.exchange ?? "Yahoo",
      });
    }
    return map;
  }, [historyQuery.data, indexQuotes, selectedIndex]);

  return (
    <DashboardShell>
      <div className="mx-auto w-full max-w-[1900px] space-y-3 font-sans">
        <div className="grid min-w-0 gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
          <IndexSelector
            activeIndex={activeIndex}
            period={period}
            quoteMap={quoteMap}
            onIndexChange={setActiveIndex}
            onPeriodChange={setPeriod}
          />

          <section className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card lg:h-[500px]">
            <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <h1 className="text-sm font-semibold tracking-tight text-foreground">
                  {selectedIndex.label} Index Contribution
                </h1>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {period === "Prev" ? "Previous close" : period} baseline · real 1-minute prices
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {view && (
                  <span className={view.indexChange >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}>
                    {view.indexChange >= 0 ? "+" : ""}{priceFormat.format(view.indexChange)} pts
                  </span>
                )}
                <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-muted-foreground/35 text-[10px]">
                  1m
                </span>
              </div>
            </div>

            <div className="relative min-h-0 flex-1 p-2 sm:p-3">
              {!view || view.chartPoints.length < 2 ? (
                <ChartState title="No chart data available" detail="No real aligned constituent history was returned." />
              ) : (
                <ClientOnly
                  fallback={(
                    <ChartState
                      title="Preparing chart"
                      detail="Initializing the interactive contribution chart."
                    />
                  )}
                >
                  <IndexContributionChart
                    points={view.chartPoints}
                    indexLabel={selectedIndex.chartLabel}
                  />
                </ClientOnly>
              )}
            </div>

            {historyQuery.data && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
                <span>
                  Source: Yahoo · Weight coverage {(historyQuery.data.coverage * 100).toFixed(1)}%
                </span>
                <span suppressHydrationWarning>
                  Weights {formatDate(historyQuery.data.weightAsOf)} · Updated {formatTimestamp(historyQuery.data.updatedAt)} IST
                </span>
              </div>
            )}
          </section>
        </div>

        {view ? (
          <ContributionTables
            positive={view.positive}
            negative={view.negative}
            totalPositive={view.totalPositive}
            totalNegative={view.totalNegative}
          />
        ) : (
          <div className="border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            Contributor tables will appear when verified price history is available.
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

function IndexSelector({
  activeIndex,
  period,
  quoteMap,
  onIndexChange,
  onPeriodChange,
}: {
  activeIndex: IndexContributionKey;
  period: Period;
  quoteMap: Map<string, Quote>;
  onIndexChange: (index: IndexContributionKey) => void;
  onPeriodChange: (period: Period) => void;
}) {
  return (
    <aside className="overflow-hidden rounded-xl border border-border bg-card lg:h-[500px]">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Index Contribution</h2>
        <div className="mt-3 grid grid-cols-6 overflow-hidden rounded-md border border-border bg-background/50">
          {PERIODS.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={period === item}
              onClick={() => onPeriodChange(item)}
              className={`min-h-8 border-r border-border px-1 text-[10px] font-semibold transition-colors last:border-r-0 ${
                period === item
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_92px_58px] border-b border-border bg-background/30 px-4 py-2 text-[11px] text-muted-foreground">
        <span>Index</span>
        <span className="text-right">Price</span>
        <span className="text-right">Chg%</span>
      </div>
      <div>
        {INDEX_OPTIONS.map((item) => {
          const quote = quoteMap.get(item.symbol);
          const changePct = quote?.changePct ?? 0;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={activeIndex === item.key}
              onClick={() => onIndexChange(item.key)}
              className={`grid w-full grid-cols-[1fr_92px_58px] items-center border-b border-border/45 px-4 py-3 text-left transition-colors ${
                activeIndex === item.key ? "bg-muted/55" : "hover:bg-muted/30"
              }`}
            >
              <span className="truncate text-xs font-semibold text-foreground">{item.label}</span>
              <span className="text-right text-xs tabular-nums text-foreground">
                {quote ? priceFormat.format(quote.price) : "--"}
              </span>
              <span
                className={`text-right text-xs font-semibold tabular-nums ${
                  changePct >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"
                }`}
              >
                {quote ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%` : "--"}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function ContributionTables({
  positive,
  negative,
  totalPositive,
  totalNegative,
}: {
  positive: ContributionRow[];
  negative: ContributionRow[];
  totalPositive: number;
  totalNegative: number;
}) {
  const pairCount = Math.max(positive.length, negative.length);
  const maxContribution = Math.max(
    0.01,
    ...positive.map((row) => Math.abs(row.contributionPoints)),
    ...negative.map((row) => Math.abs(row.contributionPoints)),
  );

  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-12">
      <div className="xl:col-span-3">
        <SideTable rows={positive} title="Positive Contributors" tone="positive" />
      </div>

      <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card xl:col-span-6">
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">Points Contribution</h2>
          <div className="flex items-center gap-3 text-sm font-semibold tabular-nums">
            <span className="text-[var(--bull)]">+{priceFormat.format(totalPositive)}</span>
            <span className="text-[var(--bear)]">{priceFormat.format(totalNegative)}</span>
          </div>
        </div>
        <div className="max-h-[510px] overflow-x-hidden overflow-y-auto [scrollbar-color:#263244_#070b11] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-corner]:bg-[#070b11] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#263244] [&::-webkit-scrollbar-track]:bg-[#070b11]">
          <div className="w-full py-1">
            {Array.from({ length: pairCount }, (_, index) => {
              const positiveRow = positive[index];
              const negativeRow = negative[index];
              const positiveWidth = positiveRow
                ? Math.max(3, (positiveRow.contributionPoints / maxContribution) * 100)
                : 0;
              const negativeWidth = negativeRow
                ? Math.max(3, (Math.abs(negativeRow.contributionPoints) / maxContribution) * 100)
                : 0;

              return (
                <div
                  key={`${positiveRow?.symbol ?? "positive"}-${negativeRow?.symbol ?? "negative"}-${index}`}
                  className="grid min-h-9 grid-cols-[minmax(88px,145px)_minmax(36px,1fr)_1px_minmax(36px,1fr)_minmax(88px,145px)] items-center gap-2 px-3 hover:bg-muted/25"
                >
                  <div className="flex min-w-0 items-center justify-end gap-2">
                    {positiveRow && (
                      <>
                        <span className="truncate text-right text-xs text-muted-foreground">{positiveRow.symbol}</span>
                        <span className="shrink-0 text-xs font-semibold text-[var(--bull)]">
                          +{priceFormat.format(positiveRow.contributionPoints)}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex justify-end">
                    {positiveRow && (
                      <div
                        className="flex h-5 items-center justify-end bg-[#37e34c] px-1.5 text-[10px] font-bold text-[#061108]"
                        style={{ width: `${positiveWidth}%` }}
                      >
                        {Math.abs(positiveRow.contributionPct).toFixed(1)}%
                      </div>
                    )}
                  </div>
                  <div className="h-7 bg-border" />
                  <div className="flex justify-start">
                    {negativeRow && (
                      <div
                        className="flex h-5 items-center bg-[#ff3046] px-1.5 text-[10px] font-bold text-white"
                        style={{ width: `${negativeWidth}%` }}
                      >
                        {Math.abs(negativeRow.contributionPct).toFixed(1)}%
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    {negativeRow && (
                      <>
                        <span className="shrink-0 text-xs font-semibold text-[var(--bear)]">
                          {priceFormat.format(negativeRow.contributionPoints)}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">{negativeRow.symbol}</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="xl:col-span-3">
        <SideTable rows={negative} title="Negative Contributors" tone="negative" />
      </div>
    </div>
  );
}

function SideTable({
  rows,
  title,
  tone,
}: {
  rows: ContributionRow[];
  title: string;
  tone: "positive" | "negative";
}) {
  const isPositive = tone === "positive";
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex min-h-11 items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className={`text-sm font-semibold ${isPositive ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
          {title}
        </h2>
        <span
          className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${
            isPositive
              ? "border-emerald-500/30 bg-emerald-500/10 text-[var(--bull)]"
              : "border-rose-500/30 bg-rose-500/10 text-[var(--bear)]"
          }`}
        >
          {rows.length}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_92px_62px] border-b border-border bg-background/30 px-4 py-2 text-[11px] text-muted-foreground">
        <span>Symbol</span>
        <span className="text-right">Price</span>
        <span className="text-right">Chg%</span>
      </div>
      <div className="max-h-[478px] overflow-y-auto [scrollbar-color:#263244_#070b11] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-corner]:bg-[#070b11] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#263244] [&::-webkit-scrollbar-track]:bg-[#070b11]">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            No {isPositive ? "positive" : "negative"} contributors
          </div>
        ) : (
          rows.map((row) => (
            <div
              key={row.symbol}
              className="grid min-h-9 grid-cols-[1fr_92px_62px] items-center border-b border-border/35 px-4 hover:bg-muted/25"
            >
              <span className="truncate text-xs font-semibold text-foreground">{row.symbol}</span>
              <span className="text-right text-xs tabular-nums text-foreground">
                {priceFormat.format(row.price)}
              </span>
              <span
                className={`text-right text-xs font-semibold tabular-nums ${
                  row.changePct >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"
                }`}
              >
                {row.changePct >= 0 ? "+" : ""}{row.changePct.toFixed(2)}%
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ChartState({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="grid h-full min-h-[380px] place-items-center px-6 text-center">
      <div className="max-w-md">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(timestamp);
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${date}T00:00:00+05:30`));
}
