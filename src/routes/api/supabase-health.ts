// ─── GET /api/supabase-health ──────────────────────────────────────────────────
// Returns a detailed health report of all Supabase tables, row counts,
// latest timestamps, and configurations. Safe to call: runs server-side
// and contains no secrets.

import { createFileRoute } from "@tanstack/react-router";
import { getSupabaseHealthReport } from "../../lib/services/supabase.server";

export const Route = createFileRoute("/api/supabase-health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const report = await getSupabaseHealthReport();
          return new Response(JSON.stringify(report, null, 2), {
            status: report.ok ? 200 : 500,
            headers: {
              "Content-Type": "application/json",
            },
          });
        } catch (err: any) {
          return new Response(
            JSON.stringify({
              ok: false,
              checkedAt: new Date().toISOString(),
              error: err?.message || String(err),
            }, null, 2),
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
