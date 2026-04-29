import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Cross-source event ingestion + dedup.
 *
 * Adapters normalize each upstream source's payload into the same shape
 * (NORMALIZED_EVENT) and call `upsertBatch`. The mutation:
 *
 *   1. Upserts each incoming event by (source, externalId). Custom events
 *      have no externalId, so they always insert.
 *   2. Fans the event's `artists` array into eventArtists rows (idempotent
 *      — re-runs replace, never duplicate).
 *   3. Runs a similarity pass to find a matching event from a different
 *      source (same venue + same date ±2h + overlapping headliner
 *      artistKey). When matched, sets `duplicateOf` on the lower-priority
 *      side. Priority: axs > custom > ticketmaster.
 *
 * Public widget queries filter `duplicateOf === undefined`, so AXS rows
 * silently take over from Ticketmaster rows for the same Pabst show the
 * moment they land — no widget code change needed.
 */

// ---------------------------------------------------------------- //
// Constants
// ---------------------------------------------------------------- //

/**
 * Higher value wins. When two sources describe the same real-world show,
 * the lower-priority row gets `duplicateOf = winner._id`.
 *
 * Rationale (brainstorm § cross-source deduplication):
 *  - axs > ticketmaster: AXS is authoritative for venue-group shows
 *    (Pabst Theater Group for RM); Ticketmaster lists them late or with
 *    worse metadata.
 *  - custom > ticketmaster: when a DJ adds extra context to a show we
 *    already pull from TM, the DJ's annotations win.
 *  - axs > custom: AXS is the canonical primary-ticketing system for
 *    its venues; custom is for shows not on AXS or TM.
 */
const SOURCE_PRIORITY: Record<EventSource, number> = {
  ticketmaster: 1,
  custom: 2,
  axs: 3,
};

/** ±2 hour window for cross-source date-match (brainstorm spec). */
const DEDUP_TIME_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * How far in either direction `by_starts_at` is scanned when looking for
 * dedup candidates. Slightly wider than DEDUP_TIME_WINDOW_MS so callers
 * with mild clock skew still find each other.
 */
const DEDUP_SCAN_WINDOW_MS = DEDUP_TIME_WINDOW_MS + 30 * 60 * 1000;

// ---------------------------------------------------------------- //
// Validators
// ---------------------------------------------------------------- //

const SOURCE = v.union(v.literal("ticketmaster"), v.literal("axs"), v.literal("custom"));

const EVENT_STATUS = v.union(
  v.literal("buyTickets"),
  v.literal("soldOut"),
  v.literal("cancelled"),
  v.literal("postponed"),
  v.literal("rescheduled"),
  v.literal("venueChange"),
  v.literal("free"),
  v.literal("private"),
  v.literal("other"),
);

const NORMALIZED_ARTIST = v.object({
  artistNameRaw: v.string(),
  role: v.union(v.literal("headliner"), v.literal("support")),
  externalPerformerId: v.optional(v.string()),
});

const NORMALIZED_EVENT = v.object({
  externalId: v.optional(v.string()),
  title: v.optional(v.string()),
  presenterName: v.optional(v.string()),
  venueName: v.string(),
  venueExternalId: v.optional(v.string()),
  city: v.string(),
  region: v.string(),
  country: v.optional(v.string()),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
  startsAt: v.number(),
  dateOnly: v.optional(v.boolean()),
  doorsAt: v.optional(v.number()),
  onSaleAt: v.optional(v.number()),
  ticketUrl: v.optional(v.string()),
  status: v.optional(EVENT_STATUS),
  imageUrl: v.optional(v.string()),
  genre: v.optional(v.string()),
  artists: v.array(NORMALIZED_ARTIST),
});

type EventSource = "ticketmaster" | "axs" | "custom";
type NormalizedArtist = {
  artistNameRaw: string;
  role: "headliner" | "support";
  externalPerformerId?: string;
};
type NormalizedEvent = {
  externalId?: string;
  title?: string;
  presenterName?: string;
  venueName: string;
  venueExternalId?: string;
  city: string;
  region: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  startsAt: number;
  dateOnly?: boolean;
  doorsAt?: number;
  onSaleAt?: number;
  ticketUrl?: string;
  status?: Doc<"events">["status"];
  imageUrl?: string;
  genre?: string;
  artists: NormalizedArtist[];
};

// ---------------------------------------------------------------- //
// Normalization helpers (exported for adapters + plays reverse-lookup)
// ---------------------------------------------------------------- //

/**
 * Normalize an artist name to the join key shared between plays and events.
 *
 * Lowercase → strip diacritics → strip articles (the/a/an) → strip every
 * non-alphanumeric. Result is always lowercase ASCII alnum.
 *
 *   "The Beatles"     → "beatles"
 *   "Flying Lotus"    → "flyinglotus"
 *   "Sault"           → "sault"
 *   "Sigur Rós"       → "sigurros"
 *   "A Tribe Called Quest" → "tribecalledquest"
 *
 * The same function is called by Step 4's plays.ts reverse-lookup so the
 * play→event match uses identical normalization on both sides. Distinct
 * from `artists.artistKey` (which uses a slugify form for canonical
 * artist rows) — this key is the cross-source matching key.
 */
export function normalizeEventArtistKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(the|a|an)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Fuzzy-normalize a venue name for cross-source matching. AXS reports
 * "Riverside Theater" and TM might report "The Riverside Theater" or
 * "Riverside Theater - Milwaukee". Strip articles + non-alnum so any
 * of those forms compare equal.
 */
function normalizeVenueName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(the|a|an)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// ---------------------------------------------------------------- //
// Mutation
// ---------------------------------------------------------------- //

// TODO(security): currently callable by anyone with the Convex URL. Same
// threat profile as plays.recordPolledPlays — add a shared-secret HMAC
// check before partner stations go live. Internal mutation isn't an option
// because Trigger.dev tasks call this via the external ConvexHttpClient.
export const upsertBatch = mutation({
  args: {
    orgId: v.id("organizations"),
    source: SOURCE,
    events: v.array(NORMALIZED_EVENT),
  },
  handler: async (ctx, { orgId, source, events }) => {
    let inserted = 0;
    let updated = 0;
    let dedupedNew = 0;
    let dedupedExisting = 0;

    for (const incoming of events) {
      const result = await upsertOneEvent(ctx, orgId, source, incoming);
      if (result.action === "inserted") inserted++;
      else updated++;

      // Cross-source dedup runs AFTER the eventArtists rows are written —
      // the similarity check pivots on artist overlap. upsertOneEvent
      // writes both the events row and its eventArtists rows before
      // returning.
      const dedupOutcome = await applyCrossSourceDedup(ctx, result.eventId, source);
      if (dedupOutcome === "newSuperseded") dedupedNew++;
      else if (dedupOutcome === "existingSuperseded") dedupedExisting++;
    }

    return { inserted, updated, dedupedNew, dedupedExisting };
  },
});

// ---------------------------------------------------------------- //
// Helpers
// ---------------------------------------------------------------- //

async function upsertOneEvent(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  source: EventSource,
  incoming: NormalizedEvent,
): Promise<{ action: "inserted" | "updated"; eventId: Id<"events"> }> {
  const existing =
    incoming.externalId !== undefined
      ? await findExistingByExternal(ctx, source, incoming.externalId)
      : null;

  const fields = {
    orgId,
    source,
    externalId: incoming.externalId,
    title: incoming.title,
    presenterName: incoming.presenterName,
    venueName: incoming.venueName,
    venueExternalId: incoming.venueExternalId,
    city: incoming.city,
    region: incoming.region,
    country: incoming.country,
    latitude: incoming.latitude,
    longitude: incoming.longitude,
    startsAt: incoming.startsAt,
    dateOnly: incoming.dateOnly,
    doorsAt: incoming.doorsAt,
    onSaleAt: incoming.onSaleAt,
    ticketUrl: incoming.ticketUrl,
    status: incoming.status,
    imageUrl: incoming.imageUrl,
    genre: incoming.genre,
  };

  let eventId: Id<"events">;
  let action: "inserted" | "updated";

  if (existing !== null) {
    // Preserve the existing duplicateOf — re-running poll shouldn't undo
    // an earlier dedup decision. The dedup pass after this can OVERWRITE
    // it if priorities have shifted (rare, but possible if a source's
    // metadata changed enough to flip the match).
    await ctx.db.patch(existing._id, fields);
    eventId = existing._id;
    action = "updated";
  } else {
    eventId = await ctx.db.insert("events", {
      ...fields,
      verified: source !== "ticketmaster",
      createdAt: Date.now(),
    });
    action = "inserted";
  }

  await replaceEventArtists(ctx, eventId, incoming.artists);
  return { action, eventId };
}

async function findExistingByExternal(
  ctx: MutationCtx,
  source: EventSource,
  externalId: string,
): Promise<Doc<"events"> | null> {
  return ctx.db
    .query("events")
    .withIndex("by_external_id", (q) => q.eq("source", source).eq("externalId", externalId))
    .first();
}

/**
 * Idempotent eventArtists fanout. Wipes prior rows for this event and
 * re-inserts from the incoming list. Cheap (events have ≤10 artists in
 * practice; typical music event has 1-4) and avoids the alternative of
 * computing a diff between old + new.
 */
async function replaceEventArtists(
  ctx: MutationCtx,
  eventId: Id<"events">,
  artists: NormalizedArtist[],
): Promise<void> {
  const existing = await ctx.db
    .query("eventArtists")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();

  for (const row of existing) {
    await ctx.db.delete(row._id);
  }

  for (const artist of artists) {
    await ctx.db.insert("eventArtists", {
      eventId,
      artistNameRaw: artist.artistNameRaw,
      artistKey: normalizeEventArtistKey(artist.artistNameRaw),
      role: artist.role,
      externalPerformerId: artist.externalPerformerId,
    });
  }
}

/**
 * Looks for a different-source event that describes the same real-world
 * show. Match criteria (all three required):
 *   - different `source`
 *   - normalized venueName equal (article-stripped, alnum-collapsed)
 *   - startsAt within ±DEDUP_TIME_WINDOW_MS
 *   - at least one shared HEADLINER artistKey
 *
 * When found, sets `duplicateOf` on the lower-priority side.
 *
 * Returns:
 *   "none"               → no candidate matched
 *   "newSuperseded"      → the just-upserted event lost; its duplicateOf set
 *   "existingSuperseded" → an existing (other-source) event lost; its duplicateOf set
 */
async function applyCrossSourceDedup(
  ctx: MutationCtx,
  eventId: Id<"events">,
  source: EventSource,
): Promise<"none" | "newSuperseded" | "existingSuperseded"> {
  const newEvent = await ctx.db.get(eventId);
  if (newEvent === null) return "none";

  const newHeadliners = await loadHeadlinerKeys(ctx, eventId);
  if (newHeadliners.size === 0) return "none";

  const newVenueKey = normalizeVenueName(newEvent.venueName);

  const candidates = await ctx.db
    .query("events")
    .withIndex("by_starts_at", (q) =>
      q
        .gte("startsAt", newEvent.startsAt - DEDUP_SCAN_WINDOW_MS)
        .lte("startsAt", newEvent.startsAt + DEDUP_SCAN_WINDOW_MS),
    )
    .collect();

  for (const candidate of candidates) {
    if (candidate._id === eventId) continue;
    if (candidate.source === source) continue;
    if (Math.abs(candidate.startsAt - newEvent.startsAt) > DEDUP_TIME_WINDOW_MS) continue;
    if (normalizeVenueName(candidate.venueName) !== newVenueKey) continue;

    const candidateHeadliners = await loadHeadlinerKeys(ctx, candidate._id);
    if (!hasIntersection(newHeadliners, candidateHeadliners)) continue;

    // Match. Resolve priority — winner takes nothing extra; loser gets
    // duplicateOf set to winner._id.
    const newPriority = SOURCE_PRIORITY[source];
    const candidatePriority = SOURCE_PRIORITY[candidate.source as EventSource];

    if (newPriority >= candidatePriority) {
      // New side wins (ties on insert order, but ties shouldn't happen
      // since priorities are distinct per source). Existing gets
      // duplicateOf set, unless it already points there.
      if (candidate.duplicateOf !== eventId) {
        await ctx.db.patch(candidate._id, { duplicateOf: eventId });
      }
      // If new event was previously marked as a duplicate of someone,
      // clear that — we just won.
      if (newEvent.duplicateOf !== undefined) {
        await ctx.db.patch(eventId, { duplicateOf: undefined });
      }
      return "existingSuperseded";
    } else {
      // Existing side wins. New event gets duplicateOf set.
      if (newEvent.duplicateOf !== candidate._id) {
        await ctx.db.patch(eventId, { duplicateOf: candidate._id });
      }
      return "newSuperseded";
    }
  }

  return "none";
}

async function loadHeadlinerKeys(ctx: MutationCtx, eventId: Id<"events">): Promise<Set<string>> {
  const rows = await ctx.db
    .query("eventArtists")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.role === "headliner") keys.add(row.artistKey);
  }
  return keys;
}

function hasIntersection<T>(a: Set<T>, b: Set<T>): boolean {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- //
// Helper queries (called by Trigger.dev tasks)
// ---------------------------------------------------------------- //

/**
 * Single-tenant org lookup. Trigger.dev tasks call this to resolve the
 * RM org id at the start of each run; multi-tenant activation will swap
 * this for a per-region or per-station listing.
 */
// Public so Trigger.dev tasks (poll-ticketmaster, future poll-axs) can call
// it via ConvexHttpClient. Single-tenant lookup; safe to expose.
export const getOrgIdBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }): Promise<Id<"organizations"> | null> => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    return org?._id ?? null;
  },
});
