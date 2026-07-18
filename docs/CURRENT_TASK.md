# CURRENT TASK

> The single active feature only. Open this first. When a feature ships, replace
> this file's contents with the next task. No history here (see `CHANGELOG.md`).

---

## Status: ACTIVE — Parallel Data-Source and Historical Frontend Workstreams

**Current Workstreams:**
1. Shoonya API onboarding, adapter design, and 2–3 live-session shadow validation. (Keep FYERS active as current primary option-chain source until Shoonya completes live shadow validation).
2. Phase 2B frontend historical chart integration using the already-completed historical backend. (Note: Phase 2B is NOT blocked by Shoonya and can continue using the existing Supabase/SQLite historical endpoints).
3. Dedicated OpenAlgo-Upstox infrastructure setup — complete.

**Current Objectives:**
- Shoonya Onboarding & Validation: Proceed with onboarding and adapter design, maintaining secure TOTP authentication.
- Phase 2B Frontend Integration: Implement selectable dates, range selectors, loaders/states, and ECharts/Recharts integration.

**Latest Completed Vertical Slice (18 July 2026, out-of-band UI task):**
- Homepage (`/`) live-dashboard UI redesign: Fear & Greed gauge, per-index
  advance/decline breadth bars, and a participant-activity section (honest
  "unavailable" state — no real FII/DII/Client/Retail dataset exists in this
  codebase). Homepage remains live-only; no historical controls added. Not
  part of the Phase 2B roadmap below — Phase 2B status is unchanged.

**Latest Completed Vertical Slice (15 July 2026):**
- Chart Lab EOD/latest OI now reads a coherent Supabase snapshot first with SQLite fallback.
- Chart Lab OI profile now uses refresh-to-refresh CE/PE OI changes only, retains the final saved refresh state after market close, matches the supplied flat broker-profile styling with wide square bars and colored hollow draining tips, shows strike-only axis labels, uses available real CE+PE activity as index volume, fits the viewport without page scroll, and remains populated when switching indices.

---

## Roadmap & Phases

### Phase 1 — Existing storage and API audit
- [x] Audit SQLite and Supabase schemas.
- [x] Inspect timestamp formats and IST/UTC handling.
- [x] Check duplicate prevention and unique constraints.
- [x] Check indexes needed for symbol and timestamp range queries.
- [x] Inspect the existing history and export APIs.
- [x] Check current retention behavior.

### Phase 2 — Seven-trading-day historical data
- [x] Phase 2A: Complete historical range query backend integration (market-history, option-history, OI activity, breadth, sector strength, with robust validation and dual-source orchestration).
- [x] Chart Lab latest EOD OI Supabase-first read and OI-profile UI vertical slice.
- [ ] Phase 2B: Frontend historical chart integration (selectable trading dates, intraday range filters, ECharts/Recharts integration, and UI state indicators).
- [x] Preserve existing live collection.
- [x] Support querying by symbol/index, start date, end date, and interval.
- [x] Use Supabase as the main historical data source.
- [x] Allow Oracle SQLite as a local fallback or sync source.
- [x] Do not create mock historical records.

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

### Broker & Middleware Migrations (Shoonya & OpenAlgo)
- [x] Set up dedicated OpenAlgo VM (`Bazaarmood2` at `146.56.55.42`) and authorize Upstox broker.
- [x] Configure deadsnakes Python 3.12, systemd Gunicorn Unix socket, SSL certs, and persistent firewall Accept rules on Bazaarmood2 VM.
- [ ] Onboard Shoonya API and implement secure TOTP authentication.
- [ ] Create Shoonya REST/WebSocket adapter and verify symbol/expiry mapping.
- [ ] Execute 2-3 live sessions shadow validation comparing Shoonya against FYERS.
- [ ] Promote Shoonya as primary Option Chain/OI source, NSE as fallback, and disable or demote FYERS.

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

## Files Expected To Change in Phase 2B
- `src/routes/index.tsx`
- `src/features/oi-analysis/`
- `src/components/DashboardShell.tsx`
- `src/lib/dashboard-query.ts`

## Files That Must NOT Be Modified (Absolute Restriction)
- `src/lib/services/scheduler.server.ts` (production-critical collector orchestration)
- `src/routeTree.gen.ts` (auto-generated)
- `.env`, `.env.example`, `fyers_config.enc` (secrets)
- `angel_one_scrip_master.json`, `upstox_instruments.json` (instrument DBs)
- `eod_cache/**`, `backend/database/**` (real data and EOD caches)
- Generated/build dirs: `node_modules/`, `.output/`, `.tanstack/`, `.wrangler/`, `.nitro/`
- Broker auth/session logic unless required.

## Production-Critical — Controlled Changes Only
- `src/lib/services/database.server.ts`
- `src/lib/services/supabase.server.ts`
  *   **Phase 2 Rule:** May be modified *only* to add approved, read-only historical range-query methods.
  *   **Prohibited from changing:** Existing live insert methods, table schema initialization, database unique constraints, timestamp writes, pruneData behavior, dual-write payload mappings, fire-and-forget behavior, and option-chain parent-ID fallback.

---

## Current Blockers
- None.

## Risks
- Storage capacity constraints and index performance on the VM database for larger queries.
- Ensuring timezones (IST vs. UTC) are correctly aligned between SQLite (stored locally, usually local/UTC) and Supabase Postgres (stored in UTC/timestamptz).

---

## Acceptance Checklist
- [x] Works with real live + EOD/historical data; FAIL state when no data is available.
- [x] No mock/synthetic data introduced.
- [x] Existing dashboard and live caching functions work normally.
- [x] `npm run build` clean (exit 0).
- [x] Only task-related files modified.
- [x] Living docs (`CURRENT_TASK.md`, `SESSION_HANDOVER.md`, `CHANGELOG.md`) updated.
