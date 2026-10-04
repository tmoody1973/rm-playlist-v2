import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { pickStaleArtists, storiesFromBackstory, type StoredStory } from "./memoryLogic";

// Under the 24h cron period so a row stamped just after one run is stale at the next.
const STALE_MS = 20 * 3_600_000;
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

/** Stamp a failed attempt so a permanently failing artist doesn't hog the daily batch; keeps existing stories. */
export const markChecked = internalMutation({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => {
    const existing = await ctx.db
      .query("artistWatch")
      .withIndex("by_artist", (q) => q.eq("artistId", artistId))
      .first();
    if (existing) await ctx.db.patch(existing._id, { checkedAt: Date.now() });
    else await ctx.db.insert("artistWatch", { artistId, stories: [], checkedAt: Date.now() });
  },
});

/** Stories for the artist, or a fixed failure reason (never the URL or error text). */
async function fetchStoriesOrReason(
  baseUrl: string,
  name: string,
): Promise<StoredStory[] | string> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "public:searchStoryCards",
        args: { text: name },
        format: "json",
      }),
      signal: AbortSignal.timeout(BACKSTORY_TIMEOUT_MS),
    });
  } catch (error) {
    return error instanceof Error ? error.name : "fetch_error";
  }
  if (!response.ok) return `http_${response.status}`;
  try {
    return storiesFromBackstory(await response.json(), name) ?? "bad_body";
  } catch {
    return "bad_body";
  }
}

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
      // A dangling artist would otherwise sort first (never checked) in every batch; a missing URL is config, so stay unstamped.
      if (url) await ctx.runMutation(internal.artistWatch.markChecked, { artistId });
      return;
    }
    const outcome = await fetchStoriesOrReason(url, name);
    if (typeof outcome === "string") {
      console.error(JSON.stringify({ event: "artist_watch.backstory_failed", reason: outcome }));
      await ctx.runMutation(internal.artistWatch.markChecked, { artistId });
      return; // the daily cron retries
    }
    const stories = outcome;
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
    const rows = await Promise.all(
      artistIds.map(async (artistId) => {
        const watch = await ctx.db
          .query("artistWatch")
          .withIndex("by_artist", (q) => q.eq("artistId", artistId))
          .first();
        return { artistId, checkedAt: watch?.checkedAt ?? null };
      }),
    );
    return pickStaleArtists(rows, Date.now(), STALE_MS, REFRESH_BATCH);
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
