# 002 — Interaction State Coverage

**Date:** 2026-04-22
**Status:** Accepted (from /plan-design-review Pass 2)
**Depends on:** `001-information-architecture.md`

## Principle

Every user-facing surface has a state for each of: **loading**, **empty**, **error (recoverable)**, **error (broken)**, **success**, **partial data**. Every state defines what the user SEES (not backend behavior). Empty states are features, not "No items found" placeholders.

## A. Operator dashboard — station card (per stream)

Each of the 4 station cards on the dashboard home.

| State | When | What user sees | Action offered |
|-------|------|----------------|----------------|
| **loading** (first paint) | Initial page render, no cached data | Skeleton: station name visible, track row showing muted shimmer bars for title/artist | None. Resolves within ~200ms from Convex cache |
| **loading** (polling) | Background poll in flight, previous data still shown | Previous track data visible, ingestion-health dot subtly pulses amber → green when fresh | None. Invisible by design |
| **empty** (legitimately no plays) | Stream offline or stream has been silent (off-air) | Station name + source badge + "Off-air" text where track title would be + timestamp of last play | "View last play" link → station detail |
| **partial-data** (track but no album art) | Play row arrived pre-enrichment | Track + artist shown, album art placeholder (not broken icon — a muted music-note glyph) | Album art fills in within seconds as enrichment resolves |
| **error** (recoverable) | Single poll failed, retry in flight | Previous track data still shown, ingestion-health dot turns amber, tooltip: "Last poll failed — retrying" | None (auto-retry) |
| **error** (broken) | Consecutive polls failed, source enters degraded state | Previous data still shown but with amber/red banner at top of card: "Ingestion paused — last successful poll 14m ago. [Investigate]" | "Investigate" link → ingestion control detail |
| **success** (fresh play) | New play arrives via Convex subscription | Card subtly updates in place (no flash, no jump), timestamp resets to "just now" | None |

## B. Operator dashboard — Reports panel

| State | When | What user sees | Action offered |
|-------|------|----------------|----------------|
| **loading** | Report list fetching | "Last report: checking..." muted | None |
| **empty** (no prior reports) | First use | "No reports generated yet. First SoundExchange export due by [next quarter end]." | Primary CTA: "Generate SoundExchange export" |
| **success** (report exists) | Prior reports visible | "Last SoundExchange export 3 hours ago. [Download] [Generate new]" | Download or regenerate |
| **success** (generation in flight) | User clicks Generate | Button shows progress ("Generating... 37%"), panel inset shows running log | Cancel (if >30s) |
| **error** (generation failed) | Report job errored | Red inline error: "Report failed: [reason]. [Retry] [Support]" | Retry or contact |
| **blocked** (unclassified tracks in window) | Attempted generate with unclassified plays | Hard block: "Can't generate — 12 plays in this window are unclassified. [Review unclassified]" — no proceed button. Decision 2026-04-22: SoundExchange legal accuracy > operator friction. | Review only |

## C. Operator dashboard — Needs Attention panel

| State | When | What user sees | Action offered |
|-------|------|----------------|----------------|
| **empty** (everything clean) | No paused sources, no anomalies, no unclassified | "Everything is clean. Last checked 12s ago." (timestamp updates live) | None |
| **partial** (some issues) | At least one item | Prioritized list: red (paused) → amber (anomalies) → neutral (unclassified count) | Each item is clickable to its detail |
| **loading** | Initial fetch | Muted skeleton rows | None |
| **error** (broken) | Convex query failed | Red: "Can't reach the server. [Retry]" | Retry |

The empty state's "Everything is clean" copy is deliberate — it's rewarding, not happy-talk. Operators see it most of the time, and when they don't, they know exactly why.

## D. Operator dashboard — Upcoming from rotation

| State | When | What user sees | Action offered |
|-------|------|----------------|----------------|
| **loading** | Cross-join with events running | Muted skeleton rows | None |
| **empty** (no upcoming matches) | No rotation artist has upcoming events in the region | "No upcoming shows in the next 14 days for artists in current rotation. [Widen window to 30 days] [View all regional events]" | Either action |
| **partial** (some artists matched) | 1+ upcoming match | List of matched artists with play counts + venue + date | Click → event detail |
| **error** (one event source failed) | Ticketmaster OR AXS down but other works | Results shown with footer note: "Some event data is stale — Ticketmaster has been unreachable for 14m" | None |

## E. Widget `playlist` — `list` layout

| State | When | What user sees | Action offered |
|-------|------|----------------|----------------|
| **loading** (first paint) | Host page loaded, widget hydrating | Skeleton rows matching the widget's configured height — tab row visible, rows muted | None |
| **empty** (truly no plays) | New station, DB empty (shakedown edge case) | "No plays yet — this station hasn't logged a play in the system." | None (live updates will fill) |
| **empty** (search, no matches) | User searched, no results | "No matches for '<query>'. Try a different artist or album name." | "Clear search" link |
| **empty** (date range, no plays) | User filtered to a range with no plays | "No plays between [start] and [end]. The earliest play in this system is [date]." | "Clear filter" link |
| **success** (plays listed) | Normal case | Plays list, tabs, search, inline concert cards where applicable | Search, filter, load more, preview |
| **partial** (enrichment lagging) | Play row arrived without album art or Spotify ID | Row shows with muted art placeholder, preview button absent — fills in live as enrichment completes | None |
| **error** (subscription lost) | Convex connection dropped | Muted banner at top of widget: "Reconnecting..." | Auto-retry; if retries fail after 30s: "Unable to connect. [Reload]" |
| **error** (widget config broken) | Bad station slug or allowedOrigins mismatch | Widget renders a single polite error: "This playlist isn't available on this site. Contact the station." | None (no error stack exposed) |

## F. Widget `playlist` — `grid` layout

Same state matrix as `list`, with these grid-specific differences:

- **loading** first paint: 4 skeleton cards with muted album-art squares and muted caption rows.
- **empty** (no plays): single centered empty message spanning all 4 card slots.
- **search**: disabled in grid layout (no search UI available), so "no matches" state doesn't apply.
- **error** (config): same single polite error, one card width.

## G. Widget `now-playing-card`

| State | When | What user sees | Action offered |
|-------|------|----------------|----------------|
| **loading** (first paint) | Widget hydrating | Album art placeholder + track skeleton shimmer, "ON AIR" label visible | None |
| **success** (track playing) | Normal case | Full card with album art + track + artist + album + "Playing since HH:MM" + optional LIVE row | LIVE row tickets link, preview button |
| **partial** (no album art resolved) | Enrichment lag | Art placeholder (muted glyph) + full track info | Fills in when enrichment resolves |
| **empty** (off-air or silent) | Station is off-air | "ON AIR — <station>" label remains, body shows: "Off the air — listen again at [next show time]" | Deep-link to radiomilwaukee.org schedule |
| **empty** (between tracks / ad break) | Short silence | Previous track info with muted opacity + "Up next..." placeholder; auto-resolves when next track lands | None |
| **error** (subscription lost) | Convex down | Previous data visible + muted footer: "Reconnecting..." | Auto-retry |
| **error** (allowedOrigins mismatch) | Widget embedded on disallowed origin | Polite single-sentence error, no stack | None |
| **no-live-event** | Artist has no upcoming shows | LIVE row omitted (NOT shown as "No upcoming shows") — the absence IS the signal | None |

## H. Widget `now-playing-strip`

Smallest footprint — degraded states must fit in one row.

| State | When | What user sees | Action offered |
|-------|------|----------------|----------------|
| **loading** | First paint | Skeleton: small art square + shimmer text bar | None |
| **success** | Playing | Thumb + track + artist + station badge (ellipsis-truncated as needed) | None |
| **partial** (no art) | Pre-enrichment | Muted music-glyph thumb + full track text | None |
| **empty** (off-air) | Station silent | "ON AIR — <station> — Off-air" single line | None |
| **error** | Subscription lost | Previous data + tiny "•" dot that changes color (green → amber → red) indicating freshness | None (silent-fail in compact form) |
| **error** (config) | Bad slug / origin | Empty (widget renders nothing; console error for developer) | None |

Rationale: A compact strip widget with a visible error banner would look broken on the host page. Silent-fail for errors, host-observable via console, is better.

## I. Dashboard — Unclassified queue

| State | When | What user sees | Action offered |
|-------|------|----------------|----------------|
| **loading** | Query in flight | Skeleton rows | None |
| **empty** (filtered window) | No unclassified tracks in the current filter window | "No unclassified tracks in the last 30 days. [View all time]" | Widen filter |
| **empty** (truly zero) | Entire system has no unclassified | "Every track is classified. Nothing to review. [Return to dashboard]" | Navigate home |
| **success** (rows shown) | Normal | Table with filter chips on top, bulk-select column, row actions | Enrich, ignore, bulk select |
| **partial** (enrichment working) | Some rows show "enriching..." badge | Row greyed slightly + "enriching..." badge → resolves live | None |
| **error** (enrichment fails) | Manual enrichment fetch returns error | Red inline on affected row: "Lookup failed — [Retry] [Manual override]" | Retry or force |

## J. Dashboard — Reports full page

| State | When | What user sees | Action offered |
|-------|------|----------------|----------------|
| **empty** (no history) | First use | Single-card empty state + generate button | Generate |
| **loading** (history) | Fetching past reports | Muted list skeleton | None |
| **success** (generating) | Job in flight | Progress bar + live event log: "Scanning plays... 23%" | Cancel |
| **success** (done) | Report generated | Row added to history, download button highlighted briefly | Download |
| **error** (validation blocked) | Unclassified tracks block the export | "Can't generate: 12 plays are unclassified. [Review]" — **no override**. Decision 2026-04-22: hard-block; legal accuracy > operator friction. | Review only |
| **error** (job crashed) | Backend job errored | "Generation failed after 42 seconds. [View log] [Retry] [Contact support]" | Triage |

## K. Dashboard — Custom DJ event creation

| State | When | What user sees | Action offered |
|-------|------|----------------|----------------|
| **empty** (fresh form) | New event | Form fields empty, preview pane shows "Your event will appear here" | Fill form |
| **partial** (typing) | User typing | Preview updates live as artist/venue/date fill in | Continue |
| **loading** (artist typeahead) | Searching canonical artists | Dropdown shows spinner beneath the input | Continue |
| **error** (artist not found) | Search returns zero matches | "No matching artist. [Create new canonical artist]" (elevated permission) or "Use freeform artist name" | Either |
| **success** (submit) | Valid form submitted | Inline toast: "Event created — will appear in events-feed and inline concert cards within a minute." | Create another |
| **error** (validation) | Missing required field | Red inline per-field, not a modal. Focus on first missing field | Fix |

## L. Global transitions

Cross-cutting state rules that apply everywhere:

1. **No flash of empty content.** All surfaces render skeleton on first paint, never a literal "Loading..." text screen.
2. **No retry loops in UI.** If first retry fails, escalate to user-visible recovery action. Never spin forever.
3. **Connection-lost banner is global, not per-surface.** If Convex connection drops, a single subtle top-of-app banner appears: "Reconnecting..." with a spinner. Individual surfaces continue to show their last-known state and don't each render their own banner.
4. **Errors name the action, not just the problem.** "Report failed: unclassified tracks block export. [Review] [Override]" — not just "Failed."
5. **Live-update transitions are subtle.** New data animates in via a 200ms opacity fade, never a slide/jump that moves layout.

## Rating recovery

**Rating after fix: 8/10.**

Remaining gap to 10:
- Accessibility state semantics (screen-reader announcements for live updates, keyboard focus on error recovery) — Pass 6 will cover.
- Content-length edge cases (47-char artist names, huge album-art URLs, stream titles in non-Latin scripts) — flagged for implementation QA.
