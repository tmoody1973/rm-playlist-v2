import { v } from "convex/values";
import type { Infer } from "convex/values";
import { type QueryCtx, query } from "./_generated/server";
import { type LiveEventSummary, toLiveEventSummary } from "./plays";
import type { stationArtistShowValidator } from "./schema";

type CachedShow = Infer<typeof stationArtistShowValidator>;

/**
 * Upcoming shows by artists a station plays, for the playlist widget's
 * Concerts tab. Reads the per-station cache that events.refreshStationArtistShows
 * rebuilds every 3 hours, then loads each event so rows match the inline
 * concert card (title, lineup, AXS/Ticketmaster source).
 *
 * No clock here on purpose: the widget trims to the next 60 days with the
 * listener's clock (concertsLogic.ts), so this answer only changes when the
 * cache or an event changes and Convex can serve it from cache otherwise.
 */
export const upcomingByStation = query({
  args: {
    stationSlug: v.union(
      v.literal("hyfin"),
      v.literal("88nine"),
      v.literal("414music"),
      v.literal("rhythmlab"),
    ),
  },
  handler: async (ctx, { stationSlug }): Promise<LiveEventSummary[]> => {
    const cached = await ctx.db
      .query("stationArtistShows")
      .withIndex("by_key", (q) => q.eq("key", stationSlug))
      .first();
    if (cached === null) return [];

    const summaries = await Promise.all(cached.shows.map((show) => summarizeShow(ctx, show)));
    return summaries.filter((summary) => summary !== null);
  },
});

async function summarizeShow(ctx: QueryCtx, show: CachedShow): Promise<LiveEventSummary | null> {
  // ponytail: rows cached before eventId existed are skipped; the 3-hourly refresh fills them in.
  if (show.eventId === undefined) return null;
  const event = await ctx.db.get(show.eventId);
  if (event === null || event.duplicateOf !== undefined) return null;
  if (event.status === "cancelled" || event.status === "postponed") return null;
  return toLiveEventSummary(ctx, { event, matchedArtistName: show.artistName, role: show.role });
}
