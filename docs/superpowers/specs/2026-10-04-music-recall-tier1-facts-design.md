# Song recall + Tier 1 facts — design

**Date:** 2026-10-04
**Sub-project:** 1 of 4 for the Alexa+ hackathon music pillar (deadline 2026-10-23)
**Source docs:** `~/Downloads/alexa-plus-music-feature-decisions.md` (music feature decisions), Backstory PRD (`~/Projects/backstory/docs/Radio Milwaukee Backstory PRD-2.md`, music coverage section)
**Decision record:** `docs/decisions/006-music-facts-merge-at-read.md`

## 1. Goal

Let the Alexa+ add-on (Radio Commons) answer three things from this playlist database, with no outside API or AI call while a listener waits:

1. **Recall:** "What was that song with the horns on 88Nine this morning?" and "No, the one before that."
2. **Track story:** sourced facts about a track: credits, year, label, samples and covers.
3. **Connections:** "The drummer on this also plays on X, which we played Tuesday." This is a station-only take on Spotify's SongDNA.

Success:
- Exact-time questions return the right spin.
- Cue questions return the best match or two to three options.
- Every fact carries a source.
- Each query answers well inside Radio Commons' 350 ms client timeout.

## 2. Where this sits

| Repo | Owns |
|---|---|
| **rm-playlist-v2 (this)** | Spins, track/artist matching, Tier 1 facts from MusicBrainz + Discogs + Genius, the read queries below |
| **Backstory** | CDS music coverage: premieres, Concert Picks, sessions. Premiere facts stay in Backstory |
| **Radio Commons** | MCP tools. Adds `src/lib/playlist.ts`, copying `src/lib/backstory.ts` (ConvexHttpClient, timeout race, zod-validated replies) |

Premiere facts are combined **when Radio Commons answers**, not by copying data between databases (decision 006). Radio Commons calls `getTrackFacts` here and Backstory's premiere lookup in parallel, joining on `trackKey`.

**Out of scope here:** the Finds library (#2), play-along game rounds (#3), the Tier 2 Crate worker (#4), and the MCP tools themselves (Radio Commons).

## 3. Storage

### 3.1 `tracks`: new optional fields

| Field | Type | Meaning |
|---|---|---|
| `matchConfidence` | `"high" \| "low"` | `high` when Apple Music and MusicBrainz agree on the recording, or the ISRCs match; otherwise `low`. Low tracks never become game questions. |
| `releaseYear` | number | First release year: MusicBrainz `first-release-date`, else Discogs `year` |
| `cueTags` | string[] | Precomputed match tags (see 3.3) |
| `creditsStatus` | `"found" \| "none" \| "error"` | Outcome of the credits phase. `none` is never retried automatically; `error` retries next tick |
| `creditsFetchedAt` | number | Unix ms of the last credits attempt |

Index `by_credits_status` on `["creditsStatus"]` (with an undefined status meaning "not yet tried") drives the backfill.

### 3.2 New table `facts`

One verified statement per row. **The source fields are required: no source, no fact.**

| Field | Type | Notes |
|---|---|---|
| `trackId` | `Id<"tracks">` | Subject track |
| `group` | `"performer" \| "writer" \| "producer" \| "engineer" \| "release" \| "connection"` | Role grouping, modeled on Spotify's expanded credits |
| `role` | string | Human label: "trumpet", "mixing engineer", "label", "samples", "cover of" |
| `value` | string | Display value: the person's name, label name, year, or the linked song's "Artist – Title" |
| `personKey` | string? | `mb:<artist mbid>`, else `discogs:<artist id>`, else `genius:<artist id>`, present when the fact names a person. The join key for connections |
| `linkedRecording` | `{ artist, title, mbid? }`? | For `connection` facts |
| `scope` | `"track" \| "album"` | Discogs album-wide credits are `album`. Only `track` facts produce cue tags |
| `sources` | array, min 1, of `{ source: "musicbrainz" \| "discogs" \| "genius", sourceUrl, sourceRef, fetchedAt }` | Every source that states this fact. `sourceUrl` is the human-viewable page for attribution; `sourceRef` is the MBID / Discogs release id / Genius song id it was read from |

`connection` roles are a fixed list: `samples`, `interpolates`, `cover_of`, `sampled_by`, `covered_by`. The sample types come from Crate's WhoSampled types.

**One fact, many sources** (the edge + edge-sources model from Crate's influence cache). Facts merge on `(trackId, group, role, personKey ?? normalized value)`. When MusicBrainz and Discogs both credit the same drummer, that's one fact with two sources, not two rows. Agreement between sources counts toward the evidence rule (5.2).

Indexes: `by_track` `["trackId"]`, `by_person` `["personKey"]`.

A re-fetch for a track deletes and rewrites that track's facts in one mutation, so stale credits don't pile up.

### 3.3 Cue tags

These are computed during enrichment and stored on the track:

- **Instrument family** from `track`-scope `performer` facts, via one hand-written lookup table. For example, trumpet / trombone / saxophone / flugelhorn / horn → `horns`; violin / viola / cello / strings → `strings`; piano / organ / synthesizer / keyboard → `keys`. Unknown instruments map to nothing.
- **Decade** from `releaseYear` (`"1970s"`).
- **Style** from Discogs `styles` + `genres`, lowercased (`"afrobeat"`, `"jazz-funk"`). This is the release's style, so it applies at album level by nature. That's acceptable for style; it isn't for instruments.
- **`local`** for tracks played on the `414music` station.

Radio Commons gets the closed list of instrument-family words in the tool description, so Alexa's AI maps "the one with brass" → `horns`.

### 3.4 Deliberately not stored

- `alexaViews` / precomputed voice summary: Alexa writes the wording from the facts.
- `cards`, `jobs`: these belong to Tier 2 (#4).
- Lyrics: never.

### 3.5 Shared normalizing

`trackKey` is the existing normalized artist+title key. Backstory needs the identical function to look up premieres. We copy it into Backstory, and both repos run the same fixture file of tricky inputs (feat., remixes, "&" vs "and", accents) in their tests. A mismatch shows up as a failing fixture, not as a silent miss.

## 4. Filling the data (slow path)

### 4.1 Credits phase inside the existing job

`src/trigger/enrich-pending-plays.ts` runs every minute (`maxDuration: 240`) and resolves 20 pending plays. A **second phase in the same run** spends the remaining time budget on credits.

1. Select tracks with no `creditsStatus` (or `error`). Tracks with a play in the last hour come first, then the highest spin count.
2. **MusicBrainz**, one call per track with a recording MBID: `GET /recording/{mbid}?inc=artist-rels+recording-rels+work-rels+releases`. This gives performer/producer/engineer credits with artist MBIDs, "samples material" and cover/work links, and the first release date.
3. **Discogs** (when the existing search already found a release): `GET /releases/{id}`. This gives `tracklist[].extraartists` (track-scope credits), release-level `extraartists` (album-scope), `styles`, `genres`, `year`.
4. **Genius**, song endpoint only: search `GET /search?q=<artist title>`, accept a hit only when its normalized artist + title match our `trackKey`, then `GET /songs/{id}`. Read `producer_artists`, `writer_artists`, and `song_relationships` (samples, interpolations, covers in both directions). **Never** call the annotations/referents endpoints, and never store any lyric text. Field shapes are in `crate-cli/src/servers/genius.ts:102-131`.
5. Pure functions turn all three responses into merged facts, cue tags, `releaseYear`, `matchConfidence`. One mutation writes everything for the track.

**Why the same job:** the existing throttles are per process. A second job would get its own 1 req/sec MusicBrainz allowance and together break the limit. Discogs (60/min with token) and Genius each get their own throttle, separate from MusicBrainz. New env var: `GENIUS_ACCESS_TOKEN` (same token Crate uses), set in Trigger.dev.

**To confirm while planning:** the task cannot overlap itself (queue concurrency 1). If it can, add that limit.

### 4.2 Backfill

The same loop works through every older resolved track, in the priority order from 4.1. At ~1 MusicBrainz call per track, the ceiling is ~3,600 tracks/hour; Discogs at 60/min is the slower lane, so Discogs coverage trails MusicBrainz coverage. While planning, take a read-only count of resolved tracks (`bunx convex data` / a `convex run` query) to estimate days-to-warm. **Ship this phase first so the backfill starts days before the demo.**

### 4.3 Failure handling

| Case | Result |
|---|---|
| Any source 429 or 5xx | `creditsStatus: "error"`, retried next tick; logged as `enrichment_error` in `ingestionEvents` |
| 404 / no relationships | `creditsStatus: "none"`. Not retried automatically; the existing `reEnrichTrack` path resets it |
| Discogs release found but it's a different pressing | Credits usually match across pressings; facts are labeled with `sourceRef` so a wrong one can be traced |
| Parser hits an unknown shape | That source contributes no facts; the other sources still write; logged |
| Genius search hit doesn't match our `trackKey` | Genius contributes nothing for that track. No fuzzy acceptance, since a wrong song means wrong samples |

## 5. Read queries (fast path)

New file `packages/convex/convex/alexa.ts`. These are public read-only queries, index reads only, called by Radio Commons via `ConvexHttpClient`.

### 5.1 `findSongPlayed({ station, from, to, cues?, beforePlayId?, afterPlayId? })`

1. Resolve the station slug, then read plays by `by_station_played_at` within `[from, to]`. Drop `ignored` and soft-deleted plays.
2. With `beforePlayId` / `afterPlayId`: return the neighboring non-ignored spin on the same station ("the one before that").
3. Score each spin: matched cue tags (weighted first), then nearness to the window's midpoint.
4. Return up to 3 matches, each `{ label: "1"|"2"|"3", playId, artist, title, playedAt, trackId|null, trackKey, matchedCues, matchReason, matchConfidence, artworkUrl }`. `matchReason` is short and factual: "credited with trumpet".

`status` values:
- `ok`: one match clearly ahead.
- `options`: 2–3 close matches.
- `cues_unchecked`: cues were given but no spin in the window has tags. Time-ranked spins are returned and Alexa says it can't tell which had the cue.
- `no_spins`: nothing in the window. Returns the nearest spin before/after so Alexa can offer it.
- `unknown_station`.

### 5.2 `getTrackFacts({ trackId? , playId? })`

`playId` covers unresolved plays. Returns:
- track basics (title, artist, album, year, label, ISRC, artwork)
- `trackKey`
- facts grouped by `group`, each with its `sources` list (name + URL for attribution)
- `evidence`

`evidence` values:
- `rich`: ≥3 `track`-scope facts and `matchConfidence: "high"`. This is the future game gate. Sub-project #3 may additionally require a fact with ≥2 agreeing sources for any fact used as a question's answer.
- `basic`: resolved, fewer facts.
- `none`: unresolved play. Basics come from the playlist strings; `trackKey` is computed from the raw strings, so Radio Commons can still find a Backstory premiere for it.

### 5.3 `getTrackConnections({ trackId, limit? })`

A station-only SongDNA:
- **Shared people:** for each `personKey` on this track, `by_person` finds other tracks crediting that person, filtered to tracks **this org has played**. Returns `{ person, role, otherTrack: {artist, title, trackId}, lastPlayedAt }`.
- **Samples / covers:** this track's `connection` facts, marked `played: true` when the linked recording is one we've spun.

Results are capped (default 5) and ordered with most-recently-played first. A popular session player could match hundreds of tracks, so the per-person scan is capped too.

## 6. Graceful degradation

Every spin is answerable. Only the depth changes.

| Level | Recall by time | Recall by cue | Track story | Connections | Game (#3) |
|---|---|---|---|---|---|
| Unresolved play | ✅ | ❌ | Playlist basics, `evidence: none`, plus any Backstory premiere | ❌ | ❌ |
| Resolved, no credits | ✅ | Decade/style only | Basics + album/year/label | ❌ | ❌ |
| Credits found | ✅ | ✅ | Full sourced facts | ✅ | only if `rich` |

Staff fixes go through the existing Needs Attention panel and `overrideUnresolvedIdentity`. A fixed track enters the credits queue on the next tick.

## 7. Testing

Unit tests on pure functions in `packages/enrichment` and `packages/convex/test`:
- instrument → family table
- MusicBrainz relationship parser, Discogs release parser, and Genius song parser (recorded JSON fixtures via the existing `fetch-mock` helper): track vs album scope, missing fields, unknown roles
- fact merging across sources (same drummer from MusicBrainz + Discogs → one fact, two sources)
- Genius guard: a fixture containing lyric-bearing fields proves nothing lyric-shaped reaches a fact
- `matchConfidence` and `evidence` rules
- cue scoring and the ranking/status choice (`ok` vs `options` vs `cues_unchecked`)
- `trackKey` shared fixture file (also copied to Backstory)

Query tests: `findSongPlayed` once per degradation level, plus "the one before that" across an ignored station ID. `getTrackConnections` with a capped popular person.

Latency: time each query from Radio Commons' region before the demo, and record p50/p95 for the submission's latency table.

## 8. Open items (non-blocking)

- Discogs and Genius API terms: confirm the attribution wording and permission to store and display credits / relationships.
- Licensing: `crate-cli` declares MIT in `package.json` but has no LICENSE file, and `crate-web` has none. Add a LICENSE before copying Crate code into this open-source submission.
- Whether Spotify's public Web API exposes the new credits. Assumed **no**; we don't depend on it.
- Count of resolved tracks → backfill duration estimate (first planning task).
- Convex deploy goes through the `Convex deploy` GitHub workflow on `main` only (see CLAUDE.md). No `convex dev` from the feature branch.

## 9. What we borrow from Crate (audit 2026-10-04)

Crate fetches raw JSON and lets an AI interpret it, so the deterministic parsers and the instrument vocabulary in this spec are new work.

**Borrowed:**
- The influence-cache edge + edge-sources model (`crate-cli/src/servers/influence-cache.ts:36-85`; Convex port `crate-web/convex/schema.ts:191-238`). It becomes "one fact, many sources" in 3.2.
- WhoSampled sample types (`whosampled.ts:56-80`) for the connection role list.
- Genius song fields (`genius.ts:102-131`).

**For sub-project #4 (Tier 2), not here:**
- Reuse the influence edge model keyed by MusicBrainz ID instead of name, with a source required on every edge.
- Reuse `citationVerify.ts` to confirm a quoted sentence exists on its page.
- Call Crate's MCP tools over stdio.
- Do **not** reuse the `/track` and `/story` prompts as written: they send Perplexity narrative into facts without per-fact sources.

**Not borrowed:**
- WhoSampled scraper (stealth browser past Cloudflare: legal risk).
- Co-mention influence heuristic (unsourced).
- Genius annotations and `lyricsSnippet` (lyrics).
- Crate's Discogs release parser (drops album-level credits).
- crate-web rate limiters (inbound quotas, not outbound throttles).

## 10. Research notes: Spotify (October 2026)

- **Expanded credits** (Nov 2025): all contributors, including engineers and performers; supplied by labels/distributors.
- **SongDNA** (beta Mar 2026): collaborators, samples, interpolations, covers; WhoSampled-powered (Spotify acquired it).
- **About the Song** (beta): swipeable story cards summarized from third-party sources; shown only past a stream threshold with enough reliable coverage.

What we take from them: role-grouped credits, people as followable keys, samples/covers. Where we differ: per-fact citations, and no popularity threshold. That's how local debuts get stories.

Sources: [Spotify for Artists blog](https://artists.spotify.com/en/blog/spotlighting-the-people-connections-and-stories-behind-your-music), [About the Song support page](https://support.spotify.com/us/artists/article/about-the-song/), [TechCrunch on SongDNA](https://techcrunch.com/2026/03/24/spotifys-songdna-feature-lets-you-explore-the-connections-behind-your-favorite-songs/), [Digital Music News](https://www.digitalmusicnews.com/2025/11/19/spotify-songdna-launch/).
