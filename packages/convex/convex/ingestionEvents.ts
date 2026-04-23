import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

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
