// Instrument-master fetch + in-memory cache (SERVER ONLY — uses node:zlib).
// Caches the RAW downloaded records + fetch time, and RE-PROJECTS them against
// the request's current time on every read, so a cached universe can never
// expose contracts that expired after the 15:30 IST boundary as "current".
// Never writes to disk / persistent cache, and never labels stale data current.
import zlib from "node:zlib";
import { promisify } from "node:util";
import { parseUpstoxInstruments } from "./instrument-master.parser.ts";
import type { FnoInstrumentUniverse, UpstoxInstrumentRecord } from "./instrument-types.ts";
import { ok, providerError, stale, type DataResult } from "./types.ts";

const UPSTOX_NSE_MASTER_URL =
  "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";

// The master changes at most daily; a 6h raw-records TTL avoids repeated large
// downloads. Freshness of the PROJECTION is always "now" (we reparse per read).
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Maximum age we will serve stale, last-good records when the provider is down.
// The master is a daily artifact; 48h tolerates a weekend/holiday provider
// outage without ever presenting arbitrarily old data as usable.
const MAX_STALE_AGE_MS = 48 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;

const gunzipAsync = promisify(zlib.gunzip);

// Cache holds RAW records + the real fetch time only. No parsed snapshot is
// retained, so expiry-sensitive fields are never frozen at fetch time.
let cache: { records: UpstoxInstrumentRecord[]; fetchedAt: number } | null = null;
let inFlight: Promise<DataResult<FnoInstrumentUniverse>> | null = null;

/** Default-deny: only an explicit development/test env unlocks dev-only helpers. */
function isDevOrTest(): boolean {
  const env = process.env.NODE_ENV;
  return env === "development" || env === "test";
}

/** Fresh only when age is non-negative (no clock skew) AND within the TTL. */
export function isFreshCacheAge(ageMs: number): boolean {
  return ageMs >= 0 && ageMs < CACHE_TTL_MS;
}
/** Stale is serveable only when age is non-negative AND within the max stale age. */
export function isUsableStaleAge(ageMs: number): boolean {
  return ageMs >= 0 && ageMs <= MAX_STALE_AGE_MS;
}

/**
 * SINGLE projection+validation helper. Reprojects raw records against `nowMs`
 * and reports whether the projected universe is CURRENTLY usable (available
 * status AND at least one current underlying).
 */
export function projectRecordsAsOf(
  records: UpstoxInstrumentRecord[],
  fetchedAt: number,
  nowMs: number,
): { universe: FnoInstrumentUniverse; usable: boolean } {
  const universe = parseUpstoxInstruments(records, { nowMs, fetchedAt });
  const usable = universe.metadata.status === "available" && universe.underlyings.length > 0;
  return { universe, usable };
}

async function downloadMaster(): Promise<UpstoxInstrumentRecord[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(UPSTOX_NSE_MASTER_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`Upstox master HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const text = (await gunzipAsync(buf)).toString("utf-8");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("Upstox master payload is not an array");
    return parsed as UpstoxInstrumentRecord[];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Serve stale last-good records ONLY when they are within the max stale age
 * (non-negative) AND still project to a usable current universe; otherwise fail.
 * Reprojects at call time (close to response time).
 */
function staleFallback(reason: string): DataResult<FnoInstrumentUniverse> {
  if (!cache) return providerError(`Upstox instrument master unavailable: ${reason}`);
  const now = Date.now();
  const ageMs = now - cache.fetchedAt;
  if (!isUsableStaleAge(ageMs)) {
    return providerError(`Upstox master stale cache not serveable (ageMs=${ageMs}): ${reason}`);
  }
  const { universe, usable } = projectRecordsAsOf(cache.records, cache.fetchedAt, now);
  if (!usable) {
    return providerError(`Upstox master stale projection has no usable current underlyings: ${reason}`);
  }
  return stale(universe, { source: "upstox:stale", timestamp: cache.fetchedAt, reason });
}

/**
 * Returns the current stock-F&O universe, always projected against `now`:
 *  - fresh raw cache within TTL that projects usable -> "available" (memory-cache)
 *  - successful download that projects usable          -> "available" (live)
 *  - otherwise usable stale last-good records          -> "stale"
 *  - nothing usable                                    -> "provider_error"
 * Outer status is NEVER available/stale with an internally unusable universe.
 */
export async function getStockFnoUniverse(
  opts: { forceRefresh?: boolean } = {},
): Promise<DataResult<FnoInstrumentUniverse>> {
  if (!opts.forceRefresh && cache) {
    const now = Date.now();
    const ageMs = now - cache.fetchedAt;
    if (isFreshCacheAge(ageMs)) {
      const { universe, usable } = projectRecordsAsOf(cache.records, cache.fetchedAt, now);
      if (usable) return ok(universe, { source: "upstox:memory-cache", timestamp: cache.fetchedAt });
      // Fresh but no longer usable (e.g. all expired) -> fall through to refresh.
    }
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const records = await downloadMaster();
      const fetchedAt = Date.now();
      const { universe, usable } = projectRecordsAsOf(records, fetchedAt, fetchedAt);
      if (usable) {
        cache = { records, fetchedAt };
        return ok(universe, { source: "upstox:live", timestamp: fetchedAt });
      }
      return staleFallback("fresh parse produced no usable current underlyings");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return staleFallback(`Upstox instrument master fetch failed: ${reason}`);
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Non-fetching accessor. Returns cache metadata plus a CURRENT-TIME projection
 * and an explicit `usable` flag (never a frozen/contradictory raw universe).
 * Null when nothing has been fetched yet.
 */
export function getCachedStockFnoUniverse(): {
  universe: FnoInstrumentUniverse;
  fetchedAt: number;
  ageMs: number;
  usable: boolean;
} | null {
  if (!cache) return null;
  const now = Date.now();
  const ageMs = now - cache.fetchedAt;
  const { universe, usable } = projectRecordsAsOf(cache.records, cache.fetchedAt, now);
  return { universe, fetchedAt: cache.fetchedAt, ageMs, usable: usable && isUsableStaleAge(ageMs) };
}

/**
 * Dev/test ONLY: clears the in-memory cache. Default-deny — throws unless
 * NODE_ENV is explicitly "development" or "test" (unset/unknown is denied).
 */
export function _clearInstrumentCache(): void {
  if (!isDevOrTest()) {
    throw new Error("_clearInstrumentCache is dev/test-only (requires NODE_ENV=development|test)");
  }
  cache = null;
  inFlight = null;
}

/**
 * Dev/test ONLY: seed the raw-records cache without a network fetch, so cache
 * behavior can be exercised deterministically. Default-deny guarded.
 */
export function _seedInstrumentCacheForTest(records: UpstoxInstrumentRecord[], fetchedAt: number): void {
  if (!isDevOrTest()) {
    throw new Error("_seedInstrumentCacheForTest is dev/test-only (requires NODE_ENV=development|test)");
  }
  cache = { records, fetchedAt };
  inFlight = null;
}
