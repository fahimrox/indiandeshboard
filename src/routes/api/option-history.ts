import { createFileRoute } from "@tanstack/react-router";
import {
  validateDateRange,
  parseInterval,
  getHistoricalOptionHistory,
} from "../../lib/services/historicalDataService.server";

export const Route = createFileRoute("/api/option-history")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);

          const symbol =
            (url.searchParams.get("symbol") || "NIFTY")
              .trim()
              .toUpperCase();

          if (!symbol) {
            return new Response(
              JSON.stringify({
                success: false,
                error: "Symbol parameter is required.",
              }),
              {
                status: 400,
                headers: {
                  "Content-Type": "application/json",
                },
              }
            );
          }

          const dateParam = url.searchParams.get("date");
          const startDateParam =
            url.searchParams.get("startDate");
          const endDateParam =
            url.searchParams.get("endDate");
          const intervalParam =
            url.searchParams.get("interval");
          const expiryParam =
            url.searchParams.get("expiry")?.trim() || undefined;

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

          const result =
            await getHistoricalOptionHistory(
              symbol,
              rangeResult.startDate,
              rangeResult.endDate,
              intervalResult.minutes,
              expiryParam
            );

          const responseBody: Record<string, any> = {
            success: true,
            symbol,
            interval: intervalResult.minutes,
            data: result.data,
          };

          if (expiryParam) {
            responseBody.expiry = expiryParam;
          }

          if (rangeResult.isSingleDate) {
            responseBody.date = rangeResult.startDate;
          } else {
            responseBody.startDate =
              rangeResult.startDate;
            responseBody.endDate =
              rangeResult.endDate;
          }

          return new Response(
            JSON.stringify(responseBody),
            {
              headers: {
                "Content-Type": "application/json",
                "X-Data-Source":
                  result.metadata.source,
                "X-Requested-Start-Date":
                  rangeResult.startDate,
                "X-Requested-End-Date":
                  rangeResult.endDate,
                "X-Actual-Dates":
                  result.metadata.actualDates.join(","),
              },
            }
          );
        } catch (err: any) {
          return new Response(
            JSON.stringify({
              success: false,
              error:
                err.message ||
                "An unexpected error occurred while fetching option-chain historical data.",
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