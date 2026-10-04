# Listener Memory + "What's new for me?" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Radio Commons remembers each linked listener (artists they follow, the last song list shown, their last visit), turns "save it" into one orchestrated answer across playlist, Finds, Apple Music, concerts and Backstory, and answers "what's new for me?" from that memory; plus 2-week artist search, a judges page, and a real-phrase eval script.

**Architecture:** Part A (rm-playlist-v2, Convex) adds three tables, two search indexes, pure-logic helpers, server-key-guarded functions, a Backstory-reading background action and a daily cron; it ships through CI (`Convex deploy`) before Part B uses it. Part B (radio-commons, Next.js 16 MCP server) adds client calls, tools, a digest card, after-response memory writes, the `/how-it-works` page, `docs/HACKATHON.md`, and `scripts/eval-turns.mjs`.

**Tech Stack:** Convex (bun test), Next.js 16.3 + mcp-handler + @modelcontextprotocol/server + ext-apps cards (vitest), zod 4, Clerk OAuth (already live).

**Spec:** `docs/superpowers/specs/2026-10-04-listener-memory-design.md` (rm-playlist-v2). Decision: `docs/decisions/009-listener-memory.md`.

## Global Constraints

- Convex deployment `precise-fish-444` is shared: **never** run `bunx convex dev`, `convex codegen` or `convex deploy`. Register new modules by hand in `packages/convex/convex/_generated/api.d.ts`. Schema/functions go live only through the CI `Convex deploy` workflow after merge to `main`.
- Every listener function: first `guard(serverKey)` (`assertServerKey(serverKey, process.env.RADIO_COMMONS_SERVER_KEY)`), then `assertListenerId(listenerId)` (both in `convex/listenerGuard.ts`).
- Never log tokens, keys, `listenerId`s, or `PlaylistUnavailable.cause`.
- Radio Commons playlist calls keep `timeoutMs = 350`; the digest call uses `1500`.
- Station slugs: `"88nine" | "hyfin" | "rhythmlab" | "414music"`.
- Every tool response must work voice-only; cards are additive.
- Spoken copy (verbatim): first follow → `I'll keep an eye out for {artist}`; Apple hint → `To add these to your Apple Music library too, connect it at radiomilwaukee.org slash connect.`; empty digest → `Nothing new from your artists yet — here's what the station's excited about.`; unknown artist → `I don't have {artist} in our playlist yet.`
- Screen memory lives 30 minutes (`SCREEN_TTL_MS = 30 * 60_000`), max 10 songs.
- Digest default window: last 7 days when the listener has never asked.
- rm-playlist checks: `cd packages/convex && bun test test/ && bun run typecheck`; root `bun run test`; `bunx prettier --check <changed files>`. radio-commons checks: `npm test`, `npm run typecheck`, `npm run lint`, `env -u NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY -u CLERK_SECRET_KEY npm run build`.

## Review Focus

1. A listener who said "stop following Thao" then saves another Thao song stays unfollowed (pinned in Task A1 `nextFollow` tests and Task A3).
2. "Save number 3" with no screen, a screen older than 30 minutes, or a number past the list's end falls through to title/artist, then "which song?" — never a wrong song (Task A1 `playAtNumber`, Task B2).
3. A brand-new listener, or one whose artists have nothing new, asking "what's new for me?" hears the station-picks fallback, not silence (Task B4).
4. Following an artist the playlist can't resolve (414 Music local releases have no canonical artist) answers "I don't have {artist} in our playlist yet." (Task A2, Task B3).
5. "Delete my data" leaves zero `listenerFollows` and `listenerState` rows (Task A2).

---

## Part A — rm-playlist-v2 (Convex)

Work in a worktree on branch `feat/listener-memory` from `origin/main`. Verify `git rev-parse --show-toplevel` before every commit.

### Task A1: Schema + pure memory logic

**Files:**
- Modify: `packages/convex/convex/schema.ts` (add tables; add search indexes to `plays`)
- Create: `packages/convex/convex/memoryLogic.ts`
- Modify: `packages/convex/convex/enrichment.ts:752` (export `normalizeArtistKey`)
- Test: `packages/convex/test/memoryLogic.test.ts`

**Interfaces:**
- Produces (used by A2–A6): `SCREEN_TTL_MS`, `MAX_SCREEN`, `playAtNumber`, `nextFollow`, `storyMentionsArtist`, `rankDigest`, types `DigestArtist`, `DigestItem`; tables `listenerFollows`, `listenerState`, `artistWatch`; `plays` indexes `search_artist`, `search_title`; exported `normalizeArtistKey(displayName: string): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/convex/test/memoryLogic.test.ts
import { describe, expect, test } from "bun:test";
import { MAX_SCREEN, SCREEN_TTL_MS, nextFollow, playAtNumber, rankDigest, storyMentionsArtist } from "../convex/memoryLogic";

const NOW = Date.UTC(2026, 9, 10, 18);

describe("playAtNumber", () => {
  const screen = { shownAt: NOW - 60_000, playIds: ["p1", "p2", "p3"] };
  test("returns the play at a spoken number", () => expect(playAtNumber(screen, 3, NOW)).toBe("p3"));
  test("null past the end, below 1, or not a whole number", () => {
    expect(playAtNumber(screen, 4, NOW)).toBeNull();
    expect(playAtNumber(screen, 0, NOW)).toBeNull();
    expect(playAtNumber(screen, 1.5, NOW)).toBeNull();
  });
  test("null when the screen is older than 30 minutes or missing", () => {
    expect(playAtNumber({ ...screen, shownAt: NOW - SCREEN_TTL_MS - 1 }, 1, NOW)).toBeNull();
    expect(playAtNumber(undefined, 1, NOW)).toBeNull();
  });
  test("MAX_SCREEN is 10", () => expect(MAX_SCREEN).toBe(10));
});

describe("nextFollow", () => {
  test("a save follows an artist with no row", () => expect(nextFollow(null, "find")).toEqual({ status: "following", source: "find" }));
  test("a save never overrides an explicit unfollow", () => expect(nextFollow({ status: "unfollowed", source: "explicit" }, "find")).toBeNull());
  test("a save leaves an existing follow alone", () => expect(nextFollow({ status: "following", source: "explicit" }, "find")).toBeNull());
  test("an explicit follow always follows", () => expect(nextFollow({ status: "unfollowed", source: "explicit" }, "explicit")).toEqual({ status: "following", source: "explicit" }));
});

describe("storyMentionsArtist", () => {
  test("keeps a story naming the artist, case and punctuation insensitive", () =>
    expect(storyMentionsArtist({ title: "Thao's Studio Milwaukee session", hint: "" }, "Thao")).toBe(true));
  test("drops a story that only matched by meaning", () =>
    expect(storyMentionsArtist({ title: "Indie rock in Riverwest", hint: "guitars and horns" }, "Thao")).toBe(false));
  test("needs a whole-word match, so 'Nas' does not match 'Nashville'", () =>
    expect(storyMentionsArtist({ title: "Nashville sounds", hint: "" }, "Nas")).toBe(false));
});

describe("rankDigest", () => {
  const since = NOW - 7 * 86_400_000;
  const artist = (name: string, over: object = {}) => ({ artistId: name, name, spins: [], nextShow: null, stories: [], ...over });
  test("orders: shows within 7 days, then most-played artists, then new stories, then later shows, then Apple Music", () => {
    const items = rankDigest({
      since, now: NOW,
      artists: [
        artist("Thao", { spins: [{ station: "88nine", count: 2 }], nextShow: { venue: "Turner Hall", city: "Milwaukee", startsAtMs: NOW + 2 * 86_400_000 } }),
        artist("Nas", { spins: [{ station: "hyfin", count: 3 }, { station: "88nine", count: 1 }], nextShow: { venue: "Riviera", city: "Chicago", startsAtMs: NOW + 20 * 86_400_000 } }),
        artist("Zhané", { stories: [{ storyId: "s1", title: "Zhané at 30", show: "Ladies First", publishedAt: NOW - 86_400_000 }] }),
      ],
      apple: { added: 3, expired: 0 },
    });
    expect(items.map((i) => `${i.kind}:${"artist" in i ? i.artist : ""}`)).toEqual([
      "show:Thao", "spins:Nas", "spins:Thao", "story:Zhané", "show:Nas", "apple:",
    ]);
    expect(items[1]).toMatchObject({ kind: "spins", artist: "Nas", total: 4 });
  });
  test("an empty digest is an empty list (the tool falls back to station picks)", () =>
    expect(rankDigest({ since, now: NOW, artists: [artist("Quiet")], apple: { added: 0, expired: 0 } })).toEqual([]));
  test("an expired Apple Music link is always reported", () =>
    expect(rankDigest({ since, now: NOW, artists: [], apple: { added: 0, expired: 1 } })).toEqual([{ kind: "apple", added: 0, expired: 1 }]));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/convex && bun test test/memoryLogic.test.ts`
Expected: FAIL — `Cannot find module '../convex/memoryLogic'`.

- [ ] **Step 3: Implement `memoryLogic.ts`**

```ts
// packages/convex/convex/memoryLogic.ts
export const SCREEN_TTL_MS = 30 * 60_000;
export const MAX_SCREEN = 10;
const SOON_MS = 7 * 86_400_000;

/** The play a listener means by "number N" on the list we last showed them, while it's fresh. */
export function playAtNumber(screen: { shownAt: number; playIds: string[] } | undefined, number: number, now: number): string | null {
  if (!screen || now - screen.shownAt > SCREEN_TTL_MS) return null;
  if (!Number.isInteger(number) || number < 1) return null;
  return screen.playIds[number - 1] ?? null;
}

type FollowStatus = "following" | "unfollowed";
type FollowSource = "find" | "explicit";

/** What to write for a follow request, or null to leave the row alone. A save never overrides "stop following". */
export function nextFollow(existing: { status: FollowStatus; source: FollowSource } | null, source: FollowSource): { status: "following"; source: FollowSource } | null {
  if (source === "explicit") return { status: "following", source };
  return existing === null ? { status: "following", source } : null;
}

const words = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim()} `;

/** Backstory search matches by meaning; keep a story only if it names the artist as a whole word. */
export function storyMentionsArtist(story: { title: string; hint: string }, artistName: string): boolean {
  const needle = words(artistName).trim();
  return needle.length > 0 && words(`${story.title} ${story.hint}`).includes(` ${needle} `);
}

export interface DigestShow { venue: string; city: string; startsAtMs: number }
export interface DigestStory { storyId: string; title: string; show: string; publishedAt: number }
export interface DigestArtist {
  artistId: string;
  name: string;
  spins: { station: string; count: number }[];
  nextShow: DigestShow | null;
  stories: DigestStory[];
}
export type DigestItem =
  | ({ kind: "show"; artist: string } & DigestShow)
  | { kind: "spins"; artist: string; total: number; byStation: { station: string; count: number }[] }
  | ({ kind: "story"; artist: string } & DigestStory)
  | { kind: "apple"; added: number; expired: number };

/** What's new, most useful first: a show this week, the most-played artists, new stories, later shows, Apple Music. */
export function rankDigest({ artists, apple, since, now }: { artists: DigestArtist[]; apple: { added: number; expired: number }; since: number; now: number }): DigestItem[] {
  const shows = artists.filter((a) => a.nextShow && a.nextShow.startsAtMs > now)
    .map((a) => ({ kind: "show" as const, artist: a.name, ...a.nextShow! }))
    .sort((x, y) => x.startsAtMs - y.startsAtMs);
  const spins = artists.map((a) => ({ kind: "spins" as const, artist: a.name, total: a.spins.reduce((n, s) => n + s.count, 0), byStation: a.spins }))
    .filter((s) => s.total > 0).sort((x, y) => y.total - x.total);
  const stories = artists.flatMap((a) => a.stories.filter((s) => s.publishedAt > since).map((s) => ({ kind: "story" as const, artist: a.name, ...s })))
    .sort((x, y) => y.publishedAt - x.publishedAt);
  const appleItem = apple.added > 0 || apple.expired > 0 ? [{ kind: "apple" as const, ...apple }] : [];
  return [
    ...shows.filter((s) => s.startsAtMs - now <= SOON_MS),
    ...spins,
    ...stories,
    ...shows.filter((s) => s.startsAtMs - now > SOON_MS),
    ...appleItem,
  ];
}
```

- [ ] **Step 4: Schema + export normalizer.** In `schema.ts` add (before the closing `});` of `defineSchema`):

```ts
  /** Artists a linked listener follows: from a save ("find") or by asking ("explicit"). */
  listenerFollows: defineTable({
    listenerId: v.string(),
    artistId: v.id("artists"),
    artistName: v.string(),
    status: v.union(v.literal("following"), v.literal("unfollowed")),
    source: v.union(v.literal("find"), v.literal("explicit")),
    updatedAt: v.number(),
  })
    .index("by_listener", ["listenerId", "status"])
    .index("by_listener_artist", ["listenerId", "artistId"])
    .index("by_artist", ["artistId", "status"]),

  /** Per-listener memory: the last song list shown (30 min) and the last "what's new" visit. */
  listenerState: defineTable({
    listenerId: v.string(),
    screen: v.optional(v.object({ shownAt: v.number(), playIds: v.array(v.id("plays")) })),
    lastDigestAt: v.optional(v.number()),
  }).index("by_listener", ["listenerId"]),

  /** Radio Milwaukee stories about an artist, gathered from Backstory; shared, no personal data. */
  artistWatch: defineTable({
    artistId: v.id("artists"),
    stories: v.array(v.object({ storyId: v.string(), title: v.string(), show: v.string(), showSlug: v.string(), publishedAt: v.number() })),
    checkedAt: v.number(),
  }).index("by_artist", ["artistId"]),
```

On `plays`, after its last `.index(...)`, add:

```ts
    .searchIndex("search_artist", { searchField: "artistRaw", filterFields: ["stationId"] })
    .searchIndex("search_title", { searchField: "titleRaw", filterFields: ["stationId"] })
```

In `enrichment.ts` change `function normalizeArtistKey(` to `export function normalizeArtistKey(`.

- [ ] **Step 5: Run checks.** `cd packages/convex && bun test test/ && bun run typecheck` → all pass. `bunx prettier --write` the changed files.

- [ ] **Step 6: Commit** — `feat(memory): listener memory tables, plays search indexes, pure memory logic`.

### Task A2: Memory and follow functions + delete-my-data

**Files:**
- Create: `packages/convex/convex/memory.ts`, `packages/convex/convex/follows.ts`
- Modify: `packages/convex/convex/finds.ts` (`deleteAllForListener`), `packages/convex/convex/_generated/api.d.ts`
- Test: `packages/convex/test/memoryLogic.test.ts` (no new pure logic; handlers are thin)

**Interfaces:**
- Consumes: A1 `playAtNumber`, `nextFollow`, `MAX_SCREEN`, `normalizeArtistKey`.
- Produces:
  - `memory:rememberScreen({serverKey, listenerId, playIds: string[]}) → null` (invalid ids dropped; keeps ≤ 10)
  - `memory:screenPlay({serverKey, listenerId, number}) → string | null`
  - `follows:follow({serverKey, listenerId, artist?: string, playId?: string}) → {status:"ok", artistId, artistName, firstFollow: boolean} | {status:"unknown_artist"}`
  - `follows:unfollow({serverKey, listenerId, artist: string}) → {status:"ok", artistName} | {status:"not_following"}`
  - internal helper exported for A3: `followArtist(ctx, listenerId, artistId, source): Promise<{firstFollow: boolean}>`
  - `deleteAllForListener` also returns `deletedFollows: number`.

- [ ] **Step 1: `memory.ts`**

```ts
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { assertListenerId, assertServerKey } from "./listenerGuard";
import { MAX_SCREEN, playAtNumber } from "./memoryLogic";

const guard = (serverKey: string) => assertServerKey(serverKey, process.env.RADIO_COMMONS_SERVER_KEY);

export const stateFor = (ctx: QueryCtx | MutationCtx, listenerId: string) =>
  ctx.db.query("listenerState").withIndex("by_listener", (q) => q.eq("listenerId", listenerId)).first();

export const rememberScreen = mutation({
  args: { serverKey: v.string(), listenerId: v.string(), playIds: v.array(v.string()) },
  handler: async (ctx, { serverKey, listenerId, playIds }) => {
    guard(serverKey);
    assertListenerId(listenerId);
    const valid = playIds.map((id) => ctx.db.normalizeId("plays", id)).filter((id): id is Id<"plays"> => id !== null).slice(0, MAX_SCREEN);
    const screen = { shownAt: Date.now(), playIds: valid };
    const existing = await stateFor(ctx, listenerId);
    if (existing) await ctx.db.patch(existing._id, { screen });
    else await ctx.db.insert("listenerState", { listenerId, screen });
    return null;
  },
});

export const screenPlay = query({
  args: { serverKey: v.string(), listenerId: v.string(), number: v.number() },
  handler: async (ctx, { serverKey, listenerId, number }) => {
    guard(serverKey);
    assertListenerId(listenerId);
    return playAtNumber((await stateFor(ctx, listenerId))?.screen, number, Date.now());
  },
});
```

- [ ] **Step 2: `follows.ts`**

```ts
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { mutation, type MutationCtx } from "./_generated/server";
import { normalizeArtistKey } from "./enrichment";
import { assertListenerId, assertServerKey } from "./listenerGuard";
import { nextFollow } from "./memoryLogic";

const guard = (serverKey: string) => assertServerKey(serverKey, process.env.RADIO_COMMONS_SERVER_KEY);

async function artistFor(ctx: MutationCtx, { artist, playId }: { artist?: string; playId?: string }) {
  const play = playId ? await ctx.db.get(ctx.db.normalizeId("plays", playId) ?? ("" as Id<"plays">)).catch(() => null) : null;
  const fromPlay = play?.canonicalArtistId ? await ctx.db.get(play.canonicalArtistId) : null;
  if (fromPlay) return fromPlay;
  if (!artist) return null;
  return ctx.db.query("artists").withIndex("by_artist_key", (q) => q.eq("artistKey", normalizeArtistKey(artist))).first();
}

/** Follow (or keep following) an artist; schedules a Backstory story check. Shared with finds.save. */
export async function followArtist(ctx: MutationCtx, listenerId: string, artistId: Id<"artists">, artistName: string, source: "find" | "explicit") {
  const existing = await ctx.db.query("listenerFollows").withIndex("by_listener_artist", (q) => q.eq("listenerId", listenerId).eq("artistId", artistId)).first();
  const next = nextFollow(existing ? { status: existing.status, source: existing.source } : null, source);
  if (next === null) return { firstFollow: false };
  const fields = { ...next, artistName, updatedAt: Date.now() };
  if (existing) await ctx.db.patch(existing._id, fields);
  else await ctx.db.insert("listenerFollows", { listenerId, artistId, ...fields });
  await ctx.scheduler.runAfter(0, internal.artistWatch.refresh, { artistId });
  return { firstFollow: existing === null || existing.status === "unfollowed" };
}

export const follow = mutation({
  args: { serverKey: v.string(), listenerId: v.string(), artist: v.optional(v.string()), playId: v.optional(v.string()) },
  handler: async (ctx, { serverKey, listenerId, artist, playId }) => {
    guard(serverKey);
    assertListenerId(listenerId);
    const found = await artistFor(ctx, { artist, playId });
    if (!found) return { status: "unknown_artist" as const };
    const { firstFollow } = await followArtist(ctx, listenerId, found._id, found.displayName, "explicit");
    return { status: "ok" as const, artistId: found._id, artistName: found.displayName, firstFollow };
  },
});

export const unfollow = mutation({
  args: { serverKey: v.string(), listenerId: v.string(), artist: v.string() },
  handler: async (ctx, { serverKey, listenerId, artist }) => {
    guard(serverKey);
    assertListenerId(listenerId);
    const found = await artistFor(ctx, { artist });
    const row = found && await ctx.db.query("listenerFollows").withIndex("by_listener_artist", (q) => q.eq("listenerId", listenerId).eq("artistId", found._id)).first();
    if (!row || row.status === "unfollowed") return { status: "not_following" as const };
    await ctx.db.patch(row._id, { status: "unfollowed", source: "explicit", updatedAt: Date.now() });
    return { status: "ok" as const, artistName: row.artistName };
  },
});
```

Replace the `artistFor` play lookup's `.catch` hack with a plain guard if typecheck objects: `const id = playId ? ctx.db.normalizeId("plays", playId) : null; const play = id ? await ctx.db.get(id) : null;`.

- [ ] **Step 3: delete-my-data.** In `finds.deleteAllForListener`, after deleting finds and the Apple link, delete every `listenerFollows` row (`withIndex("by_listener", q => q.eq("listenerId", listenerId))` — iterate both statuses: query without status) and the `listenerState` row; add `deletedFollows` to the return. Update Radio Commons' `deletedSchema` in Task B1 accordingly.

- [ ] **Step 4: Register modules** in `_generated/api.d.ts`: add `import type * as memory from "../memory.js";`, `follows`, `memoryLogic`, and (Task A4) `artistWatch`, (Task A5) `digest` — keep alphabetical, mirroring existing lines (both the import list and the `ApiFromModules` object).

- [ ] **Step 5: Checks + commit** — `bun test test/ && bun run typecheck`; prettier; commit `feat(memory): screen memory, follow/unfollow, delete-my-data covers memory`.

### Task A3: `finds.save` orchestration

**Files:**
- Modify: `packages/convex/convex/finds.ts` (`save`, `SaveResult`)

**Interfaces:**
- Consumes: A2 `followArtist`; existing `upcomingShowsByMetro(ctx, artistName)` from `./plays`.
- Produces: `SaveResult` ok branch gains `artistName: string`, `firstFollow: boolean`, `nextShow: {venue, city, startsAtMs} | null`, `story: {storyId, title, show} | null`, `recentlySaved: boolean` (another Find saved by this listener in the previous 30 minutes — drives the Apple hint).

- [ ] **Step 1: Implement.** After the insert/patch and Apple scheduling:

```ts
    const artistId = track?.artistId ?? play.canonicalArtistId ?? null;
    const { firstFollow } = artistId
      ? await followArtist(ctx, listenerId, artistId, artist, "find")
      : { firstFollow: false };
    const [show] = await upcomingShowsByMetro(ctx, artist);
    const watch = artistId ? await ctx.db.query("artistWatch").withIndex("by_artist", (q) => q.eq("artistId", artistId)).first() : null;
    const recentlySaved = (await ctx.db.query("finds").withIndex("by_listener_saved", (q) => q.eq("listenerId", listenerId).gt("savedAt", now - 30 * 60_000)).collect())
      .some((f) => f._id !== findId);
```

Return the new fields (`nextShow: show ? { venue: show.venueName ?? show.venue, city: show.city, startsAtMs: show.startsAtMs } : null` — read `LiveEventSummary` in `plays.ts` for the exact field names and map them; `story: watch?.stories[0] ? {storyId, title, show} : null`). `upcomingShowsByMetro` takes a `QueryCtx`; a `MutationCtx` satisfies it.

- [ ] **Step 2: Checks + commit** — `feat(finds): save follows the artist and returns next show, story, recent-save flag`.

### Task A4: `artistWatch` — Backstory stories per artist + daily cron

**Files:**
- Create: `packages/convex/convex/artistWatch.ts`
- Modify: `packages/convex/convex/crons.ts`

**Interfaces:**
- Consumes: A1 `storyMentionsArtist`; env `BACKSTORY_CONVEX_URL`.
- Produces: `internal.artistWatch.refresh({artistId})`, `internal.artistWatch.refreshStale({})`, internal `artistWatch.store`, internal query `artistWatch.artistName`.

- [ ] **Step 1: Implement**

```ts
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { storyMentionsArtist } from "./memoryLogic";

const MAX_STORIES = 3;
const STALE_MS = 24 * 3_600_000;
const REFRESH_BATCH = 25;
const BACKSTORY_TIMEOUT_MS = 8000;

interface StoryCard { storyId: string; title: string; show: string; showSlug: string; publishedAt: number; hint: string }

export const artistName = internalQuery({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => (await ctx.db.get(artistId))?.displayName ?? null,
});

export const store = internalMutation({
  args: { artistId: v.id("artists"), stories: v.array(v.object({ storyId: v.string(), title: v.string(), show: v.string(), showSlug: v.string(), publishedAt: v.number() })) },
  handler: async (ctx, { artistId, stories }) => {
    const existing = await ctx.db.query("artistWatch").withIndex("by_artist", (q) => q.eq("artistId", artistId)).first();
    const fields = { stories, checkedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("artistWatch", { artistId, ...fields });
  },
});

/** Ask Backstory for stories about one artist; keep only stories that name them. */
export const refresh = internalAction({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => {
    const url = process.env.BACKSTORY_CONVEX_URL;
    const name = await ctx.runQuery(internal.artistWatch.artistName, { artistId });
    if (!url || !name) {
      console.error(JSON.stringify({ event: "artist_watch.skipped", reason: url ? "no_artist" : "no_backstory_url" }));
      return;
    }
    const response = await fetch(`${url}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "public:searchStoryCards", args: { text: name }, format: "json" }),
      signal: AbortSignal.timeout(BACKSTORY_TIMEOUT_MS),
    });
    const body = (await response.json()) as { status: string; value?: StoryCard[] };
    if (!response.ok || body.status !== "success") {
      console.error(JSON.stringify({ event: "artist_watch.backstory_failed", httpStatus: response.status }));
      return; // the daily cron retries
    }
    const stories = (body.value ?? []).filter((s) => storyMentionsArtist(s, name))
      .sort((a, b) => b.publishedAt - a.publishedAt).slice(0, MAX_STORIES)
      .map(({ storyId, title, show, showSlug, publishedAt }) => ({ storyId, title, show, showSlug, publishedAt }));
    await ctx.runMutation(internal.artistWatch.store, { artistId, stories });
  },
});

export const staleFollowedArtists = internalQuery({
  args: {},
  handler: async (ctx) => {
    const follows = await ctx.db.query("listenerFollows").filter((q) => q.eq(q.field("status"), "following")).take(500);
    const ids = [...new Set(follows.map((f) => f.artistId))];
    const watched = await Promise.all(ids.map(async (artistId) => ({ artistId, row: await ctx.db.query("artistWatch").withIndex("by_artist", (q) => q.eq("artistId", artistId)).first() })));
    return watched.filter(({ row }) => !row || Date.now() - row.checkedAt > STALE_MS)
      .sort((a, b) => (a.row?.checkedAt ?? 0) - (b.row?.checkedAt ?? 0)).slice(0, REFRESH_BATCH).map(({ artistId }) => artistId);
  },
});

export const refreshStale = internalAction({
  args: {},
  handler: async (ctx) => {
    for (const artistId of await ctx.runQuery(internal.artistWatch.staleFollowedArtists, {})) {
      await ctx.scheduler.runAfter(0, internal.artistWatch.refresh, { artistId });
    }
  },
});
```

Before writing `refresh`, confirm Backstory's HTTP query shape by reading Convex's docs for the `/api/query` endpoint (`npx ctx7@latest library Convex "HTTP API query endpoint"` then `docs`), and confirm `public:searchStoryCards` returns `hint` (radio-commons `src/lib/backstory.ts` `matchSchema` shows `hint: string`).

- [ ] **Step 2: Cron.** In `crons.ts`: `crons.daily("artist stories refresh", { hourUTC: 11, minuteUTC: 0 }, internal.artistWatch.refreshStale, {});` with a one-line comment (6 a.m. Milwaukee).

- [ ] **Step 3: Controller step (Tarik approves): set the env var** — `cd packages/convex && bunx convex env set BACKSTORY_CONVEX_URL <the radio-commons BACKSTORY_CONVEX_URL value>` (not a secret; `env set` does not push code).

- [ ] **Step 4: Checks + commit** — `feat(memory): artistWatch gathers Backstory stories per followed artist; daily refresh`.

### Task A5: Digest

**Files:**
- Create: `packages/convex/convex/digest.ts`

**Interfaces:**
- Consumes: A1 `rankDigest`, `DigestArtist`; A2 `stateFor`; `upcomingShowsByMetro`.
- Produces: `digest:forListener({serverKey, listenerId}) → { since: number, items: DigestItem[], artists: {artistId, name, artworkUrl: string | null}[] }`; `digest:markSeen({serverKey, listenerId}) → null`.

- [ ] **Step 1: Implement**

```ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertListenerId, assertServerKey } from "./listenerGuard";
import { stateFor } from "./memory";
import { rankDigest, type DigestArtist } from "./memoryLogic";
import { upcomingShowsByMetro } from "./plays";

const guard = (serverKey: string) => assertServerKey(serverKey, process.env.RADIO_COMMONS_SERVER_KEY);
const DEFAULT_WINDOW_MS = 7 * 86_400_000;
const MAX_ARTISTS = 10;
const RECENT_PLAYS_PER_ARTIST = 50;

export const forListener = query({
  args: { serverKey: v.string(), listenerId: v.string() },
  handler: async (ctx, { serverKey, listenerId }) => {
    guard(serverKey);
    assertListenerId(listenerId);
    const now = Date.now();
    const since = (await stateFor(ctx, listenerId))?.lastDigestAt ?? now - DEFAULT_WINDOW_MS;
    const follows = (await ctx.db.query("listenerFollows").withIndex("by_listener", (q) => q.eq("listenerId", listenerId).eq("status", "following")).collect())
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_ARTISTS);
    const stations = new Map((await ctx.db.query("stations").collect()).map((s) => [s._id, s.slug]));
    const artists: (DigestArtist & { artworkUrl: string | null })[] = await Promise.all(follows.map(async (f) => {
      const plays = await ctx.db.query("plays").withIndex("by_canonical_artist", (q) => q.eq("canonicalArtistId", f.artistId)).order("desc").take(RECENT_PLAYS_PER_ARTIST);
      const recent = plays.filter((p) => p.playedAt > since && p.deletedAt === undefined);
      const counts = new Map<string, number>();
      for (const p of recent) counts.set(stations.get(p.stationId) ?? "unknown", (counts.get(stations.get(p.stationId) ?? "unknown") ?? 0) + 1);
      const [show] = await upcomingShowsByMetro(ctx, f.artistName);
      const watch = await ctx.db.query("artistWatch").withIndex("by_artist", (q) => q.eq("artistId", f.artistId)).first();
      const latestTrack = plays[0]?.canonicalTrackId ? await ctx.db.get(plays[0].canonicalTrackId) : null;
      return {
        artistId: f.artistId, name: f.artistName,
        spins: [...counts].map(([station, count]) => ({ station, count })),
        nextShow: show ? { venue: show.venueName, city: show.city, startsAtMs: show.startsAtMs } : null, // map to LiveEventSummary's real field names (see plays.ts)
        stories: (watch?.stories ?? []).map(({ storyId, title, show: s, publishedAt }) => ({ storyId, title, show: s, publishedAt })),
        artworkUrl: latestTrack?.artworkUrl ?? null,
      };
    }));
    const finds = await ctx.db.query("finds").withIndex("by_listener_saved", (q) => q.eq("listenerId", listenerId).gt("savedAt", since)).collect();
    const apple = { added: finds.filter((f) => f.appleMusic.status === "added").length, expired: finds.filter((f) => f.appleMusic.status === "expired").length };
    return { since, items: rankDigest({ artists, apple, since, now }), artists: artists.map(({ artistId, name, artworkUrl }) => ({ artistId, name, artworkUrl })) };
  },
});

export const markSeen = mutation({
  args: { serverKey: v.string(), listenerId: v.string() },
  handler: async (ctx, { serverKey, listenerId }) => {
    guard(serverKey);
    assertListenerId(listenerId);
    const existing = await stateFor(ctx, listenerId);
    if (existing) await ctx.db.patch(existing._id, { lastDigestAt: Date.now() });
    else await ctx.db.insert("listenerState", { listenerId, lastDigestAt: Date.now() });
    return null;
  },
});
```

Read `appleMusicStatusValidator` in `schema.ts` for the real status literals ("added" / "expired" etc.) and use them exactly.

- [ ] **Step 2: Checks + commit** — `feat(memory): digest of spins, shows, stories and Apple Music since the last visit`.

### Task A6: `alexa:searchPlays` on the search indexes

**Files:**
- Modify: `packages/convex/convex/alexa.ts`
- Create (if helpful): pure merge helper in `memoryLogic.ts` + test `mergeSearchHits(a, b, limit)` (dedupe by `_id`, newest first)

**Interfaces:**
- Produces: `alexa:searchPlays({station?: slug, query: string, days?: number}) → PublicPlay-like[]` with `{ _id, artist, title, playedAt, artworkUrl, previewUrl, stationSlug }`, newest first, ≤ 20, only plays within `days` (default 14).

- [ ] **Step 1: Test** `mergeSearchHits` (dedupe + order + limit) in `memoryLogic.test.ts`; RED; implement:

```ts
export function mergeSearchHits<T extends { _id: string; playedAt: number }>(a: T[], b: T[], limit: number): T[] {
  const byId = new Map([...a, ...b].map((hit) => [hit._id, hit]));
  return [...byId.values()].sort((x, y) => y.playedAt - x.playedAt).slice(0, limit);
}
```

- [ ] **Step 2: Query.** For each requested station (or all four), run `ctx.db.query("plays").withSearchIndex("search_artist", (q) => q.search("artistRaw", query).eq("stationId", stationId)).take(50)` and the same on `search_title`; filter `playedAt >= now - days*86_400_000`, `deletedAt === undefined`, `enrichmentStatus !== "ignored"`; merge with `mergeSearchHits(…, 20)`; map through the existing `buildPublicPlay` (export it from `plays.ts` if needed) plus `stationSlug`.

- [ ] **Step 3: Checks, PR A.** Root `bun run test`, prettier. Commit `feat(alexa): searchPlays on plays search indexes (two-week reach)`. Push branch, open PR "Listener memory (Part A)". **Controller:** after Tarik merges, wait for `Convex deploy` success, then verify with `bunx convex run` (read-only) that `alexa:searchPlays` returns "Groove Thang" for `{query:"Groove Thang"}` and that `digest:forListener` with the server key returns `{items: []}` for a new listener id.

---

## Part B — radio-commons (MCP server)

Starts after Part A is deployed. Branch `feat/listener-memory` from `origin/main` in `~/Projects/radio-commons-finds-tools`.

### Task B1: Playlist client additions

**Files:**
- Modify: `src/lib/playlist.ts`, `tests/fixtures.ts`
- Test: `tests/playlist.test.ts`

**Interfaces:**
- Produces on `PlaylistClient`:
  - `rememberScreen(listenerId: string, playIds: string[]): Promise<void>`
  - `screenPlay(listenerId: string, number: number): Promise<string | null>`
  - `follow(listenerId: string, target: { artist?: string; playId?: string }): Promise<{status:"ok"; artistName: string; firstFollow: boolean} | {status:"unknown_artist"}>`
  - `unfollow(listenerId: string, artist: string): Promise<{status:"ok"; artistName: string} | {status:"not_following"}>`
  - `digest(listenerId: string): Promise<Digest>` (timeout 1500 ms) where `Digest = { since: number; items: DigestItem[]; artists: { artistId: string; name: string; artworkUrl: string | null }[] }` and `DigestItem` mirrors Task A1's union
  - `markDigestSeen(listenerId: string): Promise<void>`
  - `searchPlays(station: Station | undefined, query: string): Promise<(RecentSong & { station: Station })[]>` → `alexa:searchPlays` (replaces the per-station `plays:searchByStation` fan-out)
  - `SavedFind` ok branch gains `artistName`, `firstFollow`, `nextShow`, `story`, `recentlySaved` (zod schema updated; all keyed calls via `keyed(...)`)
  - `deletedSchema` gains `deletedFollows: z.number()`

- [ ] **Step 1: Tests (RED)** in `tests/playlist.test.ts`, following the file's existing style: each new method calls the right function name with `serverKey` (for listener calls) and the right args; `digest` uses the 1500 ms limit (a fake query that resolves after 600 ms succeeds); a malformed digest reply throws `PlaylistUnavailable`.
- [ ] **Step 2: Implement** with zod schemas mirroring Part A's returns. Fixtures: defaults return `null`, `{status:"unknown_artist"}`, `{since:0, items:[], artists:[]}`, `[]`.
- [ ] **Step 3: Checks + commit** — `feat(playlist): memory, follow, digest and indexed search calls`.

### Task B2: Screen memory writes + `save_find` by number with the orchestrated reply

**Files:**
- Modify: `src/lib/mcp.ts` (`Deps` gains `defer?: (task: () => Promise<unknown>) => void`; recall/list/search tools; `save_find`; `search_playlist`)
- Modify: `src/app/api/mcp/route.ts` (pass `defer: (task) => after(task)` from `next/server`)
- Modify: `src/lib/speech.ts` (`spokenSaved`)
- Test: `tests/mcp.test.ts`, `tests/speech.test.ts`

**Interfaces:**
- Consumes: B1 client methods.
- Produces: `save_find` input `{ number?: int 1–10, playId?, title?, artist?, station? }`; resolution order `number → screenPlay`, then `playId`, then title/artist via `searchPlays`.

- [ ] **Step 1: Tests (RED)**:
  - linked `recent_songs` call → `defer` received a task that calls `rememberScreen("user_1", [ids…])` (test deps use `defer: (t) => void t()`); anonymous call → no `rememberScreen`.
  - `save_find {number: 3}` → `screenPlay("user_1", 3)` → saves that id; `screenPlay` null + title → falls to search; nothing resolvable → "which song".
  - spoken: `{appleMusic:"pending", firstFollow:true, nextShow:{venue:"Turner Hall", city:"Milwaukee", startsAtMs}, story:{show:"Studio Milwaukee"}}` → `Saved "Sick of the Times" by Thao to your 88Nine Finds, and I'm adding it to Apple Music. I'll keep an eye out for Thao — they play Turner Hall in Milwaukee on Friday, October 9, and we have their Studio Milwaukee story.` (date in America/Chicago).
  - `{appleMusic:"not_linked", recentlySaved:false}` → ends with the Apple hint (Global Constraints wording); `recentlySaved:true` → no hint.
- [ ] **Step 2: Implement.** `defer` default: `(task) => void task().catch(() => {})` for non-Next callers; the route passes `after`. In each list tool, after building `songs`, `if (listenerId) defer(() => deps.playlist().rememberScreen(listenerId, songs.map((s) => s.playId)))` where `listenerId = listenerIdFrom(context.http ?? {})` (list tools take `context` as their second handler argument). `search_playlist` switches to `deps.playlist().searchPlays(slug, query)`; update its description to "about the last two weeks".
- [ ] **Step 3: Checks + commit** — `feat(music): remember the list on screen; save by number; one orchestrated save reply`.

### Task B3: `follow_artist` / `unfollow_artist`

**Files:** `src/lib/mcp.ts`, `src/lib/speech.ts`, `tests/mcp.test.ts`, `tests/sim/mcpClient.test.ts` + `tests/mcp.test.ts` tool-name lists.

- [ ] **Step 1: Tests (RED)**: unlinked → `account_linking_required`; `follow_artist {artist:"Thao"}` → "I'll follow Thao. Ask me what's new for you anytime."; `unknown_artist` → "I don't have Thao in our playlist yet."; `unfollow_artist` ok → "Done — I won't keep an eye out for Thao anymore."; `not_following` → "You're not following Thao."; tool lists include both names.
- [ ] **Step 2: Implement** (`server.registerTool`, input `{artist?: string ≤ 100, playId?: PLAY_ID}` / `{artist: string}`; descriptions with example phrases "follow Thao", "follow this artist", "stop following Thao").
- [ ] **Step 3: Checks + commit** — `feat(music): follow and unfollow artists`.

### Task B4: `whats_new_for_me` + digest card

**Files:** `src/lib/mcp.ts`, `src/lib/speech.ts` (`spokenDigest`), `src/lib/card/views.ts` (`digest` view), `src/lib/card/song.ts` or new `src/lib/card/digest.ts`, tests.

- [ ] **Step 1: Tests (RED)**:
  - unlinked → `account_linking_required`.
  - items `[show Thao (in 2 days), spins Nas total 4 (hyfin 3, 88nine 1), story Zhané]` → spoken `Since your last visit: Thao plays Turner Hall in Milwaukee on {day}. HYFIN played Nas 3 times and 88Nine once. And there's a new Ladies First story about Zhané.`; `markDigestSeen` deferred once.
  - empty items → `Nothing new from your artists yet — here's what the station's excited about.` followed by `spokenPicks(...)`, card = picks card; `markDigestSeen` still deferred.
  - card: `view: "digest"`, one tile per artist in `artists` order with artwork or plain tile, lines from that artist's items, buttons `Play story` (`data-ask="Play the {show} story about {artist}"`) when a story exists and `What's new` hidden.
  - tool `_meta` has `ui.resourceUri` and `"openai/toolInvocation/invoking"`-style invoking text per Alexa docs: read `node_modules/@modelcontextprotocol/ext-apps` types for the exact `_meta.ui` invoking field name and use it ("Checking what's new for you…").
- [ ] **Step 2: Implement** `spokenDigest(items, now)` (top 3 items, station names via `STATION_NAMES`, "once/twice/N times"), the `digest` view (reuse `.tile`, `.tile-art`, `.tile-title`, `.tile-date`, `.tile-actions`), the tool (`registerAppTool`, `...CARD`).
- [ ] **Step 3: Checks + commit** — `feat(music): what's new for me — a digest from what we remember`.

### Task B5: Privacy line + manifest phrase

**Files:** `src/app/privacy/page.tsx`, `alexa/addon-package/addon.json`, `tests/alexaAddon.test.ts`, `tests/connectAppleMusic.test.ts` (if it snapshots privacy text).

- [ ] **Step 1:** Privacy "What we store" gains: "The artists you follow, the last list of songs we showed you (kept 30 minutes), and when you last asked what's new. Deleting your data erases these too."
- [ ] **Step 2:** Manifest `examplePhrases` gains `"What's new for me"`; `PHRASE_TOOLS` maps it to `whats_new_for_me`. Run `npm test`.
- [ ] **Step 3: Commit** — `docs(privacy,alexa): listener memory disclosure and example phrase`.

### Task B6: Real-phrase eval script

**Files:** Create `scripts/eval-turns.mjs`; `package.json` script `"eval:turns": "node scripts/eval-turns.mjs"`.

- [ ] **Step 1: Implement.** Reads `SIM_PASSCODE` via `@next/env` (never prints it); target `EVAL_URL` env or `https://radio-commons.vercel.app`; sends real turns to `/api/sim/turn` carrying history with the on-screen note (same format as `src/lib/sim/ui.ts` `nextHistory`); each scenario asserts on the tool trail and prints PASS/FAIL per step; exits 1 on any FAIL. Scenarios:
  1. "what were the last 5 songs on 88nine" → `recent_songs`; then "save number 3" → `save_find` input has `number: 3` or a `playId` equal to song 3's id.
  2. "when did you last play Nas" → `search_playlist`, no error.
  3. "what are the credits on Groove Thang" → `get_track_story` (or `search_playlist` then `get_track_story`), no error.
  4. "follow Thao" → `follow_artist`.
  5. "what's new for me" → `whats_new_for_me`.
  (Unlinked runs accept `account_linking_required` as PASS for 1b/4/5 — the check is which tool and which inputs.)
- [ ] **Step 2:** Run it against production after Part A deploys; paste output into the task report.
- [ ] **Step 3: Commit** — `test(eval): real phrases through the live simulator`.

### Task B7: `/how-it-works` judges page + `docs/HACKATHON.md`

**Files:** Create `src/app/how-it-works/page.tsx` (+ CSS module or reuse `landing.module.css`), `docs/HACKATHON.md`; modify `src/app/page.tsx` nav (add "For judges" → `/how-it-works`), `src/lib/landing.ts` if copy lives there; test `tests/landing.test.ts` (page renders its section headings; nav link present).

- [ ] **Step 1: Read first** `src/app/page.tsx`, `src/app/landing.module.css`, `src/lib/landing.ts`, and the card tokens — the page must use the same fonts, colors, spacing and components; no new palette.
- [ ] **Step 2: Content** (server component, static):
  1. *The two-session demo* — session 1 "save this" and session 2 "what's new for me?", as a short story with the real spoken replies.
  2. *One sentence, five services* — an ordered list/diagram: identify the play (playlist) → save (Finds) → Apple Music library (background job) → follow the artist + next show (concerts from AXS/Ticketmaster) → Backstory stories (background job, daily refresh).
  3. *What we remember, and how to erase it* — the three tables in plain words; "delete my data".
  4. *Built on Alexa+* — the add-on manifest (`alexa/addon-package/addon.json`), MCP 2025-11-25 Streamable HTTP, account linking per Amazon's spec (OAuth 2.1, PKCE S256, refresh tokens, RFC 8707), MCP Apps cards; link to the simulator.
  5. *Status* — a small table, live vs in progress, edited as tasks land.
- [ ] **Step 3:** `docs/HACKATHON.md` — problem, what it does, architecture, the required technology in code (file paths: `alexa/addon-package/addon.json`, `src/app/api/mcp/route.ts`, `src/lib/mcp.ts`, `src/app/.well-known/oauth-protected-resource/route.ts`), demo script (the eval scenarios), team.
- [ ] **Step 4:** Render check — run `npm run dev`, screenshot `/how-it-works` at desktop and 390 px width (ego-browser; Playwright for the phone viewport), attach both to the report.
- [ ] **Step 5: Checks, PR B** — all radio-commons checks; open PR "Listener memory (Part B)"; after Tarik merges, run `npm run eval:turns` against production and report.

---

## Spec coverage check

| Spec section | Task |
|---|---|
| §3 tables, search indexes | A1 |
| §4 memory/follows/delete | A2 |
| §4 finds.save changes | A3 |
| §4 artistWatch + cron + env | A4 |
| §4 digest + ranking | A1, A5 |
| §4 searchPlays | A6, B1, B2 |
| §5 screen writes, save by number, orchestrated reply, Apple hint | B2 |
| §5 follow/unfollow | B3 |
| §5 whats_new_for_me, digest card, fallback, invoking | B4 |
| §5 privacy line, manifest phrase | B5 |
| §6 judges page, HACKATHON.md | B7 |
| §7 errors/latency (1500 ms digest, after(), retries) | A4, B1, B2, B4 |
| §8 eval script | B6 |
