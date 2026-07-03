import type { OISnapshot } from "./types";

/**
 * Client-session OI history buffer.
 *
 * Every time a fresh option-chain snapshot arrives from the live poll, we
 * "auto-save" it here (in memory, keyed by symbol+expiry). This lets the time
 * window presets ("Last 5m", "Last 30m", ...) compute the REAL open-interest
 * change over the selected window — current OI minus the OI recorded at the
 * start of that window — instead of a flat approximation.
 *
 * The buffer lives for the browser session. It intentionally does not touch the
 * server / SQLite so it stays safe on every deploy target (incl. Cloudflare).
 */

interface OISample {
  ts: number;
  call: Map<number, number>; // strike -> total call OI
  put: Map<number, number>; // strike -> total put OI
  totalCall: number;
  totalPut: number;
}

const store = new Map<string, OISample[]>();
const MAX_SAMPLES = 800; // ~ a full trading day at 10s polling is ~2340; cap to keep memory bounded

/** Record a fresh snapshot. No-op if the snapshot timestamp isn't newer than the last one. */
export function recordOISnapshot(key: string, snap: OISnapshot): void {
  const ts = new Date(snap.lastUpdated).getTime();
  if (!isFinite(ts)) return;

  const arr = store.get(key) ?? [];
  const last = arr[arr.length - 1];
  if (last && ts <= last.ts) return; // same/stale tick — nothing new to save

  const call = new Map<number, number>();
  const put = new Map<number, number>();
  for (const s of snap.strikes) {
    call.set(s.strike, s.callTotalOI);
    put.set(s.strike, s.putTotalOI);
  }

  arr.push({ ts, call, put, totalCall: snap.totalCallOI, totalPut: snap.totalPutOI });
  if (arr.length > MAX_SAMPLES) arr.splice(0, arr.length - MAX_SAMPLES);
  store.set(key, arr);
}

/**
 * Build a snapshot whose OI-change fields reflect the real movement inside the
 * [fromTs, toTs] window, using recorded history for the baseline. Current values
 * always come from `snap` (freshest tick), so there is no lag even if this tick
 * hasn't been recorded yet.
 *
 * Returns null when there isn't enough recorded history to be meaningful, so the
 * caller can fall back to an approximation.
 */
export function buildWindowedSnapshot(
  key: string,
  snap: OISnapshot,
  fromTs: number | null,
  _toTs: number | null
): OISnapshot | null {
  if (fromTs === null) return null;
  const arr = store.get(key);
  if (!arr || arr.length < 2) return null;

  // Baseline = latest recorded sample at or before the window start.
  let base: OISample | null = null;
  for (const s of arr) {
    if (s.ts <= fromTs) base = s;
    else break;
  }
  if (!base) base = arr[0];

  const currentTs = new Date(snap.lastUpdated).getTime();
  if (!isFinite(currentTs) || base.ts >= currentTs) return null;

  const strikes = snap.strikes.map((s) => {
    const baseCall = base!.call.get(s.strike);
    const basePut = base!.put.get(s.strike);
    return {
      ...s,
      callOIChange: baseCall !== undefined ? s.callTotalOI - baseCall : s.callOIChange,
      putOIChange: basePut !== undefined ? s.putTotalOI - basePut : s.putOIChange,
    };
  });

  return {
    ...snap,
    strikes,
    totalCallOIChange: snap.totalCallOI - base.totalCall,
    totalPutOIChange: snap.totalPutOI - base.totalPut,
  };
}
