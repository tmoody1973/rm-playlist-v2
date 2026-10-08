import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { hasLength } from "./playDuration";

/**
 * Plays scanned per paginated page. Convex also caps the cumulative time
 * one execution spends in database calls ("too many system operations"),
 * which a month of 88Nine hit in one shot (~9k plays + a track get per
 * new song). Worst case here is PAGE_SIZE play docs + PAGE_SIZE track and
 * artist gets ≈ 3001 calls; callers loop pages client-side.
 */
const REPORT_PAGE_SIZE = 1000;

/**
 * `null` (or omitted) starts a paginated read; a string continues one.
 * The pre-pagination single-shot scan for cursorless callers is gone: it
 * was the path that timed out, and the dashboard has paged since 2026-07.
 */
const cursorArg = v.optional(v.union(v.string(), v.null()));

interface PlaysPage {
  page: Doc<"plays">[];
  isDone: boolean;
  continueCursor: string | null;
  /**
   * How far into [startMs, endMs) this page read: the last play's time, or
   * endMs once done. Pages run in time order, so the dashboard turns this
   * into a progress bar without knowing the page count up front.
   */
  scannedThroughMs: number;
}

async function fetchPlaysPage(
  ctx: QueryCtx,
  stationId: Id<"stations">,
  startMs: number,
  endMs: number,
  cursor: string | null | undefined,
): Promise<PlaysPage> {
  const result = await ctx.db
    .query("plays")
    .withIndex("by_station_played_at", (q) =>
      q.eq("stationId", stationId).gte("playedAt", startMs).lt("playedAt", endMs),
    )
    .paginate({ numItems: REPORT_PAGE_SIZE, cursor: cursor ?? null });
  const lastPlay = result.page.at(-1);
  return {
    page: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
    scannedThroughMs: result.isDone ? endMs : (lastPlay?.playedAt ?? startMs),
  };
}

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
 *   - DURATION_SECONDS         → track.durationSec, else the play's own
 *                                 durationSec (feed-reported, observed from
 *                                 the next play's start, or estimated —
 *                                 see playDuration.ts; blank only if none)
 *
 * Paginated: pass `cursor: null` for the first page, then the returned
 * `continueCursor` until `isDone`. A busy station over a month exceeds
 * Convex's 16 MiB per-execution read limit in one shot, so callers must
 * accumulate pages client-side.
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
    cursor: cursorArg,
  },
  handler: async (ctx, { stationSlug, startMs, endMs, cursor }) => {
    const emptyResult = {
      rows: [],
      stationName: null,
      totalPlays: 0,
      isDone: true,
      continueCursor: null,
      scannedThroughMs: endMs,
    };
    if (endMs <= startMs) return emptyResult;

    const station = await ctx.db
      .query("stations")
      .withIndex("by_slug", (q) => q.eq("slug", stationSlug))
      .first();
    if (station === null) return emptyResult;

    const {
      page: plays,
      isDone,
      continueCursor,
      scannedThroughMs,
    } = await fetchPlaysPage(ctx, station._id, startMs, endMs, cursor);

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
        durationSec: rowDurationSec(track.durationSec, play.durationSec),
      });
    }

    // The by_station_played_at index yields ascending playedAt, so pages
    // concatenate in chronological order on the client.
    return {
      rows,
      stationName: station.name,
      totalPlays: rows.length,
      isDone,
      continueCursor,
      scannedThroughMs,
    };
  },
});

/**
 * Count-only companion to `soundExchangePlaylist` — populates
 * "preview: N plays, M missing label" without shipping every row to
 * the browser. Same filters and pagination contract as the full query;
 * callers sum the per-page counts. `estimatedDuration` rows export with a
 * length but it is a guess (playDuration.ts), so staff can correct them;
 * `missingDuration` rows export blank.
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
    cursor: cursorArg,
  },
  handler: async (ctx, { stationSlug, startMs, endMs, cursor }) => {
    const emptyResult = {
      stationName: null,
      resolvedPlays: 0,
      missingLabel: 0,
      missingIsrc: 0,
      missingDuration: 0,
      estimatedDuration: 0,
      isDone: true,
      continueCursor: null,
      scannedThroughMs: endMs,
    };
    if (endMs <= startMs) return emptyResult;

    const station = await ctx.db
      .query("stations")
      .withIndex("by_slug", (q) => q.eq("slug", stationSlug))
      .first();
    if (station === null) return emptyResult;

    const {
      page: plays,
      isDone,
      continueCursor,
      scannedThroughMs,
    } = await fetchPlaysPage(ctx, station._id, startMs, endMs, cursor);

    const trackCache = new Map<string, Doc<"tracks"> | null>();
    let resolvedPlays = 0;
    let missingLabel = 0;
    let missingIsrc = 0;
    let missingDuration = 0;
    let estimatedDuration = 0;

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
      if (rowDurationSec(track.durationSec, play.durationSec) === null) missingDuration += 1;
      else if (!hasLength(track.durationSec) && play.durationSource === "estimated") {
        estimatedDuration += 1;
      }
    }

    return {
      stationName: station.name,
      resolvedPlays,
      missingLabel,
      missingIsrc,
      missingDuration,
      estimatedDuration,
      isDone,
      continueCursor,
      scannedThroughMs,
    };
  },
});

/** Catalog length first; otherwise whatever the play itself knows (feed or observed). */
function rowDurationSec(trackSec: number | undefined, playSec: number | undefined): number | null {
  if (hasLength(trackSec)) return trackSec;
  if (hasLength(playSec)) return playSec;
  return null;
}
