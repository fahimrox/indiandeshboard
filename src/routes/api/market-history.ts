import { createFileRoute } from "@tanstack/react-router";
import {
  validateDateRange,
  parseInterval,
  getHistoricalMarketHistory,
  type HistoricalDataSource,
} from "../../lib/services/historicalDataService.server";

export const Route = createFileRoute("/api/market-history")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);

          const dateParam =
            url.searchParams.get("date");
          const startDateParam =
            url.searchParams.get("startDate");
          const endDateParam =
            url.searchParams.get("endDate");
          const intervalParam =
            url.searchParams.get("interval");

          const symbolsParam =
            url.searchParams.get("symbols") ||
            "NIFTY,BANKNIFTY,SENSEX,INDIAVIX";

          const symbols = Array.from(
            new Set(
              symbolsParam
                .split(",")
                .map((symbol) =>
                  symbol.trim().toUpperCase()
                )
                .filter(Boolean)
            )
          );

          if (symbols.length === 0) {
            return new Response(
              JSON.stringify({
                success: false,
                error:
                  "At least one valid symbol must be provided.",
              }),
              {
                status: 400,
                headers: {
                  "Content-Type": "application/json",
                },
              }
            );
          }

          const rangeResult = validateDateRange(
            startDateParam,
            endDateParam,
            dateParam
          );

          if (!rangeResult.ok) {
            return new Response(
              JSON.stringify({
                success: false,
                error: rangeResult.error,
              }),
              {
                status: 400,
                headers: {
                  "Content-Type": "application/json",
                },
              }
            );
          }

          const intervalResult =
            parseInterval(intervalParam);

          if (!intervalResult.ok) {
            return new Response(
              JSON.stringify({
                success: false,
                error: intervalResult.error,
              }),
              {
                status: 400,
                headers: {
                  "Content-Type": "application/json",
                },
              }
            );
          }

          const entries = await Promise.all(
            symbols.map(async (symbol) => {
              const result =
                await getHistoricalMarketHistory(
                  symbol,
                  rangeResult.startDate,
                  rangeResult.endDate,
                  intervalResult.minutes
                );

              return {
                symbol,
                result,
              };
            })
          );

          const data: Record<string, any[]> = {};
          const sources: Record<
            string,
            HistoricalDataSource
          > = {};
          const actualDates = new Set<string>();

          for (const entry of entries) {
            data[entry.symbol] = entry.result.data;
            sources[entry.symbol] =
              entry.result.metadata.source;

            for (
              const date of
              entry.result.metadata.actualDates
            ) {
              actualDates.add(date);
            }
          }

          const responseBody: Record<string, any> = {
            success: true,
            interval: intervalResult.minutes,
            symbols,
            data,
            sources,
          };

          if (rangeResult.isSingleDate) {
            responseBody.date =
              rangeResult.startDate;
          } else {
            responseBody.startDate =
              rangeResult.startDate;
            responseBody.endDate =
              rangeResult.endDate;
          }

          const uniqueSources = Array.from(
            new Set(Object.values(sources))
          );

          return new Response(
            JSON.stringify(responseBody),
            {
              headers: {
                "Content-Type": "application/json",
                "X-Data-Source":
                  uniqueSources.length === 1
                    ? uniqueSources[0]
                    : "mixed",
                "X-Requested-Start-Date":
                  rangeResult.startDate,
                "X-Requested-End-Date":
                  rangeResult.endDate,
                "X-Actual-Dates":
                  Array.from(actualDates)
                    .sort()
                    .join(","),
              },
            }
          );
        } catch (err: any) {
          return new Response(
            JSON.stringify({
              success: false,
              error:
                err.message ||
                "An unexpected error occurred while fetching market historical data.",
            }),
            {
              status: 500,
              headers: {
                "Content-Type": "application/json",
              },
            }
          );
        }
      },
    },
  },
});