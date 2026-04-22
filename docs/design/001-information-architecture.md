# 001 — Information Architecture

**Date:** 2026-04-22
**Status:** Accepted (from /plan-design-review)
**Grounded by:** `~/.gstack/projects/rm-playlist-v2/designs/dashboard-home-20260422/variant-B.png` (approved) and `widget-now-playing-card-20260422/variant-C.png` (approved).

## Scope

Every user-facing surface in v2 gets an explicit visual hierarchy. This document is the source-of-truth for "what does the user see first, second, third" on each surface. Implementation must match.

## A. Operator Dashboard (authenticated, internal)

The RM staffer's landing view after sign-in. Data-dense, calm, Linear/Vercel-aesthetic. Dark mode default.

### Chrome (persistent across all authenticated views)

- **Top bar** (48px): RM wordmark left, role/session indicator right (e.g. "Operator — PM"). No decorative elements.
- **Left sidebar** (icon-only, ~56px): Dashboard (home, highlighted when active), Streams, Reports, Events, Unclassified, Widgets, Settings. Icons inherit a single accent on hover and active state.

### Dashboard home — three rows of decreasing priority

**Row 1 — Live station wall (PRIMARY, ~30% vertical height).**
Four peer cards, equal width, one per stream (HYFIN, 88Nine, 414 Music, Rhythm Lab). Each card surfaces in this order of visual weight:

1. Station name + current track title (artist — title)
2. Time played (relative, e.g. "time played 3 min ago")
3. Source badge (Spinitron / ICY / Spinitron+ICY for dual-source)
4. Ingestion health dot (green/amber/red) with last-poll-age tooltip

This row answers "is every stream alive right now?" in under 2 seconds.

**Row 2 — Reports + Needs Attention (SECONDARY, ~25% vertical height).**
Two equal-width panels:

- **Reports (left).** Primary CTA button: "Generate SoundExchange Q-next export". Below it: "Last export N hours ago" muted. Secondary actions (CPB, PRO reports) accessible via a disclosure / "More reports".
- **Needs Attention (right).** Prioritized list, most severe first:
  1. Paused sources (red)
  2. Ingestion anomalies (amber) — e.g. "Rhythm Lab ICY drift 14m"
  3. Unclassified tracks count (neutral) — clickable to queue

Empty state: "Everything is clean" + timestamp. No happy-talk.

**Row 3 — Upcoming from rotation (TERTIARY, fills remaining height).**
Two-column list of artists playing Milwaukee in the next 14 days whose tracks are in current rotation. Each row: artist name + "N plays last 30d" + venue + date. Collapsed to ~6 artists visible; "View all" link.

### Rationale

Row 1 is the "wall of status" — it's the reason operators open this view. Row 2 is the weekly/monthly workflow (generate a report, handle anomalies). Row 3 is the serendipity pane (what's worth promoting this week) and earns its place last because it's read-only inspiration.

## B. Widget: now-playing-card (public, embedded)

Host-page integration. Editorial, not promotional. Four priority tiers:

1. **PRIMARY.** Album art (88px square) + track title (large, bold).
2. **SECONDARY.** Artist name (medium) + album name (italic muted) + "Playing since HH:MM" (mono muted).
3. **TERTIARY.** "ON AIR — <station name>" label above the art; LIVE event row below the metadata when the artist has an upcoming local show.
4. **QUATERNARY.** "powered by Radio Milwaukee" footer (muted, small).

The LIVE row is the one differentiator vs every other now-playing widget. It must be visually present when applicable, not buried behind a click.

## C. Widget: now-playing-strip

Compact bar version. Single row, horizontally laid out:

1. **PRIMARY.** Track title + artist (truncate with ellipsis if needed).
2. **SECONDARY.** Album art thumbnail (24-32px) left of text.
3. **TERTIARY.** Station badge on the right.

No LIVE row (doesn't fit). No footer branding (strip is too compact; attribution belongs on the host page's widget picker, not every strip).

## D. Widget: `playlist` — the V1 carry-forward (realigned 2026-04-22)

Per user clarification 2026-04-22, v2's widget catalog realigns to V1 reality: **one `playlist` widget** with config-driven capability, plus two NEW single-track variants (sections B, C above). This section describes the `playlist` variant.

### Architectural implication

The V1 playlist widget IS the flagship public surface. `playlist.radiomilwaukee.org` (or v2's equivalent route) embeds this widget. RM's own site is the first host, and if the widget is wrong, RM's public site is wrong. Every visitor is a load test. No separate "app vs widget" distinction.

Carry-forward from V1 source (`radiomke-playlist-app V1/src/components/playlist/*` and `src/components/embed/*`):

- `PlaylistContainer` / `PlaylistContent` — structure
- `ListItem` (list layout) + `GridItem` (grid layout)
- `PlaylistHeader` — tabs + title + intro
- `SearchFilters` + `DateRangePicker` — search surface
- `ArtistEvents` / `LazyArtistEvents` — inline concert cards interleaved with plays
- `TopSongsList` — top-20 tabs
- `StationEventsTab` — Concerts tab
- `AboutPlaylistTab` — About Us tab
- `RelatedCarousel` — related-tracks carousel (expands under a focused row)
- `EnhancedAlbumArtwork` + `LazyYouTubePreviewButton` — album art + preview button
- `LoadMoreButton` — pagination
- `EmbedConfiguration` + `DisplayConfiguration` + `BasicConfiguration` + `DateSearchConfiguration` — config surface
- `JavaScriptCodeGenerator` / `IframeCodeGenerator` / `EmbedUrlGenerator` — three output formats

### Header (static, all tabs)

1. **PRIMARY.** "<Station> Playlist" or "Live Audio Playlist — <STATION>" (V1 copy, keep). Inherits host H1 style.
2. **SECONDARY.** One-paragraph intro + `digital@radiomilwaukee.org` mailto.

Both header elements are configurable — `showHeader` boolean hides them for minimal embeds.

### Tabs (V1 parity, do not change order)

`Recent` | `Top 20 Songs` | `Top 20 (30 days)` | `Concerts` | `About Us`. "Recent" default. Tab names in English; i18n deferred.

### Layout modes — `list` vs `grid` (V1 terminology, keep)

V1 ships both. v2 keeps both. Selected via `data-layout="list"` or `data-layout="grid"`.

#### `list` layout (vertical, the flagship for `radiomilwaukee.org/playlist`)

**Recent tab.**

- Search input full-width, placeholder "Search songs or artists...". Toggle-able via `showSearch`.
- Date Search toggle (collapsed default, expands to range picker). Toggle-able via `enableDateSearch`.
- Live play list, reverse chronological, auto-updating via Convex subscription:
  - Album art (48px) + track title (bold) + artist + label + album + "time played" (relative) + date + duration.
  - Preview play button on hover / tap. Source: **Spotify Web API** (see below). V1 uses YouTube; v2 upgrade path.
  - Related-tracks carousel expands under a focused row (V1 `RelatedCarousel`).
- **Inline concert card** interleaved under a play when that artist has upcoming local events (V1 `ArtistEvents`). Card anatomy: artist live-shows label, tour name, datetime, venue + city, Get Tickets button with affiliate link. Subtle gradient accent bar, not loud.
- "Load more" at bottom (predictable, not infinite scroll). Toggle-able via `showLoadMore`.

**Top 20 Songs / Top 20 (30 days) tabs.** Ranked 1-20, same row anatomy minus "time played" — replaced by play-count-in-window badge.

**Concerts tab.** Upcoming events by artists in rotation, same card anatomy as the inline version, filterable by date.

**About Us tab.** Station-owned static copy. Low-traffic static content.

#### `grid` layout (horizontal, the V1 carousel/strip seen in the provided screenshot)

Designed for WIDE but SHORT embed slots: homepage sections, blog sidebars, donate-page contexts.

**Recent tab.**

- Tab row stays on top.
- Four album-art cards in a single horizontal row (desktop); 2-up or 1-up depending on width (responsive).
- Per card: large square album art (fills card width, ~240-280px) + **inline play-button overlay top-right** (Apple Music API 30-sec preview), below the art: track title (bold), artist, time played, duration (right-aligned).
- NO search input, NO date filter, NO interleaved concert cards in this mode — they don't fit the horizontal rhythm.
- Optional "View full playlist" link beneath the row that deep-links to the `list` layout at `radiomilwaukee.org/playlist`.

**Top 20 Songs / Top 20 (30 days) tabs.** Same 4-card horizontal row; cards show rank badge overlay. 1-4 visible; 5-20 via horizontal swipe / arrow buttons.

**Concerts tab.** Upcoming events as horizontal cards (event art or venue image + artist + date + venue). Click → deep link to ticketing.

**About Us tab.** Single condensed card with "Read more" → `list` layout or radiomilwaukee.org.

### Responsive behavior

| Viewport            | `list` layout                          | `grid` layout                           |
| ------------------- | -------------------------------------- | --------------------------------------- |
| 1280px+ (desktop)   | Full-width list, album art 48px thumbs | 4 cards per row                         |
| 768-1279px (tablet) | Full-width list, larger thumbs OK      | 2-3 cards, horizontal swipe             |
| <768px (mobile)     | List stays vertical, comfortable       | Collapses to 1-card-at-a-time swipeable |

### Config surface (V1 carry-forward, all preserved)

| Attribute                 | Values                                          | Purpose                                                                                                                   |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `data-station`            | e.g. `hyfin`, `88nine`, `rhythmlab`, `414music` | Which station's playlist                                                                                                  |
| `data-layout`             | `list` \| `grid`                                | Which visual mode                                                                                                         |
| `data-theme`              | `auto` \| `light` \| `dark`                     | Color scheme                                                                                                              |
| `data-compact`            | boolean                                         | Tighter density                                                                                                           |
| `data-max-items`          | integer                                         | Max plays shown (pre-Load-More)                                                                                           |
| `data-unlimited-songs`    | boolean                                         | No upper bound, lazy-load as scrolled                                                                                     |
| `data-height`             | e.g. `400px`, `auto`                            | Container height for iframe fallback                                                                                      |
| `data-show-search`        | boolean                                         | Show search input                                                                                                         |
| `data-enable-date-search` | boolean                                         | Show date-range filter                                                                                                    |
| `data-enable-youtube`     | boolean                                         | Show preview button (renamed in v2 to `data-enable-preview`, YouTube → Apple Music API; backward-compat alias maintained) |
| `data-show-header`        | boolean                                         | Show title + intro copy                                                                                                   |
| `data-show-load-more`     | boolean                                         | Show pagination button                                                                                                    |
| `data-auto-update`        | boolean                                         | Subscribe to Convex for live updates (recommend default `true`)                                                           |

v2 rename: `data-enable-youtube` → `data-enable-preview` (backward-compat alias for old embed codes).

### Preview button — Apple Music API (revised 2026-04-22)

V1 uses `LazyYouTubePreviewButton` which loads a YouTube embed on hover. v2 swaps it for **Apple Music API previews** in our own `<audio>` element.

**Why Apple Music API, not Spotify (revised path):**

- Spotify deprecated `preview_url` for new apps registered after Nov 27, 2024. Even RM's grandfathered status would be a future-risk dependency.
- Spotify Web Playback SDK is premium-only — cuts out the majority of public-radio listeners.
- Spotify iframe embed works for everyone but is Spotify-branded — fights the editorial-broadcast design system.
- Apple Music API, with RM's existing Apple Developer Program membership, gives us reliable preview URLs we play in our own `<audio>` element with full theming control.

**Implementation path:**

1. Enrichment resolves both `spotify_track_id` (kept for canonical metadata + Spotify deep-link) AND `apple_music_song_id` (new, used to fetch preview URL).
2. Apple Music API call: `GET /v1/catalog/us/songs/{id}` returns `attributes.previews[0].url` — a 30-sec MP3 URL.
3. Preview button on hover/tap plays that URL in a native `<audio>` element. Stop control + "now previewing" indicator on the active row.
4. **Two deep-link buttons per row alongside the preview button:** "Listen on Spotify" (uses `spotify_track_id`) + "Listen on Apple Music" (uses `apple_music_song_id`). Users pick their preferred service.
5. Tracks with no resolved Apple Music ID → preview button absent (graceful absence, NOT a disabled/error button). Spotify deep-link may still be available as fallback.

**Auth model:** Signed JWT developer token (ES256), token cached in Convex with weekly Trigger.dev refresh. See `docs/decisions/002-secrets-at-rest.md` for the credential storage pattern. No per-user authentication required for preview URLs.

**Constraint to flag:** Apple Music catalog ≠ Spotify catalog. For mainstream music, ~99% overlap. For Milwaukee indie/local artists (88Nine, Rhythm Lab specialty programming), some tracks may be in one catalog but not the other. Acceptable; preview is "absent" for missing-catalog cases per state coverage in `002-interaction-states.md` section E.

### Priority rules (reinforced)

1. **Don't break V1 muscle memory.** Tab names, order, search placement, config attribute names stay (with sensible additions like `data-enable-preview` aliasing `data-enable-youtube`).
2. **Host-native is a contract, not a preference.** RM's site depends on this. Inherits host typography, color, spacing via CSS custom properties piercing the shadow DOM boundary.
3. **Live updates are subtle.** Convex subscription prepends new plays without flash/jump. Never a full reload.
4. **Search is in-place and fast.** Convex query + client-side narrowing, no network round-trip per keystroke.
5. **Inline concert cards are the product's differentiator.** One data source (canonical `events` + `plays`), three surfaces (this widget, `now-playing-card`'s LIVE row, dashboard's "Upcoming from rotation"). Same design language everywhere.
6. **No preview button = graceful absence, not broken UI.** Tracks without Spotify previews show the row without the button, not with a disabled/red-error button.

### Open decisions

- Concerts tab scope: rotation-only (V1 behavior, keep) vs full regional feed. Recommend: keep rotation-only. Partners who want the full regional feed can use a future `events-feed` widget (not MVP).
- Station switcher: in host nav (V1 convention) vs in widget. Recommend: keep in host nav — one widget instance per station page.
- Premium subscriber upgrade path: Apple MusicKit JS (Apple Music subscribers hear full tracks in-place) AND Spotify Web Playback SDK (Spotify premium subscribers hear full tracks in-place). Both deferred post-MVP (TODO-4). MVP ships with 30-sec previews via Apple Music API for everyone.

## E. Reserved

_(section D subsumed what was here; renumbering avoided for stability of backreferences)_

## F. Reserved

_(section D subsumed what was here; renumbering avoided for stability of backreferences)_

## G. Dashboard — Embed Generator (`/widgets` route)

Three-step flow, not a form:

1. **Step 1 — Pick a variant.** Visual picker: 5 cards showing mini-previews of each variant with one-line description. No dropdowns.
2. **Step 2 — Configure.** Live preview pane on the right, config inputs on the left (station, maxItems, theme: auto/light/dark, show events yes/no, allowedOrigins list). Preview updates instantly.
3. **Step 3 — Copy your tag.** Three tabs: "One-liner script", "Declarative div", "Programmatic API". Copy-to-clipboard button prominent. Secondary link: "Iframe fallback for CMSes that strip scripts".

Progress indicator across top. Back/forward navigation on left.

## H. Dashboard — Unclassified tracks queue (`/unclassified` route)

Table, one row per unclassified track:

1. **PRIMARY.** Track title + artist (as ingested, pre-enrichment).
2. **SECONDARY.** Play count + first-seen / last-seen timestamps + station(s) where played.
3. **TERTIARY.** Action: "Enrich manually" (opens override panel) or "Ignore this artist" (custom-overlay shortcut).

Top of page: filter chips (station, time range, reason-for-unclassified). Bulk select in leftmost column.

## I. Dashboard — Custom DJ event creation

Two-column form (not modal, full page):

- Left: event fields (artist search typeahead against canonical artists, venue search, date/time, ticket URL, notes).
- Right: live preview of how the event will appear in the events-feed widget.

Submit button bottom-right with live validation.

## J. Dashboard — Reports UI

List view of prior reports at top; "Generate new report" panel below.

Generate panel:

1. **PRIMARY.** Report type picker (SoundExchange / CPB / PRO / diversity).
2. **SECONDARY.** Date range (defaults to current quarter for SoundExchange).
3. **TERTIARY.** Station filter (default: all stations).

Trigger button surfaces an async job progress indicator. Completed reports appear at top of history with download links. No modal dialogs — report generation is a first-class page, not a popup.

## K. Dashboard — Ingestion controls + play rewind

Per-source panel with: live status, recent events log, pause/resume toggle, and a "rewind plays" sub-panel.

Rewind sub-panel (destructive, but reversible): station + start-time + end-time inputs, "Preview affected plays" button (shows count + sample), then "Soft-delete these N plays" button with explicit confirm. Soft-delete means `deletedAt` field — actual rows stay. Restore button available for 7 days.

## User journey arcs (added Pass 3, 2026-04-22)

### Operator 5/5/5 arc (time-horizon design)

**5 seconds (visceral).** Open dashboard → see 4 green dots → exhale. The wall-of-status is the product — confirmation that everything is fine is valuable in itself. If a dot is amber or red, the eye goes straight to Needs-Attention without thinking.

**5 minutes (behavioral).** Handle the daily music-director workflow: review unclassified queue, approve a touring flag, mark a rerun, adjust a misattribution, maybe queue a weekly diversity-metrics report. Dashboard → unclassified → fix → back. 3-5 surfaces, never deeper than 2 clicks from home.

**5 years (reflective).** "This is the tool I trust. It has not lied to me. Reports come out clean. Partners don't complain about widgets. When something breaks, I know fast and I can fix it." The product earns long-term trust by NOT being flashy — by being quietly correct at the pixel level (Joe Gebbia's trust principle).

### Public listener arc — the widget's LIVE row

**5 seconds (visceral).** Listener is on radiomilwaukee.org reading an article. In the sidebar widget, a track plays. They glance down: "Oh, I like this song." A small LIVE row says "Black Pumas at Pabst Theater — Oct 28".

**5 minutes (behavioral).** They tap the LIVE row → ticket link. OR they tap the Spotify preview → 30-sec clip plays in-place. OR they tap the album art → deep-link to Spotify to save the song.

**5 years (reflective).** "Radio Milwaukee actually gets me to concerts. The playlist isn't just nostalgia — it's a live connection between what I hear and what I can go do tonight."

That 5-year outcome is the one unique thing this product can do that Spotify/Apple/generic radio widgets cannot: the reverse lookup from rotation to regional live shows, visible in the reading flow.

## Operator primary workflow — the "fix a misattribution" journey

The journey a music director runs multiple times per week.

| Step | Action                                     | UI surface                                                                   | Friction budget                 |
| ---- | ------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------- |
| 1    | See a wrong track on dashboard             | Dashboard home                                                               | 0 clicks — it's already visible |
| 2    | Click into the unclassified or wrong entry | Unclassified queue OR station-detail view                                    | 1 click                         |
| 3    | Fix artist/title via override              | Override panel (overlays the row in place, no modal)                         | 1 click + typing                |
| 4    | See the fix propagate                      | Row updates live; dashboard card reflects within ~2s via Convex subscription | 0 clicks                        |

Goal: 3 clicks maximum from dashboard to fixed row. If current design exceeds 3, redesign the override affordance.

## Rules that govern every surface

1. **Primary action is always visible without scroll at 1280px width.** No "below-the-fold" CTAs on internal dashboard views.
2. **Empty states name their action.** Never "No items found." — always "No unclassified tracks in the last 30 days — you can [adjust filters / view all time]."
3. **Tertiary info is muted, not hidden.** Timestamps, counts, badges: muted foreground, never hidden behind hover-only tooltips on non-hover devices.
4. **Density is ops-dense, not consumer-calm.** This is an internal tool used daily. Tight leading, real data, no decorative whitespace. Widgets on the public site follow the opposite rule (respect host context, breathe).

## Open IA decisions (resolve via /plan-design-review follow-up or in implementation)

- Dashboard default time window (live-only vs "last 24h" vs "last hour"). Approved mockup implies live-only.
- Whether the embed generator's Step 2 preview is a sandboxed iframe or a same-origin mount (security tradeoff; defaults to sandboxed iframe).
- Whether "Needs Attention" links to a dedicated `/inbox` view or inlines action directly from the card. Approved mockup implies inline.

## Approved Mockups

| Screen/Section          | Mockup Path                                                                              | Direction                                                                                         | Notes                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Operator dashboard home | ~/.gstack/projects/rm-playlist-v2/designs/dashboard-home-20260422/variant-B.png          | Dark, calm Linear/Vercel aesthetic, 4-station wall-of-status, single amber accent                 | Approved 2026-04-22. "PM" in top-right resolved to role label. Mockup typo "SounmExchange" is image-gen artifact, not a design choice. |
| Widget now-playing-card | ~/.gstack/projects/rm-playlist-v2/designs/widget-now-playing-card-20260422/variant-C.png | Editorial light-mode card embedded in host-page chrome, NPR-adjacent feel, LIVE event row visible | Approved 2026-04-22. Inherits host typography. LIVE row is the differentiator and stays visible by default.                            |
