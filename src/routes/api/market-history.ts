import { createFileRoute } from "@tanstack/react-router";
import { dbService } from "../../lib/services/database.server";

export const Route = createFileRoute("/api/market-history")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const date = url.searchParams.get("date") || new Date().toISOString().split("T")[0];
          const interval = parseInt(url.searchParams.get("interval") || "1", 10);
          const symbolsParam = url.searchParams.get("symbols") || "NIFTY,BANKNIFTY,SENSEX,INDIAVIX";
          const symbols = symbolsParam.split(",");

          const result: Record<string, any[]> = {};
          for (const sym of symbols) {
            result[sym] = dbService.getMarketHistory(sym, date, interval);
          }

          return new Response(JSON.stringify({ success: true, date, interval, data: result }), {
            headers: { "Content-Type": "application/json" }
          });
        } catch (err: any) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
      }
    }
  }
});
