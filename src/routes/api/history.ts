import { createFileRoute } from "@tanstack/react-router";
import { dbService } from "../../lib/services/database.server";

export const Route = createFileRoute("/api/history")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const dates = dbService.getAvailableDates();
          return new Response(JSON.stringify({ success: true, dates }), {
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
