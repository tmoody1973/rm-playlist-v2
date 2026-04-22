# TODOs — rm-playlist-v2

Deferred work tracked across all plan reviews (CEO, design, design-consultation, eng). Each item names what, why, who-blocked-by, and when to revisit.

## Pre-scaffold blockers (must resolve BEFORE Week 1)

### TODO-1 — Set up Apple Music API developer credentials (REVISED 2026-04-22)
**What:** In Apple Developer portal (RM has membership): create a Music Identifier + Private Key. Download the `.p8` file. Capture `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, and the `.p8` contents (base64 it for env-var safety). Verify by signing a test JWT (ES256) and hitting `/v1/catalog/us/songs/{id}` for a known track. Smoke test: confirm `attributes.previews[0].url` returns a playable MP3 URL.
**Why:** Preview source switched from Spotify to Apple Music API on 2026-04-22 because Spotify deprecated `preview_url` for new apps + Web Playback SDK is premium-only + Spotify iframe embed fights editorial design. Apple Music API gives reliable preview URLs with full UI theming control, RM's existing Apple Developer membership covers the cost.
**Blocks:** Implementation of preview button affordance.
**Owner:** Tarik (only one with RM Apple Developer portal access).
**Notes:** Token rotation strategy: cache the signed developer token in Convex (refreshed via Trigger.dev cron weekly, well within 6mo expiration). See `decisions/002-secrets-at-rest.md` for env var manifest.

## During-shakedown work (do during Weeks 1-12)

### TODO-2 — Wire `data-enable-preview` as the canonical attribute, alias `data-enable-youtube` for back-compat
**What:** v2 widget config attribute is `data-enable-preview`. V1 used `data-enable-youtube`. Embed code from V1 partner sites must keep working.
**Why:** Preserves V1 embed codes in the wild on station websites.
**Where:** `apps/embed/src/loader.ts` config parser.

### TODO-3 — Property test for `adapter.parse() never throws` contract
**What:** Use fast-check or equivalent to fuzz `adapter.parse()` for every adapter (`spinitron`, `icy`, `sgmetadata`) with arbitrary input. Assert: never throws, always returns `NormalizedPlay[]` (possibly empty) or rejects with a typed error.
**Why:** Brainstorm asserts this invariant but ad-hoc tests can't prove "never throws." Property test enforces it across adapters as a CI gate.
**Where:** `packages/adapters/test/parse-never-throws.property.test.ts`.

### TODO-4 — Post-MVP: full-track playback for logged-in subscribers (Apple MusicKit JS + Spotify Web Playback SDK as parallel opt-ins)
**What:** Two parallel sign-in flows: "Sign in with Apple Music" (premium subscribers hear full tracks via MusicKit JS) and "Sign in with Spotify" (premium subscribers hear full tracks via Web Playback SDK). Both gated on premium subscription.
**Why:** 30-sec previews from Apple Music API are the floor. Premium users in either ecosystem get a meaningfully better experience hearing the full track in-place. Doing both means we don't bet on one DSP's user overlap with RM's audience.
**When:** After shakedown gates pass.
**Notes:** Both SDKs require user-token rotation infrastructure; doing both at once shares the auth-token-management code investment.

## Post-shakedown work (revisit after RM-only shakedown stabilizes)

### TODO-5 — Multi-region or alternative ICY listener architecture
**What:** Evaluate moving ICY listener from single-region Fly to multi-region active-passive, OR into a long-running Trigger.dev task.
**Why:** Single-region Fly is a SPOF for Rhythm Lab dual-source reconciliation. Acceptable for shakedown; not for production with external partner stations depending on uptime.
**Trigger:** When second station commits to v2, or when Fly ORD has its first material outage.

### TODO-6 — Multi-tenancy revival
**What:** Un-hardcode the single org ID, wire Clerk Organizations, build onboarding, add promotion queue + cross-org overlays.
**Why:** Schema's `orgId` columns make this mechanical. Triggered only when a second station commits.
**Where:** Pivot covered in `docs/decisions/001-single-tenant-first.md` "Forward-compat markers" section.

### TODO-7 — `events-feed` and `schedule` as standalone widget variants
**What:** Add the two widget variants the brainstorm originally specified but were deferred 2026-04-22.
**Why:** No demonstrated demand at MVP. Revisit if a partner station asks.

### TODO-8 — Live-update screen-reader announcement frequency configurability
**What:** Per-user preference for "announce every play" vs "announce every 30s" vs "off."
**Why:** Default is 30s/station per `docs/design/003-responsive-accessibility.md`. May be too much/too little for some users.

## Design system follow-ups

### TODO-9 — Run /design-consultation upgrade to evaluate Söhne/GT America licensed type
**What:** Re-evaluate the open-source typography stack (General Sans + Geist + JetBrains Mono) vs paid licensed options (Söhne / GT America / Berkeley Mono) once RM has measured visual identity in production.
**Why:** Open-source ships faster; paid type is more memorable. Decision deferred to post-launch.

### TODO-10 — Live-listening to RM playlist with NVDA + VoiceOver users
**What:** Recruit screen-reader users from RM's listener community, walk through dashboard + widget flows, capture findings.
**Why:** Public radio audience skews older + a11y-mandated. axe-core is necessary but not sufficient.
**When:** Pre-shakedown release.

## Ingestion / eng follow-ups

### TODO-11 — `touringFromRotation` cross-join caching strategy
**What:** Cache the rotation→events join result in a derived Convex table refreshed nightly via Trigger.dev, OR accept it as on-demand with Promise.all batching.
**Why:** Plan-eng-review #8 — at HYFIN scale (~thousands of plays/day) cross-joined with Ticketmaster/AXS feeds, even batched is expensive on every dashboard load.

### TODO-12 — Per-layer test coverage targets
**What:** Define explicit coverage floors per test layer (Layer 1 contract: ≥10 fixtures + 100% parse paths; Layer 2 live: smoke; Layer 3 mock: 80% endpoints; Layer 4 shadow: 14-day clean run; Layer 5 onboarding: schema-validated; Layer 6 prod: SLI per source).
**Why:** 6-layer testing strategy in brainstorm is named but lacks per-layer floors. CI gates need numbers.

## Process

### TODO-13 — Decision doc 002 — Convex secrets-at-rest
**What:** Already noted in project memory. Decision doc covering how secrets like `HYFIN_SPINITRON_KEY` are stored (env vars not DB rows).
**Why:** Was the next step before plan-eng-review interrupted with the design pass. Resume after eng review completes.

### TODO-14 — Run /devex-review (DX gate, optional)
**What:** Optional DX review gate not yet run.
**Why:** Plan introduces a CLI surface (potentially), MCP integration possibility (Trigger.dev console + Convex + Clerk + Fly + Spotify + Spinitron), and a developer experience for partner stations integrating widgets. Worth a DX pass.
