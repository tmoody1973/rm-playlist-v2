import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Geographic regions a station cares about for events polling.
 *
 * Schema details in schema.ts. This module owns the CRUD surface for
 * the operator settings page and the read path for the
 * poll-ticketmaster cron (and the future poll-axs cron).
 *
 * When no rows exist for an org, the cron falls back to the
 * hardcoded Milwaukee + Madison + Chicago anchors built into
 * src/trigger/poll-ticketmaster.ts. Adding even one row in the
 * settings UI takes over from those defaults — operators get
 * explicit control without forcing them to re-enter the defaults
 * just to make a small tweak.
 */

const REGION_KIND = v.union(
  v.literal("dma"),
  v.literal("radius"),
  v.literal("venue_list"),
  v.literal("country"),
);

// ---------------------------------------------------------------- //
// Queries
// ---------------------------------------------------------------- //

/**
 * Enabled regions for an org, used by polling crons. Returns shaped
 * rows with the config blob unwrapped (still v.any() to handle the
 * four kinds without a discriminated validator — the cron does its
 * own kind-based parsing).
 */
export const listEnabledForOrg = query({
  args: { orgSlug: v.string() },
  handler: async (ctx, { orgSlug }) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", orgSlug))
      .first();
    if (org === null) return [];
    const rows = await ctx.db
      .query("stationRegions")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();
    return rows
      .filter((r) => r.enabled)
      .map((r) => ({
        _id: r._id,
        stationId: r.stationId,
        kind: r.kind,
        config: r.config,
        label: r.label,
      }));
  },
});

/**
 * All regions (enabled + disabled) for the operator settings UI.
 * Includes station label so the table can render "Milwaukee →
 * 88Nine" without a follow-up query.
 */
export const listAllForOrg = query({
  args: { orgSlug: v.string() },
  handler: async (ctx, { orgSlug }) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", orgSlug))
      .first();
    if (org === null) return [];
    const rows = await ctx.db
      .query("stationRegions")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();
    const stations = await ctx.db.query("stations").collect();
    const stationById = new Map(stations.map((s) => [s._id, s]));
    return rows
      .map((r) => ({
        _id: r._id,
        stationId: r.stationId,
        stationSlug: stationById.get(r.stationId)?.slug ?? null,
        stationName: stationById.get(r.stationId)?.name ?? null,
        kind: r.kind,
        config: r.config,
        label: r.label,
        enabled: r.enabled,
        createdAt: r.createdAt,
      }))
      .sort((a, b) => a.createdAt - b.createdAt);
  },
});

// ---------------------------------------------------------------- //
// Mutations
// ---------------------------------------------------------------- //

// TODO(security): same threat profile as plays.recordPolledPlays —
// public mutation, callable by anyone with the Convex URL. Add a
// shared-secret HMAC + role check (admin only) before partner
// stations onboard. For shakedown the dashboard is allowlist-gated
// to RM emails so this is acceptable.
export const create = mutation({
  args: {
    orgSlug: v.string(),
    stationSlug: v.union(
      v.literal("hyfin"),
      v.literal("88nine"),
      v.literal("414music"),
      v.literal("rhythmlab"),
    ),
    kind: REGION_KIND,
    config: v.any(),
    label: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", args.orgSlug))
      .first();
    if (org === null) throw new Error(`Unknown org: ${args.orgSlug}`);
    const station = await ctx.db
      .query("stations")
      .withIndex("by_slug", (q) => q.eq("slug", args.stationSlug))
      .first();
    if (station === null) throw new Error(`Unknown station: ${args.stationSlug}`);

    return await ctx.db.insert("stationRegions", {
      orgId: org._id,
      stationId: station._id,
      kind: args.kind,
      config: args.config,
      label: args.label,
      enabled: args.enabled ?? true,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    regionId: v.id("stationRegions"),
    config: v.optional(v.any()),
    label: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, { regionId, config, label, enabled }) => {
    const patch: Record<string, unknown> = {};
    if (config !== undefined) patch.config = config;
    if (label !== undefined) patch.label = label;
    if (enabled !== undefined) patch.enabled = enabled;
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(regionId, patch);
    }
  },
});

export const remove = mutation({
  args: { regionId: v.id("stationRegions") },
  handler: async (ctx, { regionId }) => {
    await ctx.db.delete(regionId);
  },
});

// Re-export the kind validator so future modules (the cron
// adapter, audit log, etc.) can import the same source-of-truth
// shape without duplicating the literal union.
export { REGION_KIND };

// Module-level Id helper: return type for create() so callers can
// store the new region id without inferring through any.
export type StationRegionId = Id<"stationRegions">;
