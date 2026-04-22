# rm-playlist-v2

Radio Milwaukee playlist platform, v2. Single-tenant first (see `docs/decisions/001-single-tenant-first.md`), architected for multi-tenant activation later without schema rewrites.

## Stack

- **Convex** — DB, real-time subscriptions, HTTP actions, auth context
- **Clerk** — auth (users only; Organizations deferred)
- **Trigger.dev** — scheduled ingestion + enrichment tasks
- **Fly.io** — persistent ICY stream worker
- **Next.js 15** — dashboard + public embed routes
- **Preact** — embeddable widget bundle (separate build target, ~15KB gzip target)

## Monorepo layout (target)

```
apps/
  web/          # Next.js 15: dashboard + /embed/iframe fallback + /widget.js loader
  embed/        # Preact widget bundle, code-split by variant
packages/
  convex/       # schema, queries, mutations, HTTP actions
  ingestion/    # adapter registry + per-adapter parsers
  enrichment/   # MusicBrainz → Discogs → Spotify waterfall + artistKey normalization
  types/        # shared TS types
services/
  trigger/      # Trigger.dev tasks (poll-sources, enrich-*, poll-ticketmaster)
  icy-worker/   # Fly.io persistent ICY listener
scripts/        # one-shot utilities
docs/
  decisions/    # architectural decision records
v1-reference/   # V1_LEARNINGS.md + V1_EDGE_CASES.md (Week 0 pre-work)
```

## Adapters (ingestion sources)

MVP: `spinitron`, `sgmetadata`, `icy`. Additive: `hls`, `icecast_status`, `shoutcast_v1/v2`, `azuracast`, `radioco`.

Every adapter: one file under `packages/ingestion/src/adapters/`, conforms to `Adapter` interface, pure `parse()` function, Zod-validated config, ≥10 recorded fixtures (CI gate).

## Clean Code

See `CLAUDE.md` — 12 patterns enforced from day 1.

## Context

- `radiomke-playlist-v2-brainstorm.md` — architecture brainstorm (source of truth for design intent)
- `docs/decisions/` — every schema change, every API rename, every "we thought X, turns out Y"
- V1 at `playlist.radiomilwaukee.org` (referenced in `radiomke-playlist-app V1/`, gitignored)

## Status

Pre-implementation. Scope locked via `/plan-ceo-review` on 2026-04-22 (6 scope expansions accepted, single-tenant pivot, 12 stated implementation fixes). See CEO plan at `~/.gstack/projects/rm-playlist-v2/ceo-plans/2026-04-22-v2-selective-expansion.md`.
