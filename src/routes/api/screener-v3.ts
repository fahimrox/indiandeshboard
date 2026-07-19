import { createFileRoute } from "@tanstack/react-router";
import { runScreenerV3Batch } from "../../lib/screener-v3/row-orchestrator.server";
import { handleScreenerV3Request } from "../../lib/screener-v3/api-request";

// Read-only Screener V3 batch endpoint: GET /api/screener-v3
//
// Thin boundary only. All parsing/validation/status-mapping lives in the pure,
// unit-tested `api-request` helper. Internal controls (referenceMs, concurrency,
// cache policy, provider/range selection) are fixed server-side and can never
// be influenced by the caller. The response is the orchestrator's truthful
// DataResult<ScreenerV3Batch>, serialized verbatim, with no caching.
export const Route = createFileRoute("/api/screener-v3")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const outcome = await handleScreenerV3Request(url.searchParams, {
            now: () => Date.now(),
            runBatch: (input) => runScreenerV3Batch(input),
          });

          return new Response(JSON.stringify(outcome.body), {
            status: outcome.status,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              "X-Screener-V3-Reference-Ms": String(outcome.referenceMs),
            },
          });
        } catch {
          // Defense-in-depth: the handler is designed never to throw, but any
          // unexpected error (e.g. serialization) still yields a generic 500
          // with no leaked message, stack, path, credential, or provider data.
          return new Response(
            JSON.stringify({
              status: "error",
              value: null,
              reason: "An unexpected internal error occurred.",
            }),
            {
              status: 500,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
              },
            },
          );
        }
      },
    },
  },
});
