import fs from "node:fs/promises";
import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), "eod_cache");

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
    return JSON.parse(content);
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
