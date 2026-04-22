# 001 — Week 1-2 Scaffold

**Date:** 2026-04-22
**Status:** Ready to execute (all pre-scaffold blockers cleared)
**Depends on:** CEO plan accepted scope, DESIGN.md, 4 design docs, 2 decision docs
**Produces:** working monorepo, Convex deployed, Clerk auth live, one Trigger.dev task polling SGmetadata HYFIN, admin dashboard shell, CI green

## Entry conditions (all true as of 2026-04-22)

- [x] TODO-1: Apple Music API verified (JWT signing + search + preview URLs working)
- [x] DESIGN.md written with full token spec
- [x] TODOS.md captures 14 deferred items
- [x] decisions/001-single-tenant-first.md, decisions/002-secrets-at-rest.md
- [x] docs/design/001-004 written
- [x] Empty git repo (main branch, 2 commits)
- [x] SGmetadata credentials in hand (per project memory)
- [ ] Spinitron API keys in hand for HYFIN / 88Nine / 414Music / RhythmLab (per-station)
- [ ] Clerk app created at clerk.com, publishable + secret keys captured
- [ ] Convex team + project created at convex.dev, deploy URL + key captured
- [ ] Trigger.dev project created at trigger.dev, secret key captured
- [ ] Cloudflare account w/ Pages access (for Week 2 widget CDN)

The four unchecked items are "register the service accounts" — each ~3 min at the respective dashboard. None are code work. Do these first; scaffold blocks on them.

## Monorepo target structure

```
rm-playlist-v2/
├── apps/
│   ├── web/                       # Next 15 dashboard + Convex home
│   │   ├── app/                   # App Router routes
│   │   │   ├── (auth)/sign-in/    # Clerk-powered sign-in
│   │   │   ├── dashboard/         # authenticated shell
│   │   │   │   ├── page.tsx       # wall-of-status
│   │   │   │   ├── unclassified/
│   │   │   │   ├── widgets/
│   │   │   │   ├── reports/
│   │   │   │   ├── events/
│   │   │   │   └── streams/
│   │   │   └── layout.tsx
│   │   ├── convex/                # Convex functions (owned by web app)
│   │   │   ├── schema.ts
│   │   │   ├── _generated/        # gitignored
│   │   │   ├── sources.ts
│   │   │   ├── plays.ts
│   │   │   ├── appleMusic.ts
│   │   │   └── http.ts            # HTTP actions for widget reads
│   │   ├── middleware.ts          # Clerk auth middleware
│   │   └── package.json
│   └── embed/                     # Preact widget bundle (Week 2 priority)
│       ├── src/
│       ├── vite.config.ts
│       └── package.json
├── packages/
│   ├── adapters/                  # the source-agnostic ingestion contract
│   │   ├── src/
│   │   │   ├── types.ts           # NormalizedPlay, AdapterContract
│   │   │   ├── registry.ts
│   │   │   ├── spinitron.ts
│   │   │   ├── icy.ts
│   │   │   └── sgmetadata.ts
│   │   ├── test/
│   │   │   ├── fixtures/
│   │   │   │   ├── spinitron-hyfin-*.json
│   │   │   │   └── sgmetadata-hyfin-*.json
│   │   │   ├── parse-never-throws.property.test.ts  # fast-check
│   │   │   └── each-adapter.contract.test.ts
│   │   └── package.json
│   └── types/                     # cross-package TypeScript types
│       └── src/index.ts
├── services/
│   └── icy-worker/                # Fly persistent worker (Week 3+, stubbed Week 2)
│       ├── src/index.ts
│       ├── fly.toml
│       └── package.json
├── scripts/
│   ├── verify-apple-music.ts      # ✓ exists
│   └── sync-env.sh                # Week 2: push .env.production to all stores
├── .github/
│   └── workflows/
│       ├── ci.yml                 # adapter contract gate + typecheck + lint
│       └── widget-publish.yml     # Week 2: Cloudflare Pages deploy
├── bunfig.toml
├── package.json                   # workspace root
├── tsconfig.base.json
└── turbo.json                     # (optional) Turborepo for task caching
```

## Milestone 1 — Workspace bones (Day 1, ~30 min CC)

```bash
# From repo root
bun init -y                        # produces package.json + tsconfig.json
```

Edit `package.json` to declare workspaces:

```json
{
  "name": "rm-playlist-v2",
  "private": true,
  "workspaces": ["apps/*", "packages/*", "services/*"],
  "scripts": {
    "typecheck": "bun --filter='*' typecheck",
    "test": "bun --filter='*' test",
    "lint": "bun --filter='*' lint"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0",
    "prettier": "^3.3.0",
    "eslint": "^9.0.0"
  }
}
```

Create:
- `tsconfig.base.json` with `"strict": true`, `"moduleResolution": "bundler"`, `"jsx": "preserve"`
- `.prettierrc`, `.eslintrc.cjs` per CLAUDE.md clean-code standards (2-space indent, consistent-return, no-unused-vars)
- `bunfig.toml` with `[install] exact = true`

**Exit:** `bun install` succeeds; empty workspace dirs exist.

## Milestone 2 — Packages first (Day 1-2, ~1h CC)

Packages have no framework dependency, so they compile without Convex/Next/Clerk. Scaffold them first; adapter contract blocks everything else.

### packages/types
Shared `NormalizedPlay`, `Station`, `IngestionSource`, `PlayRow`. No runtime deps.

### packages/adapters
```bash
cd packages/adapters
bun init -y
bun add zod
bun add -d fast-check vitest
```

Implement:
- `src/types.ts` — `AdapterContract` interface: `{ name: string; parse: (raw: unknown) => NormalizedPlay[] }`. Crucially: `parse()` **never throws**, always returns array (possibly empty). This is the central invariant.
- `src/registry.ts` — `registerAdapter(name, impl)`, `getAdapter(name)`
- `src/spinitron.ts` — first real implementation. Zod schema for Spinitron's spin shape, safeparse → NormalizedPlay or empty.
- Fixtures: 10+ recorded Spinitron JSON responses (happy path, empty, malformed, paginated).
- `test/parse-never-throws.property.test.ts` — fast-check fuzz with arbitrary strings/buffers/objects, assert `parse(x)` never throws. This closes TODO-3.

**Exit:** `bun --filter=@rm/adapters test` green with ≥10 fixtures + property test.

## Milestone 3 — apps/web + Convex init (Day 2-3, ~2h CC)

```bash
mkdir -p apps/web && cd apps/web
bun create next@latest . --typescript --tailwind --app --src-dir=false --import-alias="@/*"
bun add convex @clerk/nextjs
bunx convex@latest dev   # runs `convex init` on first invocation, prompts for team + project
```

### Convex schema (initial — `apps/web/convex/schema.ts`)

Translate the brainstorm's schema section line-by-line. Every table has `orgId` as forward-compat (populated with the RM singleton `orgId` during single-tenant phase). Tables to include in Milestone 3:

- `organizations` (1 row during shakedown)
- `stations` (4 rows: HYFIN, 88Nine, 414 Music, Rhythm Lab)
- `users` (Clerk-mirrored)
- `ingestionSources` (one per station × adapter)
- `ingestionEvents` (append-only log, drives Needs-Attention panel)
- `plays` (the core table — include `deletedAt` for soft-delete rewind)
- `tracks`, `artists` (canonical)
- `widgets` (for embed generator)
- `appleMusicTokenCache` (per decisions/002)

Seed mutations: `internal.seed.rmOrg`, `internal.seed.stations`. Run once manually via `bunx convex run internal.seed.rmOrg`.

### Clerk wiring

- `middleware.ts` per Clerk Next 15 docs — protect `/dashboard/*`
- `app/(auth)/sign-in/[[...sign-in]]/page.tsx` with `<SignIn />`
- Clerk → Convex auth bridge via `ConvexProviderWithClerk` in `app/providers.tsx`
- Two roles: `operator` (default), `admin` — stored as Clerk user's `publicMetadata.role`
- One admin user seeded manually via Clerk dashboard (your account)
- Convex query helper `requireAdmin(ctx)` reads from Clerk identity claims

**Exit:** sign in works, dashboard landing page renders "Hello, <you>" with role badge, Convex dev console shows live connection.

## Milestone 4 — First Trigger.dev task (Day 3-4, ~1h CC)

```bash
cd apps/web
bun add @trigger.dev/sdk
bunx trigger.dev@latest init
```

Task: `poll-sgmetadata-hyfin` — runs every 30s via Trigger schedule, calls SGmetadata adapter with `HYFIN_SGMETADATA_USER`/`_PASS` env vars, writes NormalizedPlay to Convex via a Convex HTTP action, records an `ingestionEvents` row regardless of outcome.

**Concurrency: 1** (per brainstorm + eng review acceptance). **No retry on parse-never-throws** (empty array is a valid result).

Validation:
- Start trigger dev server: `bunx trigger.dev@latest dev`
- Watch Convex dashboard → `plays` table populates
- Watch `ingestionEvents` → each poll produces a row (success or fail)
- Purposefully rotate the SGmetadata password to invalid → `ingestionEvents` show auth error rows, `plays` table stops growing, dashboard "Needs Attention" (Milestone 5) surfaces the issue

**Exit:** HYFIN plays appearing in Convex with real artist/title data, every 30s, for at least 1 hour.

## Milestone 5 — Dashboard shell + Ingestion Health card (Day 4-5, ~3h CC)

This is the CEO-plan Week 1-2 deliverable: single-page admin dashboard surfacing `ingestionEvents` rollups. Implement per `docs/design/001-information-architecture.md` section A.

### Shell
- Top bar: RM wordmark + role indicator
- Left sidebar (icon-only, Lucide icons): Dashboard / Streams / Reports / Events / Unclassified / Widgets / Settings
- Dark mode default with tokens from `DESIGN.md` (CSS custom properties on `:root`)
- Tailwind config reads tokens from one source: `apps/web/app/design-tokens.css`

### Dashboard home — MVP scope for Week 1-2
- Row 1: 4 station cards (live now-playing via Convex subscription) — but only HYFIN has real data, others show "configuring..." until Week 3
- Row 2: Needs Attention panel — lists latest `ingestionEvents` with status ≠ success; derived-value unclassified-count placeholder for now
- Row 2: Reports panel — placeholder "Reports coming Week 3-4" card
- Row 3: Upcoming from rotation — placeholder "events integration coming Week 5"

Widgets (`now-playing-card`, `playlist`, `now-playing-strip`) are Week 3+ scope and live in `apps/embed/` which is created as an empty shell in Milestone 7.

**Exit:** `bun dev` serves the dashboard, HYFIN card shows a live track changing every song, a drop of the Spinitron API key shows the Needs-Attention card turning red within 60s.

## Milestone 6 — CI gate + env sync (Day 5, ~1h CC)

### `.github/workflows/ci.yml`

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run typecheck
      - run: bun run lint
      - run: bun --filter='@rm/adapters' test
```

This closes the CEO-plan scope item "Day 1: GitHub Actions CI gate requiring >=10 recorded fixtures + green parse tests per adapter." Add a fixture-count assertion:

```ts
// packages/adapters/test/fixture-count.test.ts
import { readdirSync } from "node:fs";
for (const adapter of ["spinitron", "icy", "sgmetadata"]) {
  test(`${adapter} has ≥10 fixtures`, () => {
    const count = readdirSync(`test/fixtures`).filter(f => f.startsWith(adapter)).length;
    expect(count).toBeGreaterThanOrEqual(10);
  });
}
```

### `scripts/sync-env.sh`

Per decisions/002 secrets-at-rest. Reads `~/.gstack/secrets/rm-playlist-v2/.env.production` (source of truth) and pushes to each store:

```bash
#!/usr/bin/env bash
set -euo pipefail
ENV_FILE="$HOME/.gstack/secrets/rm-playlist-v2/.env.production"
[[ -f "$ENV_FILE" ]] || { echo "No env at $ENV_FILE"; exit 1; }

# Convex
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  bunx convex env set "$key" "$value"
done < "$ENV_FILE"

# Trigger.dev (reads via CLI)
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  bunx trigger.dev@latest env set "$key" "$value"
done < "$ENV_FILE"

# Fly (Week 3+)
# while IFS='=' read -r key value; do
#   fly secrets set "$key=$value" -a rm-icy-worker
# done < "$ENV_FILE"

echo "Synced to Convex + Trigger."
```

**Exit:** `bash scripts/sync-env.sh` completes; pushed PR shows green CI with typecheck + lint + adapter tests.

## Milestone 7 — apps/embed shell + v1-embed compat shim at v2 domain (Day 6-7, ~2h CC)

Week 2 per CEO plan: `v1-embed compatibility shim live at v2 domain from Week 2 (separates infra routing risk from widget rendering risk at cutover)`.

### `apps/embed/` shell

```bash
mkdir -p apps/embed && cd apps/embed
bun init -y
bun add preact convex
bun add -d vite vite-plugin-preact @preact/preset-vite
```

- `src/loader.ts` — the ~5KB loader that reads `data-station` / `data-layout` etc. and dynamically imports the correct variant chunk
- `src/variants/playlist.ts` — stub that renders "playlist widget coming Week 4" in the host page's shadow root
- `vite.config.ts` — builds to `dist/v1/widget.js` (versioned path, matches `data-layout="list|grid"` config naming from DESIGN.md IA doc)

### Cloudflare Pages deploy pipeline

`.github/workflows/widget-publish.yml`:
```yaml
name: Widget publish
on:
  push:
    paths: ['apps/embed/**', '.github/workflows/widget-publish.yml']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun --filter='@rm/embed' build
      - uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: rm-playlist-v2-embed
          directory: apps/embed/dist
```

### v1-embed compat shim

Single route in `apps/web/app/embed/iframe/[slug]/[variant]/route.ts` that redirects V1 iframe URLs to the v2 CDN URL. Example: an old iframe pointing at `https://playlist.radiomilwaukee.org/iframe/88nine/recently-played` → 302 to `https://embed.radiomilwaukee.org/v1/widget.js?station=88nine&variant=recently-played`. Preserves query params, issues cache-friendly 302 (not 301).

**Exit:** pushing to main deploys widget bundle to `https://embed.radiomilwaukee.org/v1/widget.js`; V1 iframe URLs return 302 to the new location.

## Exit criteria (end of Week 2)

- [ ] Bun monorepo with workspaces wired, `bun install` clean
- [ ] Convex deployed, schema has all tables, RM org + 4 stations seeded
- [ ] Clerk auth works, you can sign in, role = admin
- [ ] One Trigger.dev task running, polling HYFIN SGmetadata every 30s
- [ ] Plays populating live in Convex, visible in dashboard HYFIN card
- [ ] CI green on PR with: typecheck + lint + adapter parse-never-throws property test + ≥10 fixtures per existing adapter
- [ ] `scripts/sync-env.sh` works, pushes env to Convex + Trigger
- [ ] Widget shell deployed to `embed.radiomilwaukee.org/v1/widget.js` (stub content OK)
- [ ] V1 iframe URLs redirect to new CDN via compat shim

## Out of scope for Week 1-2 (deferred to Week 3+)

- Spinitron adapters for 88Nine / 414 Music / Rhythm Lab (shakedown adds one/week per CEO plan)
- ICY adapter + Fly worker (Week 3)
- Rhythm Lab dual-source reconciliation (Week 3 per CEO-accepted scope move)
- Apple Music enrichment adapter + token cache refresh cron (Week 3)
- Actual widget variants implemented (Week 4+ — shell only in Week 2)
- Reports UI (Week 3-4 per CEO-accepted SoundExchange front-load)
- Events layer (Ticketmaster/AXS — Week 5)
- Enrichment waterfall (MusicBrainz/Discogs/Spotify — Week 5-6)
- `touringFromRotation` derived Convex table + cron (Week 6)
- Unclassified queue UI (Week 7)

## Worktree parallelization

Per eng review Lane structure — Weeks 1-2 are mostly sequential because Convex schema (Lane 1 step A) gates everything. Two lanes with safe overlap:

- **Lane A (must finish first):** Milestones 1-3 (workspace + packages + Convex schema + Clerk)
- **Lane B (parallelizable with Lane A's Milestone 3):** packages/adapters Spinitron impl + fixtures + property test (Milestone 2 subset)

After Lane A+B: Milestones 4-7 run sequentially in one lane (each depends on the previous Convex schema state or deployed app URL).

## Risk register (things that could bite Week 1-2)

| Risk | Mitigation |
|------|------------|
| Convex schema shape changes mid-week | Freeze schema after Milestone 3; any change requires re-running all seed mutations |
| Clerk Custom Claims for role lookup don't reach Convex correctly | Test the Clerk→Convex identity bridge in Milestone 3 exit gate before moving to Milestone 4 |
| Trigger.dev task timeouts on SGmetadata slow response | `concurrency: 1` + 20s timeout on HTTP fetch; poll interval 30s gives 10s headroom |
| Bun workspace resolution breaks on named package imports across workspaces | Use `"type": "module"` everywhere + explicit `exports` field in each package's package.json |
| Cloudflare Pages build fails on first deploy due to missing build step config | Test the GitHub Action locally with `act` before merging Milestone 7 |

## If you hit a blocker

- Re-read `docs/design/002-interaction-states.md` for "what should the user see when X fails" answers — state coverage is already designed
- Check `TODOS.md` for known deferrals; the answer to "should this be in scope" is often already there
- Project memory in `~/.claude/projects/.../memory/` has the widget catalog + V1 grounding + check-V1-first feedback — pull it forward on any widget decision

## What to do after Week 1-2

- `/checkpoint` to snapshot end-of-scaffold state
- `/retro` for first retrospective (did the plan hold up? any scope creep?)
- Start Week 3: add Spinitron adapter for 88Nine + ICY adapter + Rhythm Lab dual-source + start Apple Music enrichment
