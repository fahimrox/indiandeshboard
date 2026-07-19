// Screener V3 Phase 2A Part 3 — API request layer (PURE, framework-agnostic).
// This module owns query parsing, public-parameter validation, HTTP status
// mapping, and the dependency-injected request handler. It performs NO IO and
// imports NO server/provider modules, so it is fully unit-testable under
// `node --test` with injected fakes. The thin route file wires the real
// `Date.now` and `runScreenerV3Batch` into `handleScreenerV3Request`.
//
// Symbol normalization/dedup/rejection is intentionally NOT done here — the
// orchestrator owns canonical symbol semantics. This layer only splits/trims
// and forwards, so the orchestrator can report rejected symbols truthfully.
import { invalidInput, type DataStatus } from "./types.ts";
import type { ScreenerV3BatchInput, ScreenerV3BatchResult } from "./batch-types.ts";

// ── Public workload limits (API boundary) ─────────────────────────────────
export const API_DEFAULT_LIMIT = 200;
export const API_MIN_LIMIT = 1;
export const API_MAX_LIMIT = 250;

// Fixed server-side concurrency. Never caller-overridable.
export const API_CONCURRENCY = 4;

/** Stable source tag stamped on API-boundary failure results. */
export const API_SOURCE = "api/screener-v3";

// ── Query parsing / validation ────────────────────────────────────────────

export type ParsedScreenerV3Query =
  | { ok: true; symbols?: string[]; limit: number }
  | { ok: false; error: string };

/**
 * Parse and validate the public query string for GET /api/screener-v3.
 *
 * Supported params: `symbols` (optional), `limit` (optional).
 * Everything else is ignored and can never reach the orchestrator input.
 */
export function parseScreenerV3Query(params: URLSearchParams): ParsedScreenerV3Query {
  // ── symbols ──
  const symbolValues = params.getAll("symbols");
  let symbols: string[] | undefined;

  if (symbolValues.length > 1) {
    return {
      ok: false,
      error: "The 'symbols' query parameter must not be repeated; provide a single comma-separated value.",
    };
  }
  if (symbolValues.length === 1) {
    const raw = symbolValues[0];
    // Explicit but blank/whitespace-only symbols must be a truthful client
    // error, never a silent fall-through to the full universe.
    if (raw.trim() === "") {
      return { ok: false, error: "The 'symbols' parameter was provided but is blank." };
    }
    // Split on commas and trim each item. Order, duplicates, and interior blank
    // entries (e.g. "RELIANCE,,TCS") are PRESERVED so the orchestrator can
    // normalize, deduplicate, and reject them with truthful per-symbol reasons.
    symbols = raw.split(",").map((s) => s.trim());
  }
  // symbolValues.length === 0 -> symbols stays undefined (universe derivation).

  // ── limit ──
  const limitValues = params.getAll("limit");
  let limit = API_DEFAULT_LIMIT;

  if (limitValues.length > 1) {
    return {
      ok: false,
      error: "The 'limit' query parameter must not be repeated.",
    };
  }
  if (limitValues.length === 1) {
    const raw = limitValues[0];
    // Canonical non-negative integer only: rejects empty, whitespace,
    // signs, decimals, and non-numeric values without silent clamping.
    if (!/^\d+$/.test(raw)) {
      return {
        ok: false,
        error: `The 'limit' parameter must be an integer between ${API_MIN_LIMIT} and ${API_MAX_LIMIT}.`,
      };
    }
    const parsed = Number(raw);
    if (parsed < API_MIN_LIMIT || parsed > API_MAX_LIMIT) {
      return {
        ok: false,
        error: `The 'limit' parameter must be between ${API_MIN_LIMIT} and ${API_MAX_LIMIT}.`,
      };
    }
    limit = parsed;
  }

  return symbols === undefined ? { ok: true, limit } : { ok: true, symbols, limit };
}

// ── HTTP status mapping ─────────────────────────────────────────────────────

/**
 * Deterministic mapping from the top-level DataResult status to an HTTP status.
 * Exhaustive over DataStatus so a future status addition forces a compile-time
 * decision rather than a silent default.
 */
export function mapDataStatusToHttp(status: DataStatus): number {
  switch (status) {
    case "available":
    case "stale":
      return 200;
    case "invalid_input":
      return 400;
    case "unavailable":
    case "insufficient_history":
      return 503;
    case "provider_error":
      return 502;
  }
}

// ── Dependency-injected handler ─────────────────────────────────────────────

export interface ScreenerV3HandlerDeps {
  /** Machine-clock read. Called EXACTLY once per request at the boundary. */
  now: () => number;
  /** The orchestrator entry point (real in production, faked in tests). */
  runBatch: (input: ScreenerV3BatchInput) => Promise<ScreenerV3BatchResult>;
}

export interface ScreenerV3HttpOutcome {
  status: number;
  /** The single machine-clock read for this request; also used for the header. */
  referenceMs: number;
  /** Serialized as the JSON body. A DataResult on the normal/validation paths. */
  body: unknown;
}

/**
 * Framework-agnostic request handler. Reads the clock once, validates input,
 * invokes the orchestrator with fixed internal settings, and maps the result
 * to an HTTP outcome. Never throws: an unexpected orchestrator exception is
 * converted to a generic, non-leaking HTTP 500 outcome.
 */
export async function handleScreenerV3Request(
  params: URLSearchParams,
  deps: ScreenerV3HandlerDeps,
): Promise<ScreenerV3HttpOutcome> {
  // Read the machine clock exactly once, before any branching, so every path
  // (including validation failures) reports one consistent reference time and
  // the orchestration core receives a single deterministic referenceMs.
  const referenceMs = deps.now();

  const parsed = parseScreenerV3Query(params);
  if (!parsed.ok) {
    // Truthful client error; the orchestrator is NOT invoked.
    return {
      status: 400,
      referenceMs,
      body: invalidInput(parsed.error, { source: API_SOURCE, timestamp: referenceMs }),
    };
  }

  const input: ScreenerV3BatchInput = {
    referenceMs,
    limit: parsed.limit,
    concurrency: API_CONCURRENCY,
  };
  if (parsed.symbols !== undefined) {
    input.symbols = parsed.symbols;
  }

  try {
    const result = await deps.runBatch(input);
    return { status: mapDataStatusToHttp(result.status), referenceMs, body: result };
  } catch {
    // An exception here is NOT a DataResult-represented outcome. Return a
    // generic 500 envelope: no thrown message, stack, path, credential, or
    // provider payload is exposed. Deliberately not relabeled as invalid_input.
    return {
      status: 500,
      referenceMs,
      body: { status: "error", value: null, reason: "An unexpected internal error occurred." },
    };
  }
}
