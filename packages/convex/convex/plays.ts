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
 * Cross-source dedup window. Rhythm Lab runs SG + ICY in parallel; the two
 * sources report the same song change with ~0–2s of clock drift between them,
 * so exact-ms `(stationId, playedAt)` lets duplicates through. ±5s covers
 * observed drift while staying well below the shortest realistic song length.
 */
const DEDUP_WINDOW_MS = 5_000;

function normalizeForDedup(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Look for an existing non-deleted play on this station within ±5s of
 * `playedAt` that matches the same (artistRaw, titleRaw) after trim+lowercase.
 * Returns the first match, or null.
 *
 * Uses the `by_station_played_at` compound index for the range scan —
 * songs are 3+ minutes apart on a real station, so the window almost
 * always contains 0 or 1 rows.
 */
async function findDuplicatePlay(
  ctx: MutationCtx,
  stationId: Id<"stations">,
  play: { artistRaw: string; titleRaw: string; playedAt: number },
): Promise<Doc<"plays"> | null> {
  const artistKey = normalizeForDedup(play.artistRaw);
  const titleKey = normalizeForDedup(play.titleRaw);

  const candidates = await ctx.db
    .query("plays")
    .withIndex("by_station_played_at", (q) =>
      q
        .eq("stationId", stationId)
        .gte("playedAt", play.playedAt - DEDUP_WINDOW_MS)
        .lte("playedAt", play.playedAt + DEDUP_WINDOW_MS),
    )
    .collect();

  for (const row of candidates) {
    if (row.deletedAt !== undefined) continue;
    if (normalizeForDedup(row.artistRaw) !== artistKey) continue;
    if (normalizeForDedup(row.titleRaw) !== titleKey) continue;
    return row;
  }
  return null;
}

/**
 * Check if an incoming play matches an operator-curated ignore rule
 * (see `enrichmentIgnoreRules` in schema.ts). When it does, the play is
 * still inserted — ingestion should preserve the full history for the
 * rewind timeline — but with `enrichmentStatus: "ignored"`, skipping the
 * enrichment API call and keeping it out of Needs Attention.
 */
async function isIgnoredByRule(
  ctx: MutationCtx,
  stationId: Id<"stations">,
  artistRaw: string,
  titleRaw: string,
): Promise<boolean> {
  const artistKey = normalizeForDedup(artistRaw);
  const titleKey = normalizeForDedup(titleRaw);
  const rule = await ctx.db
    .query("enrichmentIgnoreRules")
    .withIndex("by_station_match", (q) =>
      q.eq("stationId", stationId).eq("artistKey", artistKey).eq("titleKey", titleKey),
    )
    .first();
  return rule !== null;
}

/**
 * Record a batch of normalized plays from a single adapter poll.
 *
 * The adapter produces NormalizedPlay[] — this mutation maps them into
 * `plays` rows and dedups against any existing play on the same station
 * with the same (artistRaw, titleRaw) within ±5s, so that rapid re-polls
 * AND a parallel ICY/SG source writing the same song-change don't create
 * duplicate rows. See `findDuplicatePlay` for the full window rationale.
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
      const dup = await findDuplicatePlay(ctx, source.stationId, play);
      if (dup !== null) {
        skipped++;
        continue;
      }

      const ignoredByRule = await isIgnoredByRule(
        ctx,
        source.stationId,
        play.artistRaw,
        play.titleRaw,
      );
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
        enrichmentStatus: ignoredByRule ? "ignored" : "pending",
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
 *   - Dedups by `(stationId, artistRaw, titleRaw)` within ±5s, which
 *     catches both rapid re-reads and the parallel SG+ICY writes that
 *     Rhythm Lab produces. See `findDuplicatePlay`.
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

    const dup = await findDuplicatePlay(ctx, source.stationId, play);
    if (dup !== null) {
      return { inserted: false as const, reason: "duplicate" as const };
    }

    const ignoredByRule = await isIgnoredByRule(
      ctx,
      source.stationId,
      play.artistRaw,
      play.titleRaw,
    );
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
      enrichmentStatus: ignoredByRule ? "ignored" : "pending",
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
 * Single most-recent non-deleted, non-ignored play for a station. Drives
 * each station card's now-playing row AND the public embed widget's
 * now-playing strip. Station IDs / promos / legal IDs get
 * `enrichmentStatus: "ignored"` via the operator-curated ignore rules
 * (see `enrichmentIgnoreRules` in schema.ts) and are skipped here so
 * they never appear as "now playing" on radiomilwaukee.org.
 *
 * Walks a small window of recent plays rather than using `.first()` —
 * if the literal most-recent play was ignored, we want the real song
 * playing before it, not null.
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

    const candidates = await ctx.db
      .query("plays")
      .withIndex("by_station_played_at", (q) => q.eq("stationId", station._id))
      .order("desc")
      .take(20);

    const latest = candidates.find(
      (p) => p.deletedAt === undefined && p.enrichmentStatus !== "ignored",
    );
    if (latest === undefined) return null;

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
 * Public recent-plays view — drives both the dashboard wall and the
 * embed widgets. Station IDs / promos / legal IDs (enrichmentStatus
 * "ignored") are filtered out so they don't appear in the playlist
 * on radiomilwaukee.org.
 *
 * Over-fetches ~50% beyond `limit` so that ignored rows don't shrink
 * the returned set below what the caller asked for in most cases.
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
    const fetchMany = Math.min(Math.ceil(take * 1.5) + 5, 200);
    const plays = await ctx.db
      .query("plays")
      .withIndex("by_station_played_at", (q) => q.eq("stationId", station._id))
      .order("desc")
      .take(fetchMany);

    return plays
      .filter((p) => p.deletedAt === undefined && p.enrichmentStatus !== "ignored")
      .slice(0, take)
      .map((p) => ({
        _id: p._id,
        artistRaw: p.artistRaw,
        titleRaw: p.titleRaw,
        albumRaw: p.albumRaw,
        playedAt: p.playedAt,
      }));
  },
});
