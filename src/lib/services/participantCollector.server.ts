// ─── Participant Derivatives EOD Collector ──────────────────────────────────
// Safe, once-per-day End-Of-Day collector for the official NSE F&O participant
// OI + Volume reports. Design goals (all satisfied here):
//   • Idempotent by report_date — never double-saves a report already stored.
//   • Retry window after market close — attempts run in the evening and retry
//     on a schedule; it does NOT rely on an open→closed transition event.
//   • Weekend/holiday safe — walks back to the latest AVAILABLE report.
//   • SQLite first — writes only to the local SQLite store (no Supabase here).
//   • Logs success/failure via system_logs (dbService.logEvent) + console.
//
// This module is self-contained and never throws to its caller. It is wired
// into server startup via startParticipantCollector().

import { getIstDate } from "../market-hours";
import { fetchParticipantReports } from "./participantData.server";
import { dbService } from "./database.server";

const RETRY_COOLDOWN_MS = 45 * 60_000; // don't re-probe the same date within 45m
const PROBE_DAYS = 6; // how many days back to search for the latest report
const PUBLISH_HOUR_IST = 18; // reports are published after ~market close evening

export type CollectStatus = "saved" | "skip" | "error";
export interface CollectResult {
  status: CollectStatus;
  reason?: string;
  reportDate: string | null;
  rows?: number;
}

// In-memory guard so repeated ticks in one process don't hammer NSE for a
// not-yet-published (or holiday) date.
let memory: { candidate: string; at: number; done: boolean } | null = null;

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function log(level: "INFO" | "WARN" | "ERROR", message: string, details?: string) {
  try {
    dbService.logEvent(level, message, details);
  } catch {
    /* logging must never throw */
  }
  const line = `[participantCollector] ${message}${details ? ` — ${details}` : ""}`;
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);
}

/** Most recent trading day whose report should already be published (IST). */
function mostRecentExpectedReportDate(now = Date.now()): Date {
  const d = getIstDate(now);
  // Before the evening publish time, today's report isn't out yet.
  if (d.getHours() < PUBLISH_HOUR_IST) d.setDate(d.getDate() - 1);
  // Walk back over weekends (Sun=0, Sat=6).
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d;
}

/** Max report_date currently stored in SQLite, or null. */
function safeLatestReportDate(): string | null {
  try {
    const rows = dbService.getLatestParticipantDerivativeReports(1) as Array<{ report_date?: string }>;
    let latest: string | null = null;
    for (const r of rows) {
      const rd = r.report_date;
      if (rd && (latest === null || rd > latest)) latest = rd;
    }
    return latest;
  } catch {
    return null;
  }
}

/** Which report types (OI / VOLUME) are already stored for a given date. */
function safeReportTypesForDate(date: string): Set<string> {
  const types = new Set<string>();
  try {
    const rows = dbService.getLatestParticipantDerivativeReports(PROBE_DAYS + 1) as Array<{
      report_date?: string;
      report_type?: string;
    }>;
    for (const r of rows) {
      if (r.report_date === date && r.report_type) types.add(r.report_type);
    }
  } catch {
    /* treat as none stored */
  }
  return types;
}

/**
 * Idempotent one-shot collection. Finds the latest available participant report
 * (walking back over weekends/holidays), and saves it to SQLite only if it is
 * not already fully stored. Never throws.
 */
export async function collectParticipantData(opts?: { force?: boolean }): Promise<CollectResult> {
  const force = opts?.force ?? false;
  try {
    const expected = mostRecentExpectedReportDate();
    const expectedStr = isoDate(expected);

    // Idempotency: we already hold this session (or a newer one).
    const latest = safeLatestReportDate();
    if (!force && latest && latest >= expectedStr) {
      return { status: "skip", reason: `already have ${latest} (>= ${expectedStr})`, reportDate: latest };
    }

    // Cooldown: avoid re-probing a not-yet-published/holiday date repeatedly.
    if (
      !force &&
      memory &&
      memory.candidate === expectedStr &&
      Date.now() - memory.at < RETRY_COOLDOWN_MS
    ) {
      return { status: "skip", reason: "recent attempt cooldown", reportDate: latest };
    }
    memory = { candidate: expectedStr, at: Date.now(), done: false };

    // Walk back up to PROBE_DAYS to find the latest AVAILABLE report.
    let fetched: Awaited<ReturnType<typeof fetchParticipantReports>> | null = null;
    let lastErr: unknown = null;
    const probe = new Date(expected);
    for (let i = 0; i < PROBE_DAYS; i++) {
      while (probe.getDay() === 0 || probe.getDay() === 6) probe.setDate(probe.getDate() - 1);
      try {
        fetched = await fetchParticipantReports(new Date(probe));
        break;
      } catch (err) {
        lastErr = err;
        probe.setDate(probe.getDate() - 1);
      }
    }

    if (!fetched) {
      log("WARN", `No participant report found near ${expectedStr}`, lastErr ? String(lastErr) : undefined);
      return { status: "error", reason: "no report available in probe window", reportDate: null };
    }

    // Idempotent save: skip if this report_date is already fully stored.
    const existing = safeReportTypesForDate(fetched.reportDate);
    if (!force && existing.has("OI") && existing.has("VOLUME")) {
      memory = { candidate: expectedStr, at: Date.now(), done: true };
      return { status: "skip", reason: `report ${fetched.reportDate} already stored`, reportDate: fetched.reportDate };
    }

    dbService.saveParticipantDerivatives("OI", fetched.reportDate, fetched.oi);
    dbService.saveParticipantDerivatives("VOLUME", fetched.reportDate, fetched.volume);
    memory = { candidate: expectedStr, at: Date.now(), done: true };

    const rows = fetched.oi.length + fetched.volume.length;
    log("INFO", `Saved participant report ${fetched.reportDate} (OI ${fetched.oi.length} + VOL ${fetched.volume.length})`);
    return { status: "saved", reportDate: fetched.reportDate, rows };
  } catch (err) {
    log("ERROR", "collectParticipantData failed", String(err));
    return { status: "error", reason: String(err), reportDate: null };
  }
}

let started = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the once-per-day EOD collector. Safe to call once at server startup.
 *  • Runs a catch-up attempt shortly after boot (independent of market state).
 *  • Thereafter checks every 30 minutes and only actually fetches during the
 *    post-close retry window (weekday, IST >= 18:00), or if no data exists yet.
 *  • Idempotency + cooldown guards mean redundant ticks are cheap no-ops.
 * Never throws.
 */
export function startParticipantCollector() {
  if (started) return;
  started = true;

  // Catch-up run ~15s after boot so a freshly (re)started server backfills the
  // latest session without waiting for the next tick or a market transition.
  setTimeout(() => {
    void tick("startup");
  }, 15_000);

  intervalHandle = setInterval(() => {
    void tick("interval");
  }, 30 * 60_000);

  log("INFO", "Participant EOD collector started");
}

/** Stops the interval (used only in tests / graceful shutdown). */
export function stopParticipantCollector() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  started = false;
}

async function tick(trigger: "startup" | "interval") {
  try {
    const ist = getIstDate();
    const day = ist.getDay();
    const weekday = day >= 1 && day <= 5;
    const inRetryWindow = weekday && ist.getHours() >= PUBLISH_HOUR_IST;
    const bootstrap = safeLatestReportDate() === null;

    // Interval ticks only act inside the post-close retry window, or to
    // bootstrap an empty store. The startup tick always attempts (catch-up).
    if (trigger === "interval" && !inRetryWindow && !bootstrap) return;

    const res = await collectParticipantData();
    if (res.status === "saved") {
      log("INFO", `Collector tick (${trigger}) saved report ${res.reportDate}`);
    }
  } catch (err) {
    log("ERROR", `Collector tick (${trigger}) failed`, String(err));
  }
}
