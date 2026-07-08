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
