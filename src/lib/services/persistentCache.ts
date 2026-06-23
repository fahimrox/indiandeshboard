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
