# CHANGELOG

> Permanent, chronological history of the Indian Stock Market Dashboard.
> Newest first. Session-specific notes live in `SESSION_HANDOVER.md`; this file
> is the durable record. Dates are IST.

---

## 2026-07-18 21:32 IST — Claude Opus 4.8

### Task
Screener V3 — Phase 1 **data foundation only** (no signal engines, no UI). Branch: `feat/screener-v3-data-foundation` (uncommitted, for review).

### Summary
- Added an isolated `src/lib/screener-v3/` module set. Nothing here is wired into the app, `/screener`, scheduler, DB, or deployment yet.
- **Instrument master**: `instrument-master.parser.ts` (pure) parses the full official Upstox NSE master into a typed stock-F&O universe. Indices excluded via `underlying_type === "EQUITY"` plus an explicit excluded-index safety set. Near-month future selected deterministically (earliest non-expired, IST date-safe); later expiries preserved; expired futures/options dropped from the current universe; invalid expiry/strike/lot/key rows rejected (never coerced to 0); missing spot mapping kept `null` and counted. `instrument-master.server.ts` downloads + gunzips + in-memory-caches (6h TTL) with explicit `stale`/`provider_error` states; never writes disk/persistent cache; does not touch the existing equity quote map in `upstoxService.ts`.
- **Universe helpers** (`fno-universe.ts`, pure): find/isFno/resolve spot/nearest future/expiries/options-by-expiry, and a deterministic ATM + nearby-strike resolver that only uses real strikes (never fabricates).
- **Candle service**: `candles.ts` (pure normalize/validate/dedupe/sort + IST-session-aligned 1m→3m/5m aggregation, no gap fabrication, missing volume stays `null`) and `candles.server.ts` (Yahoo v8 via existing `yahooService.getHistory`, `.NS` normalization, freshness metadata, explicit 1-minute ≤8-day limitation note).
- **Pure features** (`features.ts`): session VWAP (no last-price fallback), true range, ATR, previous-session OHLC, opening range (5/15/30m, incomplete→insufficient), 1m/3m/5m/15m returns, rolling volume sum/avg, volume acceleration — all returning explicit availability envelopes; no zero-as-missing.
- **DataResult repair** (`types.ts`): added `DataResultMeta<T>` (Omit status/value) and reordered helpers so `meta` can never override the discriminant/value; added a `stale` helper that preserves the value.
- **Tests** (Node's built-in `node:test`, zero new deps — Bun not installed): 31 tests across parser, DataResult, candles, features, universe. All pass.
- **Diagnostic**: `scripts/screener-v3-diagnostic.ts` (dev-only, production-guarded, read-only, no secrets).

### Diagnostic (real data, 2026-07-18)
88,128 raw instruments · 9,446 NSE equity · 625 stock futures · 32,197 active stock options · **210 eligible stock-F&O underlyings** · 0 missing spot · 0 invalid. RELIANCE/HDFCBANK/SBIN resolved near-month (28 JUL 26) futures, 3 expiries, ATM strikes, VWAP, ATR, opening range — all available.

### Deliberately NOT implemented (still pending)
- Rocket Boost / Intraday Breakout / Intraday Reversal / Long Momentum engines; BOS/CHoCH; confidence scores; signal ranking; any trading recommendation.
- Live near-month **futures quote** ingestion (LTP/OHLC/volume/OI/bid/ask) — no provider wired.
- Option **bid/ask/depth/Greeks** — not available in the normalized chain.
- **Delivery** data ingestion.
- No `/screener` UI, no existing signal logic, no production scheduler, no DB schema, no deployment config changed.

### Data-source limitations
- Yahoo 1-minute history is capped at ~8 days per request (20-session 1m not obtainable in one call; use 5m/daily for longer lookbacks).
- Instrument master is in-memory cached only (not persisted to disk by design).

### Build/Test Result
`node --test src/lib/screener-v3/*.test.ts`: 31 pass / 0 fail. `tsc --noEmit`: zero errors in `screener-v3`/`scripts` (pre-existing type errors remain in unrelated files: `IndexContribution/IndexContributionChart.tsx`, `market.functions.ts`, `scheduler.server.ts`, `supabase.server.ts`). Not committed.

### Signal-safety hardening pass (amended, same day — Claude Opus 4.8)
Phase 1 received a focused signal-safety hardening pass before any engine work (still Phase 1 data foundation only; no UI/signal/scheduler/DB/deploy changes):
- **Candles**: strict OHLC validation (positive prices; high ≥ open/close; low ≤ open/close; positive timestamp) with no repair; aggregator now accepts only genuine `1m` inputs and returns an explicit `AggregateResult` (counts non-1m/invalid drops); 3m/5m buckets are emitted only when EVERY expected 1-minute start exists (missing-middle omitted); incomplete buckets are returned as metadata only (never shaped like real candles); aggregate volume is `null` if any member volume is missing (no partial sums); candle START ≥ 15:30 excluded; pre/post-market dropped; dates never merged; mixed-source buckets rejected.
- **Candle service**: canonical suffix-free `symbol` + `.NS` `yahooSymbol`; `.BO` explicitly rejected; unsupported interval/range combos (e.g. `1m`+`1y`) fail fast as invalid requests before any provider call; freshness metadata (`requestedAt`/`ageMs`/`sessionDateIst`).
- **Features**: all inputs normalized (sorted+deduped); `sessionVwap` computes exactly one IST session (returns `{vwap,sessionDateIst,candleCount}`, unavailable if any session candle lacks volume or cumulative volume is 0); opening range requires full 1-minute coverage (a later candle does not imply completeness); intraday returns are same-session with an interval-based baseline tolerance (no previous-day/overnight baseline, large gaps rejected); rolling volume + acceleration reject session-boundary crossings, mixed intervals, and missing volume; ATR rejects mixed intervals and invalid OHLC.
- **Instrument master**: session-aware expiry validity — a same-day expiry is current only before 15:30 IST and rolls deterministically after close; `underlying_key` accepted only in `NSE_EQ|…` form (NSE_INDEX/malformed rejected); conflicting spot keys surfaced deterministically + counted; new eligibility tiers (`listed` ⊂ `fullyMapped` ⊂ `optionFoundationCandidate`); query-time helpers revalidate expiry against a reference time so a cached universe never returns an expired near-month; `.NS` accepted/`.BO` rejected in `fno-universe`; ATM helper normalizes/bounds `nearby`, validates explicit expiry against real current expiries, and reports CE/PE/both availability.
- **Fetch service**: 20s `AbortController` timeout; async gunzip (no event-loop block); `_clearInstrumentCache` hard-guarded against production.
- **Tests**: expanded to **45 pass / 0 fail** (added candle-service + hardening cases). `tsc --noEmit`: still zero errors in `screener-v3`/`scripts` (same pre-existing unrelated errors). Diagnostic re-run confirms 210 eligible underlyings and full RELIANCE/HDFCBANK/SBIN mappings. Not committed.

### Second correctness pass (amended, same day — Claude Opus 4.8)
A second focused correctness pass on the isolated Phase 1 foundation only (still no UI/signal/scheduler/DB/deploy changes; nothing committed). Manual review found gaps the prior tests did not cover:
- **Result type** (`types.ts`): `DataResult<T>` is now a true discriminated union (`OkResult`/`StaleResult` carry non-null `T`; failures carry `value:null` + required `reason`). Added `invalid_input` status + `invalidInput()`, and `isOk`/`isUsable`/`isFailure`/`propagateFailure` so feature code propagates failures with NO `as unknown as` casts. Metadata still cannot override `status`/`value`.
- **Exact candle timing** (`ist-time.ts`, `candles.ts`): added `isFinitePositiveTs`/`isExactMinuteBoundary`/`isCanonicalMinuteStart`/`isIntervalAlignedStart`. A canonical 1m start must satisfy `timestamp % 60_000 === 0` (09:15:30 rejected). `dedupeSortStrict` detects duplicate exact timestamps BEFORE any last-wins: identical duplicates are collapsed + counted, conflicting duplicates are removed + surfaced (never silently overwritten). `aggregateCandles` returns full metadata counters (misaligned, duplicateIdentical, duplicateConflict, duplicateMinuteSlot, mixedSourceBuckets, nonOneMinute, invalidShape, outOfSession) and `invalid_input` when a non-empty input has no usable canonical 1m candle; a bucket completes only with EXACTLY `factor` members; the meaningless `diagnostic` option was removed. `15:27–15:29` is a valid final 3m bucket; `15:30`+ excluded; any-missing-volume member → `volume:null`.
- **Session features** (`features.ts`): shared `cleanIntraday` guard (conflict/mixed-interval/daily/invalid/misaligned → `invalid_input`); optional deterministic `referenceMs` drops still-forming trailing candles. VWAP returns coverage metadata (`observedCount`/`expectedCount`/`missingCount`/`coverageRatio`) and fails on gaps instead of reporting a false-complete result. Opening range is wall-clock gated (`referenceMs >= range end`; 5m≥09:20, 15m≥09:30, 30m≥09:45) with full 1m coverage. Return windows validate integer minutes, reject pre-session baselines/targets, use an interval tolerance, and never cross the trading date. Rolling volume/acceleration require contiguous single-session aligned bars with volume. **Bug fixed** (found by new tests): the rolling/return-window session guards were calling `isSessionStart` with the Candle object instead of its timestamp (NaN → always out-of-session); now pass `c.timestamp`.
- **Spot-mapping truth** (`instrument-types.ts`, `instrument-master.parser.ts`): explicit `SpotMappingStatus` (`missing_key`/`invalid_key`/`unresolved_record`/`conflicting_keys`/`resolved`); only `resolved` is eligible and yields a usable `spotInstrumentKey` (conflicts → null + separate `diagnosticSpotKey`). Spot keys are collected ONLY from structurally-valid + current contracts (expired/invalid rows can no longer create a false conflict); strict `^NSE_EQ\|[^|\s]+$` + must resolve to a real `NSE_EQ` record. Contracts deduped by `instrumentKey` (identical collapsed, conflicting surfaced); `nowMs`/`fetchedAt` validated (throws on non-finite). Metadata renamed to what it actually counts (`currentFuturesUnderlyings`, `fullyResolvedMappings`, `optionStructureReadyUnderlyings`, spot-status breakdown, duplicate/conflict counts).
- **Option pairing** (`fno-universe.ts`): same-strike CE/PE pairing (`pairedStrikes`), readiness renamed `optionStructureReady` and now REQUIRES ≥1 genuine same-strike pair (a conflict spot mapping forces `fullyMapped=false`). ATM result exposes `atmCeAvailable`/`atmPeAvailable`/`atmBothAvailable` (same-strike at ATM) + `pairedStrikesInWindow`/`anyPairedStrikeInWindow` — the old `calls.length>0 && puts.length>0` definition is gone. `isFnoUnderlying` clarified (`isParsedFnoUnderlying` = structural vs `isListedFnoUnderlying` = current); `nowMs` validated.
- **Cache expiry-boundary safety** (`instrument-master.server.ts`): the cache now stores RAW records + fetch time and RE-PROJECTS them against the request's `now` on every read, so a cached universe can never expose contracts that expired after 15:30 IST as current. `getCachedStockFnoUniverse()` returns a current-time projection + metadata (never a frozen raw universe). Dev/test guards are default-deny (only explicit `NODE_ENV=development|test`).
- **Candle service** (`candles.server.ts`): strict symbol validation (`^[A-Z0-9&-]+$`; whitespace/slash/query/hash/`.BO` rejected) before any provider call; `1m`+`7d` removed from the allowlist (unverified); reports alignment/duplicate/conflict/cadence/last-forming hygiene and never returns a silent negative `ageMs` (future timestamp → `ageMs:null` + flagged).
- **Diagnostic** (`scripts/screener-v3-diagnostic.ts`): default-deny production protection; truthful labels (stale vs available, `nonExpiredAtReferenceTime`, "ATM estimate from last daily close"); per-session VWAP coverage; structural counts; explicitly framed as smoke-test evidence, not readiness certification.
- **Tests**: expanded to **58 pass / 0 fail** (rewritten for the new signatures + added regression cases). `tsc --noEmit`: still zero errors in `screener-v3`/`scripts` (same pre-existing unrelated errors in `IndexContribution/IndexContributionChart.tsx`, `market.functions.ts`, `scheduler.server.ts`, `supabase.server.ts`). Diagnostic (real data, 2026-07-18): 88,128 raw · 9,446 equity · 625 futures · 32,197 current options · **210 current-futures underlyings, all resolved + option-structure-ready** · RELIANCE 44 same-strike pairs, ATM both-available, per-session VWAP 375/375. Not committed.

### Corrections to the claims above (read before trusting them)
The two amendments above OVERSTATED completeness. A subsequent manual audit + third
hardening pass found and fixed real defects they missed; treat the following as the
accurate record:
- The 2nd pass conflict handling was **not complete**: coordinate conflicts (two
  distinct instrument keys at the same `expiry|FUT` or `expiry|strike|type`) were only
  *counted*, not removed — both contracts were retained. Same-key inconsistent rows
  were also retained. Now BOTH are quarantined (removed).
- The return-window "interval-based baseline tolerance" was itself a **bug**: it could
  pick a nearby candle as the baseline and could return a value across a missing
  intermediate candle. Now requires an exact baseline and full contiguity.
- The forming-candle policy was **not** consistent: `sessionVwap`/`openingRange`/
  `previousSessionOhlc` still fell back to `Date.now()` when `referenceMs` was omitted.
- `DataResult` non-null safety and `isFailure` correctness were completed by a manual
  edit (success values are `NonNullable<T>`; `isFailure` checks failure statuses).
- The diagnostic previously exited `0` even on handled failures — its exit code did
  NOT prove readiness. It is smoke-test evidence only.

### Third hardening pass (amended, same day — Claude Opus 4.8)
Regression-test-first pass on the isolated Phase 1 foundation only (no UI/signal/
scheduler/DB/deploy changes; nothing committed). Fixes, each with tests:
- **Return windows** (`features.ts`): `minutes` must be a positive integer AND an exact
  multiple of the candle interval (else `invalid_input`); baseline must exist EXACTLY at
  `last - minutes*60000`; every interval from baseline→latest must be present (missing
  intermediate → `unavailable`); no nearest/tolerance substitution; never crosses the
  trading date.
- **Forming-candle policy**: `sessionVwap`, `returnWindow`, `rollingVolumeSum`,
  `rollingAvgVolume`, `volumeAcceleration`, `openingRange` now REQUIRE an explicit
  finite-positive `referenceMs` (missing/invalid → `invalid_input`); no hidden
  `Date.now()`. `previousSessionOhlc` requires an explicit `referenceMs` too.
- **Opening range**: validates a canonical `YYYY-MM-DD` `sessionDateIst` and anchors
  midnight to a candle that actually belongs to that date; a requested date absent from
  the series returns `unavailable` (never borrows another session's midnight).
- **Parser conflict quarantine** (`instrument-master.parser.ts`): identical duplicate
  rows collapse; a single instrument key with inconsistent rows is quarantined
  (`sameKeyConflicts`); >1 distinct key at one coordinate quarantines ALL involved
  contracts (`coordinateConflicts`). Spot keys are collected ONLY from accepted,
  conflict-free, current contracts (a rejected row can no longer pollute the mapping).
  Duplicate NSE_EQ keys: identical collapse (`equityDuplicatesCollapsed`), inconsistent
  quarantine (`equityConflictingKeys`) — a conflicted equity key cannot resolve a spot.
  Runtime validation hardened: trimmed non-empty keys, integer lot/expiry, positive
  strike, `weekly === true` strict, non-object rows skipped safely
  (`malformedRecordsSkipped`) without crashing.
- **Mapping coherence** (`fno-universe.ts`): `isCoherentResolvedSpot()` requires
  status/flag/key/trading-symbol to all agree; `fullyMapped` and
  `resolveSpotInstrumentKey()` reject contradictory objects and empty/whitespace trading
  symbols. `EXCLUDED_INDEX_SYMBOLS` is a `ReadonlySet`; `bySymbol` uses
  `Object.create(null)`.
- **Cache consistency** (`instrument-master.server.ts`): single `projectRecordsAsOf()`
  validator; outer `available`/`stale` only when the projected universe is actually
  usable; a documented `MAX_STALE_AGE_MS` (48h); negative clock age is never treated as
  fresh or serveable; reprojected at response time.
- **Candle service** (`candles.server.ts`): invalid symbol/range/`nowMs` now return
  `invalid_input` (still zero provider calls); cadence counts MISSING interval bars among
  aligned in-session bars only; `lastCandleForming` derived from the last usable aligned
  bar; strict integer timestamp seconds (no `Math.round`); zero usable aligned intraday
  candles → `unavailable`; daily duplicate trading dates quarantined; injectable `nowMs`.
- **Aggregation/alignment contracts** (`candles.ts`, `ist-time.ts`): `aggregateCandles`
  validates `factorMinutes ∈ {3,5}` and rejects empty/whitespace source members;
  `isIntervalAlignedStart` validates its interval; `isExpiryContractCurrent` rejects
  non-canonical date strings.
- **Diagnostic** (`scripts/screener-v3-diagnostic.ts`): exits non-zero on any critical
  failure (universe unavailable/empty, missing expected sample mapping, non-available
  daily/1m, aggregate failure); warnings (stale universe, VWAP gaps, ATM estimate) are
  distinct from failures; passes explicit `referenceMs`; refreshes the reference time
  after network ops; ATM labelled RAW/unvalidated unless option structure is ready;
  corrected PowerShell run instructions.
- **Tests / typecheck**: **99 pass / 0 fail** (`node --test src/lib/screener-v3/*.test.ts`),
  including a new network-free `instrument-master.server.test.ts`. `npx tsc --noEmit`
  reports ZERO errors in `screener-v3`/`scripts`; the full-repo run still exits `2`
  ONLY because of the four pre-existing unrelated files
  (`IndexContribution/IndexContributionChart.tsx`, `market.functions.ts`,
  `scheduler.server.ts`, `supabase.server.ts`), which were not touched. Diagnostic
  (real data) confirms 210 current-futures underlyings, all resolved +
  option-structure-ready. Nothing committed, staged, pushed, merged, deployed, or wired
  into the app/scheduler/DB/UI. Diagnostic output is smoke-test evidence, not
  trading-readiness certification.

---

## 2026-07-18 02:45 IST — Claude Sonnet 5 (Kiro)

### Task
Redesign the homepage (`/`) live-market overview UI using reference screenshots as visual inspiration only. Live market page, no historical controls added.

### Summary
- Removed the shared page header ("Market Dashboard" / "Live Indian market intelligence" / updated-at badge) from the homepage only, by no longer passing `title`/`subtitle`/`updatedAt` to `DashboardShell` from `src/routes/index.tsx`. `DashboardShell.tsx` itself was not modified; the header still renders normally on every other page that passes `title`.
- Removed from the homepage: Positive Impact / Negative Impact / Advance-Decline / Avg Change KPI cards, the AI Market Sentiment card, the Market Breadth card, Top Gainers & Losers (NIFTY 50 stock rows), and the entire Market Overview & Pulse block (per-index bias cards, Volatility & Positioning, Sector Flow, sentiment bullet lines). `KpiCard` and `StockRow` were NOT deleted from `MarketBits.tsx` — they are still used by `src/routes/sector.$key.tsx`.
- Added `src/features/home/FearGreedGauge.tsx`: a semicircular SVG gauge with a pure, documented `computeFearGreed()` function. Real inputs only: breadth (35%, from `constituentsQuery` advance/decline for NIFTY/BANKNIFTY/SENSEX), momentum (30%, index %change clamped to ±1.5%), sector participation (20%, % of tracked sector indices positive), VIX risk adjustment (15%, inverted, clamped 10-30). Missing inputs are dropped and remaining weights renormalized — never replaced with a bullish/bearish guess. Returns `score: null` / "Unavailable" if fewer than 2 of the 4 dimensions resolve, or if neither breadth nor momentum resolves.
- Added `src/features/home/IndexBreadthBars.tsx`: three per-index (NIFTY 50 / BANK NIFTY / SENSEX) large paired Advances/Declines bars with real counts, percentages, unchanged count, and total constituent count, sourced from the existing `constituentsQuery(index)` (no new server endpoints). Each block has independent loading skeleton and error/unavailable states so one failing index doesn't affect the others.
- Added `src/features/home/ParticipantActivity.tsx`: polished FII/DII/Client/Retail-style layout. Repo-wide search (server functions, `services/database.server.ts`, `services/supabase.server.ts`, API routes, docs) found no real participant/institutional-flow dataset anywhere in the codebase — only an unrelated F&O scanner heuristic tag (`INSTITUTIONAL_BUYING`/`INSTITUTIONAL_SELLING`, not a participant-flow feed). Per the task's outcome C, the section renders a clearly labeled "Not available" state per category and a summary line: "Participant activity data is not currently available from the configured sources." No values were fabricated or derived from unrelated breadth/price/volume data.
- Rewrote `src/routes/index.tsx` to keep the 3 index hero cards, remove the old sections, and mount the three new homepage components in sequence. Kept `dashboardQuery` as the loader/data source (no new fetches added beyond the pre-existing `constituentsQuery` calls already used elsewhere in the app).

### Build/Test Result
`npm run build`: exit 0 (client + ssr + nitro, clean). `git diff --check`: clean (no whitespace errors). No other pages, `DashboardShell.tsx`, `MarketBits.tsx`, scheduler, database, or Supabase files were touched.

### Files Changed
- `src/routes/index.tsx` (rewritten)
- `src/features/home/FearGreedGauge.tsx` (new)
- `src/features/home/IndexBreadthBars.tsx` (new)
- `src/features/home/ParticipantActivity.tsx` (new)
- `docs/CURRENT_TASK.md`, `docs/SESSION_HANDOVER.md`, `docs/CHANGELOG.md` (this entry)

### Remaining Risks / Follow-ups
- Fear & Greed weights (35/30/20/15) are a first, documented pass per the task's "suggested principle, not mandatory exact weights" — may need tuning once observed against real live sessions.
- Participant Activity section will need a real read-only data source wired in before it can show live figures; currently intentionally shows an honest unavailable state.
- Not committed, staged, pushed, or merged — left for review per task instructions.

---

## 2026-07-18 00:50 IST — Antigravity

### Task
Audit and update Markdown documentation to align with the current production infrastructure, OpenAlgo setup on `Bazaarmood2`, data-source flows, and planned Shoonya migration.

### Summary
- **Infrastructure Docs Update:** Updated `docs/PRODUCTION_INFRASTRUCTURE.md` with:
  - Details for the new dedicated OpenAlgo VM `Bazaarmood2` (`146.56.55.42`) and preserved existing `indian-dashboard-collector` VM (`92.4.75.251`) untouched.
  - Resource footprints and Oracle Always Free capacity warnings (2 OCPUs, 12 GB RAM, 94 GB boot storage total).
  - OpenAlgo service configuration (`openalgo.service`, Python 3.12 compatibility from deadsnakes PPA, ~721 MB RAM, Unix socket `/var/python/openalgo/openalgo.sock` plus WebSocket proxy).
  - Nginx reverse proxy configuration and Let's Encrypt SSL certificate details (expiry 2026-10-15).
  - Persistence of OCI and host firewall rules in `/etc/iptables/rules.v4` using `netfilter-persistent`.
  - Clarified that OpenAlgo is operational as a separate standalone Upstox instance, but is not yet integrated into the Indian Dashboard production data path.
- **Project Master Architecture:** Updated `docs/PROJECT_MASTER.md` and `PROJECT_SUMMARY.md` to:
  - Reflect standard Oracle production build requirements (`NITRO_PRESET=node-server npm run build`).
  - Correct fallback statements regarding synthetic/mock option chains (strictly no mock data in live code paths).
  - Outline the planned Shoonya migration target architecture.
- **Durable Safeguards in AGENTS.md:** Appended concise operational rules covering Python 3.12 dependency, secrets protection, Bazaarmood2 isolation, Oracle build command, and Shoonya transition steps.
- **Current Roadmap Task:** Updated `docs/CURRENT_TASK.md` marking the dedicated OpenAlgo-Upstox setup phase complete, and adding Shoonya onboarding to the active task lists.

### Files Changed
- `AGENTS.md`
- `docs/PRODUCTION_INFRASTRUCTURE.md`
- `docs/SESSION_HANDOVER.md`
- `docs/CHANGELOG.md` (this file)
- `docs/CURRENT_TASK.md`
- `docs/PROJECT_MASTER.md`
- `PROJECT_SUMMARY.md`

---

## 2026-07-16 23:37 IST — Claude Sonnet 5

### Task
Complete and audit OI Analysis V2 (real historical OI analysis) on branch
`feat/oi-analysis-real-history`, then commit the verified work locally.

### Summary
- **Historical integration:** `/oi-analysis` now wires LIVE and HISTORICAL modes to
  the real backend option-chain and OI-activity history endpoints
  (`/api/option-history`, `/api/oi-history`) via `historicalOptionQuery` /
  `historicalOiActivityQuery` in `dashboard-query.ts`. No mock/synthetic OI data
  in any path.
- **Real time-window presets (3m/5m/10m/15m/30m/1h/2h/3h/Full Day):** Replaced a
  non-reactive, wrongly-keyed in-memory buffer with a reactive backend snapshot
  series (`liveHistorySnapshots`, built with `useMemo` from the historical
  queries). Root causes fixed:
  1. Time windows were anchored to `Date.now()` because the code read
     non-existent fields (`optionChain.timestamp`, `snapshot_time`); corrected to
     the real fields (`OptionChain.updatedAt`, `HistoricalOptionChainSnapshot.timestamp`,
     both epoch ms, IST-derived via `parseIstToUtcEpoch`).
  2. Baseline snapshots were hydrated into a mutable module-level `Map` that
     React never re-rendered from; replaced with a `useMemo`-derived series so
     every preset change recomputes correctly.
  Verified against the live backend: NIFTY, expiry 21-Jul-2026, 258 real
  snapshots, latest 15:30:28 IST; 3m baseline resolved to 15:27:28, 5m to
  15:25:28, 15m to 15:15:28, each with distinct non-zero signed OI deltas.
- **Chart fixes:** Responsive bar/group width that compresses to fit the
  container (no desktop horizontal scroll at 1920/1366/1024px; scoped dark
  scrollbar only as a last resort on narrow widths). Tooltip rewritten as a
  fixed-position, `pointer-events-none` overlay (no more hover jitter/layout
  shift) and simplified to Strike, Call OI, Put OI, Call ΔOI, Put ΔOI only.
- **Visual/compactness:** Signed bars with zero baseline, hatch/drain OI-change
  treatment, ~10-15% denser page layout, RadialGauge switched to a robust
  centered flexbox overlay (no magic offsets).
- **Data-trust safeguards:** Explicit stale-data guards so a symbol/date/expiry
  change never shows the previous selection's data; honest "Insufficient
  History" warning when no valid comparison snapshot exists (never fabricated
  zero movement); historical no-data states disable time controls.
- **Dead-code cleanup:** Removed `src/features/oi-analysis/oiHistoryStore.ts`
  (superseded module-level buffer, zero remaining imports), a dead synthetic
  linear-interpolation helper (`scaleSnapshotForWindow`, zero call sites), and a
  duplicated inline `<style>` scrollbar block already covered by `styles.css`.
  Updated `docs/PROJECT_MASTER.md`'s state-management section to describe the
  reactive-series pattern instead of the removed store.

### Files Changed
- `src/features/oi-analysis/OIAnalysisPage.tsx`
- `src/features/oi-analysis/components/BottomPanels.tsx`
- `src/features/oi-analysis/components/ChartToolbar.tsx`
- `src/features/oi-analysis/components/OIChart.tsx`
- `src/features/oi-analysis/components/OISidebar.tsx`
- `src/features/oi-analysis/components/RadialGauge.tsx`
- `src/features/oi-analysis/components/SymbolSelector.tsx`
- `src/features/oi-analysis/components/TimeControls.tsx`
- `src/features/oi-analysis/hooks/useOIAnalysis.ts`
- `src/features/oi-analysis/hooks/useTimeWindow.ts`
- `src/features/oi-analysis/oiHistoryStore.ts` (deleted)
- `src/features/oi-analysis/transformOptionChain.ts`
- `src/features/oi-analysis/types.ts`
- `src/features/oi-analysis/utils.ts`
- `src/lib/dashboard-query.ts`
- `src/styles.css`
- `docs/PROJECT_MASTER.md`

### Why
Time-window presets silently showed no real change and, after market close,
always fell back to wall-clock timing that could never match saved snapshots.
The chart also side-scrolled and jittered on hover at common desktop widths.
This work fixes the root causes with real backend history instead of any
synthetic/interpolated approximation, per the project's real-data-only mandate.

### Validation
- `git diff --check`: ✅ clean (no whitespace/conflict-marker errors)
- `npx tsc --noEmit`: 2 pre-existing, unrelated errors only —
  `src/components/IndexContribution/IndexContributionChart.tsx` and
  `src/lib/services/supabase.server.ts`. **Zero OI Analysis errors.**
- `npm run build`: ✅ exit 0 (client + ssr + nitro)
- Runtime: dev server SSR of `/oi-analysis` returned HTTP 200 with no
  error-boundary output; `/api/option-history` and `/api/oi-history` verified
  live against the running dev server (377 real snapshots across 3 expiries;
  5,397 real strike-level OI rows for the active expiry). Baseline-selection
  arithmetic for 3m/5m/15m independently reproduced against this live data with
  correct target timestamps and distinct non-zero deltas.
- No database schema, scheduler, or Supabase dual-write logic was touched.

### Remaining Risks / Follow-ups
- Tooltip is not clamped to the viewport edge (minor cosmetic risk near screen
  edges).
- `pcrOIChange` is currently computed identically to `pcr` (pre-existing
  simplification, out of scope for this task).
- No browser-automation click-through was available in this environment;
  verification relied on live endpoint responses, SSR rendering, and
  independent reproduction of the baseline-selection arithmetic rather than
  literal UI clicks.
- Feature branch `feat/oi-analysis-real-history` is committed locally only; not
  merged, pushed, or deployed.

## 2026-07-15 22:50 IST — Codex (GPT-5)

### Task
Merge the approved Index Contribution implementation into `main` and deploy it safely to the Oracle production server.

### Files Changed
- `docs/CHANGELOG.md`
- `docs/SESSION_HANDOVER.md`

### Deployment
- Confirmed `feat/index-contribution-professional-ui` was clean at approved commit `1133acb93f8b78c40725a8c393a045ce817d3261`, and that `origin/main` still matched the feature branch merge base.
- Merged without squash or rebase through merge commit `4dd97f378731f947ecaa2fdf28be90262d06fa76` and pushed `main`.
- Ran the existing `/home/ubuntu/deploy-indian-dashboard.sh` script. It pulled `main`, installed dependencies, built with `NITRO_PRESET=node-server`, restarted PM2 process `indian-dashboard`, and saved PM2 state.

### Validation
- Local `git diff --check HEAD~2..HEAD` and merge-parent diff check: ✅ exit 0.
- Local `NITRO_PRESET=node-server npm run build`: ✅ exit 0.
- Oracle Linux ARM64 deployment build: ✅ exit 0.
- PM2 `indian-dashboard`: online with zero unstable restarts; bound only to `127.0.0.1:3000`.
- Public `https://bazaarmood.com/` and `/index-contribution`: HTTP 200.
- Browser verified NIFTY 50, BANK NIFTY, and SENSEX selection; Prev, Intraday, 3m, 5m, 15m, and 1h controls; positive/negative contribution lines; the thin dotted index-price line; contributor tables; and dark side scrollbars.
- Reconciliation remained exact (`0.00`) for all three indices on Intraday and for all six SENSEX periods. Unchanged values remained stable over 10.5 seconds, and browser logs contained no hydration or runtime errors.

### Remaining Risks / Warnings
- The Index Contribution client chunk is approximately 1.16 MB minified; the build reports the existing large-chunk warning.
- The Oracle dependency audit reports one low-severity vulnerability, and existing Vite externalization/code-splitting warnings remain.
- Production PM2 error history retains older stale-cache, expired-FYERS fallback, and Supabase duplicate-key warnings. Post-deployment requests added only market-closed stale-cache warnings; no fresh startup/runtime failure was observed.
- The production worktree retains its pre-existing modified `package-lock.json`; it was not changed or reverted by this deployment task.

## 2026-07-15 19:38 IST — Codex (GPT-5)

### Task
Merge the approved Chart Lab work into `main` and deploy it safely to the Oracle production server.

### Files Changed
- `docs/CHANGELOG.md`
- `docs/SESSION_HANDOVER.md`

### Deployment
- Merged `feat/chartlab-supabase-oi-read` into `main` with merge commit `673f4436e1dd005714b38d5943788555e2f00063`; approved commits `8c4ce0a` and `35d8235` remain intact.
- Pushed `main` and ran the existing `/home/ubuntu/deploy-indian-dashboard.sh` script on the Oracle VM.
- The script pulled `main`, installed dependencies, built with `NITRO_PRESET=node-server`, restarted PM2 process `indian-dashboard`, and saved PM2 state.

### Validation
- Local `git diff --check HEAD~2..HEAD`: ✅ exit 0.
- Local `NITRO_PRESET=node-server npm run build`: ✅ exit 0.
- Oracle deployment build: ✅ exit 0 on Linux ARM64.
- PM2: `indian-dashboard` online with zero unstable restarts; listening only on `127.0.0.1:3000`; local server HTTP 200.
- Public smoke tests: `https://bazaarmood.com/` and `/chart` returned HTTP 200.
- Browser-verified candles, approved OI profile, relevant strike labels, EOD snapshot data, CE+PE activity volume, and no white-screen regression.
- Post-smoke PM2 log checkpoint added no fresh runtime error lines.

### Remaining Risks / Warnings
- Existing production browser hydration mismatch (React error #418) remains; the page recovers and renders fully.
- Historical PM2 logs retain older stale-cache, expired-FYERS fallback, and Supabase duplicate-key warnings; no new lines appeared during the smoke test.
- Production `npm install` reports one low-severity dependency vulnerability, and the build retains existing bundle/externalization warnings.
- The production worktree retains its pre-existing modified `package-lock.json`; it was not changed or reverted by this deployment task.

---

## 2026-07-15 18:39 IST — Codex (GPT-5)

### Task
Correct the Chart Lab OI overlay to match the user's final supplied broker-profile screenshot.

### Files Changed
- `src/features/chart/ChartLabPage.tsx`
- `docs/CURRENT_TASK.md`
- `docs/SESSION_HANDOVER.md`
- `docs/CHANGELOG.md`

### What Changed
- Replaced the red/green OI body gradients with flat muted fills and square edges.
- Restored draining OI as a sharp chart-background hollow box with a complete same-color outline at the bar's left edge; building OI retains the same-color hatch.
- Expanded the OI profile reach to use the available chart width up to 600px, matching the reference's long right-anchored bars.
- Switched the candlestick last-price line to dashed styling and aligned the custom price-label color with the latest candle direction.
- Updated the legend to describe and preview the hollow draining state accurately.

### Why
The previous gradient/open-edge inset styling visibly differed from the user's final reference, which requires flat broker-style bodies and distinct outlined draining caps.

### Validation
- Browser-verified the NIFTY EOD overlay against the supplied screenshot: flat wide bars, square corners, hollow outlined draining tips, right-side strike labels, and touching CE/PE rows.
- Audited the full six-file change set; removed leftover Chart Lab debug logging and confirmed no mock data, synthetic data, hard-coded test values, or unrelated runtime changes were introduced.
- `NITRO_PRESET=node-server npm run build`: ✅ exit 0.
- Existing unrelated warnings remain: Chart Lab hydration mismatch, `LiveScanner` route code-splitting warning, and standard bundle/externalization warnings.

### Remaining Risks
- Visual proportions depend on the available chart width, but bar reach is capped at 600px to preserve the reference behavior without overflowing smaller viewports.
- No collector, database write, broker authentication, schema, or production data files were changed.

---

## 2026-07-15 18:17 IST — Codex (GPT-5)

### Task
Implement and verify the Chart Lab Supabase-first EOD/latest OI read, then refine the OI profile UI to match the supplied broker-chart reference.

### Files Changed
- `src/lib/services/historicalDataService.server.ts`
- `src/lib/chart.functions.ts`
- `src/features/chart/ChartLabPage.tsx`
- `docs/CURRENT_TASK.md`
- `docs/SESSION_HANDOVER.md`
- `docs/CHANGELOG.md`

### What Changed
- Added coherent latest-complete OI snapshot selection across matching trading date, time, symbol, and expiry, using Supabase first and SQLite as a whole-snapshot fallback.
- Preserved the existing public Chart Lab EOD response shape and `source: "db" | "eod_cache"` contract.
- Changed hatch/drain semantics to the immediately preceding complete refresh only; exchange/session `oiChg` is no longer treated as the latest refresh delta.
- Kept final EOD refresh styling visible after market close by comparing the latest two same-store coherent snapshots; building OI uses same-colour hatching and draining OI uses a dim body with a hollow tip.
- Added exact strike-only right-axis labels, responsive wider OI bars, touching CE/PE bar pairs, and a viewport-fitted chart with no page scroll.
- Recreated the lightweight-chart instance on index changes so stale retained query data cannot leave the new symbol blank.
- Polished OI profile rendering: draining no longer darkens the entire bar, base fills remain evenly legible, and capped open-edge change insets blend into the bar instead of looking like attached outlined boxes.
- Reused existing real CE+PE volume history as an intraday index-volume fallback when Yahoo index candles contain no traded volume.

### Validation
- Runtime checked NIFTY, BANKNIFTY, and SENSEX Supabase lineage and isolated SQLite fallback for 2026-07-15.
- Browser-verified NIFTY, BANKNIFTY, and SENSEX switching, visible candles, exact strike labels, no page scroll, and CE+PE activity volume.
- Read-only runtime verification confirmed Supabase final-refresh deltas at 15:30:42 IST: NIFTY 18 CE/20 PE changed strikes, BANKNIFTY 17 CE/17 PE, and SENSEX 0/0 (correctly solid).
- `NITRO_PRESET=node-server npm run build`: ✅ exit 0.
- `tsc --noEmit` remains blocked by the pre-existing unrelated type error at `src/lib/services/supabase.server.ts:1105`.

### Remaining Risks
- CE+PE volume history remains on its existing SQLite reader, so local partial history produces a partial-day volume histogram.
- Existing Chart Lab hydration mismatch and `LiveScanner` route code-splitting warning remain outside this task.

---

## 2026-07-15 00:45 IST — Antigravity (Gemini)

### Task
Phase 2A complete — historical data integration. Fully implemented, production-verified, and deployed the entire historical range backend query infrastructure across all data domains.

### Files Changed
- `src/lib/services/database.server.ts` (Modified)
- `src/lib/services/historicalDataService.server.ts` (Modified)
- `src/lib/services/supabase.server.ts` (Modified)
- `src/routeTree.gen.ts` (Modified)
- `src/routes/api/breadth-history.ts` (Modified)
- `src/routes/api/market-history.ts` (Modified)
- `src/routes/api/oi-history.ts` (Modified)
- `src/routes/api/option-history.ts` (Modified)
- `src/routes/api/sector-history.ts` (Modified)
- `docs/CHANGELOG.md` (Modified — this entry)
- `docs/CURRENT_TASK.md` (Modified)
- `docs/SESSION_HANDOVER.md` (Modified)

### What Changed

#### Database & Supabase Range Query Support Completed
- **Files:** `src/lib/services/database.server.ts`, `src/lib/services/supabase.server.ts`
- Added read-only range query methods for Option Chains (`getOptionHistoryRangeRaw` / `getSupabaseOptionHistoryRange`), OI Activity (`getOiActivityHistoryRangeRaw` / `getSupabaseOiActivityHistoryRange`), Market Breadth (`getBreadthHistoryRangeRaw` / `getSupabaseBreadthHistoryRange`), and Sector Strength (`getSectorStrengthHistoryRangeRaw` / `getSupabaseSectorStrengthHistoryRange`).
- Implemented paginated Supabase calls matching the safety-cap limits (15,000 threshold with index-level probe) and SQLite fallbacks.

#### Historical Orchestration Completed
- **File:** `src/lib/services/historicalDataService.server.ts`
- Added custom interfaces (`HistoricalOptionChainSnapshot`, `HistoricalOiActivityRow`, `HistoricalMarketBreadthRow`, `HistoricalSectorStrengthRow`) and their normalized mappings.
- Added daily interval sampling algorithms that respect the `09:15` IST trading hour start boundary, daily resets, and custom symbols.
- Set up domain-specific orchestrators (`getHistoricalOptionHistory`, `getHistoricalOiActivityHistory`, `getHistoricalBreadthHistory`, `getHistoricalSectorStrengthHistory`) with 3-second Supabase timeout races and clean event loop clearing.

#### API Route Upgrades Completed
- **Files:** `src/routes/api/*`
- Refactored history routes (`breadth-history.ts`, `market-history.ts`, `oi-history.ts`, `option-history.ts`, `sector-history.ts`) to fully support range parameters (`startDate` & `endDate`) with strict date-handling validation.
- Added custom headers indicating data source lineage (`X-Data-Source: supabase`/`sqlite`) and date ranges.

#### Production Verification & Deployment
- Successfully completed production Nitro builds using preset `NITRO_PRESET=node-server`.
- Deployed code commit `ddb92ac` to Oracle production VM under PM2 process `indian-dashboard`.
- Verified live scheduler execution, Angel One auto-login, and live API responses returning `HTTP 200` with Supabase data lineage headers.

### Why
To complete the backend historical range-query infrastructure, enabling option chain, OI, market breadth, and sector strength historical visualization and backtesting in subsequent phases.

### Build / Test Result
All builds passed successfully (Exit code 0). Checked all 5 range routes locally and in production.

---

## 2026-07-14 22:00 IST — Antigravity (Gemini)

### Task
Phase 2A Part 1 complete — market-history vertical slice. Market snapshot history orchestration and GET /api/history/$symbol range integration completed.

### Remaining Phase 2A Work
Option-chain, OI, breadth, sector, and other historical range domains.

### Files Changed
- `src/lib/services/historicalDataService.server.ts` (NEW)
- `src/lib/services/database.server.ts` (Modified)
- `src/lib/services/supabase.server.ts` (Modified)
- `src/routes/api/history.$symbol.ts` (Modified)
- `docs/CHANGELOG.md` (Modified — this entry)
- `docs/CURRENT_TASK.md` (Modified)
- `docs/SESSION_HANDOVER.md` (Modified)

### What Changed

#### Shared Historical Types and Normalization helpers (NEW)
- **File:** `src/lib/services/historicalDataService.server.ts`
- Added normalized data type `HistoricalMarketSnapshot` mapping SQLite/Supabase snapshots into a unified API-compatible camelCase format.
- Implemented robust host-independent `getTodayIstString` using `Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata" })`.
- Added date range validation (`validateDateRange`) capping requests to 14 days, and interval parsing (`parseInterval`) accommodating suffix modifiers (e.g. `5m`).
- Created timezone-agnostic `parseIstToUtcEpoch` calculating epoch milliseconds while validating valid calendar dates (rejecting `2026-02-30`).
- Created memory-based downsampling function `sampleMarketSnapshots` grouping ticks to nearest interval boundaries starting from `09:15` IST.

#### Read-Only SQLite Range Query
- **File:** `src/lib/services/database.server.ts`
- Added read-only method `getMarketHistoryRangeRaw` returning raw database rows sorted by `trading_date ASC, timestamp ASC, id ASC`.

#### Paginated Supabase Range Query with Probe Check
- **File:** `src/lib/services/supabase.server.ts`
- Added `getSupabaseMarketHistoryRange` retrieving rows up to a 15,000 safety threshold.
- If the 15th page is full, it executes an index-level single-row probe query `.range(15000, 15000)`. It throws `SupabaseHistoryPaginationCappedError` if additional rows exist, preventing silent truncation.

#### Historical Range Orchestration
- **File:** `src/lib/services/historicalDataService.server.ts`
- Implemented `getHistoricalMarketHistory` incorporating symbol normalisation, a 3-second timeout race on Supabase requests, and SQLite fallbacks.
- Segregated three control flow paths:
  1. *Supabase succeeds with rows*: Uses Supabase data, sets source `supabase`.
  2. *Supabase succeeds with 0 rows*: Queries SQLite once, returning `sqlite` source.
  3. *Supabase fails/times out*: Logs warning, queries SQLite once. Throws combined details on failure.
- Chronological sorting is applied before deduplication (keeping the first occurrence of `trading_date` + `trading_time` + `symbol`) and downsampling.

#### Upgraded GET /api/history/$symbol
- **File:** `src/routes/api/history.$symbol.ts`
- Upgraded to support range queries (`startDate` & `endDate`) while maintaining legacy single-date parameter support (`date`).
- Returns data source in `X-Data-Source`, `X-Requested-Start-Date`, `X-Requested-End-Date`, and `X-Actual-Dates` headers.

### Why
To build the foundation of Phase 2 historical data, providing a robust, error-tolerant range query interface for market indices.

### Build / Test Result
`npm run build` completed successfully (Exit code 0). Tested all 7 API endpoints against local dev server and verified correct responses/headers.

---

## 2026-07-14 19:56 IST — Antigravity (Gemini)

### Task
Implement Supabase duplicate-prevention index migration and deploy robust server-side option chain parent-ID fallback resolution.

### Files Changed
- `src/lib/services/supabase.server.ts` (Modified)
- `AGENTS.md` (Modified)
- `docs/PRODUCTION_INFRASTRUCTURE.md` (Modified)
- `docs/SESSION_HANDOVER.md` (Modified)
- `docs/CURRENT_TASK.md` (Modified)
- `docs/CHANGELOG.md` (Modified — this entry)

### What Changed

#### Production Code Fix (Commit efcab02)
- **File:** `src/lib/services/supabase.server.ts`
- **Fallback Resolution:** Removed the direct `.single()` query from `option_chain_snapshots` upsert result to prevent failure when duplicates are ignored and zero rows are returned.
- **Deduplication Lookup:** Added a safe fallback lookup matching the business keys (`trading_date`, `trading_time`, `symbol`, `expiry`) using `.maybeSingle()`.
- **Integrity Preservation:** Child `oi_activity` inserts proceed only after a valid parent ID is resolved, keeping SQLite live collection non-blocking and fire-and-forget.

#### Supabase Migration (Unique Business-Key Indexes)
Created the following unique indexes in Supabase Postgres to prevent duplicates:
- `uq_market_snapshots_business_key` on `market_snapshots(trading_date, trading_time, symbol)`
- `uq_market_breadth_business_key` on `market_breadth(trading_date, trading_time)`
- `uq_sector_strength_business_key` on `sector_strength(trading_date, trading_time, symbol)`
- `uq_option_chain_snapshots_business_key` on `option_chain_snapshots(trading_date, trading_time, symbol, expiry)`
- `uq_oi_activity_business_key` on `oi_activity(snapshot_id, strike)`

*Excluded:* `trade_signals` (due to different time keys/schema), `system_logs` (logging duplicates is allowed by design), and `snapshot_time`-based uniqueness.

#### Historical Uniqueness Analysis & Findings
- Audited the 13 July manual backfill and confirmed it contains repeated `snapshot_time` values for some tables, proving that `snapshot_time` must not be used as a cross-history uniqueness key.
- Established `trading_date` + `trading_time` as the canonical historical uniqueness keys.

#### Validation Results
- Verified all 5 indexes with `is_unique = true` in Supabase Postgres.
- Duplicate audit returned 0 duplicate groups and 0 extra duplicate rows for all 5 tables.
- Oracle VM deployed latest commit `efcab02` and PM2 process is online, listening on `127.0.0.1:3000` with Supabase dual-write active. No conflict, duplicate, or parent-ID resolution errors appeared in logs.

### Why
To enforce database-level duplicate prevention on Supabase Postgres while ensuring that conflict resolution does not cause option chain parent ID lookup failures or block the primary SQLite live collection.

### Build / Test Result
`npm run build` passed for production code commit efcab02 before the documentation-only update.

---

## 2026-07-14 18:12 IST — Antigravity (Gemini)

### Task
Documentation-only update to record the official completion of the automatic Supabase dual-write live verification milestone and transition the project to the Historical Data and Backtesting phase.

### Files Changed
- `AGENTS.md` (Modified)
- `docs/PRODUCTION_INFRASTRUCTURE.md` (Modified)
- `docs/SESSION_HANDOVER.md` (Modified)
- `docs/CURRENT_TASK.md` (Modified)
- `docs/CHANGELOG.md` (Modified — this entry)

### What Changed

#### Live Production Verification Complete (14 July 2026, 18:01 IST)
- Verified automatic Supabase dual-write during live market hours from **09:15:03 to 15:30:03 IST** on 14 July 2026.
- Confirmed a full trading session was continuously captured and saved to both local SQLite and Supabase Postgres without errors. No fresh Supabase schema or insert errors appeared in PM2 logs.
- The previous status "pending live verification" has been marked as **verified complete** / **closed** in all documentation files.
- The verified 14 July full-session automatic dual-write counts are restricted to the following four tables:
  - `market_snapshots`: 1504
  - `market_breadth`: 376
  - `sector_strength`: 4512
  - `option_chain_snapshots`: 1128

#### Historical Milestones Preserved
- The 13 July manual backfill milestone (with counts for `market_snapshots`, `market_breadth`, `sector_strength`, `option_chain_snapshots`, `oi_activity`, and `trade_signals`) remains historically separate from this 14 July automatic live dual-write verification.

#### Shift to Historical Data and Backtesting Phase
- Reset the active task in `CURRENT_TASK.md` to target: "Last 7 Trading Days Historical Data, Date-Range Charts, and Backtesting Pipeline."
- Defined detailed roadmap phases:
  - **Phase 1**: Existing storage and API audit
  - **Phase 2**: Seven-trading-day historical data
  - **Phase 3**: Date-range charts
  - **Phase 4**: Backtesting pipeline
  - **Phase 5**: Validation
- Handed over the current status in `SESSION_HANDOVER.md` to transition from live verification to the upcoming audit and implementation phases.

### Why
To document the successful verification of the dual-write infrastructure and outline the scope and phases for the upcoming Historical Data & Backtesting work.

### Build / Test Result
Build not run (documentation-only session).

---

## 2026-07-13 19:47 IST — Antigravity (Claude Sonnet 4.6 — Thinking)

### Task
Documentation-only update: record verified 13 July 2026 production state across
all living documentation files. No application code changed.

### Files Changed
- `AGENTS.md` (Modified)
- `docs/PRODUCTION_INFRASTRUCTURE.md` (Modified)
- `docs/SESSION_HANDOVER.md` (Modified)
- `docs/CHANGELOG.md` (Modified — this entry)
- `docs/PROJECT_MASTER.md` (Modified)
- `docs/CURRENT_TASK.md` (Modified)

### What Changed

#### Full-Day SQLite Verification — 13 July 2026
The Oracle VM SQLite database (`backend/database/market_data.db`) successfully
stored a complete market session from ~09:15:10 to ~15:30:10 IST.

Verified SQLite row counts:

| Table | Count |
|-------|-------|
| `market_snapshots` | 1504 |
| `market_breadth` | 376 |
| `sector_strength` | 4512 |
| `option_chain_snapshots` | 1128 |
| `oi_activity` | 23688 |
| `trade_signals` | 0 |

Interpretation: 376 scheduler ticks; 4 market snapshot rows per tick; 3 option-chain
snapshots per tick; 12 sector rows per tick; 21 OI activity rows per option-chain snapshot.
`trade_signals` = 0 is expected (separate feature, not yet active).

#### Supabase Schema Repair
The following schema mismatches were fixed manually in Supabase to align with the
current scheduler insert payload:

- **`market_snapshots`** — added `change_pct`, `change_val`; aligned other missing fields
- **`option_chain_snapshots`** — added `expiry`; aligned current snapshot fields
- **`market_breadth`** — added `adr`
- **`sector_strength`** — added `change_pct`, `name`; removed old `sector_name NOT NULL` blocker
- **`oi_activity`** — `snapshot_id` changed from `bigint` → **UUID**; UUID FK added to
  `option_chain_snapshots(id)` with `ON DELETE CASCADE`; removed `symbol NOT NULL` blocker

#### UUID Relationship Correction
`option_chain_snapshots.id` = UUID (primary key).
`oi_activity.snapshot_id` = UUID foreign key → `option_chain_snapshots(id)` ON DELETE CASCADE.
Do not change `oi_activity.snapshot_id` back to bigint.

#### Full-Day Supabase Backfill — 13 July 2026
The complete 13 July 2026 trading-day dataset was backfilled into Supabase and
verified. Final Supabase counts match the SQLite counts exactly (1504 / 376 / 4512
/ 1128 / 23688). The temporary backfill script was deleted after a successful run.

#### PM2 State Saved
PM2 process list was saved with `pm2 save` on the Oracle VM after confirming the
`indian-dashboard` process was online.

#### Documentation Updates
- **`AGENTS.md §13`** — added the three critical collector files to the Forbidden
  Actions table.
- **`AGENTS.md §16`** — new "Production Data Safety" section: build command rule,
  dual-storage architecture, critical file list, Supabase schema key relationships,
  server/client boundary, verified production state, row counts, next-session
  verification command, safe UI development rules.
- **`docs/PRODUCTION_INFRASTRUCTURE.md`** — comprehensive update: Oracle VM details,
  PM2/Nginx/SSL confirmation, dual-write architecture section, schema tables,
  Supabase schema fixes record, full-day verification counts, verification status
  table, next-session checklist, `CLIENT_CODE`/`CLIENT_ID` issue marked resolved.
- **`docs/PROJECT_MASTER.md §18`** — new "Production Data Safety" section added
  (canonical dual-storage architecture, critical files, Supabase schema rules,
  server/client boundary).
- **`docs/CURRENT_TASK.md`** — infrastructure status note added (IDLE preserved).

### Why
Ensure every future AI agent understands the current production data-storage setup
and does not accidentally break the dual-write architecture, Supabase UUID
relationships, or critical collector files.

### Build / Test Result
Build not run (documentation-only session).

### Remaining / Pending
- **Automatic Supabase dual-write verification**: must be checked on the next live
  market session (14 July 2026 or later). Instructions in
  `PRODUCTION_INFRASTRUCTURE.md §9`.
- **Trade signals feature**: `trade_signals` table is empty; separate future task.

---

## 2026-07-13 01:45 IST — Antigravity (Gemini 3.5 Flash)

### Task
Fix broker connection-status issues for Angel One and FYERS.

### Files Changed
- `src/lib/services/angelOneService.ts` (Modified)
- `src/lib/settings.functions.ts` (Modified)
- `src/components/DashboardShell.tsx` (Modified)
- `docs/CHANGELOG.md` (Modified)
- `docs/SESSION_HANDOVER.md` (Modified)

### What Changed
- **Angel One Fix & Standardization**: Replaced all occurrences of `ANGEL_ONE_CLIENT_ID` with `ANGEL_ONE_CLIENT_CODE` in the runtime source code (`src/`) to standardize the client code configuration. Added a robust fallback to `ANGEL_ONE_CLIENT_ID` in `angelOneService.ts` and `settings.functions.ts` to prevent "Missing Env" errors if the environment has not been updated yet. Configured the settings check to log safe, credential-sanitized error logs and successes. Ensure cached sessions are reused when valid. Replaced regex-based credential sanitization with a safe plain-string helper (`redactSecret`) to prevent regex injection errors when environment variables contain special characters.
- **FYERS Diagnosis & Fix**: Configured the Fyers status checker to perform a real API health check using `getOptionChain` on a dummy spot price. Improved status reporting to return detailed states that are distinguished in the UI: Missing Token, Expired Token, Invalid Token, API Connection Error, and Connected. Added a robust Fyers token sanitizer (`cleanFyersToken`) that removes any formatting/newlines from terminal wrapping, and automatically parses and extracts the raw token if the user pastes the entire python dictionary (`{'access_token': '...', 's': 'ok'}`) or JSON format.
- **UI Customizations**: Modified the settings popup in the top navigation bar to render colored badges and descriptive text depending on the detailed status text.
- **Build Verification**: Ran standard (`npm run build`) and production (`NITRO_PRESET=node-server npm run build`) validations cleanly.

## 2026-07-13 01:25 IST — Antigravity (Gemini 3.5 Flash)

### Task
Create production infrastructure documentation and update mandatory reading order.

### Files Changed
- `docs/PRODUCTION_INFRASTRUCTURE.md` (New)
- `AGENTS.md` (Modified)
- `docs/PROJECT_MASTER.md` (Modified)
- `docs/CHANGELOG.md` (Modified)
- `docs/SESSION_HANDOVER.md` (Modified)

### What Changed
- **Created Production Infrastructure Documentation**: Documented connection of local development to GitHub, Oracle Cloud VM, PM2, Nginx, SSL, live domain, Supabase, SQLite, broker APIs, scheduler, build commands, and security rules.
- **Updated Reading Order**: Added `docs/PRODUCTION_INFRASTRUCTURE.md` to the mandatory reading order in `AGENTS.md` and `docs/PROJECT_MASTER.md`.
- **Referenced Deploy Rules**: Added a reference to `docs/PRODUCTION_INFRASTRUCTURE.md` in `docs/PROJECT_MASTER.md` overview.

## 2026-07-09 10:50 IST — Antigravity (Gemini 3.5 Flash)

### Task
Fix unresponsive top navigation bar and browser module crashes on development server.

### Files Changed
- `src/lib/services/settings.functions.ts` (Deleted)
- `src/lib/settings.functions.ts` (New)
- `src/components/DashboardShell.tsx` (Modified)
- `src/lib/nse.functions.ts` (Modified)
- `src/lib/market.functions.ts` (Modified)

### What Changed
- **Relocated settings functions**: Moved `settings.functions.ts` to `src/lib/` as per project standards.
- **Converted static imports to dynamic in functions**: Removed top-level static imports of server-only modules (`persistentCache` and `marketDataLayer`) in `settings.functions.ts`, `nse.functions.ts`, and `market.functions.ts`.
- **Resolved dev-mode crash**: Isolated Node-only dependencies (`node:fs`, `node:path`) so they do not leak into the browser environment when Vite dev-server runs in non-tree-shaking development mode.
- **Verified navigation functionality**: Verified navigation and page switching using browser subagent. Standard development HMR works cleanly without console errors.

## 2026-07-08 21:10 IST — Claude Opus 4.8

### Task
Completed Stale-Cache Audit and Scheduler Refresh Plan.

### Files Changed
- `src/lib/services/scheduler.server.ts`
- `src/lib/nse.functions.ts`
- `src/lib/services/persistentCache.ts`
- `src/lib/market.functions.ts`
- `src/lib/services/marketDataLayer.ts`

### What Changed
- Added scheduler-driven F&O stocks snapshot refresh every 2 minutes.
- Added scheduler-driven F&O screener snapshot refresh every 3 minutes.
- Added duplicate prevention so screener refresh does not cause unnecessary separate F&O stock refresh in the same tick.
- Added constituent/index contribution quote snapshot refresh every 5 minutes.
- Deduplicated NIFTY, BANKNIFTY, and SENSEX component symbols.
- Batched constituent quote refreshes safely.
- Added stale-cache warning helper in persistent cache reads.
- Propagated real broker/cache timestamps where possible.
- Exported needed F&O fetchers and cache-key generator for scheduler use.

### Why
Multiple dashboard pages depended on UI/page visits to refresh EOD snapshots. This caused old cached market data to appear after market close. Scheduler-driven refreshes ensure same-day snapshots are captured during market hours even when pages are not open.

### Verification
- `npm run build`: ✅ exit 0

### Notes / Risks
- Final freshness still needs to be verified during live market hours.
- After close, compare Sector Lab, Screener, F&O pages, and Index Contribution against trusted references such as StockMojo.

---

## 2026-07-08 — Supabase health check & monitoring API endpoint

### Added
- **`src/routes/api/supabase-health.ts`** — API endpoint (`GET /api/supabase-health`) returning the health status and row counts / latest timestamps of all 7 Supabase tables.
- **Health monitoring helpers in `supabase.server.ts`** — `getSupabaseHealthReport` and `getTableStats` functions to safely aggregate row counts and locate latest records without crashing or blocking.

---

## 2026-07-07 — Supabase dual-write from scheduler (SQLite + Supabase)


### Added
- **`SUPABASE_DUAL_WRITE` feature flag** — set to `true` in `.env` to enable dual-write.
  Default `false` keeps scheduler SQLite-only (safe for any environment).
- **3 new insert helpers** in `supabase.server.ts`:
  `insertMarketBreadth`, `insertSectorStrength`, `insertTradeSignal` (+ matching types).
- **`isDualWriteEnabled()` helper** — reads `process.env.SUPABASE_DUAL_WRITE`.
- **`dualWrite(label, promise)` wrapper** in `scheduler.server.ts` — void fire-and-forget
  that logs errors via `console.error` but NEVER throws and NEVER blocks the SQLite path.
- **Dual-write hooks in `scheduler.server.ts`** after each SQLite write:
  - `dbService.saveBreadth()` → `insertMarketBreadth()` (fire-and-forget)
  - `dbService.saveSnapshots()` → `insertMarketSnapshot()` (fire-and-forget, batched)
  - `dbService.saveSectors()` → `insertSectorStrength()` (fire-and-forget, batched)
  - `dbService.saveOptionChain()` → `insertOptionChainSnapshot()` then
    `insertOiActivity()` chained on the returned snapshot `id` (fire-and-forget)
  - `startScheduler()` startup log → `insertSystemLog()` (fire-and-forget)
- **`.env.example`** — `SUPABASE_DUAL_WRITE=false` placeholder added with comment.

### Unchanged
- `database.server.ts` — SQLite is always primary, completely untouched.
- All broker logic, routes, UI components.
- `scheduler.server.ts` async tick timing and error handling are identical.

---

## 2026-07-07 — Supabase integration layer (connection + insert test)

### Added
- **`@supabase/supabase-js`** dependency (8 packages).
- **`src/lib/services/supabase.server.ts`** — server-only Supabase client using
  `SUPABASE_SERVICE_ROLE_KEY` (never exposed to the browser). Lazy singleton.
  Exports: `insertSystemLog`, `insertMarketSnapshot`, `insertOptionChainSnapshot`,
  `insertOiActivity`. All are fire-and-forget safe (return bool/null, never throw).
- **`src/lib/supabase-test.functions.ts`** — TanStack server fn; inserts one row
  into `system_logs` and returns `{ ok, message, timestamp }`.
- **`src/routes/api/supabase-test.ts`** — `GET /api/supabase-test` API endpoint;
  returns JSON. Visit in browser to verify connectivity.
- **`.env.example`** — added `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` placeholder lines with inline comments.

### Unchanged
- Existing SQLite `database.server.ts` + scheduler: **untouched**.
- No broker logic, routes, or components modified.

---

## 2026-07-07 — Chart Lab: multi-symbol candle rendering fix

### Fixed
- **BANKNIFTY / SENSEX / stocks showed blank chart** when selected from the symbol picker.
  NIFTY continued working because it was always the initial symbol (no symbol-switch involved).
  Root cause: React Query `keepPreviousData` caused the old NIFTY candle response to remain
  in `cd` while the new symbol's fetch was in-flight. The `setData` effect fired immediately
  with stale NIFTY candles; when the correct data arrived, LWC's internal timestamp state was
  already set and silently rejected the second `setData` (swallowed by `try/catch`) → blank chart.

### Changes (`src/features/chart/ChartLabPage.tsx` only)
1. **Clear on symbol change** — `useEffect([sym.yahoo])` calls `setData([])` on candlestick and
   volume series when the symbol changes, resetting LWC's timestamp state before new data arrives.
2. **Stale-data guard** — `if (cd.symbol !== sym.yahoo) return` in both `setData` effects so
   old-symbol candles are never written to the new symbol's series.
3. **`fitContent` fix** — removed the now-redundant `cd.symbol === sym.yahoo` guard so `fitContent`
   reliably fires once when the correct data arrives.

### No changes to
- Query layer, server functions, symbol mapping, OI overlay, EOD logic, UI/theme.

---

## 2026-07-07 — Chart Lab: EOD OI bars + CE/PE volume histogram + 3m timeframe

### Added
- **EOD OI bars** — OI bars now show after market close using last saved snapshot.
  Fallback chain: SQLite `option_chain_snapshots` (per-strike via `oi_activity`) →
  `eod_cache/*.json` → "No OI snapshot available" clear state. GPT-5.5's correct
  logic implemented: market open → live OI, market closed → saved snapshot. Never
  silently hides bars.
- **`getEodOiSnapshot` server fn** (`chart.functions.ts`) — queries SQLite DB for the
  latest `option_chain_snapshots` row + joins `oi_activity` for per-strike OI. Falls
  back to `getEodOptionChain` from `persistentCache`.
- **`eodOiSnapshotQuery`** (`dashboard-query.ts`) — always-on query for indices, 2 min
  refetch when market open, 1 hour when closed.
- **LIVE / EOD badge** on OI Bars toggle button — green "LIVE" or blue "EOD" indicator.
- **`🗄 EOD Snapshot · HH:MM IST`** toolbar badge — shows when using saved snapshot.
- **CE/PE volume dual histogram** — green CE bars ↑ / red PE bars ↓ from SQLite
  `option_chain_snapshots` time-series (`getCepeVolHistory` + `cepeVolQuery`).
- **3m timeframe** — added to timeframe selector bar.
- **Hatched OI bars** — diagonal stripe pattern for building OI, hollow/drained look
  for unwinding OI. Matches screenshot reference.
- **`getEodOiSnapshot`** + **`getCepeVolHistory`** in `chart.functions.ts`.

### Changed
- `ChartLabPage.tsx` — complete rewrite with proper EOD/live data routing.
- `dashboard-query.ts` — added `cepeVolQuery` + `eodOiSnapshotQuery`.

---

## 2026-07-07 — Chart Lab bug fixes (Claude Sonnet 4.6, Antigravity)


### Fixed
- **Symbol switching** — changing to any stock/index now correctly renders its candles.
  Root cause: candle series lacked `priceScaleId: "right"` (LWC v5 requirement) and
  `setData` calls lacked error boundaries. Added `try/catch` + `prevSymTfRef` for
  clean symbol-change detection.
- **Volume histogram not appearing** — LWC v5 requires `chart.priceScale("vol").applyOptions()`
  to be called **after** `addSeries`. Previous code had the scale setup before add,
  so the `"vol"` scale was never wired. Fixed initialization order.
- **OI overlay bars not showing** — `priceToCoordinate` returned `null` silently because
  the candle series had no explicit `priceScaleId`. Setting `priceScaleId: "right"` on
  the candle series restored correct coordinate mapping.

### Notes
- Only `src/features/chart/ChartLabPage.tsx` changed. No new files. Build clean (exit 0).

---

## 2026-07-05 — Option Chain page redesign (StockMojo/OptionClock style) (Claude Opus 4.8)


### Changed
- Rebuilt `/optionchain` with the OptionClock-style dense terminal design on the
  **existing real data** (`optionChainQuery` → marketDataLayer: FYERS → Angel One
  → NSE → EOD; no synthetic). Page header removed (bare `DashboardShell`).
- **Buildup badges** now solid & 4-colour with strength shading: Long Buildup
  green · Short Buildup violet · Short Covering rose · Long Unwinding teal;
  **Strong = darkest solid, Weak = lightest**. Buildup derived via the
  underlying-direction proxy (call tracks index, put inverse) + OI-change sign;
  Strong when |OI chg%| > 14.
- **WTT / WTB / DF concentration engine** (`getColStatuses`) applied to CE/PE
  OI, Volume and OI-Chg columns with colour heat: DF (dominant OI wall), WTT/WTB
  (wall weakening toward top/bottom when 2nd ≥ 75% of max), gold ≥75%, dim-gold
  ≥50%; call max red, put max green.
- **High / Low / Spot bar** added top-centre and as the table footer (index
  day high/low/change via `quotesQuery`).
- **R1/R2/S1/S2 shifted below** the table as polished Resistance/Support cards
  (strike + basis + OI + OI-chg). Added **Stats cards** (PCR · CHG OI PCR ·
  VOLUME PCR · MAX PAIN · LOT SIZE) and per-row R.Level/S.Level (strike ± time
  value) + PCR OI/OIC. Subtle per-cell + strike borders; ATM highlighted.
- Functional expiry selector, source/EOD/FAIL badge, 10s auto-refresh retained.

### Final polish
- Spot bar (L | price | H) moved **inside the table** as a green-bordered
  divider row at the live-price bracket (between the two strikes around spot).
  Index change (+x.xx%) moved to the toolbar centre (above the strike column);
  EOD notice compacted to a chip beside the source badge. Buildup badges reduced
  to **green (bullish) / red (bearish)** only — Strong = darkest, Weak = lightest;
  each leg classified from its own OI + volume + price. Added a compact legend
  (buildup colours + DF / WTT / WTB / concentration). Subtle per-cell + strike
  borders. Page considered complete.

### Notes
- Real data only; `generateChain()` synthetic and cosmetic tick from the source
  snippet were NOT ported. `npm run build` clean (exit 0).

---

## 2026-07-06 — Chart Lab: Lightweight Charts with OI overlay (Claude Opus 4.8)

### Added
- **Chart Lab** (`/chart`) — professional live chart on TradingView's open-source
  **`lightweight-charts` v5**:
  - Candlestick + direction-coloured **volume** histogram (green up / red down).
  - **Right-side Call/Put OI bars overlay** at strike levels (red = Call OI /
    resistance, green = Put OI / support; bright tip = OI change) drawn as an
    HTML layer synced to the candle series via `priceToCoordinate` in a rAF loop.
    Live from `optionChainQuery` for NIFTY / BANKNIFTY / SENSEX.
  - **Symbol universe**: all indices (from `indexRegistry`), ~150 NSE F&O stocks,
    plus free-text search to load any NSE cash symbol (`.NS`). Timeframes
    1m/5m/15m/30m/1h/1D/1W. Header shows LTP + day change.
- **`getCandles`** server fn (`chart.functions.ts`) + `candlesQuery` — real OHLCV
  via Yahoo chart API (`v8/finance/chart`), timestamps shifted to IST. Live-verified
  (^NSEI, RELIANCE.NS, ^NSEBANK).
- **`chartSymbols.ts`** — client-safe symbol universe + typed-symbol resolver.

### Changed
- Top-nav: **Chart Lab ↔ Global Lab positions swapped**; Chart Lab is now active
  (→ `/chart`), Global Lab stays "coming soon".

### OI Analysis page — recent-refresh OI activity (same as Chart Lab)
- The `/oi-analysis` bars now use the **per-refresh incremental OI delta** (change
  since the last DISTINCT refresh, held until the next real refresh) for the
  default/live view — via a `recentSnapshot` in `OIAnalysisPage` mirroring the
  Chart Lab logic. So the hatched (increase) / hollow (decrease) decoration
  reflects recent activity instead of the whole-day `oiChg`, and persists across
  identical refetches. Explicit time presets (5m/30m/…) still use the recorded
  windowed change. **OI Analysis Pro untouched.** `npm run build` clean.

### Live OI hatched/draining — persist + bolder + incremental
- Hatched/hollow now driven by the **per-refresh incremental OI delta** (change
  since the last DISTINCT refresh), not the whole-day `oiChg` — so most bars stay
  solid and only recently-active strikes show a change accent (like the broker).
- **Persistence fix:** the delta only recomputes when OI values actually change;
  identical refetches keep the last delta, so the hatched/hollow stays visible
  until the next real refresh (was vanishing after ~2-3s).
- **Bolder hatch:** bright colour + dark diagonal stripes (4px), wider accent.

### Live OI hatched/draining effect
- OI-mode bars now show the **live building/draining effect**: during live market
  each Call/Put OI bar renders solid + the recent OI-change on the left tip —
  **building (OI↑) = hatched**, **draining (OI↓) = hollow outline + dimmer body**.
  Market closed (EOD) → plain solid bars only (matches Dhan). Requires the live
  option chain (`liveOc`) to be returning rows; otherwise it's EOD-solid.

### Volume + symbol-switch blank fix
- **Volume** now a single **candle-volume histogram** (green up / red down candle),
  matching the reference — works for stocks (indices have no traded volume).
  Replaced the non-functional CE/PE dual-histogram. Toggle relabelled "Volume".
- **Permanent fix for "only NIFTY renders, others blank":** `getCandles` never
  throws now (returns empty on failure); `candlesQuery` uses `keepPreviousData`;
  and the re-fit is gated on `cd.symbol === selected` so the keepPreviousData
  transition never leaves a new symbol stuck on the old view. Verified all
  symbols return candles (^NSEBANK, ^BSESN, RELIANCE, ^CNXIT, M&M, BAJAJ-AUTO).

### OI overlay — Dhan-style bars + settings panel
- OI bars rebuilt to match the Dhan reference: **solid thick Call (red) + Put
  (green) bars stacked per strike**, right-anchored, length = OI (sqrt-normalized
  so medium strikes stay visible), **square corners**, colours configurable.
- Added a compact **OI settings panel** (top-left): OI on/off · **OI ⇄ Change-in-OI**
  toggle · **Expiry** dropdown (live) · **Call/Put colour** pickers · CE/PE Vol ·
  LIVE/EOD badge.
- **Change-in-OI** mode (live only): bars diverge from a centre line — building
  = solid grows left, draining = hollow grows right (toward axis).
- **Market closed → solid OI only** (no hatched/draining; Change toggle disabled).
  Fixed root cause of invisible bars earlier: overlay `z-index` (`z-[3]`) so bars
  sit above the LWC canvas. Temporary diagnostics removed.

### Fixes (same day)
- Fixed a chart-creation race so **candles apply reliably** (stocks/any symbol now
  render, not just the initial index) — data is applied via a `ready` gate + data
  effects instead of the async create closure.
- Chart now **fits the screen** (`h-[calc(100vh-210px)]`), no page scroll.
- Added TradingView-style **OI / Volume eye toggles** (top-left, on/off).
- OI overlay + volume now show once ready (volume is genuinely ~0 for indices —
  shows for stocks; noted in the legend).

### Notes
- Real data only (no synthetic). SSR-safe (lightweight-charts dynamic-imported in
  effect). `npm run build` clean (exit 0). Follow-ups: broker-history candle
  fallback for Cloudflare, and true time-series CE/PE volume (needs intraday
  snapshot collection — currently volume is per-candle traded volume).

---

## 2026-07-05 — Top ticker → Intraday Booster signals (Claude Opus 4.8)

### Changed
- The dashboard's top scrolling price line now shows **live indices + the Intraday
  Booster's inflow/outflow signals** (the same Momentum-Ignition stocks as the
  page), latest signal first. Extracted the flow engine into shared
  `src/lib/boosterFlow.ts` (`computeBoosterFlows`) used by both the page and the
  ticker. Ticker fetches `fnoStocksQuery` (was `fnoScreenerQuery`); items tagged
  **INFLOW** (green) / **OUTFLOW** (red); tooltip shows Signal (buildup) + OI Chg%
  + Time; click → `/intraday-booster`.
- Ticker **scroll speed increased** (220 → 320 px/s).

---

## 2026-07-05 — Intraday Booster: per-index constituent tables + flow tables polish (Claude Opus 4.8)

### Changed
- **Flow tables** (Gainers/Inflow · Losers/Outflow) rebuilt to the reference:
  exactly **10 rows, no scroll**, middle momentum bar removed. Row = logo +
  symbol + `@ h:mm AM/PM` time pill + colored chg% pill. Sorted **newest signal
  first** (signalTime desc, flow tie-break) so old signals drop off the bottom.
- **Constituent tables** replaced with **one paired table per top-strip
  index/sector** (StockMojo-style): gainers on the left (desc) paired row-by-row
  with losers on the right (most-negative first); centre **green(gainer) +
  red(loser)** bar on a shared scale; header = circle badge + name + (chg%) +
  `N↑ M↓` advances/declines. All real constituents, no scroll.
- **Click any bar** in the top SECTOR chart → smooth-scroll to that
  index/sector's table (`#tbl-<key>`, full-height hit area) + the target table
  gets a sky-blue selected ring. **Hover** a bar → tooltip with name / Price /
  Change. Table bars are **centre-diverging** (green ends at a fixed centre line,
  red starts after a constant gap → straight vertical gap), lightly squared
  (`rounded-[1px]`). Big tables scroll with a **dark themed scrollbar**
  (`.scroll-dark`, `max-h-[440px]`).

### Added
- `INDEX_CONSTITUENTS` (`market.functions.ts`) — real member lists for all 24
  strip indices/sectors (NIFTY 50 expanded; added FINNIFTY, MIDCAP, HEALTHCARE,
  CONSUMPTION, OIL&GAS, CONSR DURBL, SERVICES, COMMODITIES, DEFENCE, CHEMICALS,
  CAPITAL MKT, PVT BANK). Unresolved tickers drop (no fabrication).
- `getIntradayBooster` now returns `groups[]` (one per strip entry, in strip
  order, with `key`/`isIndex`/constituents); `strip` items carry `key`;
  `BoosterGroup` gained `isIndex`.

### Flow tables — Momentum Ignition logic
- Gainers/Inflow · Losers/Outflow now rank by a **Momentum Ignition Score** built
  to catch a move as it ignites (not after it runs), over the NSE OI-spurt F&O
  feed: `qual·(oiThrust + volPart + pricePart) + earlyBonus + recency` where
  OI change is the leading factor, relative-volume percentile confirms, price is
  the (capped) trigger, `qual` favours fresh Long/Short Buildup over
  covering/unwinding, `earlyBonus` rewards OI+volume firing while price is still
  small, and `recency` boosts freshly-stamped signals (decays through the
  session). Split is money-flow based: **Inflow = Long Buildup / Short Covering**,
  **Outflow = Short Buildup / Long Unwinding**. A **New** tag marks signals
  ignited in the last 5 min; row tooltip shows buildup + OI%.

### Final polish
- Removed the top SECTOR chart's horizontal scroll — all bars now scale to fit
  the card width. Dropped an unused import.
- **Data sources re-verified live** (all real, no mock): FYERS index quotes +
  NSE `allIndices` (24/24) for the sector layer; NSE `live-analysis-oi-spurts`
  (HTTP 200, 215 rows) + Yahoo spark for the F&O flow tables and constituents.
  Intraday Booster page considered complete.

### Notes
- Real data only; index values via the FYERS-primary sector-index layer,
  constituents via Upstox→Yahoo. `npm run build` clean (exit 0).

---

## 2026-07-05 — FYERS-primary sector-index data layer (Claude Opus 4.8)

### Added
- **`src/lib/services/indexRegistry.ts`** — single source of truth mapping a
  canonical index key → per-provider symbols (FYERS / NSE allIndices name / Yahoo)
  for 26 broad + sectoral indices. Every FYERS symbol was **live-verified** against
  the FYERS `/data/quotes` endpoint (returned a valid `lp`), incl. the three
  indices Yahoo lacks: **Defence, Chemicals, Capital Markets**.
- **`fyersService.getIndexQuotes(keys)`** — batch live index quotes via FYERS
  `/data/quotes`; returns one `IndexQuote` per key FYERS carries; marks the token
  expired on an auth error (same behaviour as the option chain). Extracted shared
  **`isFyersAuthError()`** helper (now used by both `getIndexQuotes` and
  `getOptionChain`).
- **`nseFallbackService.getAllIndices(keys)`** — live sector/broad index quotes
  from NSE's public `allIndices` snapshot, matched to canonical keys via the
  registry names (verified **24/24** names match, incl. Defence/Chemicals/CapMkt).
- **`marketDataLayer.getSectorIndices()`** + new `sectorIndices` routing category
  (`fyers → nse → yahoo`). Fallback chain **FYERS → NSE allIndices → Yahoo → EOD
  snapshot**, filling missing keys per-tier (graceful per-index degradation),
  reusing `circuitBreaker` + FYERS-expiry check + `persistentCache`
  (`sector_indices_snapshot`). Real data only — throws (FAIL) if every tier + EOD
  fail.

### Changed
- **`getIntradayBooster`** now sources all index/sector-index **values** from the
  FYERS-primary `getSectorIndices()` layer (works on Cloudflare via authenticated
  HTTPS; carries every sectoral index). Constituent **stock** quotes stay on the
  Upstox→Yahoo quotes layer. `BOOSTER_STRIP` re-keyed to canonical index keys and
  extended with **Defence, Chemicals, Capital Markets**; `SECTORS` / `BOOSTER_INDICES`
  gained an `ik` (canonical index key) field. Strip/group values that don't resolve
  drop out — no fabricated bars.

### Why
- Cloudflare deploy (chosen target): FYERS is authenticated HTTPS so it works from
  Worker IPs, and carries the full sectoral set (incl. the 3 Yahoo-missing indices).
  NSE allIndices can be datacenter-IP-blocked on Cloudflare, so it sits below FYERS
  as fallback; Yahoo backs up the rest; EOD snapshot is the closed-market resort.

### Verified
- Live FYERS batch quote: **27/29** candidate index symbols returned valid `lp`
  (correct symbols locked in; e.g. OIL & GAS = `NSE:NIFTYOILANDGAS-INDEX`).
- FYERS-expiry fallback path reviewed + NSE allIndices tier live-checked (HTTP 200,
  139 indices, all 24 registry names matched). `npm run build` clean (exit 0 —
  client + ssr + nitro, cloudflare-module preset). No production secrets/config
  files touched during verification.

---

## 2026-07-04 — Intraday Booster page (Claude Opus 4.8)

### Added
- **Intraday Booster** page under Sector Lab (`/intraday-booster`) — StockMojo-style:
  - Top **sector-strength strip** (all 12 sectors as vertical diverging bars, sorted by change).
  - **Gainers / Inflow** + **Losers / Outflow** F&O momentum tables (ranked by a
    flow score = %chg + 0.4·OI%chg + volume-shocker bonus) with per-stock
    **buildup + signal time** (early momentum before the big move).
  - **Index tables first, then all sector tables** — each showing constituents as
    centre-diverging green/red bars; ordered by stock count so big tables pair with
    big and small with small in the 2-column grid.
- New server fn `getIntradayBooster` (`market.functions.ts`) — one aggregated,
  chunk-fetched payload of index + sector groups with constituents. Real data only
  (`cachedQuotes` → marketDataLayer). Inflow/outflow computed client-side from
  `fnoStocksQuery`. Added `intradayBoosterQuery`.
- Sector Lab nav entry "Intraday Booster".

### Changed (top-section redesign to match reference)
- Slim page header (own toolbar, no default title): logo + "Intraday Booster
  (future)" + **All / Sector Only** toggle + live clock/time + avatar.
- **Market Sentiment** slim line (green/red split bar + bull% vs bear%), computed
  from real constituent breadth.
- **SECTOR** vertical bar chart (SVG): Y-axis, green/salmon bars, % labels, rotated
  x-labels, sorted best→worst. "Sector Only" toggle hides broad indices.
- Expanded the sector-strength strip (`BOOSTER_STRIP`) to the reference set of
  broad + sectoral indices (real Yahoo/NSE tickers; unresolved ones drop out — no
  fabricated bars). Added `strip` + `breadth` to `getIntradayBooster`.

### Notes
- Real data throughout; LIVE during market hours, EOD when closed. No mock.

---

## 2026-07-04 — Remove AI Analysis page (Claude Opus 4.8)

### Removed
- Deleted `src/routes/ai-analysis.tsx` and `public/ai-analysis.html` (the
  Gemini-set-up iframe page). Removed the "AI Lab" nav group + unused `Sparkles`
  import from `DashboardShell`. Route tree auto-regenerated. No other page touched.

---

## 2026-07-03 — Index Lab pages polish pass 3 (Claude Opus 4.8)

### Changed
- `IndexHeroCard` (`MarketBits.tsx`): removed the PCR / Max Pain stats row
  (reverted); India VIX shown as a compact box on the right, aligned with the
  price/EOD line; card height reduced further.
- `DashboardShell` top-bar status pill: "Market Closed" → **"EOD"** (amber).
- `IndexBreadthCard`: height reduced to match the shorter hero card.
- `IndexContributionPanel` rebuilt to the reference layout — 3 cards (Positive
  Contributors · Points Contribution · Negative Contributors). Side cards are
  plain Symbol/Price/Chg% lists; middle card uses centre-diverging green/red bars
  with contribution % inside. Bigger bold fonts, no stock logos, and **no
  scrollbars** — tables extend full-length downward.
- Removed the temporary `useIndexOptionStats` hook (no longer needed).

### Notes
- Applies identically to NIFTY 50 / BANK NIFTY / SENSEX. Real data only; LIVE
  during market hours, EOD when closed.

---

## 2026-07-03 — Index Lab pages polish pass 2 (Claude Opus 4.8)

### Added
- `src/hooks/useIndexOptionStats.ts` — per-index live/EOD PCR + Max Pain, reusing
  the same `optionChainQuery`/`cachedOptionChainQuery` pipeline and
  `analyzeOptionChain` engine as OI Analysis Pro. No mock data.

### Changed
- `IndexHeroCard` (`MarketBits.tsx`): reduced card padding/heights; added an
  India VIX / PCR / Max Pain stats row beneath Open/High/Low/Prev Close (shown
  on index detail pages only — main dashboard hero cards unchanged).
- `IndexBreadthCard` (`IndexPanels.tsx`): reduced padding/heights to match the
  shorter hero card.
- `IndexContributionPanel` (`IndexPanels.tsx`): kept the 3-table structure
  (Positive · Points Contribution · Negative) but restyled to match the
  reference screenshots — circular stock logos (`StockLogo`/`StockAvatar`, same
  as F&O Board), bold symbol names, bold coloured %, and short rounded-pill bars
  sized by contribution strength (one step larger font throughout).
- NIFTY 50 / BANK NIFTY / SENSEX pages: wired `useIndexOptionStats` + `vix` into
  `IndexHeroCard`.

### Notes
- Data source verified real (no mock): PCR/Max Pain flow through the same
  FYERS→AngelOne→NSE→EOD-cache pipeline as `/oi-analysis-pro`; LIVE during market
  hours, EOD when closed.

---

## 2026-07-03 — Index Lab pages redesign (Claude Opus 4.8)

### Added
- `src/components/IndexPanels.tsx` — shared `IndexBreadthCard` (Bulls vs Bears
  meter + Advances/Declines + 2–3 dynamic per-index sentiment/breadth lines) and
  `IndexContributionPanel` (3-table layout: Positive Contributors · Points
  Contribution building-shape · Negative Contributors).

### Changed
- NIFTY 50 / BANK NIFTY / SENSEX pages (`nifty50.tsx`, `banknifty.tsx`,
  `sensex.tsx`): replaced the 3 small header tiles (Advance / Decline / Avg Change)
  with `IndexBreadthCard`; replaced the bottom "All constituents" list with
  `IndexContributionPanel`. All three pages now share the same layout, fed per-index
  via `indexContributionsQuery(index)` + breadth from dashboard/constituents.
- `IndexHeroCard` closed-market label changed from "Market Closed" / "LAST PRICE"
  to **"EOD"** (amber) — accurate EOD semantics; affects index pages + main dashboard.

### Notes
- Data source verified real (no mock): all breadth/contribution data flows through
  `cachedQuotes → marketDataLayer.getQuotes` (Upstox → Yahoo → EOD cache → throw).
  Market hours show **LIVE**, otherwise **EOD**.

---

## 2026-07-03 — OI Analysis Pro + Data-Integrity overhaul (Claude Opus 4.8)

### Added
- **OI Analysis Pro** page (`/oi-analysis-pro`) rebuilt from scratch as an AI
  option-interest intelligence terminal for NIFTY / BANK NIFTY / SENSEX only:
  - `src/features/oi-analysis-pro/analysis.ts` — deterministic AI engine
    (sentiment score + bias + confidence, ranked drivers, PCR/max-pain, S/R
    walls, 4-quadrant leg-buildup classifier, India VIX read, Smart Money
    footprint, Buyer/Seller action plan, live signal generator).
  - `src/features/oi-analysis-pro/charts.tsx` — full-width professional OI
    Profile table (CE buildup/LTP/Vol/ΔOI/OI-bar ‖ STRIKE ‖ PE …).
  - `src/features/oi-analysis-pro/OiProPage.tsx` — page composition.
  - Panels: AI Verdict gauge, India VIX Intelligence, Expected Move, Session,
    OI Profile, Support/Resistance ladder, OI Action & Buildup, Smart Money
    Footprint & Risk Matrix, AI Buyer & Seller Action Plan, AI Live Commentary
    (filterable, per-signal time, LIVE/EOD badge), AI Market Read.
- **LIVE / EOD / FAIL** data-source status badges across OI pages.
- Client-session OI history buffer `src/features/oi-analysis/oiHistoryStore.ts`
  so time-window presets compute real intraday OI change.
- EOD resilience helpers `getEodOptionChain()` / `saveEodOptionChain()` in
  `persistentCache.ts` (exact-expiry → symbol `default` fallback; multi-key save).
- **AI bootstrap system** in the project root: `AGENTS.md` (master, single source of
  truth for all agents), `CLAUDE.md` and `GEMINI.md` (agent-specific bootstrap, no
  duplication). Canonical doc reading order:
  `AGENTS.md → PROJECT_MASTER → CURRENT_TASK → SESSION_HANDOVER → CHANGELOG`.

### Changed
- `/oi-analysis` (StockMojo-style) bars: single seamless border; hatched top on
  OI increase, hollow outline on OI decrease.
- Time-window presets now actually re-scale the chart data.
- OI page layout uses `min-w-0` so wide charts scroll internally (no page overflow).
- Symbol lists reduced to 3 indices; **MIDCAP NIFTY removed** from OI pages.
- Docs system: all four `docs/` files rebuilt (this CHANGELOG added); reading order
  in `PROJECT_MASTER` + `SESSION_HANDOVER` aligned to `AGENTS.md`.

### Fixed
- SENSEX (and any symbol) showing **FAIL / "No EOD data"** when the auto-selected
  expiry had no dedicated cache file — now falls back to the real `default`
  snapshot.
- `/oi-analysis` BottomPanels giant bars not rendering (baseline positioning).

### Removed
- **ALL mock / synthetic / random data generators** from the live code paths:
  - `marketDataLayer` synthetic option-chain fallback (now throws → FAIL).
  - `nseFallbackService.synthOptionChain` + SENSEX synth.
  - `nse.functions` dead synthetic option-chain block, `synthFno`, fake symbol
    list, `stableNoise`.
  - Deleted `src/features/oi-analysis/mockSnapshot.ts`.

### Notes
- Data source verified real: FYERS EOD chains for all 3 indices (21 rows), with
  volume + OI change. FYERS feed lacks IV (handled gracefully).

---

## 2026-07-02 — Session bootstrap (Claude Code, opus-free)

### Added
- `.claude/launch.json` for dev-server launch.

### Notes
- Explored project, read docs, started dev server. No source changes.

---

## July 2026 — Distributed Market Data Architecture (Phases 1–4)

### Added
- Unified symbol mapper (`resolveSymbol`) across Upstox / Angel One / FYERS /
  Yahoo / NSE; SENSEX integrated across all layers.
- Central orchestrator `marketDataLayer.ts` with per-feature routing.
- 3-strike circuit breaker (`circuitBreaker.ts`, 5-min cooldown).
- Data-lineage envelope (`dataLineage.ts`) with source badges + latency in UI.
- Persistent EOD cache (`persistentCache.ts`) + SQLite historical store
  (`database.server.ts`) + intraday scheduler (`scheduler.server.ts`).

### Changed
- Angel One concurrent-login/TOTP handling; modern endpoints to bypass WAF/F5
  blocks; FYERS protected from locking on non-auth errors.

### Fixed
- Cache-collision via hashed quote-snapshot keys.
- AI Lab divide-by-zero (`+Infinity%`) on loading state.
- CSRF middleware + server-fn validator migrations.

---

*Historical entries are immutable. Append new releases at the top.*
