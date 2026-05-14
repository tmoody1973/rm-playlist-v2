# AXS Events Adapter — Design

**Date:** 2026-05-14
**Status:** Approved, ready for implementation
**Topic:** Add AXS ticketing as an event ingestion source

## Summary

Add a Trigger.dev scheduled task that polls the AXS Event Discovery API for
upcoming Pabst Theater Group shows in Milwaukee, normalizes each event into the
existing `events.upsertBatch` shape, and lets the current widget LIVE row
surface them. A second, independent workstream adds an event-image thumbnail to
that widget row.

## Context

The events pipeline already exists. The Convex schema comment names the planned
sources verbatim — "Ticketmaster / AXS / custom DJ" — and Ticketmaster already
runs as a standalone Trigger.dev task (`src/trigger/poll-ticketmaster.ts`). That
task was written with AXS in mind: its geo-strategy comment says "Same shape AXS
uses (Step 6) so when the AXS adapter lands we're not maintaining two different
region models."

This work adds the AXS adapter. It does not change Ticketmaster, the `events`
table, `events.upsertBatch`, or the widget's event query contract.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Adapter pattern | Standalone `poll-axs.ts` Trigger.dev task, mirroring `poll-ticketmaster.ts` | The one working event source uses this pattern. Adding AXS should not refactor it. Unifying sources under `ingestionSources` is a separate decision. |
| Event scope | Primary tickets, announced only — `ticketerId=22`, `includeUnannounced=false`, `includePrivateEvents=false` | Matches what Ticketmaster effectively returns. No resale duplicates, no incomplete unannounced rows. |
| Geo scoping | `siteId=110` (Pabst Theater Group) alone — no `venueId` filter | `siteId=110` already scopes to Pabst's Milwaukee venues. Inspect the first real poll and add a `venueId` filter only if out-of-scope venues appear. |
| Sync strategy | Full re-fetch each poll, 90-day forward horizon | Mirrors Ticketmaster. `events.upsertBatch` handles upsert and cross-source dedup. Incremental sync via `modifiedStartDate` is unneeded at this volume. |
| Cadence | Every 6 hours, staggered to 03:00 / 09:00 / 15:00 / 21:00 UTC | Ticketmaster runs at 00/06/12/18. Staggering spreads API and Convex load. |
| Artist mapping | `associations.headliners[]` → role `headliner`; `associations.supportingActs[]` → role `support` | Roles are explicit in the AXS response. The widget already renders an "X opens for Y" line for support-role matches (commit `a248094`). |
| Event image | Thumbnail in the existing LIVE row — separate workstream | Keeps the signature component a row. A full event-card redesign would need its own design review. |

## Architecture

`src/trigger/poll-axs.ts` — a `schedules.task` that mirrors `poll-ticketmaster.ts`:

1. Read `AXS_ACCESS_TOKEN` from the environment. If absent, log a warning and
   return idle counts — never crash the cron. (Same graceful-idle pattern as
   Ticketmaster.)
2. Resolve `orgId` via `api.events.getOrgIdBySlug` for `radiomilwaukee`.
3. Fetch all upcoming AXS events, paginating until the result set ends.
4. Normalize each AXS event into `NormalizedEvent`.
5. Call `api.events.upsertBatch` with `source: "axs"` and the normalized array.
6. Return counts: fetched, normalized, inserted, updated, deduped, skipped.

The task reuses `getConvexUrl()` from `src/trigger/env.ts`. It does **not** read
`stationRegions` — `siteId=110` replaces the radius-anchor model Ticketmaster uses.

## AXS API integration

**Endpoint:** `GET http://api.axs.com/v1/events`

**Request parameters:**

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `access_token` | `AXS_ACCESS_TOKEN` | Auth. Local dev reads `.env.local`; the deployed task reads the Trigger.dev project environment. |
| `siteId` | `110` | Scopes to Pabst Theater Group. |
| `ticketerId` | `22` | AXS Primary tickets only (29 = resale, excluded). |
| `majorCat` | `2` | Music. |
| `start` | now, UTC datetime | Horizon start. AXS errors on date-only values; send full `YYYY-MM-DDTHH:MM:SS`. |
| `end` | now + 90 days, UTC datetime | Horizon end. |
| `returnData` | `complete` | Full event records, including `associations` and `relatedMedia`. |
| `rows` | `100` | Max page size (range 10–100). |
| `page` | `1..N` | Paginate until an empty page returns. |

`includeUnannounced` and `includePrivateEvents` stay at their `false` defaults.

## AXS event → `NormalizedEvent` mapping

| `NormalizedEvent` field | AXS source | Notes |
|-------------------------|------------|-------|
| `externalId` | `eventId` | |
| `title` | `title.eventTitleText` | Plain text. Never use `title.headliners` or `title.eventTitle` — those carry embedded `<a>` HTML. |
| `venueName` | `venue.title` | |
| `venueExternalId` | `venue.venueId` | |
| `city` | `venue.city` | |
| `region` | `venue.state` | |
| `country` | `venue.country` | Normalize `"United States"` → `"US"` to match Ticketmaster's country codes. |
| `latitude` / `longitude` | `venue.latitude` / `venue.longitude` | `parseFloat` — AXS sends these as strings. |
| `startsAt` | `Date.parse(eventDateTimeUTC)` | Milliseconds. |
| `dateOnly` | `dateOnly` | Explicit boolean. When `true`, the time is a placeholder midnight — flag it so the UI shows a date without a time. |
| `ticketUrl` | `ticketing.url` + tracking code | Append `cid=usaffradiomilwaukee` as a query parameter (`?` or `&` depending on the existing URL). This gives Radio Milwaukee click-through attribution. |
| `status` | `ticketing.statusId` → `EventStatus` | See status mapping below. |
| `genre` | `minorCategoryId1` → label via AXS Appendix 2 | e.g. 12 → Rock, 25 → Pop, 20 → Hip Hop/Rap. |
| `imageUrl` | `relatedMedia`, largest near-16:9 entry | The AXS doc recommends `relatedMedia` over `media` because it follows the event → tour → performer → venue inheritance hierarchy. Primary sizes are 678×399 and 564×564. |
| `artists[]` | `associations.headliners[]` and `associations.supportingActs[]` | `artistNameRaw` ← `.name`; `externalPerformerId` ← `.performerId`; `role` ← `headliner` or `support`. |

### Status mapping (`ticketing.statusId` → `EventStatus`)

| AXS statusId | `EventStatus` |
|--------------|---------------|
| 1, 27, 29, 30, 31, 32, 33 | `buyTickets` |
| 7 | `soldOut` |
| 2 | `cancelled` |
| 5, 37 | `postponed` |
| 6, 38 | `rescheduled` |
| 11 | `venueChange` |
| 3, 9 | `free` |
| 10 | `private` |
| all others (8, 12, 13, 14, 34, 36, …) | `other` |

### Skip rules

Mirror `normalizeTmEvent`. Drop an event when it has:

- no parseable start time, or
- no `venue.title`, or
- no named artists in `associations`.

A skipped event increments the `skipped` count and never reaches `upsertBatch`.

## Widget image workstream (independent)

This workstream surfaces event images in the widget. It benefits Ticketmaster
events too, so it ships separately from the AXS adapter.

Three changes:

1. `LiveEventSummary` (`apps/embed/src/types.ts`) — add `imageUrl: string | null`.
2. The Convex public query feeding the widget LIVE row — return the event's
   `imageUrl`.
3. `LiveEventRow.tsx` — render a ~52px thumbnail (square crop, AXS 564×564
   source) at the start of the row, before the LIVE badge.

The LIVE Event Row is a signature component in `DESIGN.md`, set deliberately in
the 2026-04-22 design review. Adding the thumbnail requires a `DESIGN.md` update
to record the change.

## Prerequisites and blockers

| Item | Status | Owner |
|------|--------|-------|
| AXS `access_token` | In `.env.local` (local dev). Still needs to be added to the Trigger.dev project environment for the deployed task. | Tarik |
| AXS `siteId` | `110` — confirmed | — |
| Tracking code | `cid=usaffradiomilwaukee` — confirmed | — |
| Device allow-list IP | AXS requires an egress IP and hosting provider. The poll runs on Trigger.dev (AWS). Trigger.dev offers static IPs on certain regions/plans; provision one, then send AXS that IP. Hosting provider answer: Trigger.dev / AWS. | Tarik + AXS |

## Testing

- Save the AXS doc's "Sample Event Response" as a fixture under the events test
  directory. It exercises the full response shape (HTML in `title`, explicit
  `associations`, `relatedMedia`).
- Unit-test the normalizer against the fixture: HTML-free title, tracking code
  appended to `ticketUrl`, `dateOnly` passthrough, status mapping, country
  normalization, artist role assignment.
- Unit-test the skip rules: missing date, missing venue, no named artists.

## Out of scope

- Incremental sync (`modifiedStartDate` / `modifiedEndDate`).
- `venueId` filtering on top of `siteId=110`.
- Unifying event sources under the `ingestionSources` table.
- A full event-card redesign of the LIVE row.
