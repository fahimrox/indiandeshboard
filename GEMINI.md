# GEMINI.md — Gemini-specific Bootstrap

> **`AGENTS.md` is the master instruction file.** Read it first, then
> `docs/PROJECT_MASTER.md` → `docs/CURRENT_TASK.md` → `docs/SESSION_HANDOVER.md`
> → `docs/CHANGELOG.md`. This file adds only Gemini-specific workflow guidance — it
> does not repeat AGENTS.md.

---

## Before you code
- Read `docs/PROJECT_MASTER.md` fully once — it holds the architecture, data-layer
  fallbacks, theme tokens, and the forbidden-files list. Do not re-derive these.
- Respect `docs/CURRENT_TASK.md`: build exactly the active task, nothing extra. If it
  says IDLE, wait for the user's instruction.

## Make minimal, surgical edits
- Change only the files the task requires; keep the diff small.
- **Do not rewrite large files** to make a small change — edit in place.
- Preserve the existing architecture, patterns, naming, and design language. Prefer
  extending existing services/components over creating new ones.

## Stay implementation-focused
- Keep responses concise and action-oriented — code and the specific edits, not long
  explanations or restated theory.
- Don't add features, abstractions, or files that weren't asked for.

## Build & validate frequently
- Run `npm run build` after each checkpoint; it must exit 0 (client + ssr + nitro).
- Fix every error before moving on or declaring done.
- Sanity-check data/logic against real `eod_cache/*.json` when relevant. Never
  introduce mock/synthetic data — missing data must show a `FAIL` state.

## Hard guardrails (see AGENTS.md §13 for the full list)
- Never edit `routeTree.gen.ts`, `.env`, `fyers_config.enc`, instrument JSONs,
  `eod_cache/**`, `backend/database/**`, or the `vite.config.ts` plugin list.
- Keep Node/secret/SQLite code inside `*.functions.ts` / `services/*.server.ts`.

## When finished
- Update `docs/CURRENT_TASK.md`, `docs/SESSION_HANDOVER.md`, and `docs/CHANGELOG.md`
  per AGENTS.md §11. Keep `SESSION_HANDOVER.md` to the latest session only.

---

*Everything else: see `AGENTS.md`.*
