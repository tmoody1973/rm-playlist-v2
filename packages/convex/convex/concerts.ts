import { v } from "convex/values";
import type { Infer } from "convex/values";
import { type QueryCtx, query } from "./_generated/server";
import { type LiveEventSummary, toLiveEventSummary } from "./plays";
import { followDuplicates, withEventDetails, withStationContext } from "./concertsLogic";
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
  handler: async (
    ctx,
    { stationSlug },
  ): Promise<Array<LiveEventSummary & { metro: string; playCount: number }>> => {
    const cached = await ctx.db
      .query("stationArtistShows")
      .withIndex("by_key", (q) => q.eq("key", stationSlug))
      .first();
    if (cached === null) return [];

    const summaries = await Promise.all(cached.shows.map((show) => summarizeShow(ctx, show)));
    return summaries.filter((summary) => summary !== null);
  },
});

async function summarizeShow(
  ctx: QueryCtx,
  show: CachedShow,
): Promise<(LiveEventSummary & { metro: string; playCount: number }) | null> {
  // ponytail: rows cached before eventId existed are skipped; the 3-hourly refresh fills them in.
  if (show.eventId === undefined) return null;
  const event = await ctx.db.get(show.eventId);
  if (event === null || event.duplicateOf !== undefined) return null;
  if (event.status === "cancelled" || event.status === "postponed") return null;
  // metro and playCount are for the HYFIN site's events page; the widget ignores them.
  return withStationContext(
    await toLiveEventSummary(ctx, { event, matchedArtistName: show.artistName, role: show.role }),
    show,
  );
}

/**
 * One event by id, for the HYFIN site's event pages: past, cancelled and postponed events included (the page
 * says so), duplicates resolved to the canonical event. A malformed or unknown id answers null, never throws.
 */
export const eventById = query({
  args: { eventId: v.string() },
  handler: async (ctx, { eventId }) => {
    const id = ctx.db.normalizeId("events", eventId);
    if (id === null) return null;
    const found = await ctx.db.get(id);
    if (found === null) return null;
    const event = await followDuplicates(found, async (next) => {
      const nextId = ctx.db.normalizeId("events", next);
      return nextId === null ? null : await ctx.db.get(nextId);
    });
    if (event === null) return null;
    const lineup = await ctx.db
      .query("eventArtists")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();
    const headliner =
      lineup.find((a) => a.role === "headliner")?.artistNameRaw ?? event.title ?? "";
    const summary = await toLiveEventSummary(ctx, {
      event,
      matchedArtistName: headliner,
      role: "headliner",
    });
    return withEventDetails(summary, event);
  },
});
