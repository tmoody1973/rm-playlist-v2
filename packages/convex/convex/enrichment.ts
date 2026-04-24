import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";

/**
 * Enrichment pipeline Convex surface.
 *
 * Called by the `enrich-pending-plays` Trigger.dev task (session 2):
 * fetch pending plays via `pendingPlays`, run them through
 * `@rm/enrichment` (Apple Music + MusicBrainz in parallel), then
 * persist matches via `upsertArtist*` / `upsertTrack` / `markPlay*`.
 *
 * TODO(security): every function here is unauthenticated public
 * callable, mirroring the `plays.recordPolledPlays` pattern. Session 3
 * adds HMAC-signed requests from the Trigger worker — the single-
 * tenant RM shakedown is acceptable exposure; do NOT ship widgets that
 * expose the Convex URL until auth lands.
 */

export const pendingPlays = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit }) => {
    const take = Math.min(limit ?? 50, 200);
    const rows = await ctx.db
      .query("plays")
      .withIndex("by_enrichment_status", (q) => q.eq("enrichmentStatus", "pending"))
      .order("asc")
      .take(take);
    return rows.map((p) => ({
      _id: p._id,
      stationId: p.stationId,
      sourceId: p.sourceId,
      orgId: p.orgId,
      artistRaw: p.artistRaw,
      titleRaw: p.titleRaw,
      playedAt: p.playedAt,
    }));
  },
});

export const upsertArtistByMbid = mutation({
  args: {
    mbid: v.string(),
    displayName: v.string(),
    appleMusicId: v.optional(v.string()),
  },
  handler: async (ctx, { mbid, displayName, appleMusicId }) => {
    const existing = await ctx.db
      .query("artists")
      .withIndex("by_mbid", (q) => q.eq("mbid", mbid))
      .first();
    if (existing !== null) {
      const patch: Partial<Doc<"artists">> = {};
      if (appleMusicId && existing.appleMusicId !== appleMusicId) patch.appleMusicId = appleMusicId;
      if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("artists", {
      artistKey: normalizeArtistKey(displayName),
      displayName,
      mbid,
      appleMusicId,
      verified: false,
      createdAt: Date.now(),
    });
  },
});

export const upsertArtistByAppleMusicId = mutation({
  args: {
    appleMusicId: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, { appleMusicId, displayName }) => {
    const existing = await ctx.db
      .query("artists")
      .withIndex("by_apple_music", (q) => q.eq("appleMusicId", appleMusicId))
      .first();
    if (existing !== null) return existing._id;
    return await ctx.db.insert("artists", {
      artistKey: normalizeArtistKey(displayName),
      displayName,
      appleMusicId,
      verified: false,
      createdAt: Date.now(),
    });
  },
});

export const upsertTrack = mutation({
  args: {
    artistId: v.id("artists"),
    displayTitle: v.string(),
    appleMusicSongId: v.optional(v.string()),
    albumDisplayName: v.optional(v.string()),
    artworkUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.appleMusicSongId) {
      const existing = await ctx.db
        .query("tracks")
        .withIndex("by_apple_music", (q) => q.eq("appleMusicSongId", args.appleMusicSongId))
        .first();
      if (existing !== null) return existing._id;
    }
    return await ctx.db.insert("tracks", {
      trackKey: normalizeTrackKey(args.displayTitle, args.artistId),
      displayTitle: args.displayTitle,
      artistId: args.artistId,
      albumDisplayName: args.albumDisplayName,
      appleMusicSongId: args.appleMusicSongId,
      artworkUrl: sanitizeArtworkUrl(args.artworkUrl),
      verified: false,
      createdAt: Date.now(),
    });
  },
});

export const markPlayEnriched = mutation({
  args: {
    playId: v.id("plays"),
    canonicalArtistId: v.id("artists"),
    // Relaxed to optional in session 2 — an MB-only match produces a
    // canonicalArtistId without a corresponding track (no Apple Music
    // song ID to anchor one).
    canonicalTrackId: v.optional(v.id("tracks")),
    context: v.optional(v.any()),
  },
  handler: async (ctx, { playId, canonicalArtistId, canonicalTrackId, context }) => {
    const play = await loadPlay(ctx, playId);
    const patch: Partial<Doc<"plays">> = {
      canonicalArtistId,
      enrichmentStatus: "resolved",
    };
    if (canonicalTrackId !== undefined) patch.canonicalTrackId = canonicalTrackId;
    await ctx.db.patch(playId, patch);
    await ctx.runMutation(internal.ingestionEvents.log, {
      orgId: play.orgId,
      stationId: play.stationId,
      sourceId: play.sourceId,
      kind: "enrichment_ok",
      message:
        canonicalTrackId !== undefined
          ? "enriched via apple music + musicbrainz"
          : "enriched via musicbrainz only (partial)",
      context,
    });
  },
});

export const markPlayUnresolved = mutation({
  args: {
    playId: v.id("plays"),
    // Constrained union — matches the `UnresolvedReason` type exported
    // from `src/trigger/enrich-pending-plays.ts`. Prevents typo drift
    // between caller and server.
    reason: v.union(v.literal("mb_miss"), v.literal("no_match"), v.literal("other")),
    context: v.optional(v.any()),
  },
  handler: async (ctx, { playId, reason, context }) => {
    const play = await loadPlay(ctx, playId);
    await ctx.db.patch(playId, { enrichmentStatus: "unresolved" });
    await ctx.runMutation(internal.ingestionEvents.log, {
      orgId: play.orgId,
      stationId: play.stationId,
      sourceId: play.sourceId,
      kind: "enrichment_error",
      message: reason,
      context,
    });
  },
});

async function loadPlay(ctx: MutationCtx, playId: Id<"plays">): Promise<Doc<"plays">> {
  const play = await ctx.db.get(playId);
  if (play === null) throw new Error(`Unknown play: ${playId}`);
  return play;
}

const COMBINING_MARKS = /[̀-ͯ]/g;
const NON_ALNUM = /[^a-z0-9]+/g;
const LEADING_TRAILING_HYPHEN = /^-+|-+$/g;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(NON_ALNUM, "-")
    .replace(LEADING_TRAILING_HYPHEN, "");
}

function normalizeArtistKey(displayName: string): string {
  return slugify(displayName);
}

function normalizeTrackKey(title: string, artistId: Id<"artists">): string {
  return `${artistId}::${slugify(title)}`;
}

function sanitizeArtworkUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (!url.hostname.endsWith(".mzstatic.com")) return undefined;
  return url.toString();
}
