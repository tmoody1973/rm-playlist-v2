# Listener memory + "What's new for me?" — design

*Approved in conversation 2026-10-04. Spans `rm-playlist-v2` (Convex, the playlist database) and `radio-commons` (the Alexa+ MCP server). Hackathon deadline 2026-10-23.*

## 1. Why

Hackathon judges: *"an agentic workflow that orchestrates across services or keeps context across sessions stands out more."* Amazon's Alexa+ docs keep only the current conversation and tell add-ons to hold their own recall data ([research note](../../research/2026-10-04-agentic-radio-commons.md)). Live testing also showed the cost of no server memory: "save number 3" saved nothing because the host lost song ids between turns.

**Goal:** an experience only a local station can give — built from what *our DJs actually played*, *who is playing in town*, and *our own stories* — remembered per listener.

**Success (the demo):** session 1, "save this" → saved to Finds and Apple Music, plus "she plays Turner Hall Friday, and we have her Studio Milwaukee session." Days later, "what's new for me?" → a personal digest. "Save number 3" works on any host.

## 2. Decisions (made by Tarik, 2026-10-04)

| Question | Choice |
|---|---|
| Which artists a listener cares about | Saved songs **and** explicit "follow / stop following" |
| When the digest is assembled | **Hybrid**: spins and shows read live (same database, fast); stories gathered by a background job after each save/follow and daily |
| Digest contents | Spins since last visit · upcoming local shows · station stories & sessions · Apple Music status |
| Scope for Oct 23 | All of: screen memory, save orchestration + digest, 2-week search index, judges page |

## 3. What gets remembered (playlist Convex)

All rows are keyed by `listenerId` (the verified Clerk `sub`), written only through `RADIO_COMMONS_SERVER_KEY`-guarded functions, and erased by `finds:deleteAllForListener`.

**`listenerFollows`** — one row per listener × artist.
`listenerId`, `artistId: Id<"artists">`, `artistName` (display), `status: "following" | "unfollowed"`, `source: "find" | "explicit"`, `updatedAt`.
Indexes: `by_listener` (listenerId, status), `by_listener_artist` (listenerId, artistId), `by_artist` (artistId, status).
Rule: a save creates a `following / find` row **only if no row exists** — an explicit unfollow is never overridden by a later save.

**`listenerState`** — one row per listener.
`listenerId`, `screen?: { shownAt, playIds: Id<"plays">[] }` (position = spoken number − 1, max 10), `lastDigestAt?`.
Index: `by_listener`. A screen older than **30 minutes** is ignored ("number 3" then falls through to title/artist).

**`artistWatch`** — one row per artist, shared by all listeners (no personal data).
`artistId`, `stories: { storyId, title, show, showSlug, publishedAt }[]` (max 3, newest first), `checkedAt`.
Index: `by_artist`.

**Search index on `plays`**: `search_artist` (searchField `artistRaw`, filterFields `stationId`) and `search_title` (`titleRaw`, `stationId`). Both are existing fields, so no backfill of new data. Queried together and merged, newest first.

## 4. Functions (playlist Convex)

| Function | Kind | Does |
|---|---|---|
| `memory:rememberScreen({serverKey, listenerId, playIds})` | mutation | Upserts `listenerState.screen` |
| `memory:screenPlay({serverKey, listenerId, number})` | query | The play id at that number if the screen is < 30 min old, else null |
| `follows:follow({serverKey, listenerId, artist? , playId?})` | mutation | Resolves the artist (by playId's track, else `artistKey` of the name via the existing `matchKey` normalization), upserts `following / explicit`, schedules `artistWatch:refresh` |
| `follows:unfollow({serverKey, listenerId, artist})` | mutation | Sets `unfollowed` |
| `finds.save` (changed) | mutation | After saving: implicit follow (rule above), schedules `artistWatch:refresh`, returns `artistId`, `firstFollow: boolean`, `nextShow` (soonest upcoming via `eventArtists.by_artist`), `story` (newest from `artistWatch`, if cached) |
| `digest:forListener({serverKey, listenerId})` | query | `since = lastDigestAt ?? now − 7 days`. For followed artists (cap 10, most recently followed first): spin counts by station since `since` (`plays.by_canonical_artist`, newest 50); soonest upcoming show per metro (existing `showsByMetro` logic); `artistWatch` stories published after `since − 30 days`; Apple Music counts from `finds`. Returns ranked items. |
| `digest:markSeen({serverKey, listenerId})` | mutation | `lastDigestAt = now` |
| `artistWatch:refresh({artistId})` | internal action | Calls Backstory `public:searchStoryCards({text: artistName})` over HTTP; **keeps a story only if the artist's name appears in its title or hint** (semantic search alone is too loose); stores ≤ 3 |
| daily cron | cron | Refreshes `artistWatch` for every artist with ≥ 1 `following` row, oldest `checkedAt` first, capped per run |
| `alexa:searchPlays({station?, query, days = 14})` | query | The two search indexes, merged, newest first, ≤ 20 |
| `finds:deleteAllForListener` (changed) | mutation | Also deletes `listenerFollows` and `listenerState` rows |

New Convex env: `BACKSTORY_CONVEX_URL` (public query endpoint, not a secret).

**Digest ranking** (pure function, unit-tested): items are `spins`, `show`, `story`, `apple`. Order: a show within 7 days → artists with the most spins since `since` → new stories → Apple Music status. Voice speaks the top 3; the card shows all.

## 5. Radio Commons (MCP server)

**Screen memory writes.** `recent_songs`, `find_song_played` (2+ matches), `search_playlist`: when the call is from a linked listener, record the list with Next's `after()` (runs after the response is sent), so the listener's answer never waits on it. Failures are logged, never surfaced.

**`save_find`** gains `number`. Resolution order: `number` → `memory:screenPlay`; then `playId`; then title/artist search (`alexa:searchPlays`). Spoken reply composes, in order: saved (+ Apple Music) · "I'll keep an eye out for {artist}" on first follow · next show · story. Example: *"Saved 'Sick of the Times' by Thao to your Finds and Apple Music. I'll keep an eye out for Thao — she plays Turner Hall on Friday, and we have her Studio Milwaukee session."* When the listener has no Apple Music connection, the **first** save in a conversation (no Find saved in the previous 30 minutes) adds: "To add these to your Apple Music library too, connect it at radiomilwaukee.org slash connect." (Found in live testing 2026-10-04: a save said only "Saved", with no hint Apple Music was possible.)

**New tools** (all require a linked account; refuse with `account_linking_required` otherwise):
- `follow_artist({artist? , playId?})` — "follow Thao", "follow this artist".
- `unfollow_artist({artist})` — "stop following Thao".
- `whats_new_for_me({})` — "what's new for me?", "anything new from my artists?". Reads `digest:forListener`, speaks the top 3, shows a **digest card**, then `digest:markSeen` via `after()`. Empty digest → falls back to `station_picks` with "Nothing new from your artists yet — here's what the station's excited about."

**`search_playlist`** switches to `alexa:searchPlays` (~2 weeks reach).

**Digest card** (new card view `digest`): one tile per artist (artwork from their latest track, or the plain tile) with lines "Played 2× on 88Nine since Tue" / "Turner Hall · Fri Oct 24" and buttons "Play story" (asks for the story) and "Save latest". Same tile system as the song list.

**Privacy page:** one new line — we remember the artists you follow, the last list shown to you (30 minutes), and when you last asked what's new; "delete my data" erases them.

**Add-on manifest:** add the example phrase "What's new for me" (test maps it to `whats_new_for_me`).

## 6. Judges page and hackathon write-up

- **`/how-it-works`** on the Radio Commons site, linked from the landing page, built in the landing page's existing design (read `src/app/page.tsx` + `src/lib/landing.ts` first). Sections: the two-session demo as a story; a sequence diagram of "save it" across services (playlist → Finds → Apple Music → events → Backstory); what is remembered and where, and how to erase it; Alexa+ integration (add-on manifest, MCP 2025-11-25, account linking per Amazon's spec); honest status (live vs in progress, updated as tasks land).
- **`docs/HACKATHON.md`** in radio-commons: the same story as the page, in submission form (problem, what it does, architecture, the required technology in code with file paths, demo script).

## 7. Errors and latency

- Every playlist call keeps the existing timeout and maps failures to the existing spoken apology; screen-memory and `markSeen` writes are fire-and-forget after the response.
- `whats_new_for_me` sets `_meta.ui.invoking` ("Checking what's new for you…") per Alexa's slow-call guidance.
- Backstory unavailable → `artistWatch:refresh` retries next cron; the digest simply omits stories.
- The playlist timeout stays 350 ms for single reads; `digest:forListener` gets 1,500 ms (Amazon's guidance is 3 s; measured in the plan's first task, and lowered if it runs fast).

## 8. Testing

- **Pure logic, unit-tested** (bun / vitest): implicit-follow rule, screen expiry and number lookup, story precision filter, digest ranking and spoken text, search merge/dedupe, save resolution order.
- **Tool tests** with the fake playlist, as today.
- **Real-phrase eval script** `scripts/eval-turns.mjs` (radio-commons): runs scripted multi-turn conversations through the live simulator and checks the tool trail — "last 5 on 88Nine" → "save number 3" (save_find gets a real id); "when did you last play Nas"; "credits on Groove Thang"; "follow Thao"; "what's new for me". Run before every demo and after every deploy.
- **Live check per task** against the shared deployment after merge (Convex deploys only through CI).

## 9. Out of scope

Proactive push notifications (not documented for MCP add-ons); resume-anywhere podcasts (NPR One owns it; no playback-position signal); per-listener taste models beyond follows; editing follows from the website.

## 10. Risks

- **Backstory precision** — the name filter may drop real stories or keep none; the digest still works without stories. Measured in the `artistWatch` task.
- **Search index build** on the large `plays` table (~200k rows) happens on deploy and **blocks the deploy until it finishes** (nothing goes live mid-build); the CI deploy job allows 30 minutes.
- **Artist resolution** — plays without `canonicalArtistId` can't be followed by id; `follow_artist` by name uses `artistKey`, and unknown names get "I don't have Thao in our playlist yet."
- **Shared deployment** — schema changes ship only through the CI `Convex deploy` workflow, never `convex dev`.
