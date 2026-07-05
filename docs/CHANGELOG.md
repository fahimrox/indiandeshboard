# CHANGELOG

> Permanent, chronological history of the Indian Stock Market Dashboard.
> Newest first. Session-specific notes live in `SESSION_HANDOVER.md`; this file
> is the durable record. Dates are IST.

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
