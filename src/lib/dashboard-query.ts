import { queryOptions, keepPreviousData } from "@tanstack/react-query";
import {
  getDashboard,
  getQuotes,
  getIndexConstituents,
  getIndexContributions,
  getSectorDetail,
  getIntradayBooster,
} from "./market.functions";
import {
  getFnoStocks,
  getOptionChain,
  getCachedOptionChain,
  getFnoScreener,
} from "./nse.functions";
import { getCandles, getCepeVolHistory, getEodOiSnapshot } from "./chart.functions";
import {
  getIndexContributionHistory,
  type IndexContributionKey,
} from "./index-contribution.functions";
import { getParticipantActivity } from "./participant.functions";
import { isMarketOpenIst, msUntilNextMarketOpenIst } from "./market-hours";

const liveInterval =
  (msOpen: number, msClosed = 60_000) =>
  () =>
    isMarketOpenIst()
      ? msOpen
      : Math.max(msClosed, Math.min(msUntilNextMarketOpenIst(), 30 * 60_000));

export const dashboardQuery = queryOptions({
  queryKey: ["dashboard"],
  queryFn: () => getDashboard(),
  refetchInterval: liveInterval(10_000),
  staleTime: 5_000,
});

export const participantActivityQuery = queryOptions({
  queryKey: ["participant-activity"],
  queryFn: () => getParticipantActivity(),
  // Official EOD report — no fast polling; refresh hourly.
  refetchInterval: 60 * 60_000,
  staleTime: 30 * 60_000,
});

export const quotesQuery = (symbols: string[]) =>
  queryOptions({
    queryKey: ["quotes", symbols.join(",")],
    queryFn: () => getQuotes({ data: { symbols } }),
    refetchInterval: liveInterval(10_000),
    staleTime: 5_000,
  });

export const constituentsQuery = (index: "nifty" | "banknifty" | "sensex") =>
  queryOptions({
    queryKey: ["constituents", index],
    queryFn: () => getIndexConstituents({ data: { index } }),
    refetchInterval: liveInterval(15_000),
    staleTime: 8_000,
  });

export const indexContributionsQuery = (index: "nifty" | "banknifty" | "sensex") =>
  queryOptions({
    queryKey: ["index-contributions", index],
    queryFn: () => getIndexContributions({ data: { index } }),
    refetchInterval: liveInterval(15_000),
    staleTime: 8_000,
  });

export const indexContributionHistoryQuery = (index: IndexContributionKey) =>
  queryOptions({
    queryKey: ["index-contribution-history", index],
    queryFn: () => getIndexContributionHistory({ data: { index } }),
    refetchInterval: liveInterval(30_000, 5 * 60_000),
    staleTime: 20_000,
  });

export const sectorDetailQuery = (key: string) =>
  queryOptions({
    queryKey: ["sector", key],
    queryFn: () => getSectorDetail({ data: { key } }),
    refetchInterval: liveInterval(15_000),
    staleTime: 8_000,
  });

export const fnoStocksQuery = queryOptions({
  queryKey: ["fno-stocks"],
  queryFn: () => getFnoStocks(),
  refetchInterval: liveInterval(15_000),
  staleTime: 8_000,
});

export const candlesQuery = (symbol: string, tf: string) =>
  queryOptions({
    queryKey: ["candles", symbol, tf],
    queryFn: () => getCandles({ data: { symbol, tf } }),
    placeholderData: keepPreviousData,
    refetchInterval: liveInterval(20_000),
    staleTime: 10_000,
  });

export const cepeVolQuery = (symbol: string, date?: string) =>
  queryOptions({
    queryKey: ["cepe-vol", symbol, date ?? "today"],
    queryFn: () => getCepeVolHistory({ data: { symbol, date } }),
    refetchInterval: liveInterval(60_000),
    staleTime: 30_000,
  });

export const eodOiSnapshotQuery = (symbol: string, date?: string) =>
  queryOptions({
    queryKey: ["eod-oi-snapshot", symbol, date ?? "today"],
    queryFn: () => getEodOiSnapshot({ data: { symbol, date } }),
    // Refresh once every 2 min when open (new snapshots saved), hourly when closed
    refetchInterval: liveInterval(120_000, 60 * 60_000),
    staleTime: 60_000,
  });
export const intradayBoosterQuery = queryOptions({
  queryKey: ["intraday-booster"],
  queryFn: () => getIntradayBooster(),
  refetchInterval: liveInterval(20_000),
  staleTime: 10_000,
});
export const fnoScreenerQuery = queryOptions({
  queryKey: ["fno-screener"],
  queryFn: () => getFnoScreener(),
  refetchInterval: liveInterval(15_000),
  staleTime: 8_000,
});
export const optionChainQuery = (symbol: string, spot?: number, expiry?: string) =>
  queryOptions({
    queryKey: ["option-chain", symbol, spot ?? 0, expiry ?? ""],
    queryFn: () => getOptionChain({ data: { symbol, spot, expiry } }),
    refetchInterval: liveInterval(10_000),
    staleTime: 5_000,
  });

export const cachedOptionChainQuery = (symbol: string, expiry?: string) =>
  queryOptions({
    queryKey: ["cached-option-chain", symbol, expiry ?? ""],
    queryFn: () => getCachedOptionChain({ data: { symbol, expiry } }),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

/**
 * Query historical option-chain data for a specific date or date range.
 * Returns array of historical snapshots with metadata.
 */
export const historicalOptionQuery = (
  symbol: string,
  date: string,
  expiry?: string,
  interval?: number,
) =>
  queryOptions({
    queryKey: ["historical-option", symbol, date, expiry ?? "", interval ?? 0],
    queryFn: async () => {
      const params = new URLSearchParams({
        symbol,
        date,
        ...(expiry && { expiry }),
        ...(interval && interval > 0 && { interval: String(interval) }),
      });
      const res = await fetch(`/api/option-history?${params}`);
      if (!res.ok) throw new Error(`Historical option fetch failed: ${res.status}`);
      return await res.json();
    },
    staleTime: 5 * 60_000, // Historical data is stable, cache for 5 minutes
    gcTime: 30 * 60_000,
    retry: 1,
  });

/**
 * Query historical OI activity (strike-level detail) for a specific date.
 * Returns array of strike-level OI rows with metadata.
 */
export const historicalOiActivityQuery = (
  symbol: string,
  date: string,
  expiry?: string,
  interval?: number,
) =>
  queryOptions({
    queryKey: ["historical-oi-activity", symbol, date, expiry ?? "", interval ?? 0],
    queryFn: async () => {
      const params = new URLSearchParams({
        symbol,
        date,
        ...(expiry && { expiry }),
        ...(interval && interval > 0 && { interval: String(interval) }),
      });
      const res = await fetch(`/api/oi-history?${params}`);
      if (!res.ok) throw new Error(`Historical OI fetch failed: ${res.status}`);
      return await res.json();
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });
