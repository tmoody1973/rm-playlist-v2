import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";

/**
 * SoundExchange Report of Use (playlist format) — one row per resolved
 * play in [startMs, endMs) on a given station. Caller converts to CSV
 * in the browser so we don't pay a round-trip for byte-level rendering.
 *
 * Only resolved plays are returned (canonicalTrackId present). Ignored,
 * unresolved, and pending plays are filtered out — ignored rows are
 * station IDs / promos (not reportable), unresolved + pending need
 * operator attention before they can be reported.
 *
 * Columns map to SoundExchange's non-commercial webcaster SOR:
 *   - FEATURED_ARTIST          → artist display name
 *   - SOUND_RECORDING_TITLE    → track display title
 *   - ALBUM_TITLE              → track albumDisplayName (may be blank)
 *   - MARKETING_LABEL          → track recordLabel (may be blank; 414 Music
 *                                 rows default to "Self-released" via the
 *                                 enrichment waterfall)
 *   - ISRC                     → track isrc (may be blank)
 *   - ACTUAL_TOTAL_PERFORMANCES → inferred by SoundExchange from row count;
 *                                 we still emit one row per play so they
 *                                 can see the full schedule.
 * Plus metadata SoundExchange also accepts:
 *   - BROADCAST_DATE           → YYYY-MM-DD in UTC from playedAt
 *   - PLAY_TIME                → HH:MM:SS UTC from playedAt
 *   - CHANNEL_NAME             → station.name (e.g. "HYFIN")
 *   - DURATION_SECONDS         → track.durationSec (may be blank)
 */
export const soundExchangePlaylist = query({
  args: {
    stationSlug: v.union(
      v.literal("hyfin"),
      v.literal("88nine"),
      v.literal("414music"),
      v.literal("rhythmlab"),
    ),
    startMs: v.number(),
    endMs: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { stationSlug, startMs, endMs, limit }) => {
    if (endMs <= startMs) return { rows: [], stationName: null, totalPlays: 0 };

    const station = await ctx.db
      .query("stations")
      .withIndex("by_slug", (q) => q.eq("slug", stationSlug))
      .first();
    if (station === null) return { rows: [], stationName: null, totalPlays: 0 };

    const cap = Math.min(limit ?? 10_000, 50_000);

    const plays = await ctx.db
      .query("plays")
      .withIndex("by_station_played_at", (q) =>
        q.eq("stationId", station._id).gte("playedAt", startMs).lt("playedAt", endMs),
      )
      .take(cap);

    const trackCache = new Map<string, Doc<"tracks"> | null>();
    const artistCache = new Map<string, Doc<"artists"> | null>();

    interface Row {
      playedAt: number;
      channelName: string;
      featuredArtist: string;
      soundRecordingTitle: string;
      albumTitle: string;
      marketingLabel: string;
      isrc: string;
      durationSec: number | null;
    }
    const rows: Row[] = [];

    for (const play of plays) {
      if (play.deletedAt !== undefined) continue;
      if (play.enrichmentStatus !== "resolved") continue;
      if (play.canonicalTrackId === undefined) continue;

      const trackKey = play.canonicalTrackId as string;
      let track = trackCache.get(trackKey);
      if (track === undefined) {
        track = await ctx.db.get(play.canonicalTrackId);
        trackCache.set(trackKey, track);
      }
      if (track === null) continue;

      const artistKey = track.artistId as string;
      let artist = artistCache.get(artistKey);
      if (artist === undefined) {
        artist = await ctx.db.get(track.artistId);
        artistCache.set(artistKey, artist);
      }

      rows.push({
        playedAt: play.playedAt,
        channelName: station.name,
        featuredArtist: artist?.displayName ?? play.artistRaw,
        soundRecordingTitle: track.displayTitle,
        albumTitle: track.albumDisplayName ?? "",
        marketingLabel: track.recordLabel ?? "",
        isrc: track.isrc ?? "",
        durationSec: typeof track.durationSec === "number" ? track.durationSec : null,
      });
    }

    rows.sort((a, b) => a.playedAt - b.playedAt);
    return { rows, stationName: station.name, totalPlays: rows.length };
  },
});

/**
 * Count-only companion to `soundExchangePlaylist` — cheap enough to
 * call from the UI to populate "preview: N plays, M missing label"
 * without fetching every row. Same filters as the full query.
 */
export const soundExchangePlaylistSummary = query({
  args: {
    stationSlug: v.union(
      v.literal("hyfin"),
      v.literal("88nine"),
      v.literal("414music"),
      v.literal("rhythmlab"),
    ),
    startMs: v.number(),
    endMs: v.number(),
  },
  handler: async (ctx, { stationSlug, startMs, endMs }) => {
    if (endMs <= startMs) {
      return {
        stationName: null,
        resolvedPlays: 0,
        missingLabel: 0,
        missingIsrc: 0,
        missingDuration: 0,
      };
    }
    const station = await ctx.db
      .query("stations")
      .withIndex("by_slug", (q) => q.eq("slug", stationSlug))
      .first();
    if (station === null) {
      return {
        stationName: null,
        resolvedPlays: 0,
        missingLabel: 0,
        missingIsrc: 0,
        missingDuration: 0,
      };
    }

    const plays = await ctx.db
      .query("plays")
      .withIndex("by_station_played_at", (q) =>
        q.eq("stationId", station._id).gte("playedAt", startMs).lt("playedAt", endMs),
      )
      .take(50_000);

    const trackCache = new Map<string, Doc<"tracks"> | null>();
    let resolvedPlays = 0;
    let missingLabel = 0;
    let missingIsrc = 0;
    let missingDuration = 0;

    for (const play of plays) {
      if (play.deletedAt !== undefined) continue;
      if (play.enrichmentStatus !== "resolved") continue;
      if (play.canonicalTrackId === undefined) continue;

      const key = play.canonicalTrackId as string;
      let track = trackCache.get(key);
      if (track === undefined) {
        track = await ctx.db.get(play.canonicalTrackId);
        trackCache.set(key, track);
      }
      if (track === null) continue;

      resolvedPlays += 1;
      if (!track.recordLabel || track.recordLabel.trim().length === 0) missingLabel += 1;
      if (!track.isrc || track.isrc.trim().length === 0) missingIsrc += 1;
      if (typeof track.durationSec !== "number" || track.durationSec <= 0) missingDuration += 1;
    }

    return {
      stationName: station.name,
      resolvedPlays,
      missingLabel,
      missingIsrc,
      missingDuration,
    };
  },
});
