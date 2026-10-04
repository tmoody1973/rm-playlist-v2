# Song Recall + Tier 1 Facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store sourced credits, samples and covers for every track (MusicBrainz + Discogs + Genius), and expose three public read queries that let the Alexa+ add-on (Radio Commons) find a song by time and description, tell its sourced story, show connections, and name upcoming shows.

**Architecture:**
- **Slow path:** a second "credits" phase inside the existing `enrich-pending-plays` Trigger.dev job. It fetches each track's credits under the job's shared throttles and writes merged facts through one Convex mutation.
- **Fast path:** public Convex queries in `alexa.ts` that only read indexes. All scoring and grouping logic lives in pure helper files with `bun test` coverage.

**Tech Stack:** TypeScript, Convex, Trigger.dev v4 (`@trigger.dev/sdk` 4.6.4), Bun test runner, MusicBrainz WS/2, Discogs API, Genius API.

**Spec:** `docs/superpowers/specs/2026-10-04-music-recall-tier1-facts-design.md` (approved 2026-10-04). Decision record: `docs/decisions/006-music-facts-merge-at-read.md`.

### Corrections to the spec found while planning (apply these; the spec is updated to match)

1. **`trackKey` can't be shared with Backstory.** Live data shows `trackKey` = `<convex artistId>::<slug>`. A new pure `matchKey(artist, title)` (Task 1) is the shared cross-app key. Every place the spec says "return `trackKey` for Backstory" means `matchKey`.
2. **Tracks don't store a MusicBrainz recording ID.** The job finds one and discards it. The credits phase resolves it by **ISRC** (8,609 of 8,739 tracks have one, measured 2026-10-04), falls back to the existing fuzzy search, and saves `recordingMbid` on the track. `upsertTrack` is **not** modified, because that validator caused the 2026-04-24 outage.
3. **Shows group by metro, not city.** Upcoming events span 40+ suburbs (Chicago 528, Evanston 48, Rosemont 26 …). All 1,025 upcoming events have lat/lng, so each event goes to the nearest of Milwaukee / Madison / Chicago.
4. **Backfill ordering drops "highest spin count".** Tracks played in the last 80 ingested plays go first, then any untried track. The whole backlog is ~8,700 tracks ≈ 5–6 hours, so spin-count ordering wouldn't change the demo.
5. **`local` cue tag is computed at query time** (spin on station `414music`), not stored on the track.
6. **Past events are never pruned** (2,051 past vs 1,051 upcoming). The fan-out read switches to newest-first so old rows can't crowd out future shows.

## Global Constraints

- **No external API or LLM call inside any Convex query.** Queries read indexes only.
- **No source, no fact:** every `facts` row has `sources` with ≥1 entry (`musicbrainz | discogs | genius`, `sourceUrl`, `sourceRef`, `fetchedAt`).
- **No lyrics, ever:** never call Genius annotations/referents. The Genius parser reads only `id, url, title, primary_artist, producer_artists, writer_artists, song_relationships`.
- **Rate limits:** MusicBrainz ≤1 req/s (existing `MB_RATE_PER_SEC` throttle, shared with the plays phase). Discogs ≤60/min (existing throttle). Genius gets its own throttle at 2 req/s.
- **Shows use `normalizeEventArtistKey`**, never `matchKey` or `trackKey`.
- **Connection roles are exactly:** `samples`, `interpolates`, `cover_of`, `sampled_by`, `covered_by`.
- **Fact groups are exactly:** `performer`, `writer`, `producer`, `engineer`, `release`, `connection`.
- **Never run `bunx convex dev` or `bunx convex codegen`.** They push to the shared `precise-fish-444` deployment. New Convex modules are added to `convex/_generated/api.d.ts` by hand, the same way prior PRs did. `bunx convex data` / `convex run` are read-only and allowed.
- **Deploy order:** Convex changes (Tasks 1–3) merge and deploy **before** any Trigger.dev change that calls them (Tasks 4–8). The two deploy workflows run in parallel after CI, so they ship as **separate PRs**.
- **Preview audio:** `previewUrl` (Apple Music 30-second clips, 98.1% of tracks) is returned as data only. Playing it happens in Radio Commons' Echo Show card. Apple's preview terms require Apple attribution and a link to the song on Apple Music next to the player — unverified, check before the demo video.
- New env var `GENIUS_ACCESS_TOKEN` (Trigger.dev prod env). Without it, the Genius source is skipped, not failed.
- Code style per CLAUDE.md: functions ≤20 lines where practical, named constants, no mutation of inputs, `ponytail:` comments on deliberate shortcuts.

## Review Focus

1. **A cue asked when nobody in the window has tags** (most tracks before the backfill finishes). Expect `status: "cues_unchecked"` with time-ranked spins, never a confident wrong answer. Pinned in Task 9.
2. **"The one before that" across a station ID or soft-deleted play.** Expect the previous real song, skipping `ignored` and `deletedAt` plays. Pinned in Task 9 (pure neighbor helper).
3. **Genius search returns a different song with a similar name.** Expect zero Genius facts for that track. Pinned in Task 6.
4. **MusicBrainz 503 mid-backfill.** Expect `creditsStatus: "error"`, no partial overwrite of good facts, retried later. Pinned in Task 7.
5. **An artist with a Chicago show next week and a Milwaukee show next month.** Expect both, Chicago first, each labeled with its metro. Pinned in Task 10.

---

## File map

**`packages/convex/convex/`**

| File | Responsibility |
|---|---|
| `matchKey.ts` (new) | Cross-app song key + artist normalizer (moved from `events.ts`) |
| `factValidators.ts` (new) | Shared Convex validators for facts / credits fields |
| `schema.ts` (modify) | `tracks` new fields + indexes, new `facts` table |
| `credits.ts` (new) | `tracksNeedingCredits` query, `writeTrackCredits` mutation |
| `recall.ts` (new) | Pure: spin scoring, recall status, neighbor spin, evidence level, fact grouping |
| `showsByMetro.ts` (new) | Pure: nearest metro, soonest show per metro |
| `plays.ts` (modify) | Extract `upcomingEventsForArtist`, newest-first fan-out, add `upcomingShowsByMetro` |
| `alexa.ts` (new) | Public queries `findSongPlayed`, `getTrackFacts`, `getTrackConnections` |
| `_generated/api.d.ts` (modify) | Hand-register new modules |

**`packages/enrichment/src/`**

| File | Responsibility |
|---|---|
| `credits/types.ts` (new) | `CreditFact`, `FactSource`, `TrackForCredits`, `TrackCreditsResult` |
| `credits/instrumentFamily.ts` (new) | Instrument → family table |
| `credits/merge.ts` (new) | Merge facts across sources, cue tags, match confidence |
| `musicbrainz/client.ts` (modify) | `lookupRecordingByIsrc`, `fetchRecordingRelations` |
| `credits/parseMusicBrainz.ts` (new) | MB relations JSON → facts |
| `discogs/client.ts` (modify) | `fetchRelease` |
| `credits/parseDiscogs.ts` (new) | Discogs release JSON → facts + styles |
| `genius/client.ts` (new) | `searchGeniusSong`, `fetchGeniusSong` |
| `credits/parseGenius.ts` (new) | Genius song JSON → facts (whitelist) |
| `credits/collect.ts` (new) | `collectTrackCredits` orchestrator |

**`src/trigger/`**

| File | Responsibility |
|---|---|
| `enrich-credits.ts` (new) | `enrichCreditsBatch` time-boxed loop |
| `enrich-pending-plays.ts` (modify) | Call the credits phase after the plays batch |

Tests mirror these under `packages/convex/test/`, `packages/enrichment/test/`, and `src/trigger/`.

## Ship order

- **PR A (Convex foundation):** Tasks 1–3. Merge → `Convex deploy` workflow → confirm with `bunx convex data facts --limit 1` (empty table exists).
- **PR B (credits backfill):** Tasks 4–8. Before merge, Tarik adds `GENIUS_ACCESS_TOKEN` in Trigger.dev. Merge → `Trigger deploy`. **The backfill starts here.**
- **PR C (read API):** Tasks 9–11. Merge → Convex deploy.

---

### Task 1: Shared `matchKey` + artist normalizer

**Files:**
- Create: `packages/convex/convex/matchKey.ts`
- Modify: `packages/convex/convex/events.ts:153-160` (`normalizeEventArtistKey` delegates)
- Create: `packages/convex/test/fixtures/match-keys.json`
- Test: `packages/convex/test/matchKey.test.ts`

**Interfaces:**
- Produces: `matchKey(artist: string, title: string): string`, `normalizeArtistForMatch(name: string): string`

- [ ] **Step 1: Write the shared fixture file**

`packages/convex/test/fixtures/match-keys.json`:

```json
[
  { "artist": "Ezra Collective", "title": "Victory Dance", "expected": "ezracollective::victorydance" },
  { "artist": "Glitzy feat. Brief", "title": "Effort", "expected": "glitzy::effort" },
  { "artist": "Glitzy", "title": "Effort (feat. Brief)", "expected": "glitzy::effort" },
  { "artist": "Glitzy", "title": "Effort - Radio Edit", "expected": "glitzy::effort" },
  { "artist": "The Beatles", "title": "Let It Be (Remastered 2009)", "expected": "beatles::letitbe" },
  { "artist": "Sigur Rós", "title": "Hoppípolla", "expected": "sigurros::hoppipolla" },
  { "artist": "Thundercat", "title": "Them Changes [Live]", "expected": "thundercat::themchangeslive" },
  { "artist": "Ezra Collective", "title": "Victory Dance (Remix)", "expected": "ezracollective::victorydanceremix" }
]
```

- [ ] **Step 2: Write the failing test**

`packages/convex/test/matchKey.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { matchKey } from "../convex/matchKey";
import { normalizeEventArtistKey } from "../convex/events";
import cases from "./fixtures/match-keys.json";

describe("matchKey (shared with Backstory — keep fixtures identical in both repos)", () => {
  for (const testCase of cases) {
    test(`${testCase.artist} — ${testCase.title}`, () => {
      expect(matchKey(testCase.artist, testCase.title)).toBe(testCase.expected);
    });
  }
});

describe("normalizeEventArtistKey keeps its behavior after the move", () => {
  test("strips articles, accents, punctuation", () => {
    expect(normalizeEventArtistKey("The Beatles")).toBe("beatles");
    expect(normalizeEventArtistKey("Sigur Rós")).toBe("sigurros");
    expect(normalizeEventArtistKey("A Tribe Called Quest")).toBe("tribecalledquest");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/convex && bun test test/matchKey.test.ts`
Expected: FAIL, `Cannot find module '../convex/matchKey'`.

- [ ] **Step 4: Implement `matchKey.ts`**

```ts
/**
 * Cross-app song key computed from plain artist + title strings.
 * Backstory carries an identical copy (decision 006); both repos run
 * test/fixtures/match-keys.json so the copies can't drift silently.
 *
 * Distinct from `tracks.trackKey`, which embeds a Convex artist id and
 * can't be computed outside this database.
 */
const COMBINING_MARKS = /[̀-ͯ]/g;
const ARTICLES = /\b(the|a|an)\b/g;
const NON_ALNUM = /[^a-z0-9]/g;
const FEATURED_SUFFIX = /\s*[([]?\s*(?:feat\.?|ft\.?|featuring)\s+[^)\]]*[)\]]?\s*$/i;
const EDIT_WORDS = "radio edit|single version|remaster(?:ed)?(?: \\d{4})?|\\d{4} remaster(?:ed)?";
const EDIT_SUFFIX = new RegExp(
  `\\s*(?:[([]\\s*(?:${EDIT_WORDS})\\s*[)\\]]|-\\s*(?:${EDIT_WORDS}))\\s*$`,
  "i",
);

function foldAccents(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(COMBINING_MARKS, "");
}

/** Article-stripped, alnum-only artist key. Also the event-matching key (events.ts). */
export function normalizeArtistForMatch(name: string): string {
  return foldAccents(name).replace(ARTICLES, "").replace(NON_ALNUM, "");
}

function normalizeTitleForMatch(title: string): string {
  const stripped = title.replace(FEATURED_SUFFIX, "").replace(EDIT_SUFFIX, "");
  return foldAccents(stripped).replace(NON_ALNUM, "");
}

export function matchKey(artist: string, title: string): string {
  const artistPart = normalizeArtistForMatch(artist.replace(FEATURED_SUFFIX, ""));
  return `${artistPart}::${normalizeTitleForMatch(title)}`;
}
```

- [ ] **Step 5: Make `normalizeEventArtistKey` delegate**

In `packages/convex/convex/events.ts`, add `import { normalizeArtistForMatch } from "./matchKey";` at the top and replace the body of `normalizeEventArtistKey` (keep its doc comment and export name, since callers in `plays.ts` and `events.ts` use it):

```ts
export function normalizeEventArtistKey(name: string): string {
  return normalizeArtistForMatch(name);
}
```

- [ ] **Step 6: Run tests**

Run: `cd packages/convex && bun test test/matchKey.test.ts && bun test test/`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/convex/convex/matchKey.ts packages/convex/convex/events.ts packages/convex/test/matchKey.test.ts packages/convex/test/fixtures/match-keys.json
git commit -m "feat(convex): shared matchKey for cross-app song matching"
```

---

### Task 2: Schema — facts table and credits fields on tracks

**Files:**
- Create: `packages/convex/convex/factValidators.ts`
- Modify: `packages/convex/convex/schema.ts` (`tracks` at ~265-294; add `facts` after `tracks`)

**Interfaces:**
- Produces: `factBodyFields`, `factSourceValidator`, `matchConfidenceValidator`, `creditsStatusValidator`; table `facts` with indexes `by_track`, `by_person`; `tracks` fields `recordingMbid`, `matchConfidence`, `releaseYear`, `cueTags`, `creditsStatus`, `creditsFetchedAt`; `tracks` indexes `by_credits_status`, `by_recording_mbid`.

- [ ] **Step 1: Create `factValidators.ts`**

```ts
import { v } from "convex/values";

export const factSourceValidator = v.object({
  source: v.union(v.literal("musicbrainz"), v.literal("discogs"), v.literal("genius")),
  sourceUrl: v.string(),
  sourceRef: v.string(),
  fetchedAt: v.number(),
});

export const factGroupValidator = v.union(
  v.literal("performer"),
  v.literal("writer"),
  v.literal("producer"),
  v.literal("engineer"),
  v.literal("release"),
  v.literal("connection"),
);

/** Fields of one fact, minus the owning track. Shared by schema and credits.ts. */
export const factBodyFields = {
  group: factGroupValidator,
  role: v.string(),
  value: v.string(),
  personKey: v.optional(v.string()),
  linkedRecording: v.optional(
    v.object({ title: v.string(), artist: v.optional(v.string()), mbid: v.optional(v.string()) }),
  ),
  scope: v.union(v.literal("track"), v.literal("album")),
  sources: v.array(factSourceValidator),
};

export const matchConfidenceValidator = v.union(v.literal("high"), v.literal("low"));
export const creditsStatusValidator = v.union(
  v.literal("found"),
  v.literal("none"),
  v.literal("error"),
);
```

- [ ] **Step 2: Extend `tracks` and add `facts` in `schema.ts`**

Add the import: `import { creditsStatusValidator, factBodyFields, matchConfidenceValidator } from "./factValidators";`

Inside `tracks: defineTable({ ... })`, after `previewUrl`:

```ts
    /** MusicBrainz recording id, resolved by the credits phase (ISRC first). */
    recordingMbid: v.optional(v.string()),
    /** "high" = ISRC-exact or Apple+MB agreement; low tracks never become game questions. */
    matchConfidence: v.optional(matchConfidenceValidator),
    releaseYear: v.optional(v.number()),
    /** Precomputed recall tags: instrument families, decade, Discogs styles. */
    cueTags: v.optional(v.array(v.string())),
    /** Credits phase outcome; undefined = not yet tried. */
    creditsStatus: v.optional(creditsStatusValidator),
    creditsFetchedAt: v.optional(v.number()),
```

Append to the `tracks` index chain:

```ts
    .index("by_credits_status", ["creditsStatus"])
    .index("by_recording_mbid", ["recordingMbid"]),
```

(Remove the trailing comma/semicolon from the previous last index so the chain stays valid.)

Add after the `tracks` table:

```ts
  /**
   * One verified statement about a track, with every source that states
   * it. No source, no fact. Rewritten wholesale per track by
   * credits.writeTrackCredits. Spec: docs/superpowers/specs/2026-10-04-music-recall-tier1-facts-design.md
   */
  facts: defineTable({
    trackId: v.id("tracks"),
    ...factBodyFields,
  })
    .index("by_track", ["trackId"])
    .index("by_person", ["personKey"]),
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/convex && bun run typecheck`
Expected: exit 0. Schema types infer through `dataModel.d.ts`, so no codegen is needed.

- [ ] **Step 4: Commit**

```bash
git add packages/convex/convex/factValidators.ts packages/convex/convex/schema.ts
git commit -m "feat(convex): facts table and credits fields on tracks"
```

---

### Task 3: Credits query + write mutation

**Files:**
- Create: `packages/convex/convex/credits.ts`
- Modify: `packages/convex/convex/_generated/api.d.ts` (register `credits`, `factValidators`, `matchKey`)

**Interfaces:**
- Consumes: Task 2 validators and table.
- Produces:
  - `api.credits.tracksNeedingCredits({ limit: number }) → TrackForCreditsRow[]`, where `TrackForCreditsRow = { trackId: Id<"tracks">, artist: string, title: string, album: string | null, isrc: string | null, recordingMbid: string | null, hasAppleMatch: boolean }`
  - `api.credits.writeTrackCredits({ trackId, creditsStatus, facts, cueTags, recordingMbid?, releaseYear?, matchConfidence? }) → null`

- [ ] **Step 1: Write `credits.ts`**

```ts
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import {
  creditsStatusValidator,
  factBodyFields,
  matchConfidenceValidator,
} from "./factValidators";

/** How many of the newest plays count as "on air right now" for priority. */
const RECENT_PLAYS_WINDOW = 80;

export interface TrackForCreditsRow {
  readonly trackId: Id<"tracks">;
  readonly artist: string;
  readonly title: string;
  readonly album: string | null;
  readonly isrc: string | null;
  readonly recordingMbid: string | null;
  readonly hasAppleMatch: boolean;
}

async function toRow(ctx: QueryCtx, track: Doc<"tracks">): Promise<TrackForCreditsRow> {
  const artist = await ctx.db.get(track.artistId);
  return {
    trackId: track._id,
    artist: artist?.displayName ?? "",
    title: track.displayTitle,
    album: track.albumDisplayName ?? null,
    isrc: track.isrc ?? null,
    recordingMbid: track.recordingMbid ?? null,
    hasAppleMatch: track.appleMusicSongId !== undefined,
  };
}

async function recentlyPlayedUntried(ctx: QueryCtx): Promise<Doc<"tracks">[]> {
  const plays = await ctx.db.query("plays").order("desc").take(RECENT_PLAYS_WINDOW);
  const ids = [...new Set(plays.map((p) => p.canonicalTrackId).filter((id) => id !== undefined))];
  const tracks = await Promise.all(ids.map((id) => ctx.db.get(id)));
  return tracks.filter((t): t is Doc<"tracks"> => t !== null && t.creditsStatus === undefined);
}

async function tracksWithStatus(
  ctx: QueryCtx,
  status: Doc<"tracks">["creditsStatus"],
  limit: number,
): Promise<Doc<"tracks">[]> {
  return ctx.db
    .query("tracks")
    .withIndex("by_credits_status", (q) => q.eq("creditsStatus", status))
    .take(limit);
}

/**
 * Credits-phase work queue: on-air tracks first, then never-tried, then
 * transient errors. ponytail: no spin-count ordering — whole backlog
 * (~8.7k tracks) drains in ~6h, add ordering if the catalog grows 10x.
 */
export const tracksNeedingCredits = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }): Promise<TrackForCreditsRow[]> => {
    const picked = new Map<Id<"tracks">, Doc<"tracks">>();
    const tiers = [
      () => recentlyPlayedUntried(ctx),
      () => tracksWithStatus(ctx, undefined, limit),
      () => tracksWithStatus(ctx, "error", limit),
    ];
    for (const tier of tiers) {
      if (picked.size >= limit) break;
      for (const track of await tier()) picked.set(track._id, track);
    }
    const chosen = [...picked.values()].slice(0, limit);
    return Promise.all(chosen.map((track) => toRow(ctx, track)));
  },
});

/** Replace a track's facts and credits fields in one transaction. */
export const writeTrackCredits = mutation({
  args: {
    trackId: v.id("tracks"),
    creditsStatus: creditsStatusValidator,
    facts: v.array(v.object(factBodyFields)),
    cueTags: v.array(v.string()),
    recordingMbid: v.optional(v.string()),
    releaseYear: v.optional(v.number()),
    matchConfidence: v.optional(matchConfidenceValidator),
  },
  handler: async (ctx, args) => {
    const track = await ctx.db.get(args.trackId);
    if (track === null) throw new Error(`Unknown track: ${args.trackId}`);
    // A transient error must not wipe facts a previous run found.
    if (args.creditsStatus === "error") {
      await ctx.db.patch(args.trackId, { creditsStatus: "error", creditsFetchedAt: Date.now() });
      return null;
    }
    await replaceFacts(ctx, args.trackId, args.facts);
    await ctx.db.patch(args.trackId, {
      creditsStatus: args.creditsStatus,
      creditsFetchedAt: Date.now(),
      cueTags: args.cueTags,
      recordingMbid: args.recordingMbid ?? track.recordingMbid,
      releaseYear: args.releaseYear ?? track.releaseYear,
      matchConfidence: args.matchConfidence ?? track.matchConfidence,
    });
    return null;
  },
});
```

Add the helper below (it uses `MutationCtx`; extend the import to `import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";`):

```ts
type FactBody = Omit<Doc<"facts">, "_id" | "_creationTime" | "trackId">;

async function replaceFacts(ctx: MutationCtx, trackId: Id<"tracks">, facts: FactBody[]) {
  const existing = await ctx.db
    .query("facts")
    .withIndex("by_track", (q) => q.eq("trackId", trackId))
    .collect();
  await Promise.all(existing.map((row) => ctx.db.delete(row._id)));
  for (const fact of facts) {
    if (fact.sources.length === 0) throw new Error("No source, no fact: empty sources");
    await ctx.db.insert("facts", { trackId, ...fact });
  }
}
```

- [ ] **Step 2: Register modules in `_generated/api.d.ts`**

Add, keeping alphabetical order with the existing lines:

```ts
import type * as credits from "../credits.js";
import type * as factValidators from "../factValidators.js";
import type * as matchKey from "../matchKey.js";
```

and inside `ApiFromModules<{ ... }>`:

```ts
  credits: typeof credits;
  factValidators: typeof factValidators;
  matchKey: typeof matchKey;
```

- [ ] **Step 3: Typecheck and run the whole Convex test suite**

Run: `cd packages/convex && bun run typecheck && bun test test/`
Expected: exit 0, all PASS.

- [ ] **Step 4: Commit and open PR A**

```bash
git add packages/convex/convex/credits.ts packages/convex/convex/_generated/api.d.ts
git commit -m "feat(convex): credits work queue and writeTrackCredits mutation"
git push -u origin HEAD
gh pr create --title "feat(convex): music facts foundation (schema, matchKey, credits API)" --body "PR A of docs/superpowers/plans/2026-10-04-music-recall-tier1-facts.md. Convex-only so it deploys before the Trigger.dev worker that calls it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

After merge and the `Convex deploy` workflow succeeds, verify (read-only):

Run: `cd packages/convex && bunx convex data facts --limit 1`
Expected: an empty table listing, no "table not found" error.

---

### Task 4: Instrument families, fact merging, cue tags, confidence (pure)

**Files:**
- Create: `packages/enrichment/src/credits/types.ts`
- Create: `packages/enrichment/src/credits/instrumentFamily.ts`
- Create: `packages/enrichment/src/credits/merge.ts`
- Test: `packages/enrichment/test/credits/merge.test.ts`

**Interfaces:**
- Produces:
  - types `FactGroup`, `ConnectionRole`, `FactSource`, `CreditFact`, `TrackForCredits`, `TrackCreditsResult`, `RecordingVia = "isrc" | "search" | "stored"`
  - `instrumentFamily(role: string): InstrumentFamily | null`
  - `mergeFacts(facts: readonly CreditFact[]): CreditFact[]`
  - `deriveCueTags(input: { facts, releaseYear?, styles }): string[]`
  - `deriveMatchConfidence(via: RecordingVia | null, hasAppleMatch: boolean): "high" | "low"`

- [ ] **Step 1: Create `types.ts`**

```ts
export type FactGroup = "performer" | "writer" | "producer" | "engineer" | "release" | "connection";
export type ConnectionRole = "samples" | "interpolates" | "cover_of" | "sampled_by" | "covered_by";
export type FactSourceName = "musicbrainz" | "discogs" | "genius";

export interface FactSource {
  readonly source: FactSourceName;
  readonly sourceUrl: string;
  readonly sourceRef: string;
  readonly fetchedAt: number;
}

export interface CreditFact {
  readonly group: FactGroup;
  readonly role: string;
  readonly value: string;
  readonly personKey?: string;
  readonly linkedRecording?: { readonly title: string; readonly artist?: string; readonly mbid?: string };
  readonly scope: "track" | "album";
  readonly sources: readonly FactSource[];
}

/** How the MusicBrainz recording id was obtained. */
export type RecordingVia = "isrc" | "search" | "stored";

export interface TrackForCredits {
  readonly trackId: string;
  readonly artist: string;
  readonly title: string;
  readonly album: string | null;
  readonly isrc: string | null;
  readonly recordingMbid: string | null;
  readonly hasAppleMatch: boolean;
}

export interface TrackCreditsResult {
  readonly creditsStatus: "found" | "none" | "error";
  readonly facts: CreditFact[];
  readonly cueTags: string[];
  readonly recordingMbid?: string;
  readonly releaseYear?: number;
  readonly matchConfidence: "high" | "low";
  readonly problems: string[];
}
```

- [ ] **Step 2: Write the failing tests**

`packages/enrichment/test/credits/merge.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { instrumentFamily } from "../../src/credits/instrumentFamily";
import { deriveCueTags, deriveMatchConfidence, mergeFacts } from "../../src/credits/merge";
import type { CreditFact } from "../../src/credits/types";

const mb = { source: "musicbrainz" as const, sourceUrl: "https://musicbrainz.org/recording/r1", sourceRef: "r1", fetchedAt: 1 };
const dg = { source: "discogs" as const, sourceUrl: "https://www.discogs.com/release/9", sourceRef: "9", fetchedAt: 1 };

const drummer = (sources: CreditFact["sources"], role: string, personKey?: string): CreditFact => ({
  group: "performer", role, value: "Femi Koleoso", personKey, scope: "track", sources,
});

describe("instrumentFamily", () => {
  test("maps brass and reeds to horns", () => {
    expect(instrumentFamily("trumpet")).toBe("horns");
    expect(instrumentFamily("Saxophone [Tenor]")).toBe("horns");
    expect(instrumentFamily("tenor saxophone")).toBe("horns");
  });
  test("maps keys, strings, drums", () => {
    expect(instrumentFamily("Rhodes")).toBe("keys");
    expect(instrumentFamily("cello")).toBe("strings");
    expect(instrumentFamily("drums (drum set)")).toBe("drums");
  });
  test("unknown role → null", () => {
    expect(instrumentFamily("Photography By")).toBeNull();
  });
});

describe("mergeFacts", () => {
  test("same person + same instrument family from two sources → one fact, two sources", () => {
    const merged = mergeFacts([drummer([mb], "drums", "mb:a1"), drummer([dg], "Drums", "discogs:7")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sources.map((s) => s.source)).toEqual(["musicbrainz", "discogs"]);
    expect(merged[0]?.personKey).toBe("mb:a1");
  });
  test("different roles stay separate", () => {
    const producer: CreditFact = { ...drummer([mb], "producer", "mb:a1"), group: "producer" };
    expect(mergeFacts([drummer([mb], "drums", "mb:a1"), producer])).toHaveLength(2);
  });
  test("does not mutate inputs", () => {
    const input = [drummer([mb], "drums"), drummer([dg], "drums")];
    mergeFacts(input);
    expect(input[0]?.sources).toHaveLength(1);
  });
});

describe("deriveCueTags", () => {
  test("track-scope instrument families, decade, styles; album scope ignored", () => {
    const facts: CreditFact[] = [
      { group: "performer", role: "trumpet", value: "A", scope: "track", sources: [mb] },
      { group: "performer", role: "cello", value: "B", scope: "album", sources: [dg] },
      { group: "performer", role: "lead vocals", value: "C", scope: "track", sources: [mb] },
    ];
    expect(deriveCueTags({ facts, releaseYear: 2019, styles: ["Afrobeat", "Jazz-Funk"] })).toEqual([
      "horns", "2010s", "afrobeat", "jazz-funk",
    ]);
  });
});

describe("deriveMatchConfidence", () => {
  test("ISRC is high; search needs an Apple match; nothing is low", () => {
    expect(deriveMatchConfidence("isrc", false)).toBe("high");
    expect(deriveMatchConfidence("search", true)).toBe("high");
    expect(deriveMatchConfidence("search", false)).toBe("low");
    expect(deriveMatchConfidence(null, true)).toBe("low");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/enrichment && bun test test/credits/merge.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `instrumentFamily.ts`**

```ts
export type InstrumentFamily =
  | "horns" | "strings" | "keys" | "guitar" | "bass" | "drums" | "percussion" | "vocals" | "electronic";

/** Checked in order; first keyword contained in the role wins. Bass before guitar ("bass guitar"). */
const FAMILY_KEYWORDS: ReadonlyArray<readonly [InstrumentFamily, readonly string[]]> = [
  ["horns", ["trumpet", "trombone", "saxophone", "sax", "flugelhorn", "horn", "tuba", "cornet", "clarinet", "flute", "brass", "woodwind"]],
  ["strings", ["violin", "viola", "cello", "double bass", "contrabass", "string", "harp"]],
  ["bass", ["bass"]],
  ["keys", ["piano", "keyboard", "keys", "organ", "rhodes", "wurlitzer", "clavinet", "synthesizer", "synth", "harpsichord"]],
  ["guitar", ["guitar", "banjo", "mandolin", "ukulele", "pedal steel"]],
  ["drums", ["drum"]],
  ["percussion", ["percussion", "conga", "bongo", "shaker", "tambourine", "vibraphone", "marimba", "timbales", "cajón", "cajon"]],
  ["vocals", ["vocal", "voice", "singer", "rap", "choir"]],
  ["electronic", ["programming", "programmed", "drum machine", "sampler", "turntables", "dj"]],
];

/** ponytail: keyword table, not a taxonomy — add keywords when real credits miss. */
export function instrumentFamily(role: string): InstrumentFamily | null {
  const lowered = role.toLowerCase();
  for (const [family, keywords] of FAMILY_KEYWORDS) {
    if (keywords.some((keyword) => lowered.includes(keyword))) return family;
  }
  return null;
}
```

Note: "double bass" matches `strings` before `bass` because `strings` is checked first.

- [ ] **Step 5: Implement `merge.ts`**

```ts
import { instrumentFamily } from "./instrumentFamily";
import type { CreditFact, RecordingVia } from "./types";

/** Cue tags never include vocals: "the one with singing" doesn't narrow anything. */
const UNTAGGED_FAMILIES = new Set(["vocals"]);

function normalizeName(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}

function mergeKey(fact: CreditFact): string {
  const rolePart = fact.group === "performer" ? (instrumentFamily(fact.role) ?? fact.role.toLowerCase()) : fact.role.toLowerCase();
  return `${fact.group}|${rolePart}|${normalizeName(fact.value)}`;
}

function preferMbPersonKey(a?: string, b?: string): string | undefined {
  if (a?.startsWith("mb:")) return a;
  if (b?.startsWith("mb:")) return b;
  return a ?? b;
}

/**
 * Collapse the same statement from several sources into one fact.
 * ponytail: person identity across sources is by normalized name; two
 * different people with the same name on one track would merge (rare).
 */
export function mergeFacts(facts: readonly CreditFact[]): CreditFact[] {
  const merged = new Map<string, CreditFact>();
  for (const fact of facts) {
    const key = mergeKey(fact);
    const existing = merged.get(key);
    merged.set(key, existing === undefined ? fact : {
      ...existing,
      personKey: preferMbPersonKey(existing.personKey, fact.personKey),
      scope: existing.scope === "track" || fact.scope === "track" ? "track" : "album",
      sources: [...existing.sources, ...fact.sources],
    });
  }
  return [...merged.values()];
}

function decadeTag(year?: number): string[] {
  return year === undefined ? [] : [`${Math.floor(year / 10) * 10}s`];
}

export function deriveCueTags(input: {
  readonly facts: readonly CreditFact[];
  readonly releaseYear?: number;
  readonly styles: readonly string[];
}): string[] {
  const families = input.facts
    .filter((fact) => fact.group === "performer" && fact.scope === "track")
    .map((fact) => instrumentFamily(fact.role))
    .filter((family): family is NonNullable<typeof family> => family !== null && !UNTAGGED_FAMILIES.has(family));
  const styles = input.styles.map((style) => style.toLowerCase());
  return [...new Set([...families, ...decadeTag(input.releaseYear), ...styles])];
}

export function deriveMatchConfidence(via: RecordingVia | null, hasAppleMatch: boolean): "high" | "low" {
  if (via === "isrc") return "high";
  if ((via === "search" || via === "stored") && hasAppleMatch) return "high";
  return "low";
}
```

- [ ] **Step 6: Run tests**

Run: `cd packages/enrichment && bun test test/credits/merge.test.ts`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/enrichment/src/credits packages/enrichment/test/credits/merge.test.ts
git commit -m "feat(enrichment): credit fact types, instrument families, merging"
```

---

### Task 5: MusicBrainz — ISRC lookup, relations fetch, parser

**Files:**
- Modify: `packages/enrichment/src/musicbrainz/client.ts` (add two exported functions; reuse private `classifyError`, `safeText`, `sleep`, `USER_AGENT`, `API_BASE`)
- Create: `packages/enrichment/src/credits/parseMusicBrainz.ts`
- Create: `packages/enrichment/test/credits/fixtures/mb-isrc.json`, `mb-relations.json`
- Test: `packages/enrichment/test/credits/parseMusicBrainz.test.ts`

**Interfaces:**
- Consumes: `CreditFact` (Task 4), `Throttle`, `FetchLike`.
- Produces:
  - `lookupRecordingByIsrc({ isrc, title, throttle, signal?, fetch? }): Promise<string | null>`
  - `fetchRecordingRelations({ recordingMbid, throttle, signal?, fetch? }): Promise<MbRecordingRelations>`
  - `parseMusicBrainzRelations(json: MbRecordingRelations, fetchedAt: number): { facts: CreditFact[]; releaseYear?: number }`

- [ ] **Step 1: Write fixtures**

`packages/enrichment/test/credits/fixtures/mb-isrc.json`:

```json
{ "isrc": "GBBKS2000152", "recordings": [
  { "id": "rec-live", "title": "Victory Dance (live)" },
  { "id": "rec-studio", "title": "Victory Dance" }
] }
```

`packages/enrichment/test/credits/fixtures/mb-relations.json`:

```json
{
  "id": "rec-studio",
  "title": "Victory Dance",
  "first-release-date": "2019-05-03",
  "relations": [
    { "type": "instrument", "target-type": "artist", "direction": "backward", "attributes": ["trumpet"], "artist": { "id": "art-dylan", "name": "Ife Ogunjobi" } },
    { "type": "instrument", "target-type": "artist", "direction": "backward", "attributes": ["drums (drum set)"], "artist": { "id": "art-femi", "name": "Femi Koleoso" } },
    { "type": "vocal", "target-type": "artist", "direction": "backward", "attributes": ["lead vocals"], "artist": { "id": "art-v", "name": "Some Singer" } },
    { "type": "producer", "target-type": "artist", "direction": "backward", "attributes": [], "artist": { "id": "art-p", "name": "Producer Person" } },
    { "type": "mix", "target-type": "artist", "direction": "backward", "attributes": [], "artist": { "id": "art-m", "name": "Mix Person" } },
    { "type": "samples material", "target-type": "recording", "direction": "forward", "recording": { "id": "rec-old", "title": "Old Groove", "artist-credit": [{ "name": "Old Band" }] } },
    { "type": "samples material", "target-type": "recording", "direction": "backward", "recording": { "id": "rec-new", "title": "New Beat", "artist-credit": [{ "name": "New DJ" }] } },
    { "type": "performance", "target-type": "work", "direction": "forward", "attributes": ["cover"], "work": { "id": "work-1", "title": "Original Song",
      "relations": [ { "type": "composer", "target-type": "artist", "direction": "backward", "artist": { "id": "art-w", "name": "Writer Person" } } ] } },
    { "type": "photography", "target-type": "artist", "direction": "backward", "artist": { "id": "art-x", "name": "Photo Person" } }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

`packages/enrichment/test/credits/parseMusicBrainz.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { parseMusicBrainzRelations } from "../../src/credits/parseMusicBrainz";
import { fetchRecordingRelations, lookupRecordingByIsrc } from "../../src/musicbrainz/client";
import { createThrottle } from "../../src/throttle";
import { createMockFetch } from "../fetch-mock";
import isrcHit from "./fixtures/mb-isrc.json";
import relations from "./fixtures/mb-relations.json";

const fastThrottle = () => createThrottle({ ratePerSec: 1000 });

describe("lookupRecordingByIsrc", () => {
  test("prefers the recording whose title matches", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: isrcHit });
    const mbid = await lookupRecordingByIsrc({ isrc: "GBBKS2000152", title: "Victory Dance", throttle: fastThrottle(), fetch: mock.fetch });
    expect(mbid).toBe("rec-studio");
    expect(mock.calls[0]?.url).toContain("/isrc/GBBKS2000152");
  });
  test("404 → null", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 404, body: { error: "Not Found" } });
    expect(await lookupRecordingByIsrc({ isrc: "X", title: "Y", throttle: fastThrottle(), fetch: mock.fetch })).toBeNull();
  });
});

describe("fetchRecordingRelations", () => {
  test("requests relations, work-level relations and releases", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: relations });
    await fetchRecordingRelations({ recordingMbid: "rec-studio", throttle: fastThrottle(), fetch: mock.fetch });
    expect(mock.calls[0]?.url).toContain("inc=artist-rels+recording-rels+work-rels+work-level-rels");
  });
});

describe("parseMusicBrainzRelations", () => {
  const { facts, releaseYear } = parseMusicBrainzRelations(relations as never, 1000);
  const find = (role: string) => facts.find((fact) => fact.role === role);

  test("release year from first-release-date", () => expect(releaseYear).toBe(2019));
  test("instrument credits are track-scope performers with mb person keys", () => {
    expect(find("trumpet")).toMatchObject({ group: "performer", value: "Ife Ogunjobi", personKey: "mb:art-dylan", scope: "track" });
  });
  test("vocals, producer, mix map to groups", () => {
    expect(find("lead vocals")?.group).toBe("performer");
    expect(find("producer")?.group).toBe("producer");
    expect(find("mix")?.group).toBe("engineer");
  });
  test("samples both directions", () => {
    expect(find("samples")?.linkedRecording).toEqual({ title: "Old Groove", artist: "Old Band", mbid: "rec-old" });
    expect(find("sampled_by")?.linkedRecording?.mbid).toBe("rec-new");
  });
  test("cover performance → cover_of + composer as writer", () => {
    expect(find("cover_of")?.linkedRecording?.title).toBe("Original Song");
    expect(find("composer")).toMatchObject({ group: "writer", value: "Writer Person" });
  });
  test("unknown relation types are dropped; every fact has a source", () => {
    expect(facts.some((fact) => fact.value === "Photo Person")).toBe(false);
    for (const fact of facts) expect(fact.sources[0]?.sourceUrl).toBe("https://musicbrainz.org/recording/rec-studio");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd packages/enrichment && bun test test/credits/parseMusicBrainz.test.ts`
Expected: FAIL, missing exports.

- [ ] **Step 4: Add client functions to `musicbrainz/client.ts`**

Append (reuses the file's private helpers):

```ts
const RELATIONS_INC = "artist-rels+recording-rels+work-rels+work-level-rels+releases";

export interface MbRelation {
  type: string;
  "target-type"?: string;
  direction?: "forward" | "backward";
  attributes?: string[];
  artist?: { id?: string; name?: string };
  recording?: { id?: string; title?: string; "artist-credit"?: MbArtistCredit[] };
  work?: { id?: string; title?: string; relations?: MbRelation[] };
}

export interface MbRecordingRelations {
  id: string;
  title: string;
  "first-release-date"?: string;
  relations?: MbRelation[];
}

async function mbGetJson<T>(url: string, throttle: Throttle, signal?: AbortSignal, fetchImpl: FetchLike = globalThis.fetch): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await throttle.acquire(signal);
    const res = await fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal });
    if (res.status === 503 && attempt === 0) {
      const retryAfter = Number.parseInt(res.headers.get("Retry-After") ?? "1", 10);
      await sleep(Math.max(1, retryAfter) * 1000, signal);
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw classifyError(res.status, await safeText(res));
    return (await res.json()) as T;
  }
  throw new MusicBrainzError("upstream_5xx", 503, "musicbrainz 503 after retry");
}

/** ISRC → recording MBID. Prefers the recording whose title matches ours (ISRCs can map to live/edit variants). */
export async function lookupRecordingByIsrc(input: {
  readonly isrc: string; readonly title: string; readonly throttle: Throttle;
  readonly signal?: AbortSignal; readonly fetch?: FetchLike;
}): Promise<string | null> {
  const url = `${API_BASE}/isrc/${encodeURIComponent(input.isrc)}?fmt=json`;
  const json = await mbGetJson<{ recordings?: { id: string; title: string }[] }>(url, input.throttle, input.signal, input.fetch);
  const recordings = json?.recordings ?? [];
  const wanted = normalizeTitleForMb(input.title).toLowerCase();
  const exact = recordings.find((rec) => normalizeTitleForMb(rec.title).toLowerCase() === wanted);
  return (exact ?? recordings[0])?.id ?? null;
}

export async function fetchRecordingRelations(input: {
  readonly recordingMbid: string; readonly throttle: Throttle;
  readonly signal?: AbortSignal; readonly fetch?: FetchLike;
}): Promise<MbRecordingRelations | null> {
  const url = `${API_BASE}/recording/${encodeURIComponent(input.recordingMbid)}?fmt=json&inc=${RELATIONS_INC}`;
  return mbGetJson<MbRecordingRelations>(url, input.throttle, input.signal, input.fetch);
}
```

If `normalizeTitleForMb` already lowercases, the extra `.toLowerCase()` is harmless.

- [ ] **Step 5: Implement `parseMusicBrainz.ts`**

```ts
import type { MbRecordingRelations, MbRelation } from "../musicbrainz/client";
import type { CreditFact, FactGroup, FactSource } from "./types";

const ARTIST_RELATION_GROUPS: Record<string, FactGroup> = {
  instrument: "performer", vocal: "performer", performer: "performer",
  producer: "producer", "co-producer": "producer",
  mix: "engineer", recording: "engineer", mastering: "engineer", engineer: "engineer", "sound engineer": "engineer",
  composer: "writer", lyricist: "writer", writer: "writer",
};

function artistFact(rel: MbRelation, source: FactSource): CreditFact | null {
  const group = ARTIST_RELATION_GROUPS[rel.type];
  const name = rel.artist?.name;
  if (group === undefined || name === undefined) return null;
  const role = rel.attributes?.[0] ?? rel.type;
  const personKey = rel.artist?.id ? `mb:${rel.artist.id}` : undefined;
  return { group, role, value: name, personKey, scope: "track", sources: [source] };
}

function sampleFact(rel: MbRelation, source: FactSource): CreditFact | null {
  if (rel.type !== "samples material" || rel.recording?.title === undefined) return null;
  const artist = rel.recording["artist-credit"]?.map((credit) => credit.name).filter(Boolean).join(", ") || undefined;
  const role = rel.direction === "backward" ? "sampled_by" : "samples";
  const linkedRecording = { title: rel.recording.title, artist, mbid: rel.recording.id };
  return { group: "connection", role, value: `${artist ?? "Unknown"} – ${rel.recording.title}`, linkedRecording, scope: "track", sources: [source] };
}

function workFacts(rel: MbRelation, source: FactSource): CreditFact[] {
  if (rel.type !== "performance" || rel.work?.title === undefined) return [];
  const writers = (rel.work.relations ?? []).map((inner) => artistFact(inner, source)).filter((f): f is CreditFact => f?.group === "writer");
  if (!rel.attributes?.includes("cover")) return writers;
  const cover: CreditFact = { group: "connection", role: "cover_of", value: rel.work.title, linkedRecording: { title: rel.work.title }, scope: "track", sources: [source] };
  return [cover, ...writers];
}

function parseYear(date?: string): number | undefined {
  const year = date ? Number.parseInt(date.slice(0, 4), 10) : Number.NaN;
  return Number.isFinite(year) ? year : undefined;
}

export function parseMusicBrainzRelations(json: MbRecordingRelations, fetchedAt: number): { facts: CreditFact[]; releaseYear?: number } {
  const source: FactSource = { source: "musicbrainz", sourceUrl: `https://musicbrainz.org/recording/${json.id}`, sourceRef: json.id, fetchedAt };
  const facts = (json.relations ?? []).flatMap((rel) => {
    const single = artistFact(rel, source) ?? sampleFact(rel, source);
    return single ? [single] : workFacts(rel, source);
  });
  return { facts, releaseYear: parseYear(json["first-release-date"]) };
}
```

- [ ] **Step 6: Run tests (the new file plus the existing MB client tests)**

Run: `cd packages/enrichment && bun test test/credits/parseMusicBrainz.test.ts test/musicbrainz/`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/enrichment/src/musicbrainz/client.ts packages/enrichment/src/credits/parseMusicBrainz.ts packages/enrichment/test/credits
git commit -m "feat(enrichment): MusicBrainz ISRC lookup and credits/samples/covers parser"
```

---

### Task 6: Discogs release + Genius song — clients and parsers

**Files:**
- Modify: `packages/enrichment/src/discogs/client.ts` (add `fetchRelease`)
- Create: `packages/enrichment/src/credits/parseDiscogs.ts`
- Create: `packages/enrichment/src/genius/client.ts`
- Create: `packages/enrichment/src/credits/parseGenius.ts`
- Create fixtures: `packages/enrichment/test/credits/fixtures/discogs-release.json`, `genius-search.json`, `genius-song.json`
- Test: `packages/enrichment/test/credits/parseDiscogs.test.ts`, `parseGenius.test.ts`

**Interfaces:**
- Consumes: `CreditFact`, `instrumentFamily`, `matchKey` logic (Genius matching uses its own local normalizer — see Step 6), `Throttle`, `FetchLike`, `DiscogsAuth`.
- Produces:
  - `fetchRelease({ releaseId, throttle, ...DiscogsAuth, signal?, fetch? }): Promise<DiscogsRelease | null>`
  - `parseDiscogsRelease(json: DiscogsRelease, trackTitle: string, fetchedAt: number): { facts: CreditFact[]; styles: string[]; year?: number }`
  - `searchGeniusSong({ artist, title, token, throttle, signal?, fetch? }): Promise<number | null>`
  - `fetchGeniusSong({ songId, token, throttle, signal?, fetch? }): Promise<GeniusSong | null>`
  - `parseGeniusSong(song: GeniusSong, fetchedAt: number): CreditFact[]`

- [ ] **Step 1: Write fixtures**

`discogs-release.json`:

```json
{
  "id": 13579, "title": "You Can't Steal My Joy", "year": 2019, "uri": "https://www.discogs.com/release/13579",
  "genres": ["Jazz"], "styles": ["Afrobeat", "Jazz-Funk"],
  "extraartists": [
    { "name": "Femi Koleoso", "id": 111, "role": "Drums", "tracks": "" },
    { "name": "Ife Ogunjobi", "id": 222, "role": "Trumpet", "tracks": "A2" },
    { "name": "Studio Person", "id": 333, "role": "Mastered By", "tracks": "" },
    { "name": "Art Person", "id": 444, "role": "Artwork", "tracks": "" }
  ],
  "tracklist": [
    { "position": "A1", "title": "Quest For Coin", "extraartists": [] },
    { "position": "A2", "title": "Victory Dance", "extraartists": [
      { "name": "James Mollison", "id": 555, "role": "Saxophone [Tenor], Flute", "tracks": "" }
    ] }
  ]
}
```

`genius-search.json`:

```json
{ "response": { "hits": [
  { "type": "song", "result": { "id": 900, "title": "Victory Dance (Remix)", "primary_artist": { "id": 1, "name": "Ezra Collective" } } },
  { "type": "song", "result": { "id": 901, "title": "Victory Dance", "primary_artist": { "id": 1, "name": "Ezra Collective" } } }
] } }
```

`genius-song.json`:

```json
{ "response": { "song": {
  "id": 901, "url": "https://genius.com/Ezra-collective-victory-dance", "title": "Victory Dance",
  "primary_artist": { "id": 1, "name": "Ezra Collective" },
  "producer_artists": [{ "id": 7, "name": "Producer Person" }],
  "writer_artists": [{ "id": 8, "name": "Writer Person" }],
  "song_relationships": [
    { "relationship_type": "samples", "songs": [{ "id": 50, "title": "Old Groove", "primary_artist": { "name": "Old Band" } }] },
    { "relationship_type": "covered_by", "songs": [{ "id": 51, "title": "Victory Dance", "primary_artist": { "name": "Cover Band" } }] },
    { "relationship_type": "remix_of", "songs": [{ "id": 52, "title": "Other", "primary_artist": { "name": "X" } }] }
  ],
  "embed_content": "<div>LYRIC LINE SHOULD NEVER APPEAR</div>",
  "description": { "plain": "LYRIC LINE SHOULD NEVER APPEAR" }
} } }
```

- [ ] **Step 2: Write the failing tests**

`parseDiscogs.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { parseDiscogsRelease } from "../../src/credits/parseDiscogs";
import release from "./fixtures/discogs-release.json";

describe("parseDiscogsRelease", () => {
  const { facts, styles, year } = parseDiscogsRelease(release as never, "Victory Dance", 1000);
  const byValue = (name: string) => facts.filter((fact) => fact.value === name);

  test("tracklist extraartists are track scope, multi-role split, brackets stripped", () => {
    expect(byValue("James Mollison").map((f) => [f.role, f.scope])).toEqual([["Saxophone", "track"], ["Flute", "track"]]);
  });
  test("release-level credit naming our position is track scope", () => {
    expect(byValue("Ife Ogunjobi")[0]).toMatchObject({ role: "Trumpet", scope: "track", personKey: "discogs:222" });
  });
  test("release-level credit with no tracks is album scope", () => {
    expect(byValue("Femi Koleoso")[0]?.scope).toBe("album");
  });
  test("engineers kept, non-musical roles dropped", () => {
    expect(byValue("Studio Person")[0]?.group).toBe("engineer");
    expect(byValue("Art Person")).toHaveLength(0);
  });
  test("styles, year, and source url", () => {
    expect(styles).toEqual(["Afrobeat", "Jazz-Funk"]);
    expect(year).toBe(2019);
    expect(facts[0]?.sources[0]?.sourceUrl).toBe("https://www.discogs.com/release/13579");
  });
});
```

`parseGenius.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { searchGeniusSong } from "../../src/genius/client";
import { parseGeniusSong } from "../../src/credits/parseGenius";
import { createThrottle } from "../../src/throttle";
import { createMockFetch } from "../fetch-mock";
import search from "./fixtures/genius-search.json";
import song from "./fixtures/genius-song.json";

const fastThrottle = () => createThrottle({ ratePerSec: 1000 });

describe("searchGeniusSong", () => {
  test("accepts only an exact artist+title match, sends bearer token", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: search });
    const id = await searchGeniusSong({ artist: "Ezra Collective", title: "Victory Dance", token: "t", throttle: fastThrottle(), fetch: mock.fetch });
    expect(id).toBe(901);
    expect(mock.calls[0]?.headers.authorization).toBe("Bearer t");
  });
  test("a similar but different song is rejected", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: search });
    const id = await searchGeniusSong({ artist: "Ezra Collective", title: "Victory Lap", token: "t", throttle: fastThrottle(), fetch: mock.fetch });
    expect(id).toBeNull();
  });
});

describe("parseGeniusSong", () => {
  const facts = parseGeniusSong(song.response.song as never, 1000);

  test("producers, writers, mapped relationships; unmapped relationship dropped", () => {
    expect(facts.map((f) => `${f.group}:${f.role}:${f.value}`)).toEqual([
      "producer:producer:Producer Person",
      "writer:writer:Writer Person",
      "connection:samples:Old Band – Old Groove",
      "connection:covered_by:Cover Band – Victory Dance",
    ]);
  });
  test("no lyric-bearing field reaches any fact", () => {
    expect(JSON.stringify(facts)).not.toContain("LYRIC LINE");
  });
  test("source is the genius song page", () => {
    expect(facts[0]?.sources[0]).toMatchObject({ source: "genius", sourceUrl: "https://genius.com/Ezra-collective-victory-dance", sourceRef: "901" });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd packages/enrichment && bun test test/credits/parseDiscogs.test.ts test/credits/parseGenius.test.ts`
Expected: FAIL, missing modules.

- [ ] **Step 4: Add `fetchRelease` to `discogs/client.ts`**

Append (reuses the private `classifyError`, `safeText`, `USER_AGENT`, `API_BASE`):

```ts
export interface DiscogsCredit { name?: string; id?: number; role?: string; tracks?: string }
export interface DiscogsRelease {
  id: number; title?: string; year?: number; uri?: string;
  genres?: string[]; styles?: string[];
  extraartists?: DiscogsCredit[];
  tracklist?: { position?: string; title?: string; extraartists?: DiscogsCredit[] }[];
}

export async function fetchRelease(input: DiscogsAuth & {
  readonly releaseId: number; readonly throttle: Throttle;
  readonly signal?: AbortSignal; readonly fetch?: FetchLike;
}): Promise<DiscogsRelease | null> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const params = new URLSearchParams();
  if (input.token) params.set("token", input.token);
  else if (input.consumerKey && input.consumerSecret) {
    params.set("key", input.consumerKey);
    params.set("secret", input.consumerSecret);
  }
  await input.throttle.acquire(input.signal);
  const res = await fetchImpl(`${API_BASE}/releases/${input.releaseId}?${params.toString()}`, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: input.signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw classifyError(res.status, await safeText(res));
  return (await res.json()) as DiscogsRelease;
}
```

- [ ] **Step 5: Implement `parseDiscogs.ts`**

```ts
import type { DiscogsCredit, DiscogsRelease } from "../discogs/client";
import { instrumentFamily } from "./instrumentFamily";
import type { CreditFact, FactGroup, FactSource } from "./types";

const ROLE_GROUPS: ReadonlyArray<readonly [RegExp, FactGroup]> = [
  [/^(written|composed|lyrics|songwriter|music by|words by)/i, "writer"],
  [/^(co-)?produc/i, "producer"],
  [/(engineer|mixed|mastered|recorded|mixing|mastering)/i, "engineer"],
];

const BRACKETS = /\s*\[[^\]]*\]/g;

/** "Saxophone [Tenor], Flute" → ["Saxophone", "Flute"]. Brackets go first so their commas don't split. */
function splitRoles(role: string): string[] {
  return role.replace(BRACKETS, "").split(",").map((part) => part.trim()).filter(Boolean);
}

function groupFor(role: string): FactGroup | null {
  for (const [pattern, group] of ROLE_GROUPS) if (pattern.test(role)) return group;
  return instrumentFamily(role) === null ? null : "performer";
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function creditFacts(credit: DiscogsCredit, scope: "track" | "album", source: FactSource): CreditFact[] {
  if (!credit.name || !credit.role) return [];
  const personKey = credit.id ? `discogs:${credit.id}` : undefined;
  return splitRoles(credit.role).flatMap((role) => {
    const group = groupFor(role);
    return group === null ? [] : [{ group, role, value: credit.name!, personKey, scope, sources: [source] }];
  });
}

function namesPosition(tracks: string | undefined, position: string | undefined): boolean {
  if (!tracks || !position) return false;
  return tracks.split(/[,&]/).map((part) => part.trim()).includes(position);
}

export function parseDiscogsRelease(json: DiscogsRelease, trackTitle: string, fetchedAt: number): { facts: CreditFact[]; styles: string[]; year?: number } {
  const source: FactSource = { source: "discogs", sourceUrl: json.uri ?? `https://www.discogs.com/release/${json.id}`, sourceRef: String(json.id), fetchedAt };
  const ourTrack = (json.tracklist ?? []).find((track) => slug(track.title ?? "") === slug(trackTitle));
  const trackCredits = (ourTrack?.extraartists ?? []).flatMap((credit) => creditFacts(credit, "track", source));
  const releaseCredits = (json.extraartists ?? []).flatMap((credit) =>
    creditFacts(credit, namesPosition(credit.tracks, ourTrack?.position) ? "track" : "album", source));
  return { facts: [...trackCredits, ...releaseCredits], styles: json.styles ?? [], year: json.year || undefined };
}
```

ponytail note for the implementer: `tracks` ranges like "A1 to A3" are treated as not naming us (album scope). That's the safe direction: no false cue tags.

- [ ] **Step 6: Implement `genius/client.ts`**

```ts
import type { Throttle } from "../throttle";
import type { FetchLike } from "../types";

const API_BASE = "https://api.genius.com";

export class GeniusError extends Error {
  constructor(public readonly code: "rate_limited" | "upstream_5xx" | "other", public readonly status: number, message: string) {
    super(message);
    this.name = "GeniusError";
  }
}

export interface GeniusSong {
  id: number; url: string; title: string;
  primary_artist?: { id?: number; name?: string };
  producer_artists?: { id?: number; name?: string }[];
  writer_artists?: { id?: number; name?: string }[];
  song_relationships?: { relationship_type: string; songs: { id?: number; title?: string; primary_artist?: { name?: string } }[] }[];
}

interface GeniusAuthInput { readonly token: string; readonly throttle: Throttle; readonly signal?: AbortSignal; readonly fetch?: FetchLike }

async function geniusGet<T>(path: string, input: GeniusAuthInput): Promise<T | null> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  await input.throttle.acquire(input.signal);
  const res = await fetchImpl(`${API_BASE}${path}`, { headers: { Accept: "application/json", Authorization: `Bearer ${input.token}` }, signal: input.signal });
  if (res.status === 404) return null;
  if (res.status === 429) throw new GeniusError("rate_limited", 429, "genius 429");
  if (res.status >= 500) throw new GeniusError("upstream_5xx", res.status, `genius ${res.status}`);
  if (!res.ok) throw new GeniusError("other", res.status, `genius ${res.status}`);
  return (await res.json()) as T;
}

/** Same folding as convex/matchKey.ts (artist + title, alnum only). Exact match only — a wrong song means wrong samples. */
function songKey(artist: string, title: string): string {
  const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(the|a|an)\b/g, "").replace(/[^a-z0-9]/g, "");
  return `${fold(artist)}::${fold(title)}`;
}

export async function searchGeniusSong(input: GeniusAuthInput & { readonly artist: string; readonly title: string }): Promise<number | null> {
  const json = await geniusGet<{ response?: { hits?: { type?: string; result?: { id: number; title?: string; primary_artist?: { name?: string } } }[] } }>(
    `/search?q=${encodeURIComponent(`${input.artist} ${input.title}`)}`, input);
  const wanted = songKey(input.artist, input.title);
  const hit = (json?.response?.hits ?? []).find((h) =>
    h.type === "song" && h.result !== undefined && songKey(h.result.primary_artist?.name ?? "", h.result.title ?? "") === wanted);
  return hit?.result?.id ?? null;
}

export async function fetchGeniusSong(input: GeniusAuthInput & { readonly songId: number }): Promise<GeniusSong | null> {
  const json = await geniusGet<{ response?: { song?: GeniusSong } }>(`/songs/${input.songId}?text_format=plain`, input);
  return json?.response?.song ?? null;
}
```

- [ ] **Step 7: Implement `parseGenius.ts`**

```ts
import type { GeniusSong } from "../genius/client";
import type { ConnectionRole, CreditFact, FactGroup, FactSource } from "./types";

/** Genius relationship → our fixed connection roles. Anything else (remix_of, translations…) is dropped. */
const RELATIONSHIP_ROLES: Record<string, ConnectionRole> = {
  samples: "samples", sampled_in: "sampled_by", interpolates: "interpolates", cover_of: "cover_of", covered_by: "covered_by",
};

function people(list: GeniusSong["producer_artists"], group: FactGroup, source: FactSource): CreditFact[] {
  return (list ?? []).filter((person) => person.name).map((person) => ({
    group, role: group, value: person.name!, personKey: person.id ? `genius:${person.id}` : undefined, scope: "track" as const, sources: [source],
  }));
}

function connections(song: GeniusSong, source: FactSource): CreditFact[] {
  return (song.song_relationships ?? []).flatMap((relationship) => {
    const role = RELATIONSHIP_ROLES[relationship.relationship_type];
    if (role === undefined) return [];
    return relationship.songs.filter((linked) => linked.title).map((linked) => {
      const artist = linked.primary_artist?.name;
      return { group: "connection" as const, role, value: `${artist ?? "Unknown"} – ${linked.title}`, linkedRecording: { title: linked.title!, artist }, scope: "track" as const, sources: [source] };
    });
  });
}

/** Whitelist parser: reads only credit + relationship fields, never embed_content/description/annotations (lyrics). */
export function parseGeniusSong(song: GeniusSong, fetchedAt: number): CreditFact[] {
  const source: FactSource = { source: "genius", sourceUrl: song.url, sourceRef: String(song.id), fetchedAt };
  return [...people(song.producer_artists, "producer", source), ...people(song.writer_artists, "writer", source), ...connections(song, source)];
}
```

- [ ] **Step 8: Run tests**

Run: `cd packages/enrichment && bun test test/credits/ test/discogs/`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/enrichment/src/discogs/client.ts packages/enrichment/src/genius packages/enrichment/src/credits/parseDiscogs.ts packages/enrichment/src/credits/parseGenius.ts packages/enrichment/test/credits
git commit -m "feat(enrichment): Discogs release credits and Genius relationships (no lyrics)"
```

---

### Task 7: `collectTrackCredits` orchestrator

**Files:**
- Create: `packages/enrichment/src/credits/collect.ts`
- Test: `packages/enrichment/test/credits/collect.test.ts`

**Interfaces:**
- Consumes: Tasks 4–6, plus existing `searchRecording` (MB fuzzy) and `searchRelease` (Discogs).
- Produces: `collectTrackCredits(track: TrackForCredits, deps: CollectDeps): Promise<TrackCreditsResult>` with `CollectDeps = { mbThrottle, discogsThrottle, geniusThrottle, discogsAuth: DiscogsAuth, geniusToken?: string, fetch?: FetchLike, now?: () => number }`

Rules:
- Recording id: stored → ISRC → fuzzy search (score ≥90). `via` drives confidence.
- Each source is isolated. A `rate_limited`/`upstream_5xx` from **any** source makes the whole result `creditsStatus: "error"` (mutation keeps old facts). Other errors are recorded in `problems`, and that source contributes nothing.
- `found` = at least one fact; `none` = no facts and no transient error.

- [ ] **Step 1: Write the failing tests**

`collect.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { collectTrackCredits } from "../../src/credits/collect";
import { createThrottle } from "../../src/throttle";
import { createMockFetch } from "../fetch-mock";
import isrcHit from "./fixtures/mb-isrc.json";
import relations from "./fixtures/mb-relations.json";
import release from "./fixtures/discogs-release.json";
import geniusSearch from "./fixtures/genius-search.json";
import geniusSong from "./fixtures/genius-song.json";

const fast = () => createThrottle({ ratePerSec: 1000 });
const track = { trackId: "t1", artist: "Ezra Collective", title: "Victory Dance", album: "You Can't Steal My Joy", isrc: "GBBKS2000152", recordingMbid: null, hasAppleMatch: true };
const deps = (fetch: ReturnType<typeof createMockFetch>["fetch"], geniusToken?: string) =>
  ({ mbThrottle: fast(), discogsThrottle: fast(), geniusThrottle: fast(), discogsAuth: { token: "d" }, geniusToken, fetch, now: () => 1000 });

describe("collectTrackCredits", () => {
  test("ISRC path, all three sources, merged facts and tags", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: isrcHit });                                   // MB isrc
    mock.enqueue({ status: 200, body: relations });                                 // MB relations
    mock.enqueue({ status: 200, body: { results: [{ id: 13579, type: "release", title: "x", label: [] }] } }); // Discogs search
    mock.enqueue({ status: 200, body: release });                                   // Discogs release
    mock.enqueue({ status: 200, body: geniusSearch });                              // Genius search
    mock.enqueue({ status: 200, body: geniusSong });                                // Genius song
    const result = await collectTrackCredits(track, deps(mock.fetch, "g"));
    expect(result.creditsStatus).toBe("found");
    expect(result.recordingMbid).toBe("rec-studio");
    expect(result.matchConfidence).toBe("high");
    expect(result.releaseYear).toBe(2019);
    expect(result.cueTags).toContain("horns");
    expect(result.cueTags).toContain("afrobeat");
    const producer = result.facts.find((fact) => fact.value === "Producer Person");
    expect(producer?.sources.map((s) => s.source).sort()).toEqual(["genius", "musicbrainz"]);
  });

  test("no Genius token → Genius skipped, not failed", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: isrcHit });
    mock.enqueue({ status: 200, body: relations });
    mock.enqueue({ status: 200, body: { results: [] } });
    const result = await collectTrackCredits(track, deps(mock.fetch));
    expect(result.creditsStatus).toBe("found");
    expect(mock.calls.some((call) => call.url.includes("genius"))).toBe(false);
  });

  test("MusicBrainz 503 twice → error status (keeps old facts upstream)", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 503, headers: { "Retry-After": "0" } });
    mock.enqueue({ status: 503, headers: { "Retry-After": "0" } });
    mock.enqueue({ status: 200, body: { results: [] } });
    const result = await collectTrackCredits(track, deps(mock.fetch));
    expect(result.creditsStatus).toBe("error");
  });

  test("nothing anywhere → none", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 404, body: {} });                          // ISRC unknown
    mock.enqueue({ status: 200, body: { recordings: [] } });          // fuzzy search empty
    mock.enqueue({ status: 200, body: { results: [] } });             // Discogs empty
    const result = await collectTrackCredits(track, deps(mock.fetch));
    expect(result.creditsStatus).toBe("none");
    expect(result.matchConfidence).toBe("low");
  });
});
```

Note on the 503 test: `mbGetJson` sleeps `max(1, Retry-After)` seconds once, so this test takes ~1 s. That's acceptable; don't add a sleep seam just for it.

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/enrichment && bun test test/credits/collect.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `collect.ts`**

```ts
import type { DiscogsAuth } from "../discogs/client";
import { fetchRelease, searchRelease } from "../discogs/client";
import { fetchGeniusSong, searchGeniusSong } from "../genius/client";
import { fetchRecordingRelations, lookupRecordingByIsrc, searchRecording } from "../musicbrainz/client";
import type { Throttle } from "../throttle";
import type { FetchLike } from "../types";
import { deriveCueTags, deriveMatchConfidence, mergeFacts } from "./merge";
import { parseDiscogsRelease } from "./parseDiscogs";
import { parseGeniusSong } from "./parseGenius";
import { parseMusicBrainzRelations } from "./parseMusicBrainz";
import type { CreditFact, RecordingVia, TrackCreditsResult, TrackForCredits } from "./types";

const MIN_SEARCH_SCORE = 90;
const TRANSIENT_CODES = new Set(["rate_limited", "upstream_5xx"]);

export interface CollectDeps {
  readonly mbThrottle: Throttle;
  readonly discogsThrottle: Throttle;
  readonly geniusThrottle: Throttle;
  readonly discogsAuth: DiscogsAuth;
  readonly geniusToken?: string;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
}

interface SourceOutcome { facts: CreditFact[]; styles?: string[]; year?: number; recordingMbid?: string; via?: RecordingVia }

function isTransient(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code !== undefined && TRANSIENT_CODES.has(code);
}

async function resolveRecording(track: TrackForCredits, deps: CollectDeps): Promise<{ mbid: string; via: RecordingVia } | null> {
  if (track.recordingMbid) return { mbid: track.recordingMbid, via: "stored" };
  const common = { throttle: deps.mbThrottle, fetch: deps.fetch };
  if (track.isrc) {
    const mbid = await lookupRecordingByIsrc({ ...common, isrc: track.isrc, title: track.title });
    if (mbid) return { mbid, via: "isrc" };
  }
  const best = (await searchRecording({ ...common, artist: track.artist, title: track.title }))[0];
  return best && best.score >= MIN_SEARCH_SCORE ? { mbid: best.recordingMbid, via: "search" } : null;
}

async function fromMusicBrainz(track: TrackForCredits, deps: CollectDeps, fetchedAt: number): Promise<SourceOutcome> {
  const recording = await resolveRecording(track, deps);
  if (recording === null) return { facts: [] };
  const json = await fetchRecordingRelations({ recordingMbid: recording.mbid, throttle: deps.mbThrottle, fetch: deps.fetch });
  const parsed = json ? parseMusicBrainzRelations(json, fetchedAt) : { facts: [] };
  return { ...parsed, year: parsed.releaseYear, recordingMbid: recording.mbid, via: recording.via };
}

async function fromDiscogs(track: TrackForCredits, deps: CollectDeps, fetchedAt: number): Promise<SourceOutcome> {
  if (!track.album) return { facts: [] };
  const common = { ...deps.discogsAuth, throttle: deps.discogsThrottle, fetch: deps.fetch };
  const hit = (await searchRelease({ ...common, artist: track.artist, album: track.album }))[0];
  const json = hit ? await fetchRelease({ ...common, releaseId: hit.discogsReleaseId }) : null;
  return json ? parseDiscogsRelease(json, track.title, fetchedAt) : { facts: [] };
}

async function fromGenius(track: TrackForCredits, deps: CollectDeps, fetchedAt: number): Promise<SourceOutcome> {
  if (!deps.geniusToken) return { facts: [] };
  const common = { token: deps.geniusToken, throttle: deps.geniusThrottle, fetch: deps.fetch };
  const songId = await searchGeniusSong({ ...common, artist: track.artist, title: track.title });
  const song = songId === null ? null : await fetchGeniusSong({ ...common, songId });
  return { facts: song ? parseGeniusSong(song, fetchedAt) : [] };
}
```

Continue in the same file:

```ts
type Settled = { outcome: SourceOutcome } | { transient: true } | { problem: string };

async function settle(name: string, run: () => Promise<SourceOutcome>): Promise<Settled> {
  try {
    return { outcome: await run() };
  } catch (err) {
    if (isTransient(err)) return { transient: true };
    return { problem: `${name}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function assemble(track: TrackForCredits, settled: Settled[]): TrackCreditsResult {
  const outcomes = settled.flatMap((s) => ("outcome" in s ? [s.outcome] : []));
  const problems = settled.flatMap((s) => ("problem" in s ? [s.problem] : []));
  const mb = outcomes.find((o) => o.recordingMbid !== undefined);
  const facts = mergeFacts(outcomes.flatMap((o) => o.facts));
  const releaseYear = mb?.year ?? outcomes.find((o) => o.year !== undefined)?.year;
  const styles = outcomes.flatMap((o) => o.styles ?? []);
  const transient = settled.some((s) => "transient" in s);
  return {
    creditsStatus: transient ? "error" : facts.length > 0 ? "found" : "none",
    facts,
    cueTags: deriveCueTags({ facts, releaseYear, styles }),
    recordingMbid: mb?.recordingMbid,
    releaseYear,
    matchConfidence: deriveMatchConfidence(mb?.via ?? null, track.hasAppleMatch),
    problems,
  };
}

/** Slow path only: three rate-limited sources in parallel lanes (each source has its own throttle). */
export async function collectTrackCredits(track: TrackForCredits, deps: CollectDeps): Promise<TrackCreditsResult> {
  const fetchedAt = (deps.now ?? Date.now)();
  const settled = await Promise.all([
    settle("musicbrainz", () => fromMusicBrainz(track, deps, fetchedAt)),
    settle("discogs", () => fromDiscogs(track, deps, fetchedAt)),
    settle("genius", () => fromGenius(track, deps, fetchedAt)),
  ]);
  return assemble(track, settled);
}
```

**Mock-order caveat:** the three sources run in parallel, so the mock queue order in Step 1 depends on scheduling. If the "all three sources" test is flaky, make `createMockFetch` routing-aware for this test file only. Wrap it in a local `routeByUrl` helper that keeps one queue per host (`musicbrainz.org`, `api.discogs.com`, `api.genius.com`) and enqueue per host. Don't serialize production code to fit a test.

- [ ] **Step 4: Run tests**

Run: `cd packages/enrichment && bun test test/credits/collect.test.ts`
Expected: all PASS.

- [ ] **Step 5: Export from the package index and commit**

Add to `packages/enrichment/src/index.ts`:

```ts
export { collectTrackCredits } from "./credits/collect";
export type { CollectDeps } from "./credits/collect";
export type { CreditFact, TrackCreditsResult, TrackForCredits } from "./credits/types";
```

Run: `cd packages/enrichment && bun test && bun run typecheck`
Expected: all PASS, exit 0.

```bash
git add packages/enrichment/src/credits/collect.ts packages/enrichment/src/index.ts packages/enrichment/test/credits/collect.test.ts
git commit -m "feat(enrichment): collectTrackCredits orchestrator across MB, Discogs, Genius"
```

---

### Task 8: Credits phase in the Trigger.dev job

**Files:**
- Create: `src/trigger/enrich-credits.ts`
- Modify: `src/trigger/enrich-pending-plays.ts` (the `run` of `enrichPendingPlays`, ~lines 180-219)
- Test: `src/trigger/enrich-credits.test.ts`

**Interfaces:**
- Consumes: `api.credits.tracksNeedingCredits`, `api.credits.writeTrackCredits` (Task 3); `collectTrackCredits` (Task 7).
- Produces: `enrichCreditsBatch(deps: CreditsBatchDeps): Promise<CreditsSummary>`, where `CreditsSummary = { attempted: number; found: number; none: number; errored: number; crashed: number }`.

- [ ] **Step 1: Write the failing test**

`src/trigger/enrich-credits.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { enrichCreditsBatch } from "./enrich-credits";

const row = (id: string) => ({ trackId: id, artist: "A", title: id, album: null, isrc: null, recordingMbid: null, hasAppleMatch: false });

function fakeClient(rows: ReturnType<typeof row>[]) {
  const writes: unknown[] = [];
  return {
    writes,
    query: async () => rows,
    mutation: async (_ref: unknown, args: unknown) => { writes.push(args); return null; },
  };
}

describe("enrichCreditsBatch", () => {
  test("writes one result per track and counts statuses", async () => {
    const client = fakeClient([row("t1"), row("t2")]);
    const summary = await enrichCreditsBatch({
      client: client as never,
      deadlineMs: Number.POSITIVE_INFINITY,
      now: () => 0,
      collect: async (track) => ({ creditsStatus: track.trackId === "t1" ? "found" : "none", facts: [], cueTags: [], matchConfidence: "low", problems: [] }),
    });
    expect(summary).toEqual({ attempted: 2, found: 1, none: 1, errored: 0, crashed: 0 });
    expect(client.writes).toHaveLength(2);
  });

  test("stops at the deadline", async () => {
    const client = fakeClient([row("t1"), row("t2")]);
    let clock = 0;
    const summary = await enrichCreditsBatch({
      client: client as never, deadlineMs: 5, now: () => clock,
      collect: async () => { clock += 10; return { creditsStatus: "none", facts: [], cueTags: [], matchConfidence: "low", problems: [] }; },
    });
    expect(summary.attempted).toBe(1);
  });

  test("a crash on one track doesn't stop the batch", async () => {
    const client = fakeClient([row("t1"), row("t2")]);
    const summary = await enrichCreditsBatch({
      client: client as never, deadlineMs: Number.POSITIVE_INFINITY, now: () => 0,
      collect: async (track) => { if (track.trackId === "t1") throw new Error("boom"); return { creditsStatus: "found", facts: [], cueTags: [], matchConfidence: "high", problems: [] }; },
    });
    expect(summary).toMatchObject({ attempted: 2, crashed: 1, found: 1 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/trigger/enrich-credits.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `enrich-credits.ts`**

```ts
import type { ConvexHttpClient } from "convex/browser";
import type { TrackCreditsResult, TrackForCredits } from "../../packages/enrichment/src/credits/types";
import { api } from "../../packages/convex/convex/_generated/api.js";
import type { Id } from "../../packages/convex/convex/_generated/dataModel";

/** Tracks fetched per credits phase; the deadline usually ends the loop first. */
export const CREDITS_BATCH = 30;

export interface CreditsSummary { attempted: number; found: number; none: number; errored: number; crashed: number }

export interface CreditsBatchDeps {
  readonly client: Pick<ConvexHttpClient, "query" | "mutation">;
  readonly deadlineMs: number;
  readonly now?: () => number;
  readonly collect: (track: TrackForCredits) => Promise<TrackCreditsResult>;
  readonly log?: (msg: string) => void;
}

async function writeResult(client: CreditsBatchDeps["client"], trackId: string, result: TrackCreditsResult) {
  await client.mutation(api.credits.writeTrackCredits, {
    trackId: trackId as Id<"tracks">,
    creditsStatus: result.creditsStatus,
    facts: result.facts.map((fact) => ({ ...fact, sources: [...fact.sources] })),
    cueTags: result.cueTags,
    recordingMbid: result.recordingMbid,
    releaseYear: result.releaseYear,
    matchConfidence: result.matchConfidence,
  });
}

/** Time-boxed credits loop; runs after the plays batch inside the same job so MB's 1 req/s throttle is shared. */
export async function enrichCreditsBatch(deps: CreditsBatchDeps): Promise<CreditsSummary> {
  const now = deps.now ?? Date.now;
  const summary: CreditsSummary = { attempted: 0, found: 0, none: 0, errored: 0, crashed: 0 };
  const tracks = (await deps.client.query(api.credits.tracksNeedingCredits, { limit: CREDITS_BATCH })) as TrackForCredits[];
  for (const track of tracks) {
    if (now() >= deps.deadlineMs) break;
    summary.attempted += 1;
    try {
      const result = await deps.collect(track);
      await writeResult(deps.client, track.trackId, result);
      summary[result.creditsStatus === "error" ? "errored" : result.creditsStatus] += 1;
      for (const problem of result.problems) deps.log?.(`[credits ${track.trackId}] ${problem}`);
    } catch (err) {
      summary.crashed += 1;
      deps.log?.(`[credits ${track.trackId}] crashed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary;
}
```

- [ ] **Step 4: Wire it into `enrichPendingPlays.run`**

In `src/trigger/enrich-pending-plays.ts`, add the imports:

```ts
import { collectTrackCredits } from "../../packages/enrichment/src/credits/collect";
import { enrichCreditsBatch } from "./enrich-credits";
```

Add the constants near `PENDING_BATCH`:

```ts
/** Stop credits work this long after the run starts so a 1-minute cron tick doesn't queue behind itself. */
const CREDITS_DEADLINE_MS = 50_000;
const GENIUS_RATE_PER_SEC = 2;
```

In `run`, capture `const runStartedAt = Date.now();` as the first line. Hoist the two throttles into variables so both phases share them:

```ts
    const mbThrottle = createThrottle({ ratePerSec: MB_RATE_PER_SEC });
    const discogsThrottle = createThrottle({ ratePerSec: DISCOGS_RATE_PER_SEC });
```

and pass `throttle: mbThrottle, discogsThrottle` into `enrichBatch`. After the existing summary logging and before `return summary;`:

```ts
    const credits = await enrichCreditsBatch({
      client,
      deadlineMs: runStartedAt + CREDITS_DEADLINE_MS,
      collect: (track) => collectTrackCredits(track, {
        mbThrottle,
        discogsThrottle,
        geniusThrottle: createThrottle({ ratePerSec: GENIUS_RATE_PER_SEC }),
        discogsAuth: { token: process.env.DISCOGS_TOKEN, consumerKey: process.env.DISCOGS_CONSUMER_KEY, consumerSecret: process.env.DISCOGS_CONSUMER_SECRET },
        geniusToken: process.env.GENIUS_ACCESS_TOKEN,
      }),
      log: (msg) => logger.warn(msg),
    });
    if (credits.attempted > 0) {
      logger.log(`Credits: ${credits.found} found, ${credits.none} none, ${credits.errored} errored, ${credits.crashed} crashed (of ${credits.attempted})`);
    }
```

Move `geniusThrottle` creation out of the per-track lambda into a `const geniusThrottle = createThrottle(...)` next to the other two. One throttle per run, not per track: a per-track throttle would never actually wait.

- [ ] **Step 5: Run all Trigger tests and the root suite**

Run: `bun test src/trigger/ && bun run typecheck`
Expected: all PASS (including the existing `trigger-batch.test.ts`), exit 0.

- [ ] **Step 6: Commit and open PR B**

```bash
git add src/trigger/enrich-credits.ts src/trigger/enrich-credits.test.ts src/trigger/enrich-pending-plays.ts
git commit -m "feat(trigger): credits phase in enrich-pending-plays (starts the facts backfill)"
git push
gh pr create --title "feat(trigger): music credits backfill (MB + Discogs + Genius)" --body "PR B of docs/superpowers/plans/2026-10-04-music-recall-tier1-facts.md. Requires PR A deployed and GENIUS_ACCESS_TOKEN set in Trigger.dev prod.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

**Before merging (Tarik):** set `GENIUS_ACCESS_TOKEN` in Trigger.dev → project → Environment Variables → Production.

**After deploy, verify the backfill is moving (read-only):**

Run: `cd packages/convex && bunx convex data facts --limit 5`
Expected: rows with `sources` arrays within ~2 minutes of the first post-deploy cron tick. Trigger.dev run logs show `Credits: N found …`. Re-check after an hour: `bunx convex data tracks --limit 50` should show growing `creditsStatus` coverage.

---

### Task 9: Recall helpers (pure)

**Files:**
- Create: `packages/convex/convex/recall.ts`
- Test: `packages/convex/test/recall.test.ts`

**Interfaces:**
- Produces:
  - `type RecallStatus = "ok" | "options" | "cues_unchecked" | "no_spins"`
  - `interface SpinForRecall { playId: string; playedAt: number; durationSec: number | null; cueTags: readonly string[]; hidden: boolean }`
  - `rankSpins(spins: readonly SpinForRecall[], cues: readonly string[], windowMid: number): RankedSpin[]`, where `RankedSpin = SpinForRecall & { matchedCues: string[] }`
  - `chooseRecallStatus(ranked: readonly RankedSpin[], cues: readonly string[], windowMid: number): RecallStatus`
  - `neighborSpin(spinsByTimeAsc: readonly SpinForRecall[], anchorPlayId: string, direction: "before" | "after"): SpinForRecall | null`
  - `evidenceLevel(input: { resolved: boolean; matchConfidence?: "high" | "low"; trackScopeFactCount: number }): "rich" | "basic" | "none"`
  - `MAX_MATCHES = 3`

- [ ] **Step 1: Write the failing tests**

`packages/convex/test/recall.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { chooseRecallStatus, evidenceLevel, neighborSpin, rankSpins, type SpinForRecall } from "../convex/recall";

const MIN = 60_000;
const spin = (playId: string, minute: number, cueTags: string[] = [], extra: Partial<SpinForRecall> = {}): SpinForRecall =>
  ({ playId, playedAt: minute * MIN, durationSec: 240, cueTags, hidden: false, ...extra });

describe("rankSpins + chooseRecallStatus", () => {
  test("cue match wins over time closeness → ok", () => {
    const ranked = rankSpins([spin("a", 10), spin("b", 30, ["horns"])], ["horns"], 10 * MIN);
    expect(ranked[0]?.playId).toBe("b");
    expect(ranked[0]?.matchedCues).toEqual(["horns"]);
    expect(chooseRecallStatus(ranked, ["horns"], 10 * MIN)).toBe("ok");
  });
  test("two spins tie on cues → options", () => {
    const ranked = rankSpins([spin("a", 10, ["horns"]), spin("b", 20, ["horns"])], ["horns"], 15 * MIN);
    expect(chooseRecallStatus(ranked, ["horns"], 15 * MIN)).toBe("options");
  });
  test("cues asked but nobody in the window has tags → cues_unchecked, time-ranked", () => {
    const ranked = rankSpins([spin("a", 10), spin("b", 14)], ["horns"], 15 * MIN);
    expect(ranked[0]?.playId).toBe("b");
    expect(chooseRecallStatus(ranked, ["horns"], 15 * MIN)).toBe("cues_unchecked");
  });
  test("no cues, the midpoint falls inside one spin → ok", () => {
    const ranked = rankSpins([spin("a", 10), spin("b", 14)], [], 15 * MIN);
    expect(chooseRecallStatus(ranked, [], 15 * MIN)).toBe("ok");
  });
  test("no cues, midpoint in a gap → options", () => {
    const ranked = rankSpins([spin("a", 10, [], { durationSec: 60 }), spin("b", 20)], [], 15 * MIN);
    expect(chooseRecallStatus(ranked, [], 15 * MIN)).toBe("options");
  });
  test("hidden spins never rank; empty → no_spins", () => {
    const ranked = rankSpins([spin("a", 10, [], { hidden: true })], [], 10 * MIN);
    expect(ranked).toHaveLength(0);
    expect(chooseRecallStatus(ranked, [], 10 * MIN)).toBe("no_spins");
  });
});

describe("neighborSpin", () => {
  const spins = [spin("a", 1), spin("id", 5, [], { hidden: true }), spin("c", 9)];
  test("the one before skips station IDs / deleted plays", () => expect(neighborSpin(spins, "c", "before")?.playId).toBe("a"));
  test("the one after", () => expect(neighborSpin(spins, "a", "after")?.playId).toBe("c"));
  test("edge → null", () => expect(neighborSpin(spins, "a", "before")).toBeNull());
});

describe("evidenceLevel", () => {
  test("rich needs 3 track facts and high confidence", () => {
    expect(evidenceLevel({ resolved: true, matchConfidence: "high", trackScopeFactCount: 3 })).toBe("rich");
    expect(evidenceLevel({ resolved: true, matchConfidence: "low", trackScopeFactCount: 9 })).toBe("basic");
    expect(evidenceLevel({ resolved: false, trackScopeFactCount: 0 })).toBe("none");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/convex && bun test test/recall.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `recall.ts`**

```ts
export type RecallStatus = "ok" | "options" | "cues_unchecked" | "no_spins";

export const MAX_MATCHES = 3;
const RICH_MIN_TRACK_FACTS = 3;
/** Used when a spin has no duration: a typical song length. */
const FALLBACK_DURATION_SEC = 210;

export interface SpinForRecall {
  readonly playId: string;
  readonly playedAt: number;
  readonly durationSec: number | null;
  readonly cueTags: readonly string[];
  /** ignored (station IDs, promos) or soft-deleted — never a match, never a neighbor. */
  readonly hidden: boolean;
}

export type RankedSpin = SpinForRecall & { readonly matchedCues: string[] };

function distance(spin: SpinForRecall, windowMid: number): number {
  return Math.abs(spin.playedAt - windowMid);
}

/** Cue matches first, then closeness to the middle of the asked-about window. */
export function rankSpins(spins: readonly SpinForRecall[], cues: readonly string[], windowMid: number): RankedSpin[] {
  const wanted = cues.map((cue) => cue.toLowerCase());
  return spins
    .filter((spin) => !spin.hidden)
    .map((spin) => ({ ...spin, matchedCues: wanted.filter((cue) => spin.cueTags.includes(cue)) }))
    .sort((a, b) => b.matchedCues.length - a.matchedCues.length || distance(a, windowMid) - distance(b, windowMid));
}

function coversMoment(spin: SpinForRecall, moment: number): boolean {
  const end = spin.playedAt + (spin.durationSec ?? FALLBACK_DURATION_SEC) * 1000;
  return spin.playedAt <= moment && moment < end;
}

export function chooseRecallStatus(ranked: readonly RankedSpin[], cues: readonly string[], windowMid: number): RecallStatus {
  const [top, second] = ranked;
  if (top === undefined) return "no_spins";
  if (cues.length > 0) {
    if (ranked.every((spin) => spin.cueTags.length === 0)) return "cues_unchecked";
    const clearWinner = top.matchedCues.length > 0 && (second === undefined || top.matchedCues.length > second.matchedCues.length);
    return clearWinner ? "ok" : "options";
  }
  return ranked.length === 1 || coversMoment(top, windowMid) ? "ok" : "options";
}

export function neighborSpin(spinsByTimeAsc: readonly SpinForRecall[], anchorPlayId: string, direction: "before" | "after"): SpinForRecall | null {
  const visible = spinsByTimeAsc.filter((spin) => !spin.hidden || spin.playId === anchorPlayId);
  const index = visible.findIndex((spin) => spin.playId === anchorPlayId);
  if (index === -1) return null;
  return visible[direction === "before" ? index - 1 : index + 1] ?? null;
}

export function evidenceLevel(input: { resolved: boolean; matchConfidence?: "high" | "low"; trackScopeFactCount: number }): "rich" | "basic" | "none" {
  if (!input.resolved) return "none";
  return input.matchConfidence === "high" && input.trackScopeFactCount >= RICH_MIN_TRACK_FACTS ? "rich" : "basic";
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/convex && bun test test/recall.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/convex/convex/recall.ts packages/convex/test/recall.test.ts
git commit -m "feat(convex): recall ranking, status, neighbor and evidence helpers"
```

---

### Task 10: Upcoming shows by metro + fan-out fix

**Files:**
- Create: `packages/convex/convex/showsByMetro.ts`
- Modify: `packages/convex/convex/plays.ts:404-500` (`findLiveEventForArtist` region)
- Test: `packages/convex/test/showsByMetro.test.ts`

**Interfaces:**
- Produces:
  - `METROS` (Milwaukee, Madison, Chicago with lat/lng), `nearestMetro(lat: number | undefined, lng: number | undefined, city: string): string`
  - `pickShowsByMetro<T extends { startsAt: number; latitude?: number; longitude?: number; city: string }>(sortedByDate: readonly T[], max?: number): Array<T & { metro: string }>`
  - in `plays.ts`: `upcomingShowsByMetro(ctx: QueryCtx, artistName: string): Promise<Array<LiveEventSummary & { metro: string }>>`; `findLiveEventForArtist` keeps its signature and behavior.

- [ ] **Step 1: Write the failing tests**

`packages/convex/test/showsByMetro.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { nearestMetro, pickShowsByMetro } from "../convex/showsByMetro";

describe("nearestMetro", () => {
  test("suburbs go to their metro", () => {
    expect(nearestMetro(42.0451, -87.6877, "Evanston")).toBe("Chicago");
    expect(nearestMetro(43.0117, -88.2315, "Waukesha")).toBe("Milwaukee");
    expect(nearestMetro(43.0731, -89.4012, "Madison")).toBe("Madison");
  });
  test("no coordinates → city name", () => expect(nearestMetro(undefined, undefined, "Kohler")).toBe("Kohler"));
});

describe("pickShowsByMetro", () => {
  const show = (city: string, day: number, lat: number, lng: number) => ({ city, startsAt: day * 86_400_000, latitude: lat, longitude: lng });
  test("Chicago next week and Milwaukee next month → both, date order, one per metro", () => {
    const picked = pickShowsByMetro([
      show("Chicago", 7, 41.88, -87.63),
      show("Evanston", 9, 42.05, -87.69),
      show("Milwaukee", 30, 43.04, -87.91),
    ]);
    expect(picked.map((p) => [p.city, p.metro])).toEqual([["Chicago", "Chicago"], ["Milwaukee", "Milwaukee"]]);
  });
  test("caps at max", () => {
    const many = [show("Chicago", 1, 41.88, -87.63), show("Milwaukee", 2, 43.04, -87.91), show("Madison", 3, 43.07, -89.4), show("Kohler", 4, 43.74, -87.78)];
    expect(pickShowsByMetro(many, 3)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/convex && bun test test/showsByMetro.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `showsByMetro.ts`**

```ts
export const METROS = [
  { name: "Milwaukee", lat: 43.0389, lng: -87.9065 },
  { name: "Madison", lat: 43.0731, lng: -89.4012 },
  { name: "Chicago", lat: 41.8781, lng: -87.6298 },
] as const;

export const MAX_SHOWS = 3;

/** ponytail: squared-degree distance, not haversine — fine for picking among three metros ~80+ miles apart. */
export function nearestMetro(lat: number | undefined, lng: number | undefined, city: string): string {
  if (lat === undefined || lng === undefined) return city;
  const squaredDistance = (metro: (typeof METROS)[number]) => (metro.lat - lat) ** 2 + (metro.lng - lng) ** 2;
  return [...METROS].sort((a, b) => squaredDistance(a) - squaredDistance(b))[0]!.name;
}

/** Soonest show per metro, keeping date order. Input must already be sorted by startsAt ascending. */
export function pickShowsByMetro<T extends { startsAt: number; latitude?: number; longitude?: number; city: string }>(
  sortedByDate: readonly T[],
  max: number = MAX_SHOWS,
): Array<T & { metro: string }> {
  const seen = new Set<string>();
  const picked: Array<T & { metro: string }> = [];
  for (const show of sortedByDate) {
    const metro = nearestMetro(show.latitude, show.longitude, show.city);
    if (seen.has(metro)) continue;
    seen.add(metro);
    picked.push({ ...show, metro });
    if (picked.length >= max) break;
  }
  return picked;
}
```

- [ ] **Step 4: Refactor `plays.ts` to share candidate gathering**

Replace the body region of `findLiveEventForArtist` (`plays.ts` ~437-500) with three functions. Keep the existing doc comment above `findLiveEventForArtist`, and append one line to it: "Past events are never pruned, so the fan-out reads newest-first."

```ts
const MAX_LOOKUP_FANOUT = 10;

type EventCandidate = { event: Doc<"events">; matchedArtistName: string; role: "headliner" | "support" };

/**
 * Upcoming, non-duplicate, non-cancelled events for an artist, soonest first.
 * ponytail: newest-created eventArtists rows first — past events are never
 * pruned (2,051 past vs 1,051 upcoming on 2026-10-04), so oldest-first could
 * fill the fan-out with dead shows. Prune past events if an artist ever
 * accumulates >10 rows created after their next show.
 */
async function upcomingEventsForArtist(ctx: QueryCtx, artistName: string): Promise<EventCandidate[]> {
  const artistKey = normalizeEventArtistKey(artistName);
  if (artistKey.length === 0) return [];
  const rows = await ctx.db
    .query("eventArtists")
    .withIndex("by_artist_key", (q) => q.eq("artistKey", artistKey))
    .order("desc")
    .take(MAX_LOOKUP_FANOUT);
  const now = Date.now();
  const events = await Promise.all(rows.map((row) => ctx.db.get(row.eventId)));
  const candidates = rows.flatMap((row, i) => {
    const event = events[i];
    if (!event || event.duplicateOf !== undefined || event.startsAt <= now) return [];
    if (event.status === "cancelled" || event.status === "postponed") return [];
    return [{ event, matchedArtistName: row.artistNameRaw, role: row.role }];
  });
  return candidates.sort((a, b) => a.event.startsAt - b.event.startsAt);
}

async function toLiveEventSummary(ctx: QueryCtx, candidate: EventCandidate): Promise<LiveEventSummary> {
  const { event } = candidate;
  const lineup = await ctx.db.query("eventArtists").withIndex("by_event", (q) => q.eq("eventId", event._id)).collect();
  return {
    eventId: event._id,
    title: event.title ?? null,
    artistName: candidate.matchedArtistName,
    role: candidate.role,
    venue: event.venueName,
    city: event.city,
    startsAtMs: event.startsAt,
    ticketUrl: event.ticketUrl ?? null,
    imageUrl: event.imageUrl ?? null,
    source: event.source,
    dateOnly: event.dateOnly === true,
    doorsAt: event.doorsAt ?? null,
    genre: event.genre ?? null,
    headliners: lineup.filter((a) => a.role === "headliner").map((a) => a.artistNameRaw),
    supports: lineup.filter((a) => a.role === "support").map((a) => a.artistNameRaw),
  };
}

async function findLiveEventForArtist(ctx: QueryCtx, artistDisplayName: string): Promise<LiveEventSummary | null> {
  const [soonest] = await upcomingEventsForArtist(ctx, artistDisplayName);
  return soonest === undefined ? null : toLiveEventSummary(ctx, soonest);
}

/** For Alexa: soonest show per metro (Milwaukee / Madison / Chicago), up to 3. */
export async function upcomingShowsByMetro(ctx: QueryCtx, artistName: string): Promise<Array<LiveEventSummary & { metro: string }>> {
  const candidates = await upcomingEventsForArtist(ctx, artistName);
  const flattened = candidates.map((c) => ({ ...c, startsAt: c.event.startsAt, latitude: c.event.latitude, longitude: c.event.longitude, city: c.event.city }));
  const picked = pickShowsByMetro(flattened);
  return Promise.all(picked.map(async (pick) => ({ ...(await toLiveEventSummary(ctx, pick)), metro: pick.metro })));
}
```

Add `import { pickShowsByMetro } from "./showsByMetro";`. If `LiveEventSummary` has an `eventId` field typed differently from the original return, keep the original field list. The block above mirrors the existing return object field-for-field; diff it against the original before deleting.

- [ ] **Step 5: Typecheck and run tests**

Run: `cd packages/convex && bun run typecheck && bun test test/`
Expected: exit 0, all PASS. The widget behavior is covered by keeping `findLiveEventForArtist`'s signature and "soonest" semantics. The only intended change is newest-first fan-out.

- [ ] **Step 6: Commit**

```bash
git add packages/convex/convex/showsByMetro.ts packages/convex/convex/plays.ts packages/convex/test/showsByMetro.test.ts
git commit -m "feat(convex): upcoming shows by metro; newest-first event fan-out"
```

---

### Task 11: Public Alexa queries

**Files:**
- Create: `packages/convex/convex/alexa.ts`
- Modify: `packages/convex/convex/_generated/api.d.ts` (register `alexa`, `recall`, `showsByMetro`)

**Interfaces:**
- Consumes: `rankSpins`, `chooseRecallStatus`, `neighborSpin`, `evidenceLevel`, `MAX_MATCHES` (Task 9); `upcomingShowsByMetro` (Task 10); `matchKey` (Task 1); `facts` + `tracks` fields (Task 2).
- Produces:
  - `api.alexa.findSongPlayed({ station, from, to, cues?, beforePlayId?, afterPlayId? })`
  - `api.alexa.getTrackFacts({ trackId?, playId? })`
  - `api.alexa.getTrackConnections({ trackId, limit? })`

- [ ] **Step 1: Write `alexa.ts`, part 1: shared loaders and `findSongPlayed`**

```ts
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { matchKey } from "./matchKey";
import { upcomingShowsByMetro } from "./plays";
import { chooseRecallStatus, evidenceLevel, MAX_MATCHES, neighborSpin, rankSpins, type SpinForRecall } from "./recall";

/** ~3 hours of spins at ~20/hour; bounds reads for a wide "this morning" window. */
const MAX_WINDOW_SPINS = 60;
const LOCAL_STATION_SLUG = "414music";
const stationSlug = v.union(v.literal("hyfin"), v.literal("88nine"), v.literal("414music"), v.literal("rhythmlab"));

type LoadedSpin = { play: Doc<"plays">; track: Doc<"tracks"> | null; recall: SpinForRecall };

async function loadSpins(ctx: QueryCtx, plays: Doc<"plays">[], isLocal: boolean): Promise<LoadedSpin[]> {
  const tracks = await Promise.all(plays.map((play) => (play.canonicalTrackId ? ctx.db.get(play.canonicalTrackId) : null)));
  return plays.map((play, i) => {
    const track = tracks[i] ?? null;
    const cueTags = [...(track?.cueTags ?? []), ...(isLocal ? ["local"] : [])];
    const hidden = play.enrichmentStatus === "ignored" || play.deletedAt !== undefined;
    return { play, track, recall: { playId: play._id, playedAt: play.playedAt, durationSec: play.durationSec ?? track?.durationSec ?? null, cueTags, hidden } };
  });
}

async function toMatch(ctx: QueryCtx, spin: LoadedSpin, label: string, matchedCues: string[]) {
  const artist = spin.track ? (await ctx.db.get(spin.track.artistId))?.displayName ?? spin.play.artistRaw : spin.play.artistRaw;
  const title = spin.track?.displayTitle ?? spin.play.titleRaw;
  return {
    label, playId: spin.play._id, artist, title, playedAt: spin.play.playedAt,
    trackId: spin.track?._id ?? null, matchKey: matchKey(artist, title), matchedCues,
    matchReason: matchedCues.length > 0 ? `tagged ${matchedCues.join(", ")}` : null,
    matchConfidence: spin.track?.matchConfidence ?? null, artworkUrl: spin.track?.artworkUrl ?? null, previewUrl: spin.track?.previewUrl ?? null,
    upcomingShows: await upcomingShowsByMetro(ctx, artist),
  };
}
```

Continue:

```ts
async function stationBySlug(ctx: QueryCtx, slug: string) {
  return ctx.db.query("stations").withIndex("by_slug", (q) => q.eq("slug", slug as Doc<"stations">["slug"])).first();
}

async function playsBetween(ctx: QueryCtx, stationId: Id<"stations">, from: number, to: number) {
  return ctx.db.query("plays")
    .withIndex("by_station_played_at", (q) => q.eq("stationId", stationId).gte("playedAt", from).lte("playedAt", to))
    .take(MAX_WINDOW_SPINS);
}

async function neighborMatch(ctx: QueryCtx, stationId: Id<"stations">, anchorId: Id<"plays">, direction: "before" | "after", isLocal: boolean) {
  const anchor = await ctx.db.get(anchorId);
  if (anchor === null || anchor.stationId !== stationId) return null;
  const HOUR = 3_600_000;
  const around = await playsBetween(ctx, stationId, anchor.playedAt - HOUR, anchor.playedAt + HOUR);
  const spins = await loadSpins(ctx, around, isLocal);
  const next = neighborSpin(spins.map((s) => s.recall), anchorId, direction);
  const loaded = next ? spins.find((s) => s.recall.playId === next.playId) : undefined;
  return loaded ? toMatch(ctx, loaded, "1", []) : null;
}

/**
 * Alexa: "what was that song on 88Nine around 8:15 / with the horns /
 * no, the one before that". Index reads only — no outside calls.
 */
export const findSongPlayed = query({
  args: { station: stationSlug, from: v.number(), to: v.number(), cues: v.optional(v.array(v.string())), beforePlayId: v.optional(v.id("plays")), afterPlayId: v.optional(v.id("plays")) },
  handler: async (ctx, args) => {
    const station = await stationBySlug(ctx, args.station);
    if (station === null) return { status: "unknown_station" as const, matches: [] };
    const isLocal = args.station === LOCAL_STATION_SLUG;
    const anchorId = args.beforePlayId ?? args.afterPlayId;
    if (anchorId !== undefined) {
      const match = await neighborMatch(ctx, station._id, anchorId, args.beforePlayId ? "before" : "after", isLocal);
      return { status: match ? ("ok" as const) : ("no_spins" as const), matches: match ? [match] : [] };
    }
    const cues = args.cues ?? [];
    const windowMid = (args.from + args.to) / 2;
    const spins = await loadSpins(ctx, await playsBetween(ctx, station._id, args.from, args.to), isLocal);
    const ranked = rankSpins(spins.map((s) => s.recall), cues, windowMid);
    const status = chooseRecallStatus(ranked, cues, windowMid);
    const top = ranked.slice(0, status === "ok" ? 1 : MAX_MATCHES);
    const matches = await Promise.all(top.map((r, i) => toMatch(ctx, spins.find((s) => s.recall.playId === r.playId)!, String(i + 1), r.matchedCues)));
    return { status, matches };
  },
});
```

`no_spins` nearest-spin hint: when `status === "no_spins"`, Radio Commons widens the window and calls again. That's one extra round trip instead of extra branching here. Document this in the tool description in Radio Commons.

- [ ] **Step 2: Write `alexa.ts`, part 2: `getTrackFacts`**

```ts
function groupFacts(facts: Doc<"facts">[]) {
  const grouped: Record<string, Array<Omit<Doc<"facts">, "_id" | "_creationTime" | "trackId">>> = {};
  for (const { _id, _creationTime, trackId, ...fact } of facts) (grouped[fact.group] ??= []).push(fact);
  return grouped;
}

async function trackBasics(ctx: QueryCtx, track: Doc<"tracks">) {
  const artist = (await ctx.db.get(track.artistId))?.displayName ?? "";
  return {
    artist, title: track.displayTitle, album: track.albumDisplayName ?? null, year: track.releaseYear ?? null,
    label: track.recordLabel ?? null, isrc: track.isrc ?? null, artworkUrl: track.artworkUrl ?? null, previewUrl: track.previewUrl ?? null,
  };
}

/** Alexa: "where does that sound come from / tell me about it". Unresolved plays answer with playlist basics. */
export const getTrackFacts = query({
  args: { trackId: v.optional(v.id("tracks")), playId: v.optional(v.id("plays")) },
  handler: async (ctx, args) => {
    const play = args.playId ? await ctx.db.get(args.playId) : null;
    const trackId = args.trackId ?? play?.canonicalTrackId;
    const track = trackId ? await ctx.db.get(trackId) : null;
    if (track === null) {
      if (play === null) return { status: "not_found" as const };
      const basics = { artist: play.artistRaw, title: play.titleRaw, album: play.albumRaw ?? null, year: null, label: play.labelRaw ?? null, isrc: null, artworkUrl: null, previewUrl: null };
      return { status: "ok" as const, trackId: null, ...basics, matchKey: matchKey(play.artistRaw, play.titleRaw), evidence: "none" as const, facts: {}, upcomingShows: await upcomingShowsByMetro(ctx, play.artistRaw) };
    }
    const facts = await ctx.db.query("facts").withIndex("by_track", (q) => q.eq("trackId", track._id)).collect();
    const basics = await trackBasics(ctx, track);
    const trackScopeFactCount = facts.filter((f) => f.scope === "track" && f.group !== "release").length;
    return {
      status: "ok" as const, trackId: track._id, ...basics, matchKey: matchKey(basics.artist, basics.title),
      evidence: evidenceLevel({ resolved: true, matchConfidence: track.matchConfidence, trackScopeFactCount }),
      facts: groupFacts(facts), upcomingShows: await upcomingShowsByMetro(ctx, basics.artist),
    };
  },
});
```

- [ ] **Step 3: Write `alexa.ts`, part 3: `getTrackConnections`**

```ts
const DEFAULT_CONNECTIONS = 5;
const MAX_PEOPLE_SCANNED = 10;
/** Caps a busy session player so one person can't blow the read budget. */
const MAX_TRACKS_PER_PERSON = 25;

async function lastPlayedAt(ctx: QueryCtx, trackId: Id<"tracks">): Promise<number | null> {
  const latest = await ctx.db.query("plays").withIndex("by_canonical_track", (q) => q.eq("canonicalTrackId", trackId)).order("desc").first();
  return latest?.playedAt ?? null;
}

async function sharedPeople(ctx: QueryCtx, trackId: Id<"tracks">, facts: Doc<"facts">[]) {
  const people = facts.filter((f) => f.personKey !== undefined).slice(0, MAX_PEOPLE_SCANNED);
  const found = await Promise.all(people.map(async (person) => {
    const others = await ctx.db.query("facts").withIndex("by_person", (q) => q.eq("personKey", person.personKey)).take(MAX_TRACKS_PER_PERSON);
    return Promise.all(others.filter((o) => o.trackId !== trackId).map(async (other) => {
      const played = await lastPlayedAt(ctx, other.trackId);
      const otherTrack = played === null ? null : await ctx.db.get(other.trackId);
      if (otherTrack === null || played === null) return null;
      const artist = (await ctx.db.get(otherTrack.artistId))?.displayName ?? "";
      return { kind: "shared_person" as const, person: person.value, role: person.role, otherRole: other.role,
        otherTrack: { trackId: otherTrack._id, artist, title: otherTrack.displayTitle }, lastPlayedAt: played };
    }));
  }));
  return found.flat().filter((c): c is NonNullable<typeof c> => c !== null);
}

async function sampleLinks(ctx: QueryCtx, facts: Doc<"facts">[]) {
  return Promise.all(facts.filter((f) => f.group === "connection").map(async (fact) => {
    const mbid = fact.linkedRecording?.mbid;
    const ours = mbid ? await ctx.db.query("tracks").withIndex("by_recording_mbid", (q) => q.eq("recordingMbid", mbid)).first() : null;
    const played = ours ? await lastPlayedAt(ctx, ours._id) : null;
    return { kind: "link" as const, role: fact.role, value: fact.value, linkedRecording: fact.linkedRecording ?? null, played: played !== null, lastPlayedAt: played, sources: fact.sources };
  }));
}

/** Station-only SongDNA: people on this track who are on other tracks we've played, plus samples/covers. */
export const getTrackConnections = query({
  args: { trackId: v.id("tracks"), limit: v.optional(v.number()) },
  handler: async (ctx, { trackId, limit }) => {
    const cap = limit ?? DEFAULT_CONNECTIONS;
    const facts = await ctx.db.query("facts").withIndex("by_track", (q) => q.eq("trackId", trackId)).collect();
    const byRecency = (a: { lastPlayedAt: number | null }, b: { lastPlayedAt: number | null }) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0);
    const people = (await sharedPeople(ctx, trackId, facts)).sort(byRecency).slice(0, cap);
    const links = (await sampleLinks(ctx, facts)).sort(byRecency).slice(0, cap);
    return { people, links };
  },
});
```

- [ ] **Step 4: Register modules in `_generated/api.d.ts`**

Add imports and `fullApi` entries for `alexa`, `recall`, `showsByMetro`, in the same style as Task 3 Step 2.

- [ ] **Step 5: Typecheck and run the full suites**

Run: `cd packages/convex && bun run typecheck && bun test test/` then from the repo root `bun run test`
Expected: exit 0, all PASS.

- [ ] **Step 6: Commit and open PR C**

```bash
git add packages/convex/convex/alexa.ts packages/convex/convex/_generated/api.d.ts
git commit -m "feat(convex): public Alexa queries — findSongPlayed, getTrackFacts, getTrackConnections"
git push
gh pr create --title "feat(convex): Alexa read API for song recall, track facts, connections" --body "PR C of docs/superpowers/plans/2026-10-04-music-recall-tier1-facts.md.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

**After deploy, verify against live data (read-only `convex run`):**

Run: `cd packages/convex && bunx convex run alexa:findSongPlayed '{"station":"88nine","from":<ms 8:00 today>,"to":<ms 8:30 today>}'`
Expected: `status` of `ok` or `options`, with real songs from that half-hour (cross-check against the dashboard playlist).

Run: `bunx convex run alexa:getTrackFacts '{"trackId":"<an id with creditsStatus found>"}'`
Expected: grouped facts, each with a non-empty `sources`.

Latency: from Radio Commons' host, time 20 calls of each query and record p50/p95 for the submission's latency table. Target: p95 well under 350 ms.

---

## Self-review notes

- **Spec coverage:**
  - §3.1 → Task 2
  - §3.2 → Tasks 2, 4
  - §3.3 → Task 4 (`local` moved to query time per correction 5)
  - §3.5 → Task 1 (via `matchKey`, correction 1)
  - §4.1–4.3 → Tasks 5–8
  - §5.1 → Tasks 9, 11
  - §5.2 → Task 11
  - §5.3 → Task 11
  - §5.4 → Task 10
  - §6 → Tasks 9, 11
  - §7 → tests in every task
- **Not in this plan (by design):** Radio Commons `playlist.ts` client and MCP tools, the Backstory `matchKey` copy, Finds (#2), game (#3), Tier 2 (#4).
- **Open, non-blocking:**
  - Discogs and Genius API terms.
  - A LICENSE file for `crate-cli` (no Crate code is copied in this plan; only field shapes informed the parsers).
