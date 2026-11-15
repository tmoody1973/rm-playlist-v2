import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, internalMutation } from "./_generated/server";
import {
  TOP_SONGS_SNAPSHOT_SIZE,
  TOP_SONGS_WINDOWS,
  type RankedPlay,
  type TopSongsWindowDays,
  rankTopPlays,
  windowStartMs,
} from "./topSongsLogic";

/**
 * Hourly Top 7 / Top 30 snapshots. Counting live inside the widget's
 * subscription re-read every play in the window (~12k rows, ~9.5 MB for
 * 88Nine) each time a play landed or was enriched. Here that read happens
 * once an hour per station.
 */

export async function loadCountablePlays(
  ctx: QueryCtx,
  stationId: Id<"stations">,
  sinceMs: number,
): Promise<Doc<"plays">[]> {
  return ctx.db
    .query("plays")
    .withIndex("by_station_played_at", (q) => q.eq("stationId", stationId).gte("playedAt", sinceMs))
    .collect();
}

/**
 * Top `take` songs from the snapshot, or null when the station has none yet.
 * Plays deleted since the snapshot are skipped rather than shown.
 */
export async function readTopSongsSnapshot(
  ctx: QueryCtx,
  stationId: Id<"stations">,
  windowDays: TopSongsWindowDays,
  take: number,
): Promise<RankedPlay<Doc<"plays">>[] | null> {
  const snapshot = await findSnapshot(ctx, stationId, windowDays);
  if (snapshot === null) return null;

  const rows = await Promise.all(
    snapshot.entries.slice(0, take).map(async ({ playId, playCount }) => {
      const play = await ctx.db.get(playId);
      return play === null || play.deletedAt !== undefined ? null : { play, playCount };
    }),
  );
  return rows.filter((row) => row !== null);
}

function findSnapshot(
  ctx: QueryCtx,
  stationId: Id<"stations">,
  windowDays: TopSongsWindowDays,
): Promise<Doc<"topSongsSnapshots"> | null> {
  return ctx.db
    .query("topSongsSnapshots")
    .withIndex("by_station_window", (q) =>
      q.eq("stationId", stationId).eq("windowDays", windowDays),
    )
    .unique();
}

/** Cron entry point: one transaction per station keeps each read within Convex limits. */
export const refreshAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stations = await ctx.db.query("stations").collect();
    for (const station of stations) {
      await ctx.scheduler.runAfter(0, internal.topSongs.refreshStation, { stationId: station._id });
    }
  },
});

export const refreshStation = internalMutation({
  args: { stationId: v.id("stations") },
  handler: async (ctx, { stationId }) => {
    const nowMs = Date.now();
    const longestWindow = Math.max(...TOP_SONGS_WINDOWS) as TopSongsWindowDays;
    const plays = await loadCountablePlays(ctx, stationId, windowStartMs(nowMs, longestWindow));

    for (const windowDays of TOP_SONGS_WINDOWS) {
      const entries = rankTopPlays(
        plays,
        windowStartMs(nowMs, windowDays),
        TOP_SONGS_SNAPSHOT_SIZE,
      ).map(({ play, playCount }) => ({ playId: play._id, playCount }));
      const existing = await findSnapshot(ctx, stationId, windowDays);
      if (existing === null) {
        await ctx.db.insert("topSongsSnapshots", {
          stationId,
          windowDays,
          entries,
          refreshedAt: nowMs,
        });
      } else {
        await ctx.db.patch(existing._id, { entries, refreshedAt: nowMs });
      }
    }
  },
});
