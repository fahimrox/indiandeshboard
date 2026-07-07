// ─── GET /api/supabase-test ────────────────────────────────────────────────────
// Calls the Supabase server function to insert one row into system_logs and
// returns a JSON result. Visit this endpoint in your browser to verify the
// Supabase connection is working.
//
// Safe: runs server-side only. Service role key never reaches the client.

import { createFileRoute } from "@tanstack/react-router";
import { testSupabaseConnection } from "../../lib/supabase-test.functions";

export const Route = createFileRoute("/api/supabase-test")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const result = await testSupabaseConnection();
          return new Response(JSON.stringify(result, null, 2), {
            status: result.ok ? 200 : 502,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err: any) {
          return new Response(
            JSON.stringify({
              ok: false,
              message: `Server error: ${err.message}`,
              timestamp: new Date().toISOString(),
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
