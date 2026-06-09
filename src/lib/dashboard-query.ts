import { queryOptions } from "@tanstack/react-query";
import { getDashboard, getQuotes, getIndexConstituents, getSectorDetail } from "./market.functions";
import { getFnoStocks, getOptionChain } from "./nse.functions";

export const dashboardQuery = queryOptions({
  queryKey: ["dashboard"],
  queryFn: () => getDashboard(),
  refetchInterval: 30_000,
  staleTime: 15_000,
});

export const quotesQuery = (symbols: string[]) =>
  queryOptions({
    queryKey: ["quotes", symbols.join(",")],
    queryFn: () => getQuotes({ data: { symbols } }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

export const constituentsQuery = (index: "nifty" | "banknifty" | "sensex") =>
  queryOptions({
    queryKey: ["constituents", index],
    queryFn: () => getIndexConstituents({ data: { index } }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

export const sectorDetailQuery = (key: string) =>
  queryOptions({
    queryKey: ["sector", key],
    queryFn: () => getSectorDetail({ data: { key } }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

export const fnoStocksQuery = queryOptions({
  queryKey: ["fno-stocks"],
  queryFn: () => getFnoStocks(),
  refetchInterval: 45_000,
  staleTime: 20_000,
});

export const optionChainQuery = (symbol: string, spot?: number) =>
  queryOptions({
    queryKey: ["option-chain", symbol, spot ?? 0],
    queryFn: () => getOptionChain({ data: { symbol, spot } }),
    refetchInterval: 45_000,
    staleTime: 20_000,
  });
