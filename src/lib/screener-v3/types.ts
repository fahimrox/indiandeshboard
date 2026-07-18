// Screener V3 data-foundation availability envelope.
// Real-data-only: failure states are explicit; values are never coerced to 0.
//
// DataResult<T> is a TRUE discriminated union:
//   - "available" / "stale"  -> value is a NON-NULL/NON-UNDEFINED T
//   - failure statuses        -> value is null AND a reason is required

export type SuccessStatus = "available" | "stale";
export type FailureStatus =
  | "unavailable"
  | "insufficient_history"
  | "provider_error"
  | "invalid_input";
export type DataStatus = SuccessStatus | FailureStatus;

interface ResultMeta {
  source?: string;
  /** Epoch ms of the data point / computation input freshness where practical. */
  timestamp?: number;
}

export interface OkResult<T> extends ResultMeta {
  status: "available";
  value: NonNullable<T>;
  reason?: string;
}

export interface StaleResult<T> extends ResultMeta {
  status: "stale";
  value: NonNullable<T>;
  reason?: string;
}

export interface FailureResult extends ResultMeta {
  status: FailureStatus;
  value: null;
  reason: string;
}

export type DataResult<T> = OkResult<T> | StaleResult<T> | FailureResult;

/**
 * Metadata a caller may attach WITHOUT being able to overwrite the discriminant
 * (`status`) or payload (`value`). Metadata is spread first and invariant fields
 * are written last.
 */
export type DataResultMeta = ResultMeta & { reason?: string };

export function ok<T>(
  value: NonNullable<T>,
  meta: DataResultMeta = {},
): OkResult<T> {
  return { ...meta, status: "available", value };
}

export function stale<T>(
  value: NonNullable<T>,
  meta: DataResultMeta = {},
): StaleResult<T> {
  return { ...meta, status: "stale", value };
}

export function unavailable(
  reason: string,
  meta: DataResultMeta = {},
): FailureResult {
  return { ...meta, status: "unavailable", value: null, reason };
}

export function insufficient(
  reason: string,
  meta: DataResultMeta = {},
): FailureResult {
  return { ...meta, status: "insufficient_history", value: null, reason };
}

export function providerError(
  reason: string,
  meta: DataResultMeta = {},
): FailureResult {
  return { ...meta, status: "provider_error", value: null, reason };
}

export function invalidInput(
  reason: string,
  meta: DataResultMeta = {},
): FailureResult {
  return { ...meta, status: "invalid_input", value: null, reason };
}

// ── Narrowing / propagation helpers ─────────────────────────────────────────

export function isOk<T>(r: DataResult<T>): r is OkResult<T> {
  return r.status === "available";
}

/** Available or stale — both carry a usable non-null value. */
export function isUsable<T>(
  r: DataResult<T>,
): r is OkResult<T> | StaleResult<T> {
  return r.status === "available" || r.status === "stale";
}

export function isFailure<T>(r: DataResult<T>): r is FailureResult {
  return (
    r.status === "unavailable" ||
    r.status === "insufficient_history" ||
    r.status === "provider_error" ||
    r.status === "invalid_input"
  );
}

/**
 * A FailureResult carries no T, so it can safely propagate as a failure of any
 * target result type without a cast.
 */
export function propagateFailure<U>(f: FailureResult): DataResult<U> {
  return f;
}