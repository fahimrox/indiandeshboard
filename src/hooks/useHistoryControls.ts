// ─── useHistoryControls (Phase 2B-A1) ─────────────────────────────────────────
// Reusable, frontend-only control state for Live/Historical selection. This hook
// ONLY manages state — it never fetches, never enables a network request on its
// own, and holds no page-specific logic. Pages combine `historicalReady` with a
// history query's own gating to decide when to fetch.
//
// URL synchronization is OPT-IN (`urlSync: true`) and deliberately implemented
// with a guarded `window.history.replaceState`, so it works without editing any
// generated route file or a page route's `validateSearch`. It initializes state
// from props for SSR determinism, then hydrates from the URL on mount to avoid
// hydration mismatches. Pages that prefer router-native sync can ignore `urlSync`
// and drive the hook from their own `useSearch`/`navigate` via the setters.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HistoryInterval } from "@/lib/history-types";

export type HistoryMode = "LIVE" | "HISTORICAL";

export const HISTORY_INTERVALS: readonly HistoryInterval[] = [1, 3, 5, 15, 30, 60];

/** Runtime type guard for the strict `HistoryInterval` union. */
export function isHistoryInterval(value: unknown): value is HistoryInterval {
  return typeof value === "number" && (HISTORY_INTERVALS as readonly number[]).includes(value);
}

/**
 * Coerce an untrusted value (URL string, DOM value, loosely-typed prop) to a
 * valid `HistoryInterval`, falling back to `fallback` when it is not allowed.
 */
export function coerceHistoryInterval(
  raw: unknown,
  fallback: HistoryInterval,
): HistoryInterval {
  const n = typeof raw === "string" ? Number(raw) : raw;
  return isHistoryInterval(n) ? n : fallback;
}

export interface HistoryControlsState {
  mode: HistoryMode;
  /** YYYY-MM-DD; only meaningful in HISTORICAL mode. */
  date?: string;
  interval: HistoryInterval;
  /** Optional expiry selection (page decides whether it applies). */
  expiry?: string;
}

export interface UseHistoryControlsOptions {
  initialMode?: HistoryMode;
  initialDate?: string;
  initialInterval?: HistoryInterval;
  initialExpiry?: string;
  /**
   * Opt-in URL sync via guarded `window.history.replaceState`. Default false.
   * Safe for SSR (no-op on the server) and requires no route/validateSearch edits.
   */
  urlSync?: boolean;
  /** Namespace for URL keys so multiple instances don't collide. Default "h". */
  urlKeyPrefix?: string;
}

export interface UseHistoryControlsReturn extends HistoryControlsState {
  isHistorical: boolean;
  /** True only when HISTORICAL mode is active AND a date is selected. */
  historicalReady: boolean;
  setMode: (mode: HistoryMode) => void;
  toLive: () => void;
  toHistorical: () => void;
  setDate: (date: string | undefined) => void;
  setInterval: (interval: HistoryInterval) => void;
  setExpiry: (expiry: string | undefined) => void;
  reset: () => void;
}

export function useHistoryControls(
  options: UseHistoryControlsOptions = {},
): UseHistoryControlsReturn {
  const {
    initialMode = "LIVE",
    initialDate,
    initialInterval = 1,
    initialExpiry,
    urlSync = false,
    urlKeyPrefix = "h",
  } = options;

  // Validate the incoming initial interval at runtime — a caller may pass a value
  // that satisfies the TS type via a cast but is not actually allowed.
  const safeInitialInterval = isHistoryInterval(initialInterval) ? initialInterval : 1;

  // State is initialized from props for deterministic SSR output; URL hydration
  // (if enabled) happens in a mount effect below.
  const [mode, setModeState] = useState<HistoryMode>(initialMode);
  const [date, setDateState] = useState<string | undefined>(initialDate);
  const [interval, setIntervalState] = useState<HistoryInterval>(safeInitialInterval);
  const [expiry, setExpiryState] = useState<string | undefined>(initialExpiry);

  const keys = useMemo(
    () => ({
      mode: `${urlKeyPrefix}Mode`,
      date: `${urlKeyPrefix}Date`,
      interval: `${urlKeyPrefix}Interval`,
      expiry: `${urlKeyPrefix}Expiry`,
    }),
    [urlKeyPrefix],
  );

  // `hydrated` is STATE (not a ref) so the URL-write effect stays disabled until
  // the hydrated values are actually committed. The hydration effect sets the
  // hydrated state and the parsed values in the same batched update, so the write
  // effect never runs with the stale default (LIVE) and cannot wipe the incoming
  // historical params. `didHydrateRef` guarantees hydration happens only once.
  const [hydrated, setHydrated] = useState(false);
  const didHydrateRef = useRef(false);

  // Hydrate from the URL once on mount (client only), when urlSync is enabled.
  useEffect(() => {
    if (!urlSync || didHydrateRef.current) return;
    if (typeof window === "undefined") return; // no URL to read → writing stays off
    didHydrateRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const urlMode = params.get(keys.mode);
    if (urlMode === "LIVE" || urlMode === "HISTORICAL") setModeState(urlMode);

    const urlDate = params.get(keys.date);
    if (urlDate) setDateState(urlDate);

    const urlInterval = params.get(keys.interval);
    if (urlInterval) setIntervalState((prev) => coerceHistoryInterval(urlInterval, prev));

    const urlExpiry = params.get(keys.expiry);
    if (urlExpiry) setExpiryState(urlExpiry);

    // Enable writing only after (and batched with) the hydrated values above.
    setHydrated(true);
  }, [urlSync, keys]);

  // Write state back to the URL (guarded, replaceState — no navigation/history push).
  useEffect(() => {
    if (!urlSync || !hydrated) return;
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const p = url.searchParams;

    if (mode === "LIVE") {
      // Keep LIVE as the clean default: strip all history params from the URL.
      p.delete(keys.mode);
      p.delete(keys.date);
      p.delete(keys.interval);
      p.delete(keys.expiry);
    } else {
      p.set(keys.mode, mode);
      if (date) p.set(keys.date, date);
      else p.delete(keys.date);
      p.set(keys.interval, String(interval));
      if (expiry) p.set(keys.expiry, expiry);
      else p.delete(keys.expiry);
    }

    const next = `${url.pathname}${p.toString() ? `?${p.toString()}` : ""}${url.hash}`;
    window.history.replaceState(window.history.state, "", next);
  }, [urlSync, hydrated, keys, mode, date, interval, expiry]);

  const setMode = useCallback((next: HistoryMode) => setModeState(next), []);
  const toLive = useCallback(() => setModeState("LIVE"), []);
  const toHistorical = useCallback(() => setModeState("HISTORICAL"), []);
  const setDate = useCallback((next: string | undefined) => setDateState(next || undefined), []);
  // Guard against invalid runtime values reaching state — fall back to the
  // current valid interval when an out-of-range value is passed.
  const setInterval = useCallback(
    (next: HistoryInterval) =>
      setIntervalState((prev) => (isHistoryInterval(next) ? next : prev)),
    [],
  );
  const setExpiry = useCallback(
    (next: string | undefined) => setExpiryState(next || undefined),
    [],
  );
  const reset = useCallback(() => {
    setModeState(initialMode);
    setDateState(initialDate);
    setIntervalState(safeInitialInterval);
    setExpiryState(initialExpiry);
  }, [initialMode, initialDate, safeInitialInterval, initialExpiry]);

  const isHistorical = mode === "HISTORICAL";
  const historicalReady = isHistorical && !!date;

  return {
    mode,
    date,
    interval,
    expiry,
    isHistorical,
    historicalReady,
    setMode,
    toLive,
    toHistorical,
    setDate,
    setInterval,
    setExpiry,
    reset,
  };
}
