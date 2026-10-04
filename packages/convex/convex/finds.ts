import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { clampFindsLimit, dedupeKeyFor } from "./findsLogic";
import { assertServerKey } from "./listenerGuard";
import { appleMusicStatusValidator } from "./schema";

const guard = (serverKey: string) =>
  assertServerKey(serverKey, process.env.RADIO_COMMONS_SERVER_KEY);
const assertListener = (listenerId: string) => {
  if (listenerId.trim().length === 0) throw new Error("InvalidListener");
};

async function songFor(ctx: MutationCtx, play: Doc<"plays">) {
  const track = play.canonicalTrackId ? await ctx.db.get(play.canonicalTrackId) : null;
  const artist = track
    ? ((await ctx.db.get(track.artistId))?.displayName ?? play.artistRaw)
    : play.artistRaw;
  const station = await ctx.db.get(play.stationId);
  return {
    track,
    artist,
    title: track?.displayTitle ?? play.titleRaw,
    stationSlug: station?.slug ?? "unknown",
  };
}

async function hasActiveAppleLink(ctx: MutationCtx, listenerId: string): Promise<boolean> {
  const link = await ctx.db
    .query("appleMusicLinks")
    .withIndex("by_listener", (q) => q.eq("listenerId", listenerId))
    .first();
  return link?.status === "active";
}

export const save = mutation({
  args: { serverKey: v.string(), listenerId: v.string(), playId: v.id("plays") },
  handler: async (ctx, { serverKey, listenerId, playId }) => {
    guard(serverKey);
    assertListener(listenerId);
    const play = await ctx.db.get(playId);
    if (play === null || play.deletedAt !== undefined) throw new Error("PlayNotFound");
    const { track, artist, title, stationSlug } = await songFor(ctx, play);
    const dedupeKey = dedupeKeyFor(playId, track?._id);
    const now = Date.now();
    const status = (await hasActiveAppleLink(ctx, listenerId))
      ? ("pending" as const)
      : ("not_linked" as const);
    const existing = await ctx.db
      .query("finds")
      .withIndex("by_listener_dedupe", (q) =>
        q.eq("listenerId", listenerId).eq("dedupeKey", dedupeKey),
      )
      .first();
    const fields = {
      playId,
      trackId: track?._id,
      artist,
      title,
      stationSlug,
      savedAt: now,
      appleMusic: { status, at: now },
    };
    let findId: Id<"finds">;
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      findId = existing._id;
    } else {
      findId = await ctx.db.insert("finds", { listenerId, dedupeKey, ...fields });
    }
    if (status === "pending")
      await ctx.scheduler.runAfter(0, internal.findsApple.addToAppleMusic, { findId });
    return { findId, appleMusic: status, artist, title, alreadySaved: existing !== null };
  },
});

export const list = query({
  args: { serverKey: v.string(), listenerId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { serverKey, listenerId, limit }) => {
    guard(serverKey);
    assertListener(listenerId);
    const rows = await ctx.db
      .query("finds")
      .withIndex("by_listener_saved", (q) => q.eq("listenerId", listenerId))
      .order("desc")
      .take(clampFindsLimit(limit));
    return Promise.all(
      rows.map(async (find, index) => {
        const track = find.trackId ? await ctx.db.get(find.trackId) : null;
        return {
          label: String(index + 1),
          findId: find._id,
          playId: find.playId,
          trackId: find.trackId ?? null,
          artist: find.artist,
          title: find.title,
          stationSlug: find.stationSlug,
          savedAt: find.savedAt,
          appleMusic: { status: find.appleMusic.status, reason: find.appleMusic.reason ?? null },
          artworkUrl: track?.artworkUrl ?? null,
          previewUrl: track?.previewUrl ?? null,
        };
      }),
    );
  },
});

export const deleteAllForListener = mutation({
  args: { serverKey: v.string(), listenerId: v.string() },
  handler: async (ctx, { serverKey, listenerId }) => {
    guard(serverKey);
    assertListener(listenerId);
    const finds = await ctx.db
      .query("finds")
      .withIndex("by_listener_saved", (q) => q.eq("listenerId", listenerId))
      .collect();
    await Promise.all(finds.map((find) => ctx.db.delete(find._id)));
    const links = await ctx.db
      .query("appleMusicLinks")
      .withIndex("by_listener", (q) => q.eq("listenerId", listenerId))
      .collect();
    await Promise.all(links.map((link) => ctx.db.delete(link._id)));
    return { deletedFinds: finds.length, deletedLink: links.length > 0 };
  },
});

/** Everything the Apple add needs, in one read; null when the find or link is gone. */
export const loadForApple = internalQuery({
  args: { findId: v.id("finds") },
  handler: async (ctx, { findId }) => {
    const find = await ctx.db.get(findId);
    if (find === null) return null;
    const track = find.trackId ? await ctx.db.get(find.trackId) : null;
    const link = await ctx.db
      .query("appleMusicLinks")
      .withIndex("by_listener", (q) => q.eq("listenerId", find.listenerId))
      .first();
    return {
      appleMusicSongId: track?.appleMusicSongId ?? null,
      link:
        link?.status === "active"
          ? { linkId: link._id, encryptedUserToken: link.encryptedUserToken }
          : null,
    };
  },
});

export const recordAppleOutcome = internalMutation({
  args: {
    findId: v.id("finds"),
    status: appleMusicStatusValidator,
    reason: v.optional(v.string()),
    expireLink: v.optional(v.id("appleMusicLinks")),
  },
  handler: async (ctx, { findId, status, reason, expireLink }) => {
    const find = await ctx.db.get(findId);
    if (find !== null)
      await ctx.db.patch(findId, { appleMusic: { status, reason, at: Date.now() } });
    if (expireLink) {
      // The link may have been deleted while the Apple add was in flight.
      const link = await ctx.db.get(expireLink);
      if (link) await ctx.db.patch(expireLink, { status: "expired" });
    }
  },
});

export type FindId = Id<"finds">;
