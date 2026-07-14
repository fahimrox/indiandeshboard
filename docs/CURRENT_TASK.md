# CURRENT TASK

> The single active feature only. Open this first. When a feature ships, replace
> this file's contents with the next task. No history here (see `CHANGELOG.md`).

---

## Status: ACTIVE — Historical Data and Backtesting Phase

**Current Feature:**
Last 7 Trading Days Historical Data, Date-Range Charts, and Backtesting Pipeline

**Current Objective:**
Complete Phase 1 (Existing storage and API audit) to lay the groundwork for historical data querying and backtesting, and proceed through the subsequent implementation phases.

---

## Roadmap & Phases

### Phase 1 — Existing storage and API audit
- [ ] Audit SQLite and Supabase schemas.
- [ ] Inspect timestamp formats and IST/UTC handling.
- [ ] Check duplicate prevention and unique constraints.
- [ ] Check indexes needed for symbol and timestamp range queries.
- [ ] Inspect the existing history and export APIs.
- [ ] Check current retention behavior.

### Phase 2 — Seven-trading-day historical data
- [ ] Preserve existing live collection.
- [ ] Support querying by symbol/index, start date, end date, and interval.
- [ ] Use Supabase as the main historical data source.
- [ ] Allow Oracle SQLite as a local fallback or sync source.
- [ ] Do not create mock historical records.

### Phase 3 — Date-range charts
- [ ] Add selectable trading dates.
- [ ] Add intraday range filters.
- [ ] Show clear loading, empty-data, market-closed, and error states.
- [ ] Preserve the current dashboard design.

### Phase 4 — Backtesting pipeline
- [ ] Replay historical market snapshots chronologically.
- [ ] Prevent future-data leakage.
- [ ] Store strategy inputs, signals, entries, exits, P&L, and performance metrics.
- [ ] Keep backtesting isolated from live trading and production collection.
- [ ] No order placement features.

### Phase 5 — Validation
- [ ] Verify row counts per trading day.
- [ ] Verify no timestamp gaps or duplicates.
- [ ] Verify Supabase and SQLite consistency.
- [ ] Run build and type checking.

---

## Functional Requirements
- Preserve the existing live market data collection architecture without disruption.
- Retrieve and serve historical data from Supabase, falling back to local SQLite as needed.
- No mock data or synthetic data under any circumstances. Clear error/FAIL states when no data exists.
- Ensure chronological accuracy in the backtest replay engine, completely preventing look-ahead bias (future-data leakage).

## UI Requirements
- Add date selection controls and range filters to the dashboard without redesigning the core layout.
- Maintain premium look and feel (dark theme, oklch theme tokens, Tailwind v4).
- Show appropriate loaders, closed-market labels, empty states, and connection error pills.

## Data Requirements
- Real data only.
- Leverage the existing orchestrator (`marketDataLayer.ts`) and query cache hooks (`dashboard-query.ts`).

---

## Files Expected To Change
*To be filled out specifically before beginning implementation code changes.*

## Files That Must NOT Be Modified
- `src/routeTree.gen.ts` (auto-generated)
- `.env`, `.env.example`, `fyers_config.enc`
- `angel_one_scrip_master.json`, `upstox_instruments.json`
- `eod_cache/**`, `backend/database/**`
- Generated/build dirs: `node_modules/`, `.output/`, `.tanstack/`, `.wrangler/`, `.nitro/`
- Broker auth/session logic unless required.
- `src/lib/services/scheduler.server.ts`
- `src/lib/services/supabase.server.ts`
- `src/lib/services/database.server.ts`

---

## Current Blockers
- None.

## Risks
- Storage capacity constraints and index performance on the VM database for larger queries.
- Ensuring timezones (IST vs. UTC) are correctly aligned between SQLite (stored locally, usually local/UTC) and Supabase Postgres (stored in UTC/timestamptz).

---

## Acceptance Checklist
- [ ] Works with real live + EOD/historical data; FAIL state when no data is available.
- [ ] No mock/synthetic data introduced.
- [ ] Existing dashboard and live caching functions work normally.
- [ ] `npm run build` clean (exit 0).
- [ ] Only task-related files modified.
- [ ] Living docs (`CURRENT_TASK.md`, `SESSION_HANDOVER.md`, `CHANGELOG.md`) updated.
