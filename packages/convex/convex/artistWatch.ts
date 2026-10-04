import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { storiesFromBackstory } from "./memoryLogic";

const STALE_MS = 24 * 3_600_000;
const REFRESH_BATCH = 25;
const BACKSTORY_TIMEOUT_MS = 8000;
const MAX_FOLLOWS_SCANNED = 500;

export const artistName = internalQuery({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => (await ctx.db.get(artistId))?.displayName ?? null,
});

export const store = internalMutation({
  args: {
    artistId: v.id("artists"),
    stories: v.array(
      v.object({
        storyId: v.string(),
        title: v.string(),
        show: v.string(),
        showSlug: v.string(),
        publishedAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, { artistId, stories }) => {
    const existing = await ctx.db
      .query("artistWatch")
      .withIndex("by_artist", (q) => q.eq("artistId", artistId))
      .first();
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
      console.error(
        JSON.stringify({
          event: "artist_watch.skipped",
          reason: url ? "no_artist" : "no_backstory_url",
        }),
      );
      return;
    }
    const response = await fetch(`${url}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "public:searchStoryCards",
        args: { text: name },
        format: "json",
      }),
      signal: AbortSignal.timeout(BACKSTORY_TIMEOUT_MS),
    });
    const stories = response.ok ? storiesFromBackstory(await response.json(), name) : null;
    if (!stories) {
      console.error(
        JSON.stringify({ event: "artist_watch.backstory_failed", httpStatus: response.status }),
      );
      return; // the daily cron retries
    }
    await ctx.runMutation(internal.artistWatch.store, { artistId, stories });
  },
});

export const staleFollowedArtists = internalQuery({
  args: {},
  handler: async (ctx) => {
    // ponytail: scans at most 500 follow rows; past that, add a by_status index or a distinct-artist counter table.
    const follows = await ctx.db
      .query("listenerFollows")
      .filter((q) => q.eq(q.field("status"), "following"))
      .take(MAX_FOLLOWS_SCANNED);
    const artistIds = [...new Set(follows.map((follow) => follow.artistId))];
    const watched = await Promise.all(
      artistIds.map(async (artistId) => ({
        artistId,
        row: await ctx.db
          .query("artistWatch")
          .withIndex("by_artist", (q) => q.eq("artistId", artistId))
          .first(),
      })),
    );
    const now = Date.now();
    return watched
      .filter(({ row }) => !row || now - row.checkedAt > STALE_MS)
      .sort((a, b) => (a.row?.checkedAt ?? 0) - (b.row?.checkedAt ?? 0))
      .slice(0, REFRESH_BATCH)
      .map(({ artistId }) => artistId);
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
