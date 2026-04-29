import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

/**
 * Seed or upsert an ingestion source row.
 *
 * Idempotent — if a row already exists for (stationId, adapter, role),
 * updates it in place rather than inserting a duplicate.
 */
export const upsert = internalMutation({
  args: {
    stationSlug: v.union(
      v.literal("hyfin"),
      v.literal("88nine"),
      v.literal("414music"),
      v.literal("rhythmlab"),
    ),
    adapter: v.union(v.literal("spinitron"), v.literal("sgmetadata"), v.literal("icy")),
    role: v.union(v.literal("primary"), v.literal("supplementary"), v.literal("shadow")),
    config: v.any(),
    pollIntervalSec: v.optional(v.number()),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const station = await ctx.db
      .query("stations")
      .withIndex("by_slug", (q) => q.eq("slug", args.stationSlug))
      .first();
    if (station === null) {
      throw new Error(`Station not seeded: ${args.stationSlug}`);
    }

    const existing = await ctx.db
      .query("ingestionSources")
      .withIndex("by_station", (q) => q.eq("stationId", station._id))
      .filter((q) =>
        q.and(q.eq(q.field("adapter"), args.adapter), q.eq(q.field("role"), args.role)),
      )
      .first();

    const now = Date.now();

    if (existing !== null) {
      await ctx.db.patch(existing._id, {
        config: args.config,
        pollIntervalSec: args.pollIntervalSec,
        enabled: args.enabled,
      });
      return { sourceId: existing._id, action: "updated" as const };
    }

    const sourceId = await ctx.db.insert("ingestionSources", {
      orgId: station.orgId,
      stationId: station._id,
      adapter: args.adapter,
      role: args.role,
      config: args.config,
      pollIntervalSec: args.pollIntervalSec,
      enabled: args.enabled,
      createdAt: now,
    });
    return { sourceId, action: "inserted" as const };
  },
});

/**
 * Read a source by ID. Called by the Trigger.dev task before polling.
 * Internal only — never expose ingestion config (may contain apiKeyRef
 * pointing at secrets).
 */
export const get = internalQuery({
  args: { sourceId: v.id("ingestionSources") },
  handler: async (ctx, { sourceId }) => {
    const source = await ctx.db.get(sourceId);
    if (source === null) return null;
    const station = await ctx.db.get(source.stationId);
    return { source, station };
  },
});

/**
 * Get all enabled sources. Used by the Trigger dispatcher.
 */
export const listEnabled = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sources: Doc<"ingestionSources">[] = await ctx.db
      .query("ingestionSources")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect();
    return sources;
  },
});

/**
 * Update lastSuccessAt. Called by Trigger task after a successful poll.
 */
export const markSuccess = internalMutation({
  args: { sourceId: v.id("ingestionSources") },
  handler: async (ctx, { sourceId }) => {
    await ctx.db.patch(sourceId, { lastSuccessAt: Date.now() });
  },
});

/**
 * Public read: every enabled source with the minimum fields needed to poll.
 * Consumed by the Trigger.dev dispatcher task (`poll-all-sources`). Omits
 * sensitive-adjacent fields like `lastSuccessAt` that are dashboard-scoped.
 *
 * `config.apiKeyRef` is the NAME of the env var holding the real secret,
 * not the secret itself. `config.scraperUuid` is an opaque identifier.
 * Neither is a secret — safe to expose on a public query.
 */
export const listEnabledForPolling = query({
  args: {},
  handler: async (ctx) => {
    const sources = await ctx.db
      .query("ingestionSources")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect();

    const stations = await ctx.db.query("stations").collect();
    const stationSlugById = new Map(stations.map((s) => [s._id, s.slug]));

    const rows: Array<{
      _id: Doc<"ingestionSources">["_id"];
      stationSlug: Doc<"stations">["slug"];
      adapter: Doc<"ingestionSources">["adapter"];
      role: Doc<"ingestionSources">["role"];
      config: {
        apiKeyRef?: string;
        scraperUuid?: string;
        count?: number;
        /** ICY adapter: full HTTP(S) URL of the broadcaster stream. */
        streamUrl?: string;
      };
    }> = [];
    for (const s of sources) {
      const stationSlug = stationSlugById.get(s.stationId);
      if (stationSlug === undefined) continue;
      rows.push({
        _id: s._id,
        stationSlug,
        adapter: s.adapter,
        role: s.role,
        config: s.config as {
          apiKeyRef?: string;
          scraperUuid?: string;
          count?: number;
          streamUrl?: string;
        },
      });
    }
    return rows;
  },
});

/**
 * Seed/upsert a Rhythm Lab-style ICY source without a poll interval.
 *
 * Distinct from `upsert` because ICY sources carry `config.streamUrl`
 * rather than `apiKeyRef/scraperUuid`, and have no meaningful poll
 * interval (the worker holds a persistent connection).
 *
 * Called once per station via `bunx convex run ingestionSources:upsertIcy
 *   '{ "stationSlug": "rhythmlab", "streamUrl": "https://...", "role": "primary", "enabled": true }'`
 */
export const upsertIcy = internalMutation({
  args: {
    stationSlug: v.union(
      v.literal("hyfin"),
      v.literal("88nine"),
      v.literal("414music"),
      v.literal("rhythmlab"),
    ),
    streamUrl: v.string(),
    role: v.union(v.literal("primary"), v.literal("supplementary"), v.literal("shadow")),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const station = await ctx.db
      .query("stations")
      .withIndex("by_slug", (q) => q.eq("slug", args.stationSlug))
      .first();
    if (station === null) {
      throw new Error(`Station not seeded: ${args.stationSlug}`);
    }

    const existing = await ctx.db
      .query("ingestionSources")
      .withIndex("by_station", (q) => q.eq("stationId", station._id))
      .filter((q) => q.and(q.eq(q.field("adapter"), "icy"), q.eq(q.field("role"), args.role)))
      .first();

    const config = { streamUrl: args.streamUrl };
    const now = Date.now();

    if (existing !== null) {
      await ctx.db.patch(existing._id, {
        config,
        enabled: args.enabled,
      });
      return { sourceId: existing._id, action: "updated" as const };
    }

    const sourceId = await ctx.db.insert("ingestionSources", {
      orgId: station.orgId,
      stationId: station._id,
      adapter: "icy",
      role: args.role,
      config,
      enabled: args.enabled,
      createdAt: now,
    });
    return { sourceId, action: "inserted" as const };
  },
});

/**
 * One-off cleanup: disable a source by id. Used to retire duplicates that
 * accrued during rapid seed iteration.
 */
export const disableById = internalMutation({
  args: { sourceId: v.id("ingestionSources") },
  handler: async (ctx, { sourceId }) => {
    await ctx.db.patch(sourceId, { enabled: false });
  },
});

// TODO(security): callable by anyone with the Convex URL — same threat
// profile as plays.recordPolledPlays. Add an admin-role + HMAC check
// before partner stations onboard. Today the dashboard is allowlist-
// gated to RM emails (apps/web/app/dashboard/layout.tsx) so this is
// acceptable for shakedown.
export const setEnabled = mutation({
  args: {
    sourceId: v.id("ingestionSources"),
    enabled: v.boolean(),
  },
  handler: async (ctx, { sourceId, enabled }) => {
    await ctx.db.patch(sourceId, { enabled });
  },
});

/**
 * Public-read view of ingestion status per station, for the dashboard
 * "Needs Attention" panel. Omits config (which contains apiKeyRef).
 */
export const statusForDashboard = query({
  args: {},
  handler: async (ctx) => {
    const sources = await ctx.db.query("ingestionSources").collect();
    const stations = await ctx.db.query("stations").collect();
    const stationsById = new Map(stations.map((s) => [s._id, s]));
    return sources.map((source) => ({
      _id: source._id,
      station: stationsById.get(source.stationId)?.name ?? "?",
      stationSlug: stationsById.get(source.stationId)?.slug ?? "?",
      adapter: source.adapter,
      role: source.role,
      enabled: source.enabled,
      lastSuccessAt: source.lastSuccessAt,
    }));
  },
});
