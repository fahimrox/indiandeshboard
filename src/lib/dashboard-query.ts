import { queryOptions } from "@tanstack/react-query";
import { getDashboard, getQuotes } from "./market.functions";

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
