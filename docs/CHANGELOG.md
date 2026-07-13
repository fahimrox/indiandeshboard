# CHANGELOG

> Permanent, chronological history of the Indian Stock Market Dashboard.
> Newest first. Session-specific notes live in `SESSION_HANDOVER.md`; this file
> is the durable record. Dates are IST.

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
