# AGENTS.md — Master AI Instructions

> **Single source of truth for every AI coding agent** working in this repository
> (Claude, GPT, Gemini, DeepSeek, GLM, Kimi, MiniMax, Mistral, Qwen, Amazon Q,
> Kiro, OpenCode, and any future agent).
>
> Read this file first, every session. It is intentionally concise — the deep
> architecture lives in `docs/PROJECT_MASTER.md`.

---

## 1. Project Overview

- **What:** Indian Stock Market Dashboard — a real-time, AI-powered index & options
  terminal (indices, option chain, OI analytics, F&O, sentiment).
- **Indices in scope:** **NIFTY 50, BANK NIFTY, SENSEX** only.
- **Stack:** TanStack Start (React 19 + Vite 7, SSR via Nitro → Cloudflare target),
  TanStack Router (file-based), TanStack React Query v5, Tailwind v4 (dark-only,
  oklch tokens), Radix/shadcn UI, ECharts/Recharts, SQLite (`better-sqlite3`, Node
  runtime), Zod. Package manager: `npm` (port 8080).
- **Core promise:** show **real** market data — live during market hours, EOD when
  closed — and a clear **FAIL** state otherwise. Never fabricate.

---

## 2. Documentation Reading Order (mandatory, every session)

1. **`AGENTS.md`** (this file) — rules for all agents
2. **`docs/PROJECT_MASTER.md`** — stable architecture (read once, deeply)
3. **`docs/CURRENT_TASK.md`** — the one active task
4. **`docs/SESSION_HANDOVER.md`** — what the last session did + do-not-touch list
5. **`docs/CHANGELOG.md`** — permanent history (skim for context)

> Goal: understand the project in minutes without rescanning the whole repo.

---

## 3. Repository Structure (top level)

```
src/
  server.ts / start.ts        # SSR entry (+ starts intraday scheduler) / middleware
  router.tsx                  # Router + QueryClient
  routeTree.gen.ts            # AUTO-GENERATED — never edit
  styles.css                  # Tailwind v4 + dark-only oklch theme tokens
  routes/                     # File-based pages + /api server routes
  components/
    DashboardShell.tsx        # App layout: "Lab" nav, market status, settings modal
    ui/                       # shadcn/Radix shared primitives (reuse these)
    TickingNumber, MarketBits, TopTicker/
    OIAnalysis/, IndexContribution/   # LEGACY, UNUSED — ignore
  features/
    oi-analysis/              # /oi-analysis (StockMojo-style)
    oi-analysis-pro/          # /oi-analysis-pro (AI OI intelligence)
  hooks/                      # useMarketOpen, useDebounce, use-mobile
  lib/
    dashboard-query.ts        # TanStack Query options (the query layer)
    market.functions.ts       # Server RPC: quotes, dashboard, constituents, contributions
    nse.functions.ts          # Server RPC: option chain, F&O, scanner, intraday history
    market-hours.ts, utils.ts
    services/                 # data layer (orchestrator, brokers, cache, db, scheduler)
eod_cache/  backend/database/  docs/  public/
```

Full detail: `docs/PROJECT_MASTER.md` §3–§9.

---

## 4. Development Philosophy

- **Improve, don't replace.** Extend working code; reuse existing services/components.
- **Real data only.** No mock/synthetic/random/demo data in live paths — ever.
- **Minimal blast radius.** Touch only the files the task needs.
- **Consistency over novelty.** Match existing patterns, naming, and design language.
- **Ship verified.** Every change ends with a clean build.

---

## 5. AI Workflow (every task)

1. Read the docs in the order above.
2. Confirm the task from `CURRENT_TASK.md`; if unclear, ask.
3. Locate only the relevant files (use search; don't scan everything).
4. Implement using existing patterns.
5. Run `npm run build` → must be clean (exit 0). Fix all errors.
6. Update docs (see §11) before finishing.

If interrupted (tokens/time/connection): update `CURRENT_TASK.md` +
`SESSION_HANDOVER.md` with completed / remaining / modified files / next step.

---

## 6. Architecture Preservation Rules

- **Server/client boundary is sacred.** Node modules, secrets, `fs`, SQLite, broker
  SDKs → only in `*.functions.ts` / `services/*.server.ts`. Client (`routes/**`,
  `features/**`) calls server functions via the query layer only.
- **Data flows through `marketDataLayer`** — respect the fallback chains and the
  `EnvelopedResponse { _metadata }` lineage. Do not bypass the orchestrator.
- **Fallback chains (no synthetic step):**
  - Quotes: Upstox → Yahoo → EOD cache → throw
  - Option chain: FYERS → Angel One → NSE → EOD cache (`getEodOptionChain`) → FAIL
  - F&O: NSE OI-spurts + Yahoo → EOD cache → empty `[]`
- **Status semantics:** `LIVE` (open + real feed) · `EOD` (closed + real cache) ·
  `FAIL` (nothing real). Preserve these on data pages.
- **Per-index isolation:** analysis panels are selected-index-only. Never mix indices.

---

## 7. Coding Standards

- `@/` alias for `src`. Feature code in `src/features/<feature>/`; shared UI in
  `components/ui`; server RPC in `lib/*.functions.ts`; providers in `lib/services`.
- Naming: Components `PascalCase`; hooks `useX`; server fns `getX`/`saveX`; query
  options `xQuery`; types `PascalCase`.
- Prefer explicit exported types (`OptionChain`, `Quote`, `ProAnalysis`,
  `DataStatus`). `any` only at untyped broker/JSON edges — cast narrowly.
- Prettier + ESLint (`npm run lint` / `npm run format`). Keep code clean even though
  `noUnusedLocals` is off.

---

## 8. React / TanStack Best Practices

- **Query state → React Query**, never mirrored into `useState`.
- Every live query uses `placeholderData: keepPreviousData`; use `isPending` (not
  `isLoading`) for first-load spinners.
- Polling is market-hours-aware via `liveInterval()` in `dashboard-query.ts`.
- Wrap the query cache: `useQuery({ ...someQuery(args), ... })`.
- Local UI state via `useState`; derivations via `useMemo`; stable callbacks via
  `useCallback`; hot components in `memo`.
- Wrap pages in `<DashboardShell>`.

---

## 9. Performance Rules

- Memoize live tables/chart rows/gauges with complete dependency arrays.
- Wide SVG/tables scroll inside their container (`overflow-x-auto` + `min-w-0`
  parent), never overflow the page.
- Keep closed-market polling spaced out.
- Compute on already-fetched data instead of new round-trips where possible.

---

## 10. Testing & Validation

- No automated test suite exists. **The build is the gate.**
- After any change: `npm run build` must exit 0 (client + ssr + nitro).
- For data/logic changes, sanity-check against real `eod_cache/*.json` if useful.
- Clean up any temporary scripts you create.

---

## 11. Documentation Update Rules

On finishing a task, update the living docs:

- **`docs/CURRENT_TASK.md`** — reset to the next task (or IDLE). No history.
- **`docs/SESSION_HANDOVER.md`** — replace with the latest session only (lightweight).
- **`docs/CHANGELOG.md`** — append an entry for any completed feature (newest first).
- **`docs/PROJECT_MASTER.md`** — only if stable architecture actually changed.

Never let history accumulate in `SESSION_HANDOVER.md`; never put session notes in
`PROJECT_MASTER.md`.

---

## 12. Validation Checklist (Definition of Done)

- [ ] Works with real live + EOD data; FAIL state when no data
- [ ] No mock/synthetic data introduced
- [ ] Existing features still work
- [ ] Only task-related files changed
- [ ] `npm run build` clean (exit 0)
- [ ] `CURRENT_TASK.md`, `SESSION_HANDOVER.md`, `CHANGELOG.md` updated
- [ ] No file from the Forbidden list touched

---

## 13. Forbidden Actions

**Never modify** (unless the task IS specifically about it):

| Path | Reason |
|------|--------|
| `src/routeTree.gen.ts` | Auto-generated |
| `.env`, `.env.example`, `fyers_config.enc` | Secrets |
| `angel_one_scrip_master.json`, `upstox_instruments.json` | Instrument DBs |
| `eod_cache/**`, `backend/database/**` | Real cached/historical data |
| `node_modules/`, `.output/`, `.tanstack/`, `.wrangler/`, `.nitro/` | Generated/build |
| `vite.config.ts` plugin list | Uses `@lovable.dev` config — extra plugins break the app |
| Broker auth/session logic (`upstoxService`, `angelOneService`, `fyersService`, `configStore`) | Fragile token/login handling |

**Never:** fabricate data · redesign the project · rewrite unrelated files · delete
code without explanation · leave a session without updating the living docs.

---

## 14. Mission Statement

> Build and maintain a trustworthy, real-time Indian options terminal where every
> number on screen is real market data. An index-options trader should open a page,
> read the market's mood, OI structure and key levels in seconds — and trust it,
> because the system never lies with fake data.

---

*Master file. AI-specific bootstrap notes: `CLAUDE.md`, `GEMINI.md`. Deep
architecture: `docs/PROJECT_MASTER.md`.*
