// ─── Supabase connection test — server function ────────────────────────────────
// Exposes a single server fn that inserts one row into public.system_logs and
// returns a plain result object the API route can serialise to JSON.
// Server-only: imports supabase.server.ts which uses the SERVICE ROLE KEY.

import { createServerFn } from "@tanstack/react-start";
import { insertSystemLog } from "./services/supabase.server";

export type SupabaseTestResult = {
  ok: boolean;
  message: string;
  timestamp: string;
};

export const testSupabaseConnection = createServerFn({ method: "GET" }).handler(
  async (): Promise<SupabaseTestResult> => {
    const timestamp = new Date().toISOString();

    const ok = await insertSystemLog({
      service: "local-supabase-test",
      level: "INFO",
      message: "Supabase connection working from local project",
      details: `Tested at ${timestamp}`,
    });

    return {
      ok,
      message: ok
        ? "✅ Supabase insert succeeded — check your system_logs table."
        : "❌ Insert failed — check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env and console logs.",
      timestamp,
    };
  }
);
