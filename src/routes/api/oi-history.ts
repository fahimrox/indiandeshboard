import { createFileRoute } from "@tanstack/react-router";
import { dbService } from "../../lib/services/database.server";

export const Route = createFileRoute("/api/oi-history")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const snapshotIdStr = url.searchParams.get("snapshotId");
          if (!snapshotIdStr) {
            return new Response(JSON.stringify({ success: false, error: "Missing snapshotId parameter" }), {
              status: 400,
              headers: { "Content-Type": "application/json" }
            });
          }
          const snapshotId = parseInt(snapshotIdStr, 10);

          const activity = dbService.getOiHistory(snapshotId);
          return new Response(JSON.stringify({ success: true, snapshotId, data: activity }), {
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
