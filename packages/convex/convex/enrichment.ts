import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";

/**
 * Enrichment pipeline Convex surface.
 *
 * Called by the `enrich-pending-plays` Trigger.dev task (session 2):
 * fetch pending plays via `pendingPlays`, run them through
 * `@rm/enrichment` (Apple Music + MusicBrainz in parallel), then
 * persist matches via `upsertArtist*` / `upsertTrack` / `markPlay*`.
 *
 * TODO(security): every function here is unauthenticated public
 * callable, mirroring the `plays.recordPolledPlays` pattern. Session 3
 * adds HMAC-signed requests from the Trigger worker — the single-
 * tenant RM shakedown is acceptable exposure; do NOT ship widgets that
 * expose the Convex URL until auth lands.
 */

export const pendingPlays = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit }) => {
    const take = Math.min(limit ?? 50, 200);
    const rows = await ctx.db
      .query("plays")
      .withIndex("by_enrichment_status", (q) => q.eq("enrichmentStatus", "pending"))
      .order("asc")
      .take(take);

    // Resolve station slugs once — only 4 stations during shakedown, so
    // one .collect() is cheaper than `ctx.db.get(stationId)` per play.
    // The orchestrator needs the slug to apply station-specific fallbacks
    // (e.g. default to "Self-released" for 414 Music when all label
    // tiers miss — see project_stations memory).
    const stations = await ctx.db.query("stations").collect();
    const slugById = new Map(stations.map((s) => [s._id, s.slug]));

    return rows.map((p) => ({
      _id: p._id,
      stationId: p.stationId,
      stationSlug: slugById.get(p.stationId),
      sourceId: p.sourceId,
      orgId: p.orgId,
      artistRaw: p.artistRaw,
      titleRaw: p.titleRaw,
      playedAt: p.playedAt,
    }));
  },
});

export const upsertArtistByMbid = mutation({
  args: {
    mbid: v.string(),
    displayName: v.string(),
    appleMusicId: v.optional(v.string()),
  },
  handler: async (ctx, { mbid, displayName, appleMusicId }) => {
    const existing = await ctx.db
      .query("artists")
      .withIndex("by_mbid", (q) => q.eq("mbid", mbid))
      .first();
    if (existing !== null) {
      const patch: Partial<Doc<"artists">> = {};
      if (appleMusicId && existing.appleMusicId !== appleMusicId) patch.appleMusicId = appleMusicId;
      if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("artists", {
      artistKey: normalizeArtistKey(displayName),
      displayName,
      mbid,
      appleMusicId,
      verified: false,
      createdAt: Date.now(),
    });
  },
});

export const upsertArtistByAppleMusicId = mutation({
  args: {
    appleMusicId: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, { appleMusicId, displayName }) => {
    const existing = await ctx.db
      .query("artists")
      .withIndex("by_apple_music", (q) => q.eq("appleMusicId", appleMusicId))
      .first();
    if (existing !== null) return existing._id;
    return await ctx.db.insert("artists", {
      artistKey: normalizeArtistKey(displayName),
      displayName,
      appleMusicId,
      verified: false,
      createdAt: Date.now(),
    });
  },
});

export const upsertTrack = mutation({
  args: {
    artistId: v.id("artists"),
    displayTitle: v.string(),
    appleMusicSongId: v.optional(v.string()),
    albumDisplayName: v.optional(v.string()),
    recordLabel: v.optional(v.string()),
    isrc: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    artworkUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const artworkUrl = sanitizeArtworkUrl(args.artworkUrl);
    if (args.appleMusicSongId) {
      const existing = await ctx.db
        .query("tracks")
        .withIndex("by_apple_music", (q) => q.eq("appleMusicSongId", args.appleMusicSongId))
        .first();
      if (existing !== null) {
        // Backfill SoundExchange-relevant fields on older rows that were
        // upserted before these fields were captured. Only patch when the
        // new arg is defined AND the existing row is empty for that field.
        const patch: Partial<Doc<"tracks">> = {};
        if (args.albumDisplayName && !existing.albumDisplayName) {
          patch.albumDisplayName = args.albumDisplayName;
        }
        if (args.recordLabel && !existing.recordLabel) {
          patch.recordLabel = args.recordLabel;
        }
        if (args.isrc && !existing.isrc) patch.isrc = args.isrc;
        if (args.durationSec && !existing.durationSec) patch.durationSec = args.durationSec;
        if (artworkUrl && !existing.artworkUrl) patch.artworkUrl = artworkUrl;
        if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
        return existing._id;
      }
    }
    return await ctx.db.insert("tracks", {
      trackKey: normalizeTrackKey(args.displayTitle, args.artistId),
      displayTitle: args.displayTitle,
      artistId: args.artistId,
      albumDisplayName: args.albumDisplayName,
      recordLabel: args.recordLabel,
      isrc: args.isrc,
      durationSec: args.durationSec,
      appleMusicSongId: args.appleMusicSongId,
      artworkUrl,
      verified: false,
      createdAt: Date.now(),
    });
  },
});

export const markPlayEnriched = mutation({
  args: {
    playId: v.id("plays"),
    canonicalArtistId: v.id("artists"),
    // Relaxed to optional in session 2 — an MB-only match produces a
    // canonicalArtistId without a corresponding track (no Apple Music
    // song ID to anchor one).
    canonicalTrackId: v.optional(v.id("tracks")),
    context: v.optional(v.any()),
  },
  handler: async (ctx, { playId, canonicalArtistId, canonicalTrackId, context }) => {
    const play = await loadPlay(ctx, playId);
    const patch: Partial<Doc<"plays">> = {
      canonicalArtistId,
      enrichmentStatus: "resolved",
    };
    if (canonicalTrackId !== undefined) patch.canonicalTrackId = canonicalTrackId;
    await ctx.db.patch(playId, patch);
    await ctx.runMutation(internal.ingestionEvents.log, {
      orgId: play.orgId,
      stationId: play.stationId,
      sourceId: play.sourceId,
      kind: "enrichment_ok",
      message:
        canonicalTrackId !== undefined
          ? "enriched via apple music + musicbrainz"
          : "enriched via musicbrainz only (partial)",
      context,
    });
  },
});

/**
 * Operator action — fix the raw artist/title for an unresolved group
 * and kick re-enrichment. Patches every matching unresolved play
 * (by station + current artistRaw/titleRaw) with the new hints, then
 * flips status back to `pending` so the next enrich cron tick picks
 * them up with the better strings.
 *
 * Useful when the source feed delivered a typo or a misleading
 * StreamTitle ("Metalica" → "Metallica", or "DJ Intro" → "Actual
 * Artist — Actual Title").
 *
 * Audit via ingestionEvents.log using the existing `source_resumed`
 * kind — reusing rather than expanding the union for session 3. A
 * dedicated `override_applied` kind is a session-4 clean-up.
 */
// TODO(security): HMAC + user attribution. Session 3 security pass.
export const overrideUnresolvedIdentity = mutation({
  args: {
    stationId: v.id("stations"),
    fromArtistRaw: v.string(),
    fromTitleRaw: v.string(),
    toArtistRaw: v.string(),
    toTitleRaw: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { stationId, fromArtistRaw, fromTitleRaw, toArtistRaw, toTitleRaw, limit },
  ) => {
    const nextArtist = toArtistRaw.trim();
    const nextTitle = toTitleRaw.trim();
    if (nextArtist.length === 0 || nextTitle.length === 0) {
      throw new Error("override artist and title must both be non-empty");
    }
    if (nextArtist.length > 500 || nextTitle.length > 500) {
      throw new Error("override values capped at 500 chars each");
    }

    const cap = Math.min(limit ?? 500, 1000);
    const matching = await ctx.db
      .query("plays")
      .withIndex("by_station_played_at", (q) => q.eq("stationId", stationId))
      .filter((q) =>
        q.and(
          q.eq(q.field("enrichmentStatus"), "unresolved"),
          q.eq(q.field("artistRaw"), fromArtistRaw),
          q.eq(q.field("titleRaw"), fromTitleRaw),
        ),
      )
      .take(cap);

    let flipped = 0;
    for (const p of matching) {
      await ctx.db.patch(p._id, {
        artistRaw: nextArtist,
        titleRaw: nextTitle,
        enrichmentStatus: "pending",
      });
      flipped += 1;
    }

    const firstPlay = matching[0];
    if (flipped > 0 && firstPlay !== undefined) {
      await ctx.runMutation(internal.ingestionEvents.log, {
        orgId: firstPlay.orgId,
        stationId,
        sourceId: firstPlay.sourceId,
        kind: "source_resumed",
        message: `override: ${fromArtistRaw} — ${fromTitleRaw} → ${nextArtist} — ${nextTitle}`,
        context: {
          flipped,
          from: { artistRaw: fromArtistRaw, titleRaw: fromTitleRaw },
          to: { artistRaw: nextArtist, titleRaw: nextTitle },
        },
      });
    }

    return { flipped };
  },
});

/**
 * Operator action — patch SoundExchange-required fields on a canonical
 * track when enrichment couldn't find them. Accepts partial updates so
 * an operator supplying only the label doesn't have to re-type the
 * ISRC.
 *
 * Values are trimmed; empty strings clear the field. ISRC is validated
 * against the 12-character standard format (country + registrant +
 * year + designation). Duration must be non-negative finite seconds;
 * 0 clears.
 *
 * Separate from re-enrichment: this persists the operator's ground
 * truth into the track. `reEnrichTrack` re-hits APIs instead.
 */
// TODO(security): HMAC + user attribution. Session 3 security pass.
export const patchTrackMetadata = mutation({
  args: {
    trackId: v.id("tracks"),
    recordLabel: v.optional(v.string()),
    isrc: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    albumDisplayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const track = await ctx.db.get(args.trackId);
    if (track === null) throw new Error(`Unknown track: ${args.trackId}`);

    const patch: Partial<Doc<"tracks">> = {};
    if (args.recordLabel !== undefined) {
      const value = args.recordLabel.trim();
      if (value.length > 200) throw new Error("recordLabel capped at 200 chars");
      patch.recordLabel = value.length === 0 ? undefined : value;
    }
    if (args.isrc !== undefined) {
      const value = args.isrc.trim().toUpperCase();
      if (value.length > 0 && !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(value)) {
        throw new Error(
          "ISRC must be 12 chars: 2 country + 3 registrant + 2 year + 5 designation",
        );
      }
      patch.isrc = value.length === 0 ? undefined : value;
    }
    if (args.durationSec !== undefined) {
      if (!Number.isFinite(args.durationSec) || args.durationSec < 0) {
        throw new Error("durationSec must be a non-negative finite number");
      }
      patch.durationSec = args.durationSec === 0 ? undefined : Math.floor(args.durationSec);
    }
    if (args.albumDisplayName !== undefined) {
      const value = args.albumDisplayName.trim();
      if (value.length > 500) throw new Error("albumDisplayName capped at 500 chars");
      patch.albumDisplayName = value.length === 0 ? undefined : value;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.trackId, patch);
    }
    return { patched: Object.keys(patch).length };
  },
});

/**
 * Tracks that resolved but are missing SoundExchange-required fields.
 * Reports groups keyed by the canonical track so a popular song isn't
 * shown once per play. Primary use case: dashboard "metadata
 * incomplete" surface that tells a music director WHICH SoundExchange
 * fields are still blank before SOR filing.
 */
export const tracksMissingSoundExchangeFields = query({
  args: {
    limit: v.optional(v.number()),
    windowMs: v.optional(v.number()),
  },
  handler: async (ctx, { limit, windowMs }) => {
    const take = Math.min(limit ?? 15, 50);
    const window = windowMs ?? 7 * 24 * 60 * 60 * 1000;
    const since = Date.now() - window;

    const recentPlays = await ctx.db
      .query("plays")
      .withIndex("by_enrichment_status", (q) => q.eq("enrichmentStatus", "resolved"))
      .order("desc")
      .take(1000);

    const stations = await ctx.db.query("stations").collect();
    const stationNameById = new Map(stations.map((s) => [s._id, s.name]));
    const trackCache = new Map<string, Doc<"tracks"> | null>();
    const artistCache = new Map<string, Doc<"artists"> | null>();

    interface Group {
      trackId: string;
      displayTitle: string;
      artistDisplayName: string;
      albumDisplayName?: string;
      missingFields: string[];
      playCount: number;
      stationNames: string[];
      lastPlayedAt: number;
    }
    const groups = new Map<string, Group>();

    for (const play of recentPlays) {
      if (play.playedAt < since) continue;
      if (play.canonicalTrackId === undefined) continue;
      const tid = play.canonicalTrackId as string;
      let track = trackCache.get(tid);
      if (track === undefined) {
        track = await ctx.db.get(play.canonicalTrackId);
        trackCache.set(tid, track);
      }
      if (track === null) continue;

      const missing: string[] = [];
      if (!track.recordLabel || track.recordLabel.trim().length === 0) missing.push("label");
      if (!track.isrc || track.isrc.trim().length === 0) missing.push("ISRC");
      if (typeof track.durationSec !== "number" || track.durationSec <= 0) missing.push("duration");
      if (missing.length === 0) continue;

      const existing = groups.get(tid);
      const station = stationNameById.get(play.stationId) ?? "?";
      if (existing !== undefined) {
        existing.playCount += 1;
        if (!existing.stationNames.includes(station)) existing.stationNames.push(station);
        if (play.playedAt > existing.lastPlayedAt) existing.lastPlayedAt = play.playedAt;
        continue;
      }
      const artistIdStr = track.artistId as string;
      let artist = artistCache.get(artistIdStr);
      if (artist === undefined) {
        artist = await ctx.db.get(track.artistId);
        artistCache.set(artistIdStr, artist);
      }
      groups.set(tid, {
        trackId: tid,
        displayTitle: track.displayTitle,
        artistDisplayName: artist?.displayName ?? "Unknown artist",
        albumDisplayName: track.albumDisplayName,
        missingFields: missing,
        playCount: 1,
        stationNames: [station],
        lastPlayedAt: play.playedAt,
      });
    }

    return Array.from(groups.values())
      .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
      .slice(0, take);
  },
});

/**
 * Per-station enrichment coverage over the last `windowMs` (default 24h).
 *
 * Drives the compact coverage stat on each StationCard. Three ratios are
 * computed against the set of resolved plays (plays with a
 * `canonicalTrackId`) — NOT against the total plays, because a station
 * running an un-indexed local act can't reach 100% and we want the
 * denominator to reflect what enrichment actually got its hands on:
 *
 *   labelCoverage   — % of resolved plays whose track has a recordLabel
 *   isrcCoverage    — % whose track has an isrc
 *   durationCoverage — % whose track has durationSec > 0
 *
 * Also returns `resolvedRatio` (resolved / total) so operators can tell
 * "this station's 40% label coverage is because enrichment can't match
 * its catalog" from "it matched everything but Apple omits labels for
 * half of it" — very different problems.
 *
 * 414 Music will show chronically low labelCoverage; the memory file
 * (project_stations.md) documents this as expected, not a bug.
 *
 * Window defaults to 24h because each new play invalidates this query
 * (via the `by_station_played_at` index read) — a 7d scan + track-get
 * per resolved play × 12 plays/hr across the wall = expensive. 24h keeps
 * the scan cheap (~70 rows) without losing signal.
 */
export const stationCoverage = query({
  args: {
    stationSlug: v.union(
      v.literal("hyfin"),
      v.literal("88nine"),
      v.literal("414music"),
      v.literal("rhythmlab"),
    ),
    windowMs: v.optional(v.number()),
  },
  handler: async (ctx, { stationSlug, windowMs }) => {
    const station = await ctx.db
      .query("stations")
      .withIndex("by_slug", (q) => q.eq("slug", stationSlug))
      .first();
    if (station === null) return null;

    const window = windowMs ?? 24 * 60 * 60 * 1000;
    const since = Date.now() - window;

    const recentPlays = await ctx.db
      .query("plays")
      .withIndex("by_station_played_at", (q) =>
        q.eq("stationId", station._id).gte("playedAt", since),
      )
      .take(500);

    const trackCache = new Map<string, Doc<"tracks"> | null>();
    let totalPlays = 0;
    let resolvedPlays = 0;
    let withLabel = 0;
    let withIsrc = 0;
    let withDuration = 0;

    for (const play of recentPlays) {
      if (play.deletedAt !== undefined) continue;
      totalPlays += 1;
      if (play.canonicalTrackId === undefined) continue;
      resolvedPlays += 1;
      const tid = play.canonicalTrackId as string;
      let track = trackCache.get(tid);
      if (track === undefined) {
        track = await ctx.db.get(play.canonicalTrackId);
        trackCache.set(tid, track);
      }
      if (track === null) continue;
      if (track.recordLabel && track.recordLabel.trim().length > 0) withLabel += 1;
      if (track.isrc && track.isrc.trim().length > 0) withIsrc += 1;
      if (typeof track.durationSec === "number" && track.durationSec > 0) withDuration += 1;
    }

    const ratio = (n: number, d: number): number => (d === 0 ? 0 : n / d);
    return {
      totalPlays,
      resolvedPlays,
      resolvedRatio: ratio(resolvedPlays, totalPlays),
      labelCoverage: ratio(withLabel, resolvedPlays),
      isrcCoverage: ratio(withIsrc, resolvedPlays),
      durationCoverage: ratio(withDuration, resolvedPlays),
      windowMs: window,
    };
  },
});

/**
 * Operator action — flip every resolved play pointing at a track back
 * to `pending` so the next enrich cron tick re-runs the Apple+Discogs
 * lookups. `upsertTrack`'s patch branch fills in any fields that
 * weren't present before. Use when new enrichment sources shipped
 * after the track was first resolved (session 3 MB label fallback
 * will be a common trigger).
 */
// TODO(security): same HMAC plan. Session 3.
export const reEnrichTrack = mutation({
  args: {
    trackId: v.id("tracks"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { trackId, limit }) => {
    const cap = Math.min(limit ?? 200, 1000);
    const matching = await ctx.db
      .query("plays")
      .withIndex("by_canonical_track", (q) => q.eq("canonicalTrackId", trackId))
      .filter((q) => q.eq(q.field("enrichmentStatus"), "resolved"))
      .take(cap);
    let flipped = 0;
    for (const p of matching) {
      await ctx.db.patch(p._id, { enrichmentStatus: "pending" });
      flipped += 1;
    }
    return { flipped };
  },
});

/**
 * Operator action — retry every unresolved play whose
 * (stationId, artistRaw, titleRaw) matches the supplied tuple by flipping
 * them back to `enrichmentStatus: "pending"`. The enrich cron picks them
 * up within 60s and runs whatever enrichment logic is currently shipped
 * (so useful after a normalization fix / after Discogs was added).
 *
 * Deliberately conservative: only touches `unresolved` plays. Resolved or
 * already-pending plays are left alone.
 */
// TODO(security): same HMAC plan as the enrichment mutations. Session 3.
export const retryUnresolvedGroup = mutation({
  args: {
    stationId: v.id("stations"),
    artistRaw: v.string(),
    titleRaw: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { stationId, artistRaw, titleRaw, limit }) => {
    const cap = Math.min(limit ?? 500, 1000);
    const matching = await ctx.db
      .query("plays")
      .withIndex("by_station_played_at", (q) => q.eq("stationId", stationId))
      .filter((q) =>
        q.and(
          q.eq(q.field("enrichmentStatus"), "unresolved"),
          q.eq(q.field("artistRaw"), artistRaw),
          q.eq(q.field("titleRaw"), titleRaw),
        ),
      )
      .take(cap);
    let flipped = 0;
    for (const p of matching) {
      await ctx.db.patch(p._id, { enrichmentStatus: "pending" });
      flipped += 1;
    }
    return { flipped };
  },
});

/**
 * Operator action — permanently ignore every play whose
 * (stationId, artistRaw, titleRaw) matches. "Ignored" is the schema's
 * existing terminal state that SoundExchange exports and widget queries
 * filter out. Station IDs, DJ tags, ad breaks, and other non-song
 * StreamTitles land here.
 *
 * Patches BOTH pending AND unresolved rows — the latter catches past
 * occurrences so they stop surfacing in Needs Attention; the former
 * short-circuits future ticks of the same promo.
 */
// TODO(security): same HMAC plan. Session 3.
export const ignoreUnresolvedGroup = mutation({
  args: {
    stationId: v.id("stations"),
    artistRaw: v.string(),
    titleRaw: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { stationId, artistRaw, titleRaw, limit }) => {
    const station = await ctx.db.get(stationId);
    if (station === null) throw new Error(`Unknown station: ${stationId}`);

    const cap = Math.min(limit ?? 1000, 5000);
    const matching = await ctx.db
      .query("plays")
      .withIndex("by_station_played_at", (q) => q.eq("stationId", stationId))
      .filter((q) =>
        q.and(
          q.eq(q.field("artistRaw"), artistRaw),
          q.eq(q.field("titleRaw"), titleRaw),
          q.or(
            q.eq(q.field("enrichmentStatus"), "unresolved"),
            q.eq(q.field("enrichmentStatus"), "pending"),
          ),
        ),
      )
      .take(cap);
    let flipped = 0;
    for (const p of matching) {
      await ctx.db.patch(p._id, { enrichmentStatus: "ignored" });
      flipped += 1;
    }

    // Persist the ignore rule so future ingestion writes the same
    // (artist, title) straight to `ignored` without running enrichment.
    const artistKey = normalizeMatchKey(artistRaw);
    const titleKey = normalizeMatchKey(titleRaw);
    const existing = await ctx.db
      .query("enrichmentIgnoreRules")
      .withIndex("by_station_match", (q) =>
        q.eq("stationId", stationId).eq("artistKey", artistKey).eq("titleKey", titleKey),
      )
      .first();
    let ruleCreated = false;
    if (existing === null) {
      await ctx.db.insert("enrichmentIgnoreRules", {
        orgId: station.orgId,
        stationId,
        artistKey,
        titleKey,
        artistRaw,
        titleRaw,
        createdAt: Date.now(),
      });
      ruleCreated = true;
    }
    return { flipped, ruleCreated };
  },
});

function normalizeMatchKey(value: string): string {
  return value.trim().toLowerCase();
}

export const markPlayUnresolved = mutation({
  args: {
    playId: v.id("plays"),
    // Constrained union — matches the `UnresolvedReason` type exported
    // from `src/trigger/enrich-pending-plays.ts`. Prevents typo drift
    // between caller and server.
    reason: v.union(v.literal("mb_miss"), v.literal("no_match"), v.literal("other")),
    context: v.optional(v.any()),
  },
  handler: async (ctx, { playId, reason, context }) => {
    const play = await loadPlay(ctx, playId);
    await ctx.db.patch(playId, { enrichmentStatus: "unresolved" });
    // Pack the source artist/title into context so the dashboard can show
    // operators WHICH song failed, not just a cryptic reason code.
    const enrichedContext = {
      ...(context ?? {}),
      playId,
      artistRaw: play.artistRaw,
      titleRaw: play.titleRaw,
    };
    await ctx.runMutation(internal.ingestionEvents.log, {
      orgId: play.orgId,
      stationId: play.stationId,
      sourceId: play.sourceId,
      kind: "enrichment_error",
      message: reason,
      context: enrichedContext,
    });
  },
});

async function loadPlay(ctx: MutationCtx, playId: Id<"plays">): Promise<Doc<"plays">> {
  const play = await ctx.db.get(playId);
  if (play === null) throw new Error(`Unknown play: ${playId}`);
  return play;
}

const COMBINING_MARKS = /[̀-ͯ]/g;
const NON_ALNUM = /[^a-z0-9]+/g;
const LEADING_TRAILING_HYPHEN = /^-+|-+$/g;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(NON_ALNUM, "-")
    .replace(LEADING_TRAILING_HYPHEN, "");
}

function normalizeArtistKey(displayName: string): string {
  return slugify(displayName);
}

function normalizeTrackKey(title: string, artistId: Id<"artists">): string {
  return `${artistId}::${slugify(title)}`;
}

function sanitizeArtworkUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (!url.hostname.endsWith(".mzstatic.com")) return undefined;
  return url.toString();
}
