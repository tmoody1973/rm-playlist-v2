# rm-playlist-v2

Radio Milwaukee's playlist platform, v2 — a single-tenant operator dashboard plus embeddable widgets for HYFIN, 88Nine, Rhythm Lab, and 414 Music. Single-tenant first (see [`docs/decisions/001-single-tenant-first.md`](docs/decisions/001-single-tenant-first.md)), architected so multi-tenant activation doesn't require a schema rewrite.

## What's in here

- **Operator dashboard** — live wall-of-status per station, `Needs Attention` panel with manual triage (Retry / Ignore / Edit / Re-enrich), per-station SoundExchange coverage stat.
- **Ingestion** — Spinitron + SGmetadata polled adapters, plus a persistent ICY worker on Fly for in-band Shoutcast/Icecast metadata.
- **Enrichment** — 4-tier record-label waterfall (Apple Music → Discogs release w/ variant retry → MusicBrainz release-by-MBID → Discogs artist-only), plus SoundExchange-required ISRC / duration capture. Station-aware fallback: 414 Music defaults to `Self-released` when all tiers miss.
- **Embed widgets** — Preact bundle shipped via Cloudflare Pages; `playlist`, `now-playing-strip`, `now-playing-card` variants.

## Stack

| Layer       | Tech                                                |
| ----------- | --------------------------------------------------- |
| DB + realtime | Convex (queries, mutations, HTTP actions)         |
| Auth        | Clerk (users only; Organizations deferred)          |
| Scheduling  | Trigger.dev (poll-all-sources, enrich-pending-plays, refresh-apple-music-token) |
| Long-lived  | Fly.io (`@rm/icy-worker`)                           |
| Dashboard   | Next.js 16.2 (Turbopack) + React 19 + Tailwind v4   |
| Widgets     | Preact + Vite, `@rm/embed` deployed to Cloudflare Pages |
| Enrichment  | Apple Music API (ES256 JWT), MusicBrainz, Discogs   |
| Runtime     | Bun 1.3+ (workspaces, test runner)                  |
| CI          | GitHub Actions                                      |

## Monorepo layout

```
apps/
  web/         # Next.js dashboard + /embed iframe fallback + /widget.js loader
  embed/       # Preact widget bundle (code-split by variant)
  icy-worker/  # Fly.io persistent ICY listener
packages/
  convex/      # schema, queries, mutations, HTTP actions
  ingestion/   # adapter registry + per-adapter parsers (spinitron, sgmetadata, icy)
  enrichment/  # Apple Music + MusicBrainz + Discogs clients, throttles, label waterfall
  types/       # shared TS types (NormalizedPlay, AdapterKind, etc.)
src/
  trigger/     # Trigger.dev tasks — poll-all-sources, enrich-pending-plays, refresh-apple-music-token
scripts/       # one-shot utilities (sync-env.sh, verify-apple-music.ts)
docs/
  decisions/     # ADRs — schema changes, API renames, pivots
  design/        # DESIGN.md + information-architecture, interaction-states, a11y
  implementation/# weekly implementation plans
```

## Quick start

### Prerequisites

- [Bun](https://bun.sh) 1.3+
- [Convex account](https://convex.dev) (dev deployment)
- [Clerk account](https://clerk.com)
- [Trigger.dev account](https://trigger.dev)
- [Fly.io CLI](https://fly.io/docs/hands-on/install-flyctl/) — only needed to deploy the ICY worker
- Apple Music Developer API key (`.p8` file) — required for enrichment
- Discogs API key pair — recommended for label coverage
- SGmetadata scraper UUIDs — from [streamguys1.com](https://streamguys1.com) dashboard

### Install + bootstrap

```bash
git clone <repo-url>
cd cebu  # or wherever rm-playlist-v2 is checked out
bun install

# Fill in secrets
cp .env.local.example .env.local  # if present, else see "Environment" below
# Edit .env.local with your keys

# Generate Convex types from schema
cd packages/convex && bunx convex codegen && cd -
```

### Develop

Five things typically run in parallel:

```bash
# 1. Convex dev (live schema + query push)
cd packages/convex && bunx convex dev

# 2. Trigger.dev task watcher (registers crons + hot-reloads)
bunx trigger.dev dev

# 3. Next.js dashboard
cd apps/web && bun run dev      # http://localhost:3000

# 4. ICY worker (only if you want live Rhythm Lab playback data)
cd apps/icy-worker && bun run dev

# 5. Embed widget dev server
cd apps/embed && bun run dev
```

### Typecheck + test

```bash
bun run typecheck   # all workspaces
bun run test        # all workspaces — ~220 tests across enrichment, ingestion, icy-worker
```

## Environment

All secrets live in `.env.local` (gitignored) and `~/.gstack/secrets/` for the Apple Music `.p8` key. Run `scripts/sync-env.sh` to push a subset to Trigger.dev and Fly.

| Variable                            | Used by                               | Required                    |
| ----------------------------------- | ------------------------------------- | --------------------------- |
| `NEXT_PUBLIC_CONVEX_URL`            | web dashboard, embed widgets          | yes                         |
| `CONVEX_URL` / `CONVEX_DEPLOYMENT`  | Trigger tasks, scripts                | yes                         |
| `CONVEX_SITE_URL`                   | Convex HTTP actions                   | yes                         |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | web dashboard                         | yes                         |
| `CLERK_SECRET_KEY`                  | web dashboard server side             | yes                         |
| `TRIGGER_PROJECT_REF`               | Trigger.dev CLI + deploys             | yes                         |
| `TRIGGER_SECRET_KEY`                | Trigger.dev CLI + deploys             | yes                         |
| `SGMETADATA_API_KEY`                | SGmetadata polled adapter             | for HYFIN / Rhythm Lab      |
| `HYFIN_SGMETADATA_SCRAPER_UUID`     | HYFIN source config                   | for HYFIN                   |
| `RHYTHMLAB_SGMETADATA_SCRAPER_UUID` | Rhythm Lab source config              | for Rhythm Lab              |
| `HYFIN_ICY_URL`                     | ICY worker (HYFIN future)             | optional                    |
| `RHYTHMLAB_ICY_URL`                 | ICY worker                            | for Rhythm Lab stream       |
| `APPLE_MUSIC_KEY_ID`                | Apple Music JWT signing               | yes (for enrichment)        |
| `APPLE_MUSIC_TEAM_ID`               | Apple Music JWT signing               | yes                         |
| `APPLE_MUSIC_PRIVATE_KEY` (or `_B64`) | Apple Music JWT signing             | yes                         |
| `DISCOGS_CONSUMER_KEY`              | Discogs fallback label lookup         | recommended                 |
| `DISCOGS_CONSUMER_SECRET`           | Discogs fallback label lookup         | recommended                 |
| `SPOTIFY_CLIENT_ID` / `_SECRET`     | Spotify preview URL (future)          | optional                    |
| `TICKETMASTER_CONSUMER_KEY` / `_SECRET` | Events ingestion (future)         | optional                    |
| `CLOUDFLARE_ACCOUNT_ID` / `_API_TOKEN` | Embed widget deploys to Pages      | only for widget deploys     |

## Ingestion adapters

MVP adapters, all live:

- **`spinitron`** — polled REST API, 60s interval
- **`sgmetadata`** — StreamGuys metadata scraper REST, 60s interval, drives HYFIN + 88Nine + Rhythm Lab
- **`icy`** — long-lived HTTP connection with `Icy-MetaData: 1`, in-band `StreamTitle=` blocks, Fly-deployed worker

Each adapter is one file under `packages/ingestion/src/adapters/`, conforms to the `Adapter` interface, pure `parse()` function, Zod-validated config, fixture-tested.

## Enrichment pipeline

Every `pending` play runs through `src/trigger/enrich-pending-plays.ts` (60s cron, batch of 20):

1. Apple Music + MusicBrainz in parallel — `packages/enrichment/src/apple-music`, `packages/enrichment/src/musicbrainz`
2. MB hit + AM hit → upsert canonical artist (by MBID) + track, `markPlayEnriched`
3. MB hit only → `markPlayEnriched` with artist but no canonical track
4. AM hit only → `markPlayUnresolved` with `mb_miss` (surfaces in Needs Attention)
5. Transient Apple errors (401/429/5xx) → play stays `pending`, batch aborts on 401 and triggers token refresh

Record-label resolution runs its own 4-tier waterfall before `upsertTrack`: Apple → Discogs release (variant retry) → MB release-by-MBID → Discogs artist-only. 414 Music plays default to `Self-released` when all four tiers miss.

## Deployment targets

- **Convex** — deployed via `bunx convex deploy`
- **Vercel** — `apps/web` (dashboard)
- **Cloudflare Pages** — `apps/embed` (widgets, `embed.radiomilwaukee.org`)
- **Fly.io** — `apps/icy-worker` (`fly deploy` from that directory)
- **Trigger.dev** — `bunx trigger.dev deploy` from the repo root

## Conventions

- Coding standards: [`CLAUDE.md`](CLAUDE.md) at the repo root
- Design system: [`DESIGN.md`](DESIGN.md) plus docs in `docs/design/`
- Architecture decisions: `docs/decisions/`
- V1 reference learnings: `v1-reference/` (gitignored)

## Status

Shakedown phase — single-tenant, Radio Milwaukee only. Live ingestion on Rhythm Lab via ICY + SGmetadata; enrichment running every 60s; dashboard + Needs Attention panel in use. Deliverables tracked against the CEO plan at `~/.gstack/projects/rm-playlist-v2/ceo-plans/2026-04-22-v2-selective-expansion.md`.
