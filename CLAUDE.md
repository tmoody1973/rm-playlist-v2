# Design System

Always read `DESIGN.md` before making any visual or UI decisions. All font choices, colors, spacing, motion, aesthetic direction, and component vocabulary are defined there. Do not deviate without explicit user approval. In QA mode, flag any code that doesn't match `DESIGN.md`.

Authoritative companion docs in `docs/design/`:

- `001-information-architecture.md` — what every UI surface shows, in what hierarchy
- `002-interaction-states.md` — loading/empty/error/success states per surface
- `003-responsive-accessibility.md` — viewport breakpoints, keyboard nav, ARIA, contrast, motion
- `004-unresolved-decisions.md` — design decisions still open + recommended defaults

# Convex Deployment Sync (READ BEFORE running convex dev/codegen)

The `precise-fish-444` Convex deployment is **shared** across every worktree and every developer. It is not version-controlled — whatever was last pushed wins. Running `bunx convex codegen` or `bunx convex dev` from a stale branch silently pushes that branch's functions + schema validators, overwriting whatever was live.

This caused a real outage on 2026-04-24: a `convex codegen` from a feature branch that pre-dated the `previewUrl`-on-`upsertTrack` change pushed the old validator. Main kept advancing; the deployed trigger worker called the new signature; every enrichment run failed `ArgumentValidationError`. Enrichment fell 71 min behind and every widget stopped showing artwork.

## Authoritative sync path

`.github/workflows/convex-deploy.yml` runs `bunx convex deploy` after CI passes on `main`, using the `CONVEX_DEPLOY_KEY` repo secret. **That workflow is the source of truth** for what's live.

## If you must run Convex commands manually

- **`bunx convex dev` (watch mode)** — ONLY from a worktree you're confident is in sync with `main`, i.e. the clock-time between your last `git pull` and your dev command should be under a minute. If another PR has merged since your last pull, STOP and rebase first.
- **`bunx convex codegen`** — same caveat. Codegen pushes functions as a side effect; it is not the pure "regenerate TypeScript bindings" command its name implies.
- **`bunx convex run`** — safe, read-only query/action invocation. No push.
- **`bunx convex data`** — safe, read-only table inspection. No push.

## If the deployment drifts

Symptoms: enrich-pending-plays cron shows `errored:N, resolved:0` in its summary; widgets stop showing fresh artwork; `Needs Attention` panel accumulates pending rows.

Recovery, in order of preference:

1. Trigger the `Convex deploy` workflow manually (GitHub → Actions → Convex deploy → Run workflow) — picks up current `main`, pushes cleanly
2. From a freshly-pulled `main` checkout locally: `cd packages/convex && bunx convex dev --once` — pushes the current commit's functions

Never run recovery from a feature branch — you'll just re-introduce the drift.

# Clean Code Standards

All code produced in this project must follow these clean code principles. These are non-negotiable defaults — not suggestions.

## Naming

- Every variable, function, and class name must clearly communicate its purpose. No single-letter names, no abbreviations unless universally understood (e.g., `id`, `url`).
- Use `numberOfUsers` not `n`. Use `calculateShippingCost` not `calc`.

## Functions

- Each function does ONE thing (Single Responsibility Principle). If you can describe what a function does using "and," split it.
- Keep functions under 20 lines. If longer, extract helper functions.
- Prefer small, composable functions over large monolithic ones.

## Comments

- Code should be self-explanatory. Comments explain WHY, never WHAT or HOW.
- Bad: `// Loop through users` — Good: `// Retry failed users from the last sync batch`
- Delete comments that restate the code. Outdated comments are worse than no comments.

## Formatting & Consistency

- Use consistent indentation (2 or 4 spaces — pick one, never mix).
- Group related logic with blank lines. Separate concerns visually.
- Use Prettier/ESLint or equivalent formatter. Every file should look like the same person wrote it.

## No Hardcoded Values

- Extract magic numbers and strings into named constants or config.
- Bad: `if (users >= 100)` — Good: `if (users >= MAX_USERS)`

## Project Structure

- Organize by concern: `components/`, `services/`, `utils/`, `tests/`.
- Keep test files outside `src/` in a mirrored structure.
- Never dump everything in one directory.

## Error Handling

- Fail fast. Throw meaningful errors with clear messages.
- Use try/catch blocks. Never silently swallow errors.
- Log like you're documenting a crime scene: precise, relevant, minimal.

## Testing

- Write unit tests for every function with logic.
- Tests should be as clean as production code.
- Test edge cases, not just the happy path.

## Dependency Injection

- Pass dependencies as arguments rather than hardcoding them.
- This makes code testable and swappable.

## The Boy Scout Rule

- Leave every file cleaner than you found it.
- When touching existing code: rename unclear variables, extract messy functions, remove dead code.

## Open/Closed Principle

- Design for extension, not modification. Use polymorphism and composition.
- Adding a new feature should not require rewriting existing working code.

## Code Smells to Fix on Sight

- Duplicated logic → extract into a shared function
- God objects doing everything → split responsibilities
- Long parameter lists → use an options/config object
- Nested conditionals 3+ levels deep → extract or invert early returns
