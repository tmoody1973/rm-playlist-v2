# 004 — Unresolved Design Decisions

**Date:** 2026-04-22
**Status:** Active (from /plan-design-review Pass 7)
**Depends on:** all `001-`, `002-`, `003-` design docs.

Decisions that came up during the design review and have NOT been resolved here. Each lists what happens if left ambiguous, the recommended default, and where to revisit it.

| # | Decision | If deferred | Recommended | Revisit when |
|---|----------|-------------|-------------|--------------|
| 1 | ~~Operator role model~~ — **RESOLVED 2026-04-22.** Two roles: `Operator` (read + override misattributions + generate reports + view all surfaces) and `Admin` (everything Operator can do + create canonical artists + soft-delete plays + pause/resume ingestion sources + manage widgets). Audit log captures who-did-what. | n/a | Locked | When RM org grows beyond ~5 staff and finer roles needed. |
| 2 | ~~"PM" indicator~~ — **RESOLVED 2026-04-22.** "PM" is the role label in the top-right (`<role> — <session>` format), where the role is Operator or Admin. | n/a | Locked | n/a |
| 3 | Spotify preview depth — `preview_url` (anonymous, 30-sec clip) vs Web Playback SDK (logged-in premium users hear full track in their Spotify client). | Engineer ships only `preview_url` and the "no preview available" rate is high (~30% for indie/local catalog). | MVP: `preview_url` only. Post-MVP: add Playback SDK as an opt-in "Sign in with Spotify" affordance for premium listeners. Logged as deferred. | After shakedown. |
| 4 | Embed generator Step 2 preview rendering — sandboxed iframe vs same-origin mount. | Engineer picks iframe (safer) without thinking about sticky theme bug where host CSS leaks differently in iframe vs real embed. | Sandboxed iframe by default. The widget IS designed to work inside iframes (V1 supports this). Revisit only if the preview behaves materially differently than the real embed. | Implementation. |
| 5 | "Needs Attention" — inline action vs dedicated `/inbox` view. | Engineer ships an /inbox detour and operators have to navigate away from dashboard to act. | Inline action where possible (matches approved mockup). Items that genuinely need a workspace open detail panels in place, not navigate-away. | Implementation. |
| 6 | Concerts tab scope (rotation-only vs full regional feed). | Engineer over-builds full Ticketmaster + AXS dump and the page becomes a generic event listing. | Rotation-only (V1 behavior + the differentiator). Full regional feed lives in a future `events-feed` widget. | If a partner asks for full feed. |
| 7 | Station switcher (host nav vs widget) for the playlist widget on `radiomilwaukee.org/playlist`. | Engineer adds an in-widget switcher and creates two ways to do the same thing. | Host nav only — one widget instance per station page (V1 convention). | Never, unless RM site nav changes. |
| 8 | Whether the `playlist` widget is offered to third-party stations in its full form (tabs, search, related-tracks) or only in compact form. | Engineer ships only compact, partners ask for the full thing later, more work. | Offer the full form day one. Same product RM runs is the easiest sell. | If a partner asks for restrictions. |
| 9 | Mobile dashboard primary-use scope — production tool OR "in a pinch on the road"? | Engineer over-invests in mobile-only features for a use case that doesn't exist. | "In a pinch" only. Mobile dashboard works but isn't optimized for; no mobile-only features. | If a music director starts working from phone primarily (unlikely). |
| 10 | Live-update announcement frequency cap on screen readers — every play, every 30s, every 5 min, only on demand? | Engineer picks "every play" and screen-reader users get spammed during fast rotations. | Every 30s per station (already in `003-responsive-accessibility.md`). Configurable post-MVP if users complain. | If user feedback says it's too much/too little. |
| 11 | Embed generator's "copy code" output — three formats (script / div / programmatic) vs one. | Engineer ships only one and partners with weird CMSes can't integrate. | Three formats per V1 (`JavaScriptCodeGenerator`, `IframeCodeGenerator`, `EmbedUrlGenerator`). Don't break partners by removing options. | Never. |
| 12 | Whether the dashboard's "Wall of Status" cards link to a station-detail view, or expand inline on click. | Engineer picks at random; either works. | Expand inline (matches "no navigate-away" rule from decision #5). Tap a station card → it grows to fill row 1 with full station detail (recent plays, ingestion log, source toggle), other cards collapse to a smaller status strip on the side. Esc returns to wall. | Implementation. |

## Decisions resolved within this review

For traceability:

| Resolved decision | Outcome | Source |
|-------------------|---------|--------|
| Single-tenant first | Yes (RM only, deferred multi-tenant) | `decisions/001-single-tenant-first.md` |
| Widget catalog for v2 MVP | `playlist` + `now-playing-strip` + `now-playing-card` | `001-information-architecture.md` section D, this review Pass 1 |
| `playlist-page` separate variant | No — subsumed into `playlist` widget with `layout: list \| grid` | this review Pass 1 |
| Spotify vs YouTube for previews | Spotify Web API `preview_url` MVP | this review Pass 1 + Pass 7 #3 |
| Dashboard primary workflow model | Wall of Status (4 streams glance-able) | this review Pass 1 |
| Report generation when unclassified plays exist | Hard-block, no override | this review Pass 2 |
| DESIGN.md creation | Deferred to `/design-consultation` skill, run as next step | this review Pass 5 |
| Layout terminology | `list` / `grid` (V1 names, keep) | this review Pass 1 |
| Mobile dashboard scope | "In a pinch" only | this review Pass 6 + Pass 7 #9 |
