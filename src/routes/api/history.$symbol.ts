import { createFileRoute } from "@tanstack/react-router";
import {
  validateDateRange,
  parseInterval,
  getHistoricalMarketHistory,
} from "../../lib/services/historicalDataService.server";

export const Route = createFileRoute("/api/history/$symbol")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const symbol = params.symbol.trim().toUpperCase();
          if (!symbol) {
            return new Response(JSON.stringify({ success: false, error: "Symbol parameter is required." }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const url = new URL(request.url);
          const dateParam = url.searchParams.get("date");
          const startDateParam = url.searchParams.get("startDate");
          const endDateParam = url.searchParams.get("endDate");
          const intervalParam = url.searchParams.get("interval");

          // 1. Validate date range parameters
          const rangeResult = validateDateRange(startDateParam, endDateParam, dateParam);
          if (!rangeResult.ok) {
            return new Response(JSON.stringify({ success: false, error: rangeResult.error }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          // 2. Validate and parse interval
          const intervalResult = parseInterval(intervalParam);
          if (!intervalResult.ok) {
            return new Response(JSON.stringify({ success: false, error: intervalResult.error }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          // 3. Query historical range orchestrator
          const result = await getHistoricalMarketHistory(
            symbol,
            rangeResult.startDate,
            rangeResult.endDate,
            intervalResult.minutes
          );

          // 4. Construct response body maintaining backwards compatibility
          const responseBody: Record<string, any> = {
            success: true,
            symbol,
            interval: intervalResult.minutes,
            data: result.data,
          };

          if (rangeResult.isSingleDate) {
            responseBody.date = rangeResult.startDate;
          } else {
            responseBody.startDate = rangeResult.startDate;
            responseBody.endDate = rangeResult.endDate;
          }

          return new Response(JSON.stringify(responseBody), {
            headers: {
              "Content-Type": "application/json",
              "X-Data-Source": result.metadata.source,
              "X-Requested-Start-Date": rangeResult.startDate,
              "X-Requested-End-Date": rangeResult.endDate,
              "X-Actual-Dates": result.metadata.actualDates.join(","),
            },
          });
        } catch (err: any) {
          return new Response(
            JSON.stringify({
              success: false,
              error: err.message || "An unexpected error occurred while fetching historical data.",
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      },
    },
  },
});
