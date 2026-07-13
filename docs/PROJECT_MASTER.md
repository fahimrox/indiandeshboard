# PROJECT MASTER

> **Single source of truth for the project's stable architecture.**
> Written for AI coding agents first. Read this once and you should understand the
> whole system without rescanning the repo.
>
> This file must contain **only durable architecture** — no session notes, no
> TODOs, no progress tracking. Those live in `CURRENT_TASK.md`,
> `SESSION_HANDOVER.md`, and `CHANGELOG.md`.

---

## 1. Project Overview

| | |
|---|---|
| **Name** | Indian Stock Market Dashboard ("Indian Dashboard") |
| **Purpose** | Professional, real-time Indian market terminal — indices, options, F&O, OI analytics, AI-driven sentiment. |
| **Vision** | An AI-powered index-options cockpit where a trader understands the market's mood, OI structure and key levels at a glance. |
| **Indices in scope** | **NIFTY 50, BANK NIFTY, SENSEX** (only these three). |
| **Architecture** | Full-stack React on TanStack Start (SSR via Nitro). Server functions fetch/normalize live broker data; client renders with TanStack Query polling. Multi-broker fallback with a hard **no-mock** rule. |
| **Production & Deploy** | Detailed documentation of VMs, ports, Nginx proxy, build presets, and deployment scripts is maintained in [docs/PRODUCTION_INFRASTRUCTURE.md](file:///d:/Lovable%20Deshboard/indiandeshboard/docs/PRODUCTION_INFRASTRUCTURE.md). |

---

## 2. Tech Stack

| Layer | Tech |
|-------|------|
| Framework | TanStack Start (`@tanstack/react-start`) + React 19 + Vite 7 |
| Routing | TanStack Router (file-based, type-safe) |
| Server/SSR | Nitro (build target: **Cloudflare `cloudflare-module`**) |
| Data/query | TanStack React Query v5 |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`, `@theme inline` tokens) |
| UI kit | Radix UI primitives + shadcn-style components (`src/components/ui`) |
| Icons | `lucide-react` |
| Charts | ECharts (`echarts-for-react`), Recharts, custom SVG |
| DB (historical) | SQLite via `better-sqlite3` (Node/Bun runtime only) |
| Validation | Zod |
| Package mgr | npm (Bun also configured) |
| Config | Uses `@lovable.dev/vite-tanstack-config` — bundles tanstackStart, react, tailwind, tsconfig paths, nitro, `@` alias. **Do not add those plugins manually.** |

**Scripts:** `npm run dev` (port 8080) · `npm run build` · `npm run preview` · `npm run lint` · `npm run format`.

---

## 3. Folder Structure

```
indiandeshboard/
├── src/
│   ├── server.ts               # SSR entry (error wrapper) + starts intraday scheduler
│   ├── start.ts                # TanStack Start instance: error + CSRF middleware
│   ├── router.tsx              # Router + QueryClient wiring
│   ├── routeTree.gen.ts        # AUTO-GENERATED — never hand-edit
│   ├── styles.css              # Tailwind v4 + theme tokens (dark-only)
│   ├── routes/                 # File-based pages + /api server routes
│   ├── components/
│   │   ├── DashboardShell.tsx  # App layout: top nav "Labs", market status, settings modal
│   │   ├── TickingNumber.tsx   # Animated live-ticking number
│   │   ├── MarketBits.tsx      # Small market UI bits + fmt helpers
│   │   ├── TopTicker/          # Scrolling quote ticker
│   │   ├── ui/                 # shadcn/Radix components (~47) — shared primitives
│   │   ├── OIAnalysis/         # LEGACY, UNUSED (no imports) — ignore/remove
│   │   └── IndexContribution/  # LEGACY, UNUSED (no imports) — ignore/remove
│   ├── features/
│   │   ├── oi-analysis/        # /oi-analysis (StockMojo-style OI page)
│   │   └── oi-analysis-pro/    # /oi-analysis-pro (AI OI intelligence page)
│   ├── hooks/                  # useMarketOpen, useDebounce, use-mobile
│   └── lib/
│       ├── dashboard-query.ts  # TanStack Query queryOptions (the query layer)
│       ├── market.functions.ts # Server RPC: quotes, dashboard, constituents, contributions, sectors
│       ├── nse.functions.ts    # Server RPC: option chain, F&O stocks, scanner, intraday history
│       ├── market-hours.ts     # IST market-open helpers
│       ├── utils.ts            # cn() + shared utils
│       ├── api/                # example.functions.ts (template, unused)
│       └── services/           # data layer (see §6)
├── eod_cache/                  # Persisted EOD JSON snapshots (real data) + intraday/
├── backend/database/           # SQLite market_data.db + backups (created at runtime)
├── docs/                       # PROJECT_MASTER · CURRENT_TASK · SESSION_HANDOVER · CHANGELOG
├── public/                     # static assets (favicon, robots, etc.)
└── package.json / vite.config.ts / tsconfig.json
```

---

## 4. Routing Architecture

File-based under `src/routes/`. Navigation is grouped into "Labs" in `DashboardShell`.

| Route | Lab | Purpose | Primary data |
|-------|-----|---------|--------------|
| `/` (`index.tsx`) | Index | Market overview: indices, breadth, sectors, AI sentiment | `getDashboard` |
| `/nifty50`, `/banknifty`, `/sensex` | Index | Per-index detail + constituents | `getQuotes`, `getIndexConstituents` |
| `/index-contribution` | Index | Which stocks moved the index (points contribution) | `getIndexContributions` |
| `/future-dashboard` | F&O | Futures overview | `getFnoStocks` |
| `/fno` | F&O | F&O stocks list w/ buildup | `getFnoStocks` |
| `/fnoboard` | F&O | F&O heatmap board | `getFnoStocks` |
| `/optionchain` | Option | Option chain CE/PE table | `getOptionChain` |
| `/oi-analysis` | Option | StockMojo-style OI analysis | `getOptionChain` / `getCachedOptionChain` |
| `/oi-analysis-pro` | Option | **AI OI intelligence** (3 indices) | `getOptionChain` / cached + `quotes` |
| `/screener` | Screener | Live F&O scanner / signals | `getLiveScannerData`, `getFnoScreener` |
| `/heatmap` | Sector | Sector heatmap | `getDashboard` sectors |
| `/intraday-booster` | Sector | Sector strength strip, F&O inflow/outflow momentum, index+sector movers | `getIntradayBooster`, `getFnoStocks` |
| `/sector/$key` | Sector | Sector constituents | `getSectorDetail` |
| `/sitemap[.]xml` | — | Sitemap | — |
| `/api/*` | — | Server API routes (history/candles/export/oi-history/…) | SQLite via `database.server` |

`src/routes/api/`: `breadth-history`, `candles.$symbol`, `export`, `history`, `history.$symbol`, `market-history`, `oi-history`, `option-history`.

---

## 5. Application Architecture

**Server ↔ Client split (TanStack Start):**
- **Server functions** (`createServerFn`) live in `*.functions.ts` and `services/*.server.ts`. They touch brokers, filesystem, SQLite, secrets. They are stripped from the client bundle.
- **Client pages** (`routes/*.tsx`, `features/**`) never import Node modules directly — only call server functions via the query layer.
- `src/server.ts` is the SSR entry: wraps errors into a friendly page and **starts the intraday scheduler** (`startScheduler()`).
- `src/start.ts` registers request middleware: error normalization + CSRF (for server fns).

**Request flow:**
```
Route component → useQuery(dashboard-query option) → server fn (*.functions.ts)
   → marketDataLayer (orchestrator) → broker service → normalize → EnvelopedResponse
   → React Query cache → component render
```

---

## 6. Data Layer

### 6.1 Query layer — `src/lib/dashboard-query.ts`
Exposes `queryOptions` factories consumed by pages:
`dashboardQuery`, `quotesQuery(symbols)`, `constituentsQuery(index)`,
`indexContributionsQuery(index)`, `sectorDetailQuery(key)`, `fnoStocksQuery`,
`fnoScreenerQuery`, `optionChainQuery(symbol, spot?, expiry)`,
`cachedOptionChainQuery(symbol, expiry)`.
- Market-hours-aware refetch: `liveInterval()` polls ~10–15s when open, and spaces
  out when closed. `staleTime` set; pages pass `placeholderData: keepPreviousData`.

### 6.2 Orchestrator — `src/lib/services/marketDataLayer.ts`
Single entry for market data with per-feature fallback and a **circuit breaker**.
Every response is an `EnvelopedResponse<T>` carrying `_metadata { source, status,
latencyMs }` (see `dataLineage.ts`).

**Fallback chains (verified, NO synthetic step):**
```
Quotes:        Upstox → Yahoo → EOD cache → (else) throw
Option Chain:  FYERS → Angel One → NSE scraper → EOD cache → (else) FAIL (throw)
F&O Stocks:    NSE OI-spurts + Yahoo quotes → EOD cache → (else) empty []
EOD read:      getEodOptionChain() = exact-expiry file, else symbol `default` snapshot
```

### 6.3 Providers (`services/`)
| Service | Role |
|---------|------|
| `upstoxService.ts` | Primary cash quotes |
| `yahooService.ts` | Fallback quotes, SENSEX spot, F&O day levels |
| `angelOneService.ts` | Futures/OI + option-chain backup (TOTP login, WAF bypass) |
| `fyersService.ts` | **Primary option chain** (V3) |
| `nseFallbackService.ts` | NSE scraper (option chain, OI spurts). Throws on fail — no synth |
| `symbolMapper.ts` | `resolveSymbol(standard, broker)` for NIFTY/BANKNIFTY/SENSEX |
| `circuitBreaker.ts` | 3 failures → disable broker for 5 min; reset on success |
| `dataLineage.ts` | `EnvelopedResponse` + `DataLineage` types |
| `configStore.ts` / `config.server.ts` | FYERS encrypted config (`fyers_config.enc`) |
| `settings.functions.ts` | Broker connection status + save FYERS token |

### 6.4 Persistence
- **EOD JSON cache** — `persistentCache.ts` → `eod_cache/*.json`. Saves only real
  sources (never fallback/synthetic). Helpers: `getEodData`, `saveEodData`,
  `getEodOptionChain` (exact→default), `saveEodOptionChain` (multi-key, self-healing).
- **SQLite historical** — `database.server.ts` (`backend/database/market_data.db`,
  WAL). Tables: market_snapshots, option_chain_snapshots, oi_activity,
  market_breadth, sector_strength, trade_signals, system_logs.
- **Intraday scheduler** — `scheduler.server.ts` runs every ~1 min **during market
  hours** (started in `server.ts`): captures quotes/breadth/sectors/option-chains
  into SQLite; on market close performs DB backup + 180-day prune.
- ⚠️ SQLite + Node `fs` run on **Node/Bun only**, not Cloudflare Workers.

---

## 7. Live Market Architecture (Providers)

| Provider | Feature | Status semantics |
|----------|---------|------------------|
| **Upstox** | Cash quotes (primary) | live |
| **Yahoo Finance** | Quotes fallback, SENSEX, levels | fallback |
| **Angel One** | Futures/OI, option-chain backup | fallback |
| **FYERS** | Option chain (primary, V3) | live |
| **NSE** | Scraper: option chain, OI spurts | fallback |
| **Cache (JSON/SQLite)** | EOD + historical | cached (EOD) |

**Data-source status shown in UI:** `LIVE` (market open + real live feed) ·
`EOD` (market closed, real cached data) · `FAIL` (all sources + cache failed).

---

## 8. Feature "Labs" (what exists)

- **Index Lab** — Overview, NIFTY 50, BANK NIFTY, SENSEX, Index Contribution.
- **F&O Lab** — Future Dashboard, F&O Stocks, F&O Board (heatmap).
- **Option Lab** — Option Chain, OI Analysis, **OI Analysis Pro**.
- **Screener Lab** — Live F&O scanner + signals.
- **Sector Lab** — Sector heatmap, sector detail, Intraday Booster.
- **Coming soon (nav placeholders only):** AI Lab, Global Lab, Chart Lab, Tool Lab, News Lab.

**`src/features/oi-analysis-pro/`** (flagship): `analysis.ts` (deterministic AI
engine — sentiment/PCR/max-pain/S-R/buildup/VIX/smart-money/action-plan/signals),
`charts.tsx` (pro OI profile table), `OiProPage.tsx`. All panels are
**selected-index-only** — never mix indices.

---

## 9. Component Architecture

- **`DashboardShell`** — the app frame: grouped "Lab" top-nav dropdowns, market
  status pill, API-settings modal (broker health + FYERS token), TopTicker. Wrap
  every page in `<DashboardShell>`.
- **Shared primitives** — `src/components/ui/*` (shadcn/Radix). Reuse these; do not
  reinvent buttons/dialogs/tables.
- **Shared widgets** — `TickingNumber`, `MarketBits` (incl. `fmt`), `TopTicker`.
- **Feature modules** — self-contained under `src/features/<feature>/` with their
  own `components/`, `hooks/`, engine (`analysis.ts` / `utils.ts`), and `types`.
- **Legacy/unused** — `components/OIAnalysis/*` (has a stray `mockData.ts`) and
  `components/IndexContribution/*` are **not imported anywhere**. Ignore them; do
  not wire mock data from them into live pages.

---

## 10. UI / Theme System

- **Dark-only** theme defined in `src/styles.css` via Tailwind v4 `@theme inline`
  + `:root` CSS variables in **oklch**.
- **Core tokens:** `--background`, `--card`, `--foreground`, `--muted`, `--border`,
  `--primary`, plus market tokens **`--bull`** (green), **`--bear`** (red),
  **`--neon`** (accent). Radius scale via `--radius`.
- **Color language:**
  - Index/quote up = bull green, down = bear red.
  - `/oi-analysis` (StockMojo parity): **Call = green, Put = red.**
  - `/oi-analysis-pro`: **Call = rose, Put = emerald** (resistance vs support), and
    buildup Interpretation is **impact-coloured** — green = option gaining, red =
    option losing; **Strong = dark shade, Weak = light shade.** No other hues.
- **Typography:** system sans; heavy weights + `tabular-nums` for numbers; small
  uppercase tracked labels for section headers.
- **Layout:** rounded bordered cards (`rounded-2xl border bg-slate/gradient`);
  responsive grids; wide tables/charts use `overflow-x-auto` + `min-w-0` parents so
  the page never overflows horizontally.

---

## 11. State Management

- **Server/query state → TanStack Query** (never mirror it into React state).
  Poll with market-hours-aware intervals; `placeholderData: keepPreviousData` to
  avoid layout jumps; check `isPending` (not `isLoading`) for first-load spinners.
- **Local UI state → `useState`** (symbol, expiry, filters, toggles).
- **Cross-cutting client caches** → module-level stores where appropriate (e.g.
  `oiHistoryStore.ts` session buffer). No global Redux/Zustand.
- **Derivations → `useMemo`**; stable callbacks → `useCallback`; heavy components
  wrapped in `memo`.

---

## 12. Coding Standards

- **Server/client boundary is sacred:** Node modules, secrets, SQLite, fs → only in
  `*.functions.ts` / `*.server.ts`. Client code calls server functions via the
  query layer.
- **Files:** feature code under `src/features/<feature>/`; shared UI in
  `components/ui`; server RPC in `lib/*.functions.ts`; data providers in
  `lib/services`.
- **Naming:** Components `PascalCase`; hooks `useX`; server fns `getX`/`saveX`;
  types `PascalCase`; query options `xQuery`.
- **Imports:** use the `@/` alias for `src`.
- **Types:** prefer explicit exported types (`OptionChain`, `Quote`, `ProAnalysis`,
  `DataStatus`, …). Avoid `any` except at untyped broker/JSON boundaries (cast narrowly).
- **Formatting:** Prettier + ESLint (`npm run lint` / `format`). `tsconfig` has
  `noUnusedLocals:false` — but keep code clean anyway.
- **Reuse first:** extend existing services/components before adding new ones.

---

## 13. Performance Rules

- Memoize live-updating tables, chart rows, gauges (`memo`, `useMemo`, `useCallback`
  with complete dep arrays).
- Use `placeholderData: keepPreviousData` on every live query.
- Keep polling intervals market-hours-aware (spaced out when closed).
- Wide SVG/tables scroll inside their container (`overflow-x-auto` + `min-w-0`), not
  the whole page.
- Prefer deterministic client-side computation over extra round-trips where data is
  already fetched.

---

## 14. Data Integrity Rules (CRITICAL)

1. **NO mock / synthetic / random / demo data anywhere in live code paths.** Ever.
2. If real data is unavailable → show a clear **FAIL** state. Never fabricate.
3. Maintain the **LIVE / EOD / FAIL** status semantics on data-driven pages.
4. Only `saveEodData`/`saveEodOptionChain` real broker responses to cache (never
   fallback/synthetic).
5. Keep each index's data isolated — analysis panels are selected-index-only.

---

## 15. AI Workflow (mandatory for every AI)

**Read order (defined by `AGENTS.md`, the master file — do not diverge):**
1. `AGENTS.md` — rules for all agents
2. `docs/PROJECT_MASTER.md` (this file) — stable architecture
3. `docs/PRODUCTION_INFRASTRUCTURE.md` — production architecture & deploy constraints (mandatory read before editing build, deployment, environment, broker authentication, scheduler, database, server runtime, PM2, Nginx, or production-sensitive code)
4. `docs/CURRENT_TASK.md` — the active task
5. `docs/SESSION_HANDOVER.md` — last session + files you must NOT touch
6. `docs/CHANGELOG.md` — history (skim)

**Then:**
7. Open **only** the files the task needs. Do not scan the whole repo.
8. Implement. Run `npm run build` — must be clean (exit 0).
9. Before stopping, update **`CURRENT_TASK.md`** and **`SESSION_HANDOVER.md`**, and
   append a **`CHANGELOG.md`** entry for any completed feature.

If interrupted (tokens/time/connection): still update `CURRENT_TASK.md` +
`SESSION_HANDOVER.md` with completed/remaining/modified-files/next-step.

---

## 16. Do NOT Modify (unless the task specifically requires it)

| Path | Why |
|------|-----|
| `src/routeTree.gen.ts` | Auto-generated by TanStack Router |
| `.env`, `.env.example` | Secrets — don't echo values |
| `fyers_config.enc` | Encrypted FYERS session (runtime-managed) |
| `angel_one_scrip_master.json`, `upstox_instruments.json` | Large instrument DBs |
| `eod_cache/**`, `backend/database/**` | Real cached/historical data |
| `node_modules/`, `.output/`, `.tanstack/`, `.wrangler/`, `.nitro/` | Generated/build |
| `vite.config.ts` plugin list | Uses `@lovable.dev` config — adding plugins breaks the app |
| Broker auth/session logic (`upstoxService`, `angelOneService`, `fyersService`, `configStore`) | Fragile token/login handling — only touch for explicit auth fixes |

## 17. What an AI Must NEVER Do
- Redesign the project or rewrite unrelated files.
- Remove working features or delete code without explanation.
- Replace real data with mock/demo/synthetic data.
- Add the plugins already bundled by `@lovable.dev/vite-tanstack-config`.
- Leave a session without updating the living docs.

## 18. Production Data Safety (CRITICAL)

> Verified as of **13 July 2026**. See `docs/PRODUCTION_INFRASTRUCTURE.md` for the
> full detail. This section is the canonical summary for agents reading PROJECT_MASTER.

### 18.1 Dual-Storage Architecture

The Oracle VM production collector writes to **two stores** on every scheduler tick:

| Store | Location | Role |
|-------|----------|------|
| **SQLite (primary)** | `backend/database/market_data.db` | Always written, synchronous |
| **Supabase Postgres** | Cloud (`SUPABASE_URL`) | Fire-and-forget mirror |

Enable mirroring with `SUPABASE_DUAL_WRITE=true` in the environment.

### 18.2 Critical Collector Files

> **Never** casually rewrite, relocate, delete, rename, or refactor these files.

| File | Role |
|------|------|
| `src/lib/services/scheduler.server.ts` | Tick orchestration + dual-write hooks |
| `src/lib/services/supabase.server.ts` | Supabase client + insert helpers |
| `src/lib/services/database.server.ts` | SQLite schema + all write/read helpers |

Before modifying any of these: read all docs in order, understand both schemas,
preserve dual-write (SQLite primary, Supabase fire-and-forget), run
`NITRO_PRESET=node-server npm run build`, explain migration impact, update docs.

### 18.3 Supabase Schema Key Rules

- `option_chain_snapshots.id` = **UUID** primary key
- `oi_activity.snapshot_id` = **UUID** foreign key → `option_chain_snapshots(id)`
  with `ON DELETE CASCADE`
- **Never change `oi_activity.snapshot_id` back to `bigint`.**

### 18.4 Production Build Command (Oracle VM)

```bash
NITRO_PRESET=node-server npm run build
```

Plain `npm run build` may select the Cloudflare preset and cause 502 errors.

### 18.5 Server/Client Boundary

- `node:fs`, `node:path`, SQLite, Supabase service-role logic, secret access →
  **server only** (`*.server.ts` / `*.functions.ts`)
- Client code (`routes/**`, `features/**`) calls server functions via the query
  layer only. Dynamic imports preserve this boundary. Do not break it.

---

*This document describes stable architecture only. For the active task see
`CURRENT_TASK.md`; for history see `CHANGELOG.md`; for the last session see
`SESSION_HANDOVER.md`; for production/deployment see `PRODUCTION_INFRASTRUCTURE.md`.*
