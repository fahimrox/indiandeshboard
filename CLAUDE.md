# CLAUDE.md — Claude-specific Bootstrap

> **`AGENTS.md` is the master document.** Read it first, then
> `docs/PROJECT_MASTER.md` → `docs/CURRENT_TASK.md` → `docs/SESSION_HANDOVER.md`
> → `docs/CHANGELOG.md`. This file adds only Claude-specific working notes — it does
> not repeat the rules in AGENTS.md.

---

## Plan before coding
- Restate the task from `CURRENT_TASK.md` in one line, then list the exact files you
  intend to touch **before** editing. If it spans many files, use a short todo list.
- For anything beyond a trivial edit, gather context with targeted search/reads
  first — never start editing blind.

## Large tasks → phases
- Split big features into checkpoints (engine/types → components → wiring → polish).
- Build after each meaningful checkpoint (`npm run build`, exit 0) so failures stay
  localized.
- If an approach fails twice, stop and diagnose the root cause instead of patching.

## Token & context efficiency
- Trust the docs; do **not** rescan the repository each session.
- Read files in parallel (batch related reads in one turn) rather than one-by-one.
- Prefer `read_code`/scoped reads and grep over dumping whole large files.
- Reuse knowledge already captured in `PROJECT_MASTER.md` (data layer, fallbacks,
  theme, forbidden files) instead of re-deriving it.

## Preserving context across long sessions
- Keep a working todo list for multi-step work; mark items done as you go.
- Record decisions/assumptions in `SESSION_HANDOVER.md` as you make them, not only at
  the end — so a compaction or interruption never loses them.
- After a context compaction, re-confirm your position from recent file state, not
  memory.

## Use the documentation correctly
- `CURRENT_TASK.md` = what to build now. `CHANGELOG.md` = history (don't duplicate it
  into other docs). `SESSION_HANDOVER.md` = latest session only, kept lightweight.
- When done, update the living docs exactly as AGENTS.md §11 specifies.

## This repo's Claude reminders
- Server/client boundary is strict — keep Node/secret/SQLite code in
  `*.functions.ts` / `services/*.server.ts` only.
- **No mock data, ever.** Missing data → `FAIL` state.
- Match the existing dark oklch theme and reuse `components/ui/*`.
- Be direct and concise in chat; put thoroughness into the code, not the prose.

---

*Everything else: see `AGENTS.md`.*
