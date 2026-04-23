import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

/**
 * Append-only log of every poll attempt, success, failure, enrichment
 * event, or operator action. Drives the "Needs Attention" panel and the
 * per-station "last 24h of weird" view on the dashboard.
 *
 * Always called via internal mutation — not exposed to widgets or public.
 */
export const log = internalMutation({
  args: {
    orgId: v.id("organizations"),
    stationId: v.id("stations"),
    sourceId: v.id("ingestionSources"),
    kind: v.union(
      v.literal("poll_ok"),
      v.literal("poll_error"),
      v.literal("source_paused"),
      v.literal("source_resumed"),
      v.literal("drift_detected"),
      v.literal("enrichment_ok"),
      v.literal("enrichment_error"),
    ),
    message: v.string(),
    context: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("ingestionEvents", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

/**
 * Recent non-success events for the dashboard "Needs Attention" panel.
 * Returns the last N events whose kind is NOT `poll_ok` / `enrichment_ok`,
 * ordered newest-first. Empty result means everything is clean.
 */
export const recentProblems = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit }) => {
    const take = Math.min(limit ?? 10, 50);

    // Pull recent events and filter in memory — for Milestone 5 volume
    // (~4 polls/min = ~5000/day total) this is cheap. When partner stations
    // light up and the table gets bigger, swap to a dedicated index or
    // separate `problems` table that only receives non-ok kinds.
    const recent = await ctx.db
      .query("ingestionEvents")
      .withIndex("by_created")
      .order("desc")
      .take(200);

    const stations = await ctx.db.query("stations").collect();
    const stationNameById = new Map(stations.map((s) => [s._id, s.name]));

    return recent
      .filter((ev) => ev.kind !== "poll_ok" && ev.kind !== "enrichment_ok")
      .slice(0, take)
      .map((ev) => ({
        _id: ev._id,
        kind: ev.kind,
        message: ev.message,
        station: stationNameById.get(ev.stationId) ?? "?",
        createdAt: ev.createdAt,
      }));
  },
});
