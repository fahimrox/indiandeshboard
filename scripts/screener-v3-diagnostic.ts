// ─── Screener V3 — DEV-ONLY read-only diagnostic ───────────────────────────
// Smoke-test evidence ONLY — NOT trading-readiness certification.
//
// Run (PowerShell, default-deny):
//   $env:NODE_ENV = "development"
//   node scripts/screener-v3-diagnostic.ts
//
// Safety: default-deny — runs ONLY when NODE_ENV is explicitly development/test.
// Public network reads only; never writes DB / persistent cache; never prints
// credentials/tokens; easy to delete. Exits non-zero on any critical failure.
import { getStockFnoUniverse } from "../src/lib/screener-v3/instrument-master.server.ts";
import {
  resolveNearestFuture,
  resolveAtmContracts,
  getMappingStatus,
} from "../src/lib/screener-v3/fno-universe.ts";
import { fetchSpotCandles, normalizeNseSymbol } from "../src/lib/screener-v3/candles.server.ts";
import { aggregateCandles } from "../src/lib/screener-v3/candles.ts";
import { sessionVwap, atr, openingRange } from "../src/lib/screener-v3/features.ts";
import { istDateStr, istMinutesOfDay } from "../src/lib/screener-v3/ist-time.ts";

const SAMPLE = ["RELIANCE", "HDFCBANK", "SBIN"];
const line = (s = "") => console.log(s);

let hadFailure = false;
const fail = (msg: string) => {
  hadFailure = true;
  line(`  FAILURE: ${msg}`);
};
const warn = (msg: string) => line(`  WARNING: ${msg}`);

function isDevOrTest(): boolean {
  const env = process.env.NODE_ENV;
  return env === "development" || env === "test";
}

async function main() {
  // Default-deny: unset/unknown NODE_ENV must NOT permit diagnostic execution.
  if (!isDevOrTest()) {
    console.error(
      "Refusing to run: this diagnostic requires an explicit NODE_ENV=development|test (default-deny).",
    );
    process.exit(1);
  }

  let now = Date.now();
  line("=== Screener V3 diagnostic (read-only; smoke-test evidence, NOT readiness certification) ===");
  line(`reference IST time: ${istDateStr(now)} @ ${istMinutesOfDay(now).toFixed(1)} min-of-day`);

  const uniRes = await getStockFnoUniverse();
  now = Date.now(); // refresh reference after the network fetch (expiry-boundary safe)
  line(`universe status: ${uniRes.status} (source=${uniRes.source ?? "n/a"})`);

  if (uniRes.status !== "available" && uniRes.status !== "stale") {
    fail(`universe unavailable: ${uniRes.reason ?? "unknown"}`);
    return;
  }
  if (uniRes.value === null) {
    fail("universe usable status but null value (contradiction)");
    return;
  }
  if (uniRes.status === "stale") {
    warn("universe is STALE (last-good projection) — not current readiness.");
  }

  const u = uniRes.value;
  const m = u.metadata;
  if (m.currentFuturesUnderlyings === 0 || u.underlyings.length === 0) {
    fail("universe projects zero current-futures underlyings");
    return;
  }
  const fetchedAgeMs = Math.max(0, Date.now() - m.fetchedAt);
  line("\n-- master metadata --");
  line(`fetchedAt: ${new Date(m.fetchedAt).toISOString()} (age ${(fetchedAgeMs / 1000).toFixed(0)}s)  effectiveDateIst: ${m.effectiveDateIst}`);
  line(`raw=${m.totalRawInstruments} eq=${m.totalNseEquity} futs=${m.totalStockFutures} opts=${m.totalStockOptions} (current ${m.totalActiveStockOptions})`);
  line(`current-futures underlyings: ${m.currentFuturesUnderlyings}`);
  line(`fully-resolved mappings: ${m.fullyResolvedMappings} | option-structure-ready: ${m.optionStructureReadyUnderlyings}`);
  line(
    `spot status -> resolved=${m.spotResolvedCount} missing=${m.spotMissingKeyCount} invalid=${m.spotInvalidKeyCount} unresolved=${m.spotUnresolvedRecordCount} conflicting=${m.spotConflictingCount}`,
  );
  line(
    `contract hygiene -> invalidSkipped=${m.invalidRecordsSkipped} malformed=${m.malformedRecordsSkipped} dupCollapsed=${m.duplicateContractsCollapsed} sameKeyConflict=${m.sameKeyConflicts} coordConflict=${m.coordinateConflicts}`,
  );
  line(
    `equity hygiene -> duplicatesCollapsed=${m.equityDuplicatesCollapsed} conflictingKeys=${m.equityConflictingKeys}`,
  );

  for (const sym of SAMPLE) {
    line(`\n===== ${sym} =====`);
    now = Date.now(); // refresh per sample (after prior network ops)
    const canon = normalizeNseSymbol(sym);
    line(`canonical: ${canon?.symbol} (${canon?.yahooSymbol})`);
    const st = getMappingStatus(u, sym, { nowMs: now });
    if (!st) {
      fail(`${sym}: expected a current stock-F&O underlying, but none was found`);
      continue;
    }
    const nf = resolveNearestFuture(u, sym, { nowMs: now });
    line(`spotMapping=${st.spotMappingStatus} listed=${st.listed} fullyMapped=${st.fullyMapped} optionStructureReady=${st.optionStructureReady}`);
    line(`nearest future: ${nf?.tradingSymbol ?? "n/a"} | expiry=${nf?.expiryDateIst} | nonExpiredAtReferenceTime=${nf !== null}`);
    line(
      `nearest option expiry: ${st.nearestOptionExpiry ? istDateStr(st.nearestOptionExpiry) : "n/a"} | CE=${st.ceAvailable} PE=${st.peAvailable} strikes=${st.distinctStrikes} pairedStrikes=${st.pairedStrikeCount}`,
    );

    const daily = await fetchSpotCandles(sym, "1d", { range: "1mo", nowMs: Date.now() });
    if (daily.status === "available" && daily.value) {
      const dv = daily.value;
      const last = dv.candles[dv.candles.length - 1];
      line(`daily candles: ${dv.count} (last close=${last.close} @ ${istDateStr(last.timestamp)}, ageMs=${dv.ageMs ?? "null(future)"}, dupDates=${dv.hygiene.duplicateTradingDates})`);
      // ATM computed from the LAST DAILY CLOSE — a raw estimate, not a live ATM.
      const atm = resolveAtmContracts(u, sym, last.close, { nearby: 2, nowMs: Date.now() });
      if (atm) {
        const label = st.optionStructureReady
          ? "ATM estimate from last daily close (structure-ready)"
          : "ATM RAW estimate from last daily close (structure NOT ready — unvalidated)";
        line(
          `${label} @${last.close}: strike=${atm.atmStrike} window=[${atm.strikes.join(",")}] atmBoth=${atm.atmBothAvailable} pairedInWindow=${atm.pairedStrikesInWindow.length}`,
        );
      } else {
        warn(`${sym}: ATM estimate unavailable from last daily close`);
      }
      const a = atr(dv.candles, 14);
      line(`ATR(14,daily): ${a.status}${a.value !== null ? ` = ${a.value.toFixed(2)}` : ""}`);
    } else {
      fail(`${sym}: daily candles ${daily.status} (${daily.reason ?? ""})`);
    }

    // Intraday 1m -> hygiene, aggregate bucket completeness, PER-SESSION VWAP.
    const oneMin = await fetchSpotCandles(sym, "1m", { range: "5d", nowMs: Date.now() });
    if (oneMin.status === "available" && oneMin.value) {
      const ov = oneMin.value;
      const refMs = Date.now();
      const candles = ov.candles;
      const withVol = candles.filter((c) => c.volume !== null).length;
      line(`1m candles: ${candles.length} | volume coverage: ${withVol}/${candles.length}`);
      line(
        `1m hygiene -> aligned=${ov.hygiene.alignedCount} misaligned=${ov.hygiene.misalignedCount} outOfSession=${ov.hygiene.outOfSessionCount} dupId=${ov.hygiene.duplicateIdentical} conflict=${ov.hygiene.conflictingTimestamps} cadenceGaps=${ov.hygiene.cadenceGaps} forming=${ov.hygiene.lastCandleForming}`,
      );
      const agg5 = aggregateCandles(candles, 5);
      if (agg5.status !== "available") fail(`${sym}: 5m aggregate ${agg5.status} (${agg5.reason ?? ""})`);
      const reasons = agg5.incomplete.reduce<Record<string, number>>((acc, b) => {
        acc[b.reason] = (acc[b.reason] ?? 0) + 1;
        return acc;
      }, {});
      line(
        `5m aggregate: status=${agg5.status} complete=${agg5.candles.length} incomplete=${agg5.incomplete.length} nonOneMinute=${agg5.counts.nonOneMinute} misaligned=${agg5.counts.misaligned} dupConflict=${agg5.counts.duplicateConflict} reasons=${JSON.stringify(reasons)}`,
      );

      // Per-session VWAP coverage (explicit referenceMs; gaps are warnings).
      const sessions = [...new Set(candles.map((c) => istDateStr(c.timestamp)))].sort();
      for (const d of sessions) {
        const v = sessionVwap(candles, { sessionDateIst: d, referenceMs: refMs });
        if (v.status === "available" && v.value) {
          line(`  VWAP ${d}: ${v.value.vwap.toFixed(2)} coverage ${v.value.observedCount}/${v.value.expectedCount} (missing ${v.value.missingCount})`);
        } else {
          line(`  VWAP ${d}: ${v.status} (${v.reason ?? ""})`);
        }
      }
      const or15 = openingRange(candles, 15, { referenceMs: refMs });
      line(`opening range 15m: ${or15.status}${or15.value ? ` [${or15.value.low}-${or15.value.high}] cov ${or15.value.coverage}/${or15.value.expected}` : ` (${or15.reason ?? ""})`}`);
    } else {
      fail(`${sym}: 1m candles ${oneMin.status} (${oneMin.reason ?? ""})`);
    }
  }

  line("");
  if (hadFailure) {
    line("=== RESULT: FAILURE — one or more critical checks failed (see FAILURE lines) ===");
    process.exitCode = 1;
  } else {
    line("=== RESULT: OK — smoke-test evidence only (NOT trading-readiness certification) ===");
  }
}

main().catch((err) => {
  console.error("diagnostic failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
