import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";

/**
 * Fetch a source by id or throw. Shared by `recordPolledPlays` (batch) and
 * `recordStreamPlay` (single) — both need the orgId/stationId off the source
 * row to attribute the play correctly.
 */
async function loadSourceOrThrow(
  ctx: MutationCtx,
  sourceId: Id<"ingestionSources">,
): Promise<Doc<"ingestionSources">> {
  const source = await ctx.db.get(sourceId);
  if (source === null) {
    throw new Error(`Unknown source: ${sourceId}`);
  }
  return source;
}

/**
 * Record a batch of normalized plays from a single adapter poll.
 *
 * The adapter produces NormalizedPlay[] — this mutation maps them into
 * `plays` rows and dedups against (stationId, playedAt) within a small
 * window so that rapid re-polls don't create duplicate rows.
 *
 * Also logs a `poll_ok` ingestionEvent and updates the source's
 * `lastSuccessAt`. On empty input (the source returned nothing — valid),
 * still logs the success but records 0 inserts.
 */
// TODO(security): currently callable by anyone with the Convex URL. Add a
// shared-secret HMAC check before partner stations go live — signed header from
// the Trigger.dev task, verified here.
export const recordPolledPlays = mutation({
  args: {
    sourceId: v.id("ingestionSources"),
    plays: v.array(
      v.object({
        artistRaw: v.string(),
        titleRaw: v.string(),
        albumRaw: v.optional(v.string()),
        labelRaw: v.optional(v.string()),
        durationSec: v.optional(v.number()),
        playedAt: v.number(),
        raw: v.any(),
      }),
    ),
  },
  handler: async (ctx, { sourceId, plays: incoming }) => {
    const source = await loadSourceOrThrow(ctx, sourceId);

    let inserted = 0;
    let skipped = 0;

    for (const play of incoming) {
      // Dedup: same station, same playedAt (ms), not soft-deleted
      const dup = await ctx.db
        .query("plays")
        .withIndex("by_station_played_at", (q) =>
          q.eq("stationId", source.stationId).eq("playedAt", play.playedAt),
        )
        .first();
      if (dup !== null) {
        skipped++;
        continue;
      }

      await ctx.db.insert("plays", {
        orgId: source.orgId,
        stationId: source.stationId,
        sourceId,
        artistRaw: play.artistRaw,
        titleRaw: play.titleRaw,
        albumRaw: play.albumRaw,
        labelRaw: play.labelRaw,
        durationSec: play.durationSec,
        playedAt: play.playedAt,
        enrichmentStatus: "pending",
        raw: play.raw,
        createdAt: Date.now(),
      });
      inserted++;
    }

    await ctx.runMutation(internal.ingestionSources.markSuccess, { sourceId });
    await ctx.runMutation(internal.ingestionEvents.log, {
      orgId: source.orgId,
      stationId: source.stationId,
      sourceId,
      kind: "poll_ok",
      message: `Polled ${source.adapter}: ${inserted} new, ${skipped} duplicate`,
      context: { inserted, skipped, total: incoming.length },
    });

    return { inserted, skipped };
  },
});

/**
 * Record a single play from a long-lived stream (ICY worker on Fly).
 *
 * Unlike `recordPolledPlays` — which runs once per minute and logs a
 * `poll_ok` ingestionEvent per batch — streams emit one StreamTitle per song
 * change (~every 3 min per station). Logging a Convex event for every tick
 * would flood `ingestionEvents`. So this mutation:
 *
 *   - Dedups by `(stationId, playedAt)` exactly like the batch version.
 *   - Does NOT write an ingestionEvent on success (too noisy).
 *   - Does NOT update `lastSuccessAt` here — a session-3 heartbeat mutation
 *     or ingestion-events kind extension will own that path.
 *
 * Returns a discriminated result so the worker can distinguish new plays
 * from duplicates without catching exceptions, and surface unknown-source
 * errors up to the supervisor for abort-this-source handling.
 */
// TODO(security): unauthenticated public mutation — same threat profile as
// `recordPolledPlays` above. Before partner stations go live: (a) HMAC-sign
// requests from the Fly worker using a shared secret, verify here with
// `crypto.timingSafeEqual`; (b) sliding-window rate limit per sourceId to
// cap at ~60 inserts/min/source (real ICY streams tick ~20/hr). These two
// mitigations collapse the DoS + sourceId-trust + playedAt-displacement
// concerns flagged in M8 session 2 security review.
export const recordStreamPlay = mutation({
  args: {
    sourceId: v.id("ingestionSources"),
    play: v.object({
      artistRaw: v.string(),
      titleRaw: v.string(),
      albumRaw: v.optional(v.string()),
      labelRaw: v.optional(v.string()),
      durationSec: v.optional(v.number()),
      playedAt: v.number(),
      raw: v.any(),
    }),
  },
  handler: async (ctx, { sourceId, play }) => {
    const source = await loadSourceOrThrow(ctx, sourceId);

    const dup = await ctx.db
      .query("plays")
      .withIndex("by_station_played_at", (q) =>
        q.eq("stationId", source.stationId).eq("playedAt", play.playedAt),
      )
      .first();
    if (dup !== null) {
      return { inserted: false as const, reason: "duplicate" as const };
    }

    await ctx.db.insert("plays", {
      orgId: source.orgId,
      stationId: source.stationId,
      sourceId,
      artistRaw: play.artistRaw,
      titleRaw: play.titleRaw,
      albumRaw: play.albumRaw,
      labelRaw: play.labelRaw,
      durationSec: play.durationSec,
      playedAt: play.playedAt,
      enrichmentStatus: "pending",
      raw: play.raw,
      createdAt: Date.now(),
    });

    return { inserted: true as const };
  },
});

/**
 * Log a poll failure. Called from Trigger task's catch block.
 */
export const recordPollFailure = mutation({
  args: {
    sourceId: v.id("ingestionSources"),
    errorMessage: v.string(),
    context: v.optional(v.any()),
  },
  handler: async (ctx, { sourceId, errorMessage, context }) => {
    const source = await loadSourceOrThrow(ctx, sourceId);
    await ctx.runMutation(internal.ingestionEvents.log, {
      orgId: source.orgId,
      stationId: source.stationId,
      sourceId,
      kind: "poll_error",
      message: errorMessage,
      context,
    });
  },
});

/**
 * Single most-recent non-deleted play for a station. Drives each station
 * card's now-playing row on the dashboard wall-of-status. Returns null
 * if the station has never had a play (fresh install) or only has
 * soft-deleted plays.
 */
export const currentByStation = query({
  args: {
    stationSlug: v.union(
      v.literal("hyfin"),
      v.literal("88nine"),
      v.literal("414music"),
      v.literal("rhythmlab"),
    ),
  },
  handler: async (ctx, { stationSlug }) => {
    const station = await ctx.db
      .query("stations")
      .withIndex("by_slug", (q) => q.eq("slug", stationSlug))
      .first();
    if (station === null) return null;

    const latest = await ctx.db
      .query("plays")
      .withIndex("by_station_played_at", (q) => q.eq("stationId", station._id))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();

    if (latest === null) return null;

    return {
      _id: latest._id,
      artistRaw: latest.artistRaw,
      titleRaw: latest.titleRaw,
      albumRaw: latest.albumRaw,
      playedAt: latest.playedAt,
    };
  },
});

/**
 * Public dashboard view: the most recent N plays per station.
 */
export const recentByStation = query({
  args: {
    stationSlug: v.union(
      v.literal("hyfin"),
      v.literal("88nine"),
      v.literal("414music"),
      v.literal("rhythmlab"),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { stationSlug, limit }) => {
    const station = await ctx.db
      .query("stations")
      .withIndex("by_slug", (q) => q.eq("slug", stationSlug))
      .first();
    if (station === null) return [];

    const take = Math.min(limit ?? 20, 100);
    const plays = await ctx.db
      .query("plays")
      .withIndex("by_station_played_at", (q) => q.eq("stationId", station._id))
      .order("desc")
      .take(take);

    return plays
      .filter((p) => p.deletedAt === undefined)
      .map((p) => ({
        _id: p._id,
        artistRaw: p.artistRaw,
        titleRaw: p.titleRaw,
        albumRaw: p.albumRaw,
        playedAt: p.playedAt,
      }));
  },
});
