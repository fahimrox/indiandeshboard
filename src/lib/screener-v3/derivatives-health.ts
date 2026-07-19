// Screener V3 Phase 2B Part 1 — PURE derivatives-health aggregation.
// No IO, no clock, no provider calls. Aggregates the three enrichment legs
// (future, call, put) into a single truthful health verdict + counts + reasons.
// This reflects DATA availability/freshness only — never a signal, score, or
// trade-eligibility judgement.
import { isFailure, type DataResult } from "./types.ts";
import type {
  DerivativesHealth,
  DerivativesHealthStatus,
  FuturesMarketSnapshot,
  OptionMarketSnapshot,
} from "./derivatives-types.ts";

/**
 * Fixed leg order for deterministic reason aggregation.
 * A leg is USABLE when available or stale; STALE is a usable-but-carried-over
 * value; a failure status is UNUSABLE.
 *
 * Precedence (first match wins):
 *   1. unavailable — no usable leg at all
 *   2. degraded    — at least one USABLE leg is stale
 *   3. partial     — at least one usable leg AND at least one failed leg, no stale
 *   4. complete    — all three legs available and non-stale
 */
export function deriveDerivativesHealth(input: {
  future: DataResult<FuturesMarketSnapshot>;
  call: DataResult<OptionMarketSnapshot>;
  put: DataResult<OptionMarketSnapshot>;
}): DerivativesHealth {
  // Deterministic order: future, call, put.
  const legs: Array<DataResult<FuturesMarketSnapshot | OptionMarketSnapshot>> = [
    input.future,
    input.call,
    input.put,
  ];

  let usableLegs = 0;
  let staleLegs = 0;
  let failedLegs = 0;
  const rawReasons: string[] = [];

  for (const leg of legs) {
    if (isFailure(leg)) {
      failedLegs++;
      rawReasons.push(leg.reason);
    } else {
      usableLegs++;
      if (leg.status === "stale") {
        staleLegs++;
        rawReasons.push(leg.reason ?? "stale market data");
      }
    }
  }

  // Deduplicate preserving first-occurrence (future → call → put) order.
  const seen = new Set<string>();
  const reasons: string[] = [];
  for (const r of rawReasons) {
    if (!seen.has(r)) {
      seen.add(r);
      reasons.push(r);
    }
  }

  let status: DerivativesHealthStatus;
  if (usableLegs === 0) {
    status = "unavailable";
  } else if (staleLegs > 0) {
    status = "degraded";
  } else if (failedLegs > 0) {
    status = "partial";
  } else {
    status = "complete";
  }

  return { status, usableLegs, staleLegs, failedLegs, reasons };
}
