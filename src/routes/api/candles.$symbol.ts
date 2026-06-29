import { createFileRoute } from "@tanstack/react-router";
import { dbService } from "../../lib/services/database.server";

export const Route = createFileRoute("/api/candles/$symbol")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const { symbol } = params;
          const url = new URL(request.url);
          const date = url.searchParams.get("date") || new Date().toISOString().split("T")[0];
          const interval = parseInt(url.searchParams.get("interval") || "1", 10);

          const candles = dbService.getCandles(symbol, date, interval);
          return new Response(JSON.stringify({ success: true, symbol, date, interval, data: candles }), {
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
