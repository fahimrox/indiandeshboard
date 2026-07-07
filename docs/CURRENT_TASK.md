# CURRENT TASK

> The single active feature only. Open this first. When a feature ships, replace
> this file's contents with the next task. No history here (see `CHANGELOG.md`).

---

## Status: IDLE — no feature in progress

Most recent work (2026-07-08, recorded in `CHANGELOG.md`): added **Supabase health/debug API endpoint** (`GET /api/supabase-health`) —
queries row counts and latest timestamps/records from all 7 Supabase tables safely without throwing or exposing env credentials.
SQLite remains primary.


Earlier (2026-07-05, recorded in `CHANGELOG.md`): (1) built the
**FYERS-primary sector-index data layer** (chain FYERS → NSE allIndices → Yahoo →
EOD) and (2) polished the **Intraday Booster** — flow tables (10 rows, no scroll,
newest-first), and **one paired gainers↔losers table per strip index/sector** with
real constituents (`INDEX_CONSTITUENTS`, 24 indices) + click-a-bar-to-scroll.
Earlier (2026-07-04): Intraday Booster page + AI Analysis removal. There is no
active development task.

**Next AI:** take the user's next instruction and fill the template below before
starting work.

---

## Current Feature
_None — awaiting assignment._

## Current Objective
_TBD_

## Functional Requirements
- _TBD_

## UI Requirements
- Match the existing design language (dark theme, oklch tokens, Tailwind v4).
- Reuse `src/components/ui/*` and the `DashboardShell` layout.

## Data Requirements
- Real data only (live during market hours, EOD when closed). **Never mock.**
- Use the existing query layer (`src/lib/dashboard-query.ts`) + `marketDataLayer`.
- Surface a **FAIL** state when no real data is available.

## Files Expected To Change
- _TBD (list before editing)_

## Files That Must NOT Be Modified
- `src/routeTree.gen.ts` (auto-generated)
- `.env`, `.env.example`, `fyers_config.enc`
- `angel_one_scrip_master.json`, `upstox_instruments.json`
- `eod_cache/**`, `backend/database/**`
- Generated/build dirs: `node_modules/`, `.output/`, `.tanstack/`, `.wrangler/`, `.nitro/`
- Broker auth/session logic unless the task IS an auth fix (see PROJECT_MASTER).

## Dependencies
- _TBD_

## Current Blockers
- None.

## Risks
- Cloudflare deploy has no persistent FS/SQLite — EOD/history persistence is
  Node/Bun-only. Consider this for any storage-related task.

## Acceptance Checklist
- [ ] Feature works with real live + EOD data
- [ ] Existing features still work
- [ ] No mock/synthetic data introduced
- [ ] `npm run build` clean (exit 0)
- [ ] Only task-related files changed
- [ ] `CURRENT_TASK.md`, `SESSION_HANDOVER.md`, `CHANGELOG.md` updated

## Definition of Done
Feature meets acceptance checklist, build is clean, and all three living docs are
updated (this file reset for the next task; handover + changelog appended).

## Next Immediate Task
Await user instruction.
