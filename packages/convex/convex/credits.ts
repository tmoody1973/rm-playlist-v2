import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { creditsStatusValidator, factBodyFields, matchConfidenceValidator } from "./factValidators";

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

type FactBody = Omit<Doc<"facts">, "_id" | "_creationTime" | "trackId">;

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
  const ids = [
    ...new Set(
      plays.map((p) => p.canonicalTrackId).filter((id): id is Id<"tracks"> => id !== undefined),
    ),
  ];
  const tracks = await Promise.all(ids.map((id) => ctx.db.get(id)));
  return tracks.filter((t): t is Doc<"tracks"> => t !== null && t.creditsStatus === undefined);
}

async function tracksWithStatus(
  ctx: QueryCtx,
  status: Doc<"tracks">["creditsStatus"],
  limit: number,
): Promise<Doc<"tracks">[]> {
  // Index is (creditsStatus, creditsFetchedAt): ascending = least recently
  // attempted first, so a track that keeps failing goes to the back and
  // can't hold the retry tier.
  return ctx.db
    .query("tracks")
    .withIndex("by_credits_status", (q) => q.eq("creditsStatus", status))
    .order("asc")
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
