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
 *
 * Surfaces artistRaw/titleRaw from the event context so the dashboard
 * can show WHICH song failed, not just the reason code.
 */
export const recentProblems = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit }) => {
    const take = Math.min(limit ?? 10, 50);

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
      .map((ev) => {
        const ctx = (ev.context ?? {}) as {
          artistRaw?: string;
          titleRaw?: string;
        };
        return {
          _id: ev._id,
          kind: ev.kind,
          message: ev.message,
          station: stationNameById.get(ev.stationId) ?? "?",
          createdAt: ev.createdAt,
          artistRaw: typeof ctx.artistRaw === "string" ? ctx.artistRaw : undefined,
          titleRaw: typeof ctx.titleRaw === "string" ? ctx.titleRaw : undefined,
        };
      });
  },
});

/**
 * Recent ingestion events scoped to a single station. Powers the
 * /dashboard/streams per-station drill-down. Includes ALL event kinds
 * (poll_ok heartbeats + errors + enrichment events) by default — the
 * stream-detail view wants the full activity tail so an operator can
 * see "yes, polls are firing" alongside "but enrichment failed twice
 * in the last hour." Caller can opt out of poll_ok via excludeHealthy
 * if they want a problems-only feed.
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
    excludeHealthy: v.optional(v.boolean()),
  },
  handler: async (ctx, { stationSlug, limit, excludeHealthy }) => {
    const take = Math.min(limit ?? 30, 100);
    const station = await ctx.db
      .query("stations")
      .withIndex("by_slug", (q) => q.eq("slug", stationSlug))
      .first();
    if (station === null) return [];

    // Over-fetch slightly when excluding healthy; the by_station index
    // returns chronological without filtering on `kind`.
    const fetchMany = excludeHealthy === true ? Math.min(take * 4, 400) : take;

    const events = await ctx.db
      .query("ingestionEvents")
      .withIndex("by_station", (q) => q.eq("stationId", station._id))
      .order("desc")
      .take(fetchMany);

    const filtered =
      excludeHealthy === true
        ? events.filter((e) => e.kind !== "poll_ok" && e.kind !== "enrichment_ok")
        : events;

    return filtered.slice(0, take).map((ev) => {
      const c = (ev.context ?? {}) as {
        artistRaw?: string;
        titleRaw?: string;
        inserted?: number;
        skipped?: number;
        total?: number;
      };
      return {
        _id: ev._id,
        kind: ev.kind,
        message: ev.message,
        createdAt: ev.createdAt,
        artistRaw: typeof c.artistRaw === "string" ? c.artistRaw : undefined,
        titleRaw: typeof c.titleRaw === "string" ? c.titleRaw : undefined,
        inserted: typeof c.inserted === "number" ? c.inserted : undefined,
        skipped: typeof c.skipped === "number" ? c.skipped : undefined,
      };
    });
  },
});

/**
 * Enrichment-error events in the last 24h, grouped by (station × reason ×
 * artist × title) so a repeating station-ID / DJ-tag / spot that can't be
 * resolved doesn't clutter the dashboard with 47 identical rows. Count
 * communicates severity more than recency — a 47× miss on "Radio
 * Milwaukee Programming Note" is a pattern to ignore, not 47 separate
 * problems.
 */
export const enrichmentProblemsGrouped = query({
  args: {
    limitGroups: v.optional(v.number()),
    windowMs: v.optional(v.number()),
  },
  handler: async (ctx, { limitGroups, windowMs }) => {
    const take = Math.min(limitGroups ?? 15, 50);
    const window = windowMs ?? 24 * 60 * 60 * 1000;
    const since = Date.now() - window;

    const recent = await ctx.db
      .query("ingestionEvents")
      .withIndex("by_created", (q) => q.gte("createdAt", since))
      .order("desc")
      .take(500);

    const stations = await ctx.db.query("stations").collect();
    const stationNameById = new Map(stations.map((s) => [s._id, s.name]));

    interface Group {
      stationId: string;
      station: string;
      reason: string;
      artistRaw?: string;
      titleRaw?: string;
      count: number;
      lastSeenAt: number;
    }
    const groups = new Map<string, Group>();

    for (const ev of recent) {
      if (ev.kind !== "enrichment_error") continue;
      const raw = (ev.context ?? {}) as { artistRaw?: string; titleRaw?: string };
      const artistRaw = typeof raw.artistRaw === "string" ? raw.artistRaw : undefined;
      const titleRaw = typeof raw.titleRaw === "string" ? raw.titleRaw : undefined;
      const key = `${ev.stationId}|${ev.message}|${artistRaw ?? ""}|${titleRaw ?? ""}`;
      const existing = groups.get(key);
      if (existing !== undefined) {
        existing.count += 1;
        if (ev.createdAt > existing.lastSeenAt) existing.lastSeenAt = ev.createdAt;
        continue;
      }
      groups.set(key, {
        stationId: ev.stationId,
        station: stationNameById.get(ev.stationId) ?? "?",
        reason: ev.message,
        artistRaw,
        titleRaw,
        count: 1,
        lastSeenAt: ev.createdAt,
      });
    }

    return (
      Array.from(groups.values())
        // Drop groups where no song info was captured — these predate the
        // context-field fix and render as "Unknown" otherwise, just noise.
        .filter((g) => g.artistRaw !== undefined || g.titleRaw !== undefined)
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
        .slice(0, take)
    );
  },
});
