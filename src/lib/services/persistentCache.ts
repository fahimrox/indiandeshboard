import fs from "node:fs/promises";
import path from "node:path";
import { getIstDate } from "../market-hours";

const CACHE_DIR = path.join(process.cwd(), "eod_cache");
const lastWarnedMap = new Map<string, { dateStr: string; timestamp: number }>();

function getIstDateStr(timestamp: number): string {
  const ist = getIstDate(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ist.getFullYear()}-${pad(ist.getMonth() + 1)}-${pad(ist.getDate())}`;
}

export function warnIfStale(cacheKey: string, data: any): any {
  if (!data) return data;
  const ts = data.cachedAt || data.updatedAt;
  if (!ts) return data;

  const now = Date.now();
  const todayIstStr = getIstDateStr(now);
  const dataIstStr = getIstDateStr(ts);

  if (todayIstStr !== dataIstStr) {
    const lastWarned = lastWarnedMap.get(cacheKey);
    const shouldWarn = !lastWarned || 
      (lastWarned.dateStr !== todayIstStr || now - lastWarned.timestamp >= 30 * 60000);
    
    if (shouldWarn) {
      lastWarnedMap.set(cacheKey, { dateStr: todayIstStr, timestamp: now });
      const ageDays = Math.max(1, Math.round((now - ts) / (24 * 60 * 60 * 1000)));
      console.warn(
        `WARN [cache] ${cacheKey} snapshot is stale (cached/updated ${ageDays} day(s) ago, date: ${dataIstStr}) — may show stale data`
      );
    }
  }
  return data;
}

async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (e) {
    // Ignore
  }
}

export async function saveEodData(key: string, data: any): Promise<void> {
  // Only save if the data is from a valid/real source (not synthetic/fallback)
  if (data && data.source !== "fallback" && !data.isEod) {
    try {
      await ensureCacheDir();
      const filePath = path.join(CACHE_DIR, `${key}.json`);
      const payload = {
        ...data,
        isEod: true,
        cachedAt: Date.now(),
      };
      await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
    } catch (err) {
      console.error(`Failed to write persistent cache for ${key}:`, err);
    }
  }
}

export async function getEodData(key: string): Promise<any | null> {
  try {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);
    return warnIfStale(key, data);
  } catch (e) {
    return null;
  }
}

const SIGNAL_TIMES_KEY = "fno_signal_times";

/**
 * Read the persisted per-trading-day signal-first-seen times.
 *
 * Returns null when the state file does not exist yet (ENOENT) -- that is a
 * valid empty state (first day, fresh install, or day rollover).  All other
 * errors (bad JSON, permission failure, transient I/O) are re-thrown so the
 * caller can decide not to mark hydration complete and retry on the next
 * request.
 */
export async function loadSignalTimes(): Promise<{
  tradingDate: string;
  entries: Record<string, { key: string; at: number }>;
} | null> {
  const filePath = path.join(CACHE_DIR, `${SIGNAL_TIMES_KEY}.json`);
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (e: any) {
    // ENOENT means the file has never been written yet -- valid empty state.
    if (e?.code === "ENOENT") return null;
    // Any other error (EACCES, EIO, EMFILE ...) is a transient failure.
    throw e;
  }
  // readFile succeeded -- parse must succeed too.  If JSON is malformed
  // (truncated by a previous crash before the atomic rename fixed it, etc.)
  // we throw so the caller can retry rather than treating corrupt data as empty.
  return JSON.parse(content);
}

// ── Signal-times persistence: Promise-tail serialization ─────────────────────
//
// Problem: fetchFnoStocks() can be called concurrently (scheduler + ad-hoc
// poll).  Concurrent saveSignalTimes() calls must:
//   1. Execute in strict invocation order (A -> B -> C).
//   2. Let each caller await its own write and see its own failure.
//   3. Never let an older payload overwrite a newer one.
//   4. Never permanently poison the chain after a write failure.
//
// Solution: a module-level Promise tail.  Each saveSignalTimes() call:
//   a. Captures an immutable snapshot of its payload.
//   b. Builds thisWrite = prevTail.catch(noop).then(write): recovers from any
//      prior failure, then performs its own atomic write.
//   c. Advances the module-level tail to thisWrite.catch(noop) so the *next*
//      caller always starts from a fulfilled promise, regardless of whether
//      this write succeeded or failed.
//   d. Returns thisWrite (NOT the tail) to the caller so the caller's await
//      rejects when this specific write failed.
//
// Lost-wakeup race is impossible: there is no boolean draining flag and no
// while loop.  signalTimesWriteTail is updated synchronously before any I/O
// begins, so a payload cannot arrive between the queue-empty check and a
// flag reset.
//
// Ordering: .then() callbacks on the same promise fire in registration order
// (Promises/A+ §2.2.6).  Writes A -> B -> C execute and land on disk in that
// order.  C is always the final state on disk.

const SIGNAL_TIMES_FILE = path.join(CACHE_DIR, `${SIGNAL_TIMES_KEY}.json`);
const SIGNAL_TIMES_TMP  = `${SIGNAL_TIMES_FILE}.tmp`;

/**
 * Atomic write helper: tmp-write then rename.
 * Logs the error and awaits best-effort temp cleanup, then re-throws so the
 * returned promise rejects and the caller's await sees the failure.
 */
async function _atomicWriteSignalTimes(payload: {
  tradingDate: string;
  entries: Record<string, { key: string; at: number }>;
}): Promise<void> {
  try {
    await ensureCacheDir();
    await fs.writeFile(SIGNAL_TIMES_TMP, JSON.stringify(payload), "utf-8");
    await fs.rename(SIGNAL_TIMES_TMP, SIGNAL_TIMES_FILE);
  } catch (err) {
    console.error("Failed to persist F&O signal times:", err);
    // Best-effort cleanup; await so the unlink attempt completes before we
    // re-throw, but ignore any secondary error from unlink itself.
    await fs.unlink(SIGNAL_TIMES_TMP).catch(() => undefined);
    // Re-throw so thisWrite rejects and the caller's await sees the failure.
    throw err;
  }
}

// The tail of the write chain.  Starts resolved so the first call attaches
// immediately.  Kept as a non-rejecting promise (via .catch below) so the
// next caller always has a fulfilled base to chain from.
let signalTimesWriteTail: Promise<void> = Promise.resolve();

export function saveSignalTimes(payload: {
  tradingDate: string;
  entries: Record<string, { key: string; at: number }>;
}): Promise<void> {
  // Snapshot the payload synchronously so later mutations to the caller's
  // object (e.g. signalSeenAt being cleared on day rollover) cannot change
  // what this queued write will persist.
  const snapshot = { tradingDate: payload.tradingDate, entries: { ...payload.entries } };

  // thisWrite: recover from any prior tail rejection, then perform this write.
  // _atomicWriteSignalTimes re-throws on failure, so thisWrite can reject --
  // that rejection is visible to the caller's `await saveSignalTimes()`.
  const thisWrite = signalTimesWriteTail
    .catch(() => undefined)            // recover from any prior write failure
    .then(() => _atomicWriteSignalTimes(snapshot));

  // Advance the tail to thisWrite.catch(noop) so the *next* caller always
  // starts from a fulfilled promise even if this write failed.  We do NOT
  // assign thisWrite itself to the tail -- that would propagate a rejection
  // into the next caller's chain.
  signalTimesWriteTail = thisWrite.catch(() => undefined);

  // Return thisWrite (not the tail) so the caller sees this call's outcome.
  return thisWrite;
}

/**
 * Read the best-available real EOD option chain for a symbol.
 * Tries the exact expiry file first, then falls back to the symbol's `default`
 * snapshot (the last saved real chain). This avoids a FAIL when the selected
 * expiry has no dedicated cache file yet but real data exists under `default`.
 */
export async function getEodOptionChain(symbol: string, expiry?: string): Promise<any | null> {
  if (expiry) {
    const exact = await getEodData(`option_chain_${symbol}_${expiry}`);
    if (exact && Array.isArray(exact.rows) && exact.rows.length) return exact;
  }
  const def = await getEodData(`option_chain_${symbol}_default`);
  if (def && Array.isArray(def.rows) && def.rows.length) return def;
  return null;
}

/**
 * Persist a real option chain under both its returned expiry key and (when the
 * request had no explicit expiry) the `default` key, so per-expiry cache files
 * accumulate and future exact-expiry reads succeed.
 */
export async function saveEodOptionChain(
  symbol: string,
  requestedExpiry: string | undefined,
  data: any
): Promise<void> {
  const returnedExpiry: string | undefined = data?.expiry;
  if (returnedExpiry) await saveEodData(`option_chain_${symbol}_${returnedExpiry}`, data);
  if (requestedExpiry && requestedExpiry !== returnedExpiry) {
    await saveEodData(`option_chain_${symbol}_${requestedExpiry}`, data);
  }
  if (!requestedExpiry) await saveEodData(`option_chain_${symbol}_default`, data);
}
