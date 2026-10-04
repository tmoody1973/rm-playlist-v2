import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertListenerId, assertServerKey } from "./listenerGuard";
import { stateFor } from "./memory";
import {
  countSpinsSince,
  digestSince,
  pickHomeShow,
  rankDigest,
  type DigestArtist,
} from "./memoryLogic";
import { upcomingShowsByMetro } from "./plays";

const guard = (serverKey: string) =>
  assertServerKey(serverKey, process.env.RADIO_COMMONS_SERVER_KEY);
const MAX_ARTISTS = 10;
const RECENT_PLAYS_PER_ARTIST = 50;
const MAX_FINDS_PER_DIGEST = 200;
const UNKNOWN_STATION = "unknown";

export const forListener = query({
  args: { serverKey: v.string(), listenerId: v.string() },
  handler: async (ctx, { serverKey, listenerId }) => {
    guard(serverKey);
    assertListenerId(listenerId);
    const now = Date.now();
    const since = digestSince((await stateFor(ctx, listenerId))?.lastDigestAt, now);
    const follows = (
      await ctx.db
        .query("listenerFollows")
        .withIndex("by_listener", (q) => q.eq("listenerId", listenerId).eq("status", "following"))
        .collect()
    )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_ARTISTS);
    const stationSlugById = new Map(
      (await ctx.db.query("stations").collect()).map((s) => [s._id, s.slug]),
    );
    const artists: (DigestArtist & { artworkUrl: string | null })[] = await Promise.all(
      follows.map(async (follow) => {
        const plays = await ctx.db
          .query("plays")
          .withIndex("by_canonical_artist", (q) => q.eq("canonicalArtistId", follow.artistId))
          .order("desc")
          .take(RECENT_PLAYS_PER_ARTIST);
        const spins = countSpinsSince(
          plays.map((p) => ({
            stationSlug: stationSlugById.get(p.stationId) ?? UNKNOWN_STATION,
            playedAt: p.playedAt,
            deleted: p.deletedAt !== undefined,
          })),
          since,
        );
        const show = pickHomeShow(await upcomingShowsByMetro(ctx, follow.artistName));
        const watch = await ctx.db
          .query("artistWatch")
          .withIndex("by_artist", (q) => q.eq("artistId", follow.artistId))
          .first();
        const latestTrackId = plays[0]?.canonicalTrackId;
        const latestTrack = latestTrackId ? await ctx.db.get(latestTrackId) : null;
        return {
          artistId: follow.artistId,
          name: follow.artistName,
          spins,
          nextShow: show
            ? { venue: show.venue, city: show.city, startsAtMs: show.startsAtMs }
            : null,
          stories: (watch?.stories ?? []).map(
            ({ storyId, title, show: showName, publishedAt }) => ({
              storyId,
              title,
              show: showName,
              publishedAt,
            }),
          ),
          artworkUrl: latestTrack?.artworkUrl ?? null,
        };
      }),
    );
    const finds = await ctx.db
      .query("finds")
      .withIndex("by_listener_saved", (q) => q.eq("listenerId", listenerId).gt("savedAt", since))
      .take(MAX_FINDS_PER_DIGEST);
    const countWithStatus = (status: "added" | "expired") =>
      finds.filter((f) => f.appleMusic.status === status).length;
    const apple = { added: countWithStatus("added"), expired: countWithStatus("expired") };
    return {
      since,
      items: rankDigest({ artists, apple, since, now }),
      artists: artists.map(({ artistId, name, artworkUrl }) => ({ artistId, name, artworkUrl })),
    };
  },
});

export const markSeen = mutation({
  args: { serverKey: v.string(), listenerId: v.string() },
  handler: async (ctx, { serverKey, listenerId }) => {
    guard(serverKey);
    assertListenerId(listenerId);
    const lastDigestAt = Date.now();
    const existing = await stateFor(ctx, listenerId);
    if (existing) await ctx.db.patch(existing._id, { lastDigestAt });
    else await ctx.db.insert("listenerState", { listenerId, lastDigestAt });
    return null;
  },
});
