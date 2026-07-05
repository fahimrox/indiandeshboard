# SESSION HANDOVER

> Latest session only. Read this to continue immediately. Older sessions are in
> `CHANGELOG.md` — do NOT let history accumulate here.
> **Read order (per `AGENTS.md`):** `AGENTS.md` → `docs/PROJECT_MASTER.md` →
> `docs/CURRENT_TASK.md` → this file → `docs/CHANGELOG.md`.

---

## Session Summary

| Field | Value |
|-------|-------|
| **Date** | 2026-07-05 |
| **AI** | Claude Opus 4.8 (Kiro IDE agent) |
| **Focus** | Intraday Booster: FYERS-primary sector-index layer + flow-table polish + **per-index constituent tables** (click-to-scroll) |
| **Build** | ✅ Clean — `npm run build` exit 0 (client + ssr + nitro, cloudflare-module) |

---

## Work Completed
- Built a dedicated **sector/broad index data layer** so the Intraday Booster's
  strip + index/sector group headers get **real** index values on Cloudflare:
  - `indexRegistry.ts` — canonical key → FYERS / NSE-name / Yahoo symbol for 26
    indices. All FYERS symbols **live-verified**; includes Defence, Chemicals,
    Capital Markets (which Yahoo lacks).
  - `fyersService.getIndexQuotes()` + shared `isFyersAuthError()` (option chain
    refactored to use it).
  - `nseFallbackService.getAllIndices()` (NSE `/api/allIndices`, 24/24 names match).
  - `marketDataLayer.getSectorIndices()` + `sectorIndices` routing category —
    chain **FYERS → NSE allIndices → Yahoo → EOD snapshot**, per-tier fill,
    circuitBreaker + FYERS-expiry check + persistentCache. Throws (FAIL) if all fail.
  - `getIntradayBooster` rewired: index **values** from `getSectorIndices` (FYERS
    primary), constituent **stocks** stay on `cachedQuotes` (Upstox→Yahoo). Strip
    re-keyed + extended with Defence/Chemicals/Capital Markets.

- **Intraday Booster UI** (later in the session):
  - Flow tables → 10 rows, no scroll, middle bar removed, `@ h:mm AM/PM` time pill
    + colored chg% pill, newest-signal-first ordering.
  - Constituent tables → **one paired gainers↔losers table per strip
    index/sector** (green gainer + red loser centre bar; badge + name + (chg%) +
    `N↑ M↓`). Real constituents via new `INDEX_CONSTITUENTS` (24 indices).
  - Click a SECTOR-chart bar → smooth-scroll to that table (`#tbl-<key>`).
  - `getIntradayBooster` now returns `groups[]` + `strip` (with `key`) + `breadth`
    (dropped separate `indices`/`sectors`).

_Full detail: see `CHANGELOG.md` → 2026-07-05 (two entries)._

## Files Created
- `src/lib/services/indexRegistry.ts`

## Files Modified
- `src/lib/services/fyersService.ts` (shared `isFyersAuthError`, `getIndexQuotes`)
- `src/lib/services/nseFallbackService.ts` (`getAllIndices`)
- `src/lib/services/marketDataLayer.ts` (`sectorIndices` category + `getSectorIndices`)
- `src/lib/market.functions.ts` (`getIntradayBooster` → `groups`/`strip`; `INDEX_CONSTITUENTS`; `SECTORS`/`BOOSTER_STRIP` keyed to registry; `BoosterGroup.isIndex`, `StripItem.key`)
- `src/features/intraday-booster/IntradayBoosterPage.tsx` (flow tables, `IndexFlowTable`, clickable `SectorBarChart`)
- `docs/{CURRENT_TASK,SESSION_HANDOVER,CHANGELOG}.md`

## Files Removed
- None.

---

## Current Bugs
- None known.

## Known Limitations
- **Cloudflare + FYERS token expiry (daily):** when the token is expired, the
  sector-index layer falls to NSE allIndices → Yahoo. On Cloudflare, NSE can be
  datacenter-IP-blocked, so Yahoo covers the core sectors while **Defence /
  Chemicals / Capital Markets may drop from the strip** until the FYERS token is
  refreshed (they have no Yahoo ticker). This is graceful degradation, not a crash
  — no fabricated bars. On Node/VPS, NSE allIndices fills all 24 (verified).
- SQLite (`better-sqlite3`) + Node `fs` EOD cache are Node/Bun-only, not Cloudflare
  Workers. On Cloudflare, closed-market data relies on shipped `eod_cache/*.json`.
- FYERS option-chain feed carries no IV (ATM IV shows "—").

## Important Decisions
- **Sector-index source = FYERS primary** (authenticated HTTPS → works on
  Cloudflare + carries every sectoral index). NSE allIndices is fallback (IP-block
  risk on CF), Yahoo backs up the rest, EOD snapshot is the closed-market resort.
- Reused the existing orchestrator/circuitBreaker/cache — no parallel system.
- Data integrity absolute: no fabricated data; unresolved index values drop / FAIL.

## Assumptions
- FYERS index symbols stay stable (all live-verified this session).

## Pending Work
- None. Completed this session: **Intraday Booster** (FYERS-primary sector-index
  layer, strip chart, Momentum-Ignition flow tables, per-index paired constituent
  tables), **top ticker → Booster inflow/outflow signals**, and a full
  **Option Chain (`/optionchain`) redesign** (OptionClock-style on real
  FYERS→AngelOne→NSE→EOD data: buildup badges, WTT/WTB/DF heat, in-table spot bar,
  R/S + stats cards, legend). All build clean (exit 0), real data only.
  Awaiting the user's next task.

## Recommended Next Step
- Await user direction. If asked to make sector-index data survive FYERS expiry on
  Cloudflare for Defence/Chemicals/CapMkt, add a KV/D1 snapshot of the last good
  FYERS index values (FS/SQLite cache is Node-only).

## Notes For Next AI
- Run `npm run build` (exit 0) before finishing.
- Do NOT touch `fyers_config.enc` / `.env` (secrets). FYERS index symbols live in
  `indexRegistry.ts`; verify any new one with a live `/data/quotes` call before use.
- Update BOTH `CURRENT_TASK.md` and this file; add a `CHANGELOG.md` entry for any
  completed feature. Keep this file to the latest session only.

---

*Last Updated: 2026-07-05 · Claude Opus 4.8*
