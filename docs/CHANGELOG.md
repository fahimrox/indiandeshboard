# CHANGELOG

> Permanent, chronological history of the Indian Stock Market Dashboard.
> Newest first. Session-specific notes live in `SESSION_HANDOVER.md`; this file
> is the durable record. Dates are IST.

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
