import { createFileRoute } from "@tanstack/react-router";
import { dbService } from "../../lib/services/database.server";

export const Route = createFileRoute("/api/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const table = url.searchParams.get("table") || "market_snapshots";
          const date = url.searchParams.get("date") || new Date().toISOString().split("T")[0];
          const format = url.searchParams.get("format") || "csv";

          // Only allow querying safe data tables to avoid SQL injection
          const allowedTables = ["market_snapshots", "option_chain_snapshots", "market_breadth", "sector_strength", "trade_signals", "system_logs"];
          if (!allowedTables.includes(table)) {
            return new Response(JSON.stringify({ success: false, error: "Invalid table specified" }), {
              status: 400,
              headers: { "Content-Type": "application/json" }
            });
          }

          // Fetch all records for the given date
          let query;
          if (table === "system_logs") {
            query = `SELECT * FROM system_logs ORDER BY timestamp ASC`;
          } else {
            query = `SELECT * FROM ${table} WHERE trading_date = ? ORDER BY timestamp ASC`;
          }

          // Use the internal better-sqlite3 database context (or query through helpers)
          // To fetch raw data safely, we can query it directly
          const dbInstance = (dbService as any).db;
          if (!dbInstance) {
            return new Response(JSON.stringify({ success: false, error: "Database not initialized" }), {
              status: 500,
              headers: { "Content-Type": "application/json" }
            });
          }

          const records = table === "system_logs" 
            ? dbInstance.prepare(query).all() 
            : dbInstance.prepare(query).all(date);

          if (format === "json") {
            return new Response(JSON.stringify(records, null, 2), {
              headers: {
                "Content-Type": "application/json",
                "Content-Disposition": `attachment; filename="${table}_${date}.json"`
              }
            });
          }

          // Otherwise CSV
          if (records.length === 0) {
            return new Response("No records found", {
              headers: {
                "Content-Type": "text/csv",
                "Content-Disposition": `attachment; filename="${table}_${date}.csv"`
              }
            });
          }

          const headers = Object.keys(records[0]);
          const csvLines = [headers.join(",")];

          for (const row of records) {
            const line = headers.map(h => {
              const val = row[h];
              if (val === null || val === undefined) return "";
              const strVal = String(val);
              // Escape quotes and commas
              if (strVal.includes(",") || strVal.includes('"') || strVal.includes("\n")) {
                return `"${strVal.replace(/"/g, '""')}"`;
              }
              return strVal;
            });
            csvLines.push(line.join(","));
          }

          return new Response(csvLines.join("\n"), {
            headers: {
              "Content-Type": "text/csv",
              "Content-Disposition": `attachment; filename="${table}_${date}.csv"`
            }
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
