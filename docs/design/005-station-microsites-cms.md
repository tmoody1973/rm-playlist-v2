# 005 — Station Microsites CMS (`apps/cms`)

**Date:** 2026-05-28
**Status:** Accepted (from brainstorming session)
**Scope:** A new app in this monorepo for themeable public station pages — built template-first, powered by the existing `@rm/convex` data.

## Purpose

A small internal CMS + public site that lets Radio Milwaukee staff build
**themeable microsites and campaign pages** for three stations — **HYFIN,
88Nine, Rhythm Lab** (414 Music stays in the playlist system, no public CMS
pages). The stations' existing main websites are unchanged; this builds
*complementary* pages:

- **Station hub** — `/[station]` (now-playing, recent playlist, upcoming
  events, "touring artists we play")
- **Event pages** — `/[station]/events/[slug]`
- **Fundraiser pages** — `/[station]/fundraisers/[slug]`

All widgets read live data already in `@rm/convex` — no duplication, single
source of truth.

> **Relationship to `openbio-hyfin`:** that AGPL fork was a prototype that
> proved out the Convex + Clerk pairing and informed this design. The product
> lives here. The bento page-builder concept is **rebuilt clean** in `apps/cms`
> — OpenBio code is reference only, never copied (license hygiene; this repo is
> meant to stay a readable template).

## Locked decisions

| Decision | Choice |
| --- | --- |
| Page scope | Microsites + campaigns (main sites untouched) |
| Stations | hyfin, 88nine, rhythmlab |
| Page model | **Template-first block model** (page = ordered block stack; templates = preset stacks). Freeform 2D grid deferred as a contained block. |
| Theming | **Hybrid** — station default theme + per-page/event override (pick a theme and/or token overrides) |
| App boundary | New `apps/cms` — public pages + Clerk-gated `/admin` builder; shares `@rm/convex` |
| Auth | Reuse Clerk (`@radiomilwaukee.org`, existing `users` roles operator/admin) |
| Contest/giveaway | **Phase 2** module (not v1); v1 stays forward-compatible |

## Architecture & rendering

`apps/cms` — Next 16 (Turbopack) + React 19 + Tailwind v4, imports `@rm/convex`.

- **Public routes** (path-based): `/[station]`, `/[station]/events/[slug]`,
  `/[station]/fundraisers/[slug]`. `station ∈ hyfin | 88nine | rhythmlab`.
  Served on one dedicated host initially (exact domain TBD). Per-station
  subdomains are a later option via the existing proxy pattern — not v1.
- **Admin**: `/admin` in the same app, gated by Clerk middleware + the existing
  `@radiomilwaukee.org` restriction and `users.role`.
- **Rendering**: public pages are RSCs reading Convex via `fetchQuery` /
  `preloadQuery` → server-rendered, cacheable, mobile-first, SEO-friendly.
  **Live widgets** (now-playing) hydrate as small client components using Convex
  `useQuery` for realtime. Page content/theme uses revalidation (ISR-style);
  it does not need to be realtime.
- **Data boundary**: CMS *reads* `plays`, `tracks`, `events`,
  `touringFromRotation`; *owns* `pages` and `themes`. It does not modify core
  tables.

## Data model (new tables in `packages/convex`)

```
themes
  orgId, stationId?         // stationId set = station-scoped theme
  name                      // "HYFIN Brand", "Fundraiser Red"
  isStationDefault: bool    // fallback theme for that station
  tokens: { colorPrimary, colorBg, colorCard, colorAccent, font, radius, ... }
  // indexes: by_station, by_org

pages
  orgId, stationId
  kind: 'station-home' | 'event' | 'fundraiser'   // open enum (giveaway later)
  slug                      // '' for the hub; e.g. 'summerfest-2026'
  title
  status: 'draft' | 'published'
  themeId?                  // page-level theme override
  themeOverrides?           // token-level tweaks (accent, bg, hero image)
  blocks: Block[]           // ordered array — the page body
  eventId?                  // event pages link to an ingested event
  seo: { title?, description?, ogImage? }
  publishedAt?, createdBy, updatedBy
  // indexes: by_station_kind_slug, by_station_status
```

- **Blocks are an embedded ordered array.** A page has a bounded handful of
  blocks, edits are infrequent, docs stay small — no separate table. Each block
  is `{ id, type, config }`, validated at the function boundary with a Zod
  discriminated union so `config` is type-safe per block type.
- **Theme cascade at render:** station default theme → `page.themeId` (if set)
  → `page.themeOverrides` (token-level). Resolved once server-side, emitted as
  CSS variables on the page wrapper.
- **Station hub** = one `page` per station with `kind: 'station-home'`,
  `slug: ''`. Station default theme is `themes` row where
  `stationId == X && isStationDefault`.

## Block catalog (v1)

**Content blocks (staff-authored):** `hero` (title/subtitle/background/CTA),
`rich-text` (Tiptap), `image` (+caption/link), `cta` (buttons).

**Live-data blocks (read `@rm/convex`, zero data entry):**
- `now-playing` — current track + 30s Apple preview (realtime)
- `playlist` — recent N plays (list/grid)
- `upcoming-events` — future, non-cancelled `events` for the station/region
- `touring` — "artists we play coming to town" from `touringFromRotation`

**Campaign block:** `fundraiser-progress` — goal / raised / % bar + donate CTA.
**v1 is manual-entry** (staff update goal/raised) + a donate link. Live
donation-platform integration is deferred.

**Templates (preset block stacks):**
- **station-home:** hero → now-playing → playlist → upcoming-events → touring
- **event:** hero(event) → rich-text → cta(tickets) → (optional) touring
- **fundraiser:** hero → fundraiser-progress → rich-text → cta(donate) →
  (optional) now-playing

**Deferred (Phase 2+):** `entry-form` (giveaway), freeform `grid` block, embeds.

## Editing, draft/publish & roles

- **Admin builder** (`/admin`): page list grouped by station; create → pick
  station + kind → seeded from the kind's template; edit via a **vertical
  block-stack editor** (add/remove/reorder as a *list*, inline per-block config,
  live preview pane with resolved theme); theme controls (pick page theme /
  inherit station default + token overrides); publish.
- **Draft/publish:** public routes render only `published` pages (draft slug →
  404 publicly); staff preview drafts in the admin and/or a Clerk-guarded
  `?preview` route.
- **Roles (light for v1):** `operator` = create/edit/publish pages for any
  station; `admin` = that plus manage themes (presets, station default) and
  delete pages. Both already exist in `users`. Team is small → any staff edits
  any station; no per-station permission matrix in v1.
- **Authorization:** every CMS mutation derives the user server-side via
  `ctx.auth.getUserIdentity()` → `users` row → role check. Never trust a
  client-passed role/userId. Matches the existing repo pattern.

## Build phasing

Read/render paths before write paths, so something real renders early.

- **Phase 0 — Scaffold.** `apps/cms` (Next 16, Tailwind v4, `@rm/convex`, Clerk
  middleware + `@radiomilwaukee.org` gate on `/admin`). Add `themes` + `pages`
  tables. Seed a default theme per station.
- **Phase 1 — Public render pipeline.** Block renderer + theme cascade (→ CSS
  vars); content blocks (hero, rich-text, image, cta); `/[station]` routes
  rendering published pages. Goal: a seeded page renders on-theme, mobile-first.
- **Phase 2 — Live-data blocks.** now-playing (realtime), playlist,
  upcoming-events, touring — reusing existing `plays`/`events` queries where
  present.
- **Phase 3 — Admin builder.** Page list, create-from-template, block-stack
  editor, live preview, draft/publish — with role-checked Convex mutations.
- **Phase 4 — Theme management.** Admin UI for presets + station default;
  page-level theme + token overrides.
- **Phase 5 — Fundraiser-progress (manual) + polish.** SEO/OG images (reuse the
  `next/og` pattern in `apps/web`), per-page SEO.
- **Later:** giveaway/contest module, freeform grid block, per-station
  subdomains, live donation integration.

Each phase is independently shippable and verifiable.

## Phase 2 — Contest / ticket-giveaway module (forward-compat only)

A future module: at events people enter giveaways; multiple entry methods grant
more entries; a fair random picker selects winners. It fits as **another
themeable campaign page** (a `giveaway` page-kind + an `entry-form` block)
backed by new tables (`giveaways`, `giveawayEntries`, `entryActions`) and an
auditable random-draw mutation. Convex suits it well (realtime counts,
transactional dedup).

**Two hard truths captured now:**

1. **Social-action verification is mostly honor-system.** Instagram/Meta and
   YouTube no longer expose follow/subscribe checks. Lead with **verifiable**
   actions — newsletter signup (double opt-in, list you own) and **referral via
   unique link**. Model `entryActions` as `verified` vs `claimed`; social
   follows are claimed bonus entries, not verified.
2. **Sweepstakes law is non-optional** for a US nonprofit: no-purchase-necessary
   / AMOE (a free entry path must always exist — critical if entries ever tie to
   donations), official rules, age/residency limits, privacy/consent for
   collected emails. Requires a human/legal review, not just code.

**v1 forward-compat guarantees** so this drops in cleanly later:
- Block registry stays open → `entry-form` is just a new block type.
- `pages.kind` is an open enum → add `giveaway`.
- **Entrants are NOT Clerk users** → lightweight email-keyed rows, fully
  separate from staff auth.

## Open items (not blocking)

- Exact public host/domain for the microsites.
- Which donation platform (for later live `fundraiser-progress`).
- Confirm reusable now-playing / recent-plays / events query helpers in
  `plays.ts` / `events.ts` vs new CMS-specific queries.
