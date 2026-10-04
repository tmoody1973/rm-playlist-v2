import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { mutation, type MutationCtx } from "./_generated/server";
import { normalizeArtistKey } from "./enrichment";
import { assertListenerId, assertServerKey } from "./listenerGuard";
import { isUsableArtistName, nextFollow } from "./memoryLogic";

const guard = (serverKey: string) =>
  assertServerKey(serverKey, process.env.RADIO_COMMONS_SERVER_KEY);

async function artistFor(
  ctx: MutationCtx,
  { artist, playId }: { artist?: string; playId?: string },
) {
  const id = playId ? ctx.db.normalizeId("plays", playId) : null;
  const play = id ? await ctx.db.get(id) : null;
  const fromPlay = play?.canonicalArtistId ? await ctx.db.get(play.canonicalArtistId) : null;
  if (fromPlay) return fromPlay;
  if (!isUsableArtistName(artist)) return null;
  return ctx.db
    .query("artists")
    .withIndex("by_artist_key", (q) => q.eq("artistKey", normalizeArtistKey(artist)))
    .first();
}

/** Follow (or keep following) an artist; schedules a Backstory story check. Shared with finds.save. */
export async function followArtist(
  ctx: MutationCtx,
  listenerId: string,
  artistId: Id<"artists">,
  artistName: string,
  source: "find" | "explicit",
) {
  const existing = await ctx.db
    .query("listenerFollows")
    .withIndex("by_listener_artist", (q) => q.eq("listenerId", listenerId).eq("artistId", artistId))
    .first();
  const next = nextFollow(
    existing ? { status: existing.status, source: existing.source } : null,
    source,
  );
  if (next === null) return { firstFollow: false };
  const fields = { ...next, artistName, updatedAt: Date.now() };
  if (existing) await ctx.db.patch(existing._id, fields);
  else await ctx.db.insert("listenerFollows", { listenerId, artistId, ...fields });
  await ctx.scheduler.runAfter(0, internal.artistWatch.refresh, { artistId });
  return { firstFollow: existing === null || existing.status === "unfollowed" };
}

export const follow = mutation({
  args: {
    serverKey: v.string(),
    listenerId: v.string(),
    artist: v.optional(v.string()),
    playId: v.optional(v.string()),
  },
  handler: async (ctx, { serverKey, listenerId, artist, playId }) => {
    guard(serverKey);
    assertListenerId(listenerId);
    const found = await artistFor(ctx, { artist, playId });
    if (!found) return { status: "unknown_artist" as const };
    const { firstFollow } = await followArtist(
      ctx,
      listenerId,
      found._id,
      found.displayName,
      "explicit",
    );
    return {
      status: "ok" as const,
      artistId: found._id,
      artistName: found.displayName,
      firstFollow,
    };
  },
});

export const unfollow = mutation({
  args: { serverKey: v.string(), listenerId: v.string(), artist: v.string() },
  handler: async (ctx, { serverKey, listenerId, artist }) => {
    guard(serverKey);
    assertListenerId(listenerId);
    const found = await artistFor(ctx, { artist });
    const row =
      found &&
      (await ctx.db
        .query("listenerFollows")
        .withIndex("by_listener_artist", (q) =>
          q.eq("listenerId", listenerId).eq("artistId", found._id),
        )
        .first());
    if (!row || row.status === "unfollowed") return { status: "not_following" as const };
    await ctx.db.patch(row._id, {
      status: "unfollowed",
      source: "explicit",
      updatedAt: Date.now(),
    });
    return { status: "ok" as const, artistName: row.artistName };
  },
});
