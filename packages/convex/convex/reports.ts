import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";

/**
 * Plays scanned per paginated page. Sized so one execution stays far
 * under Convex's per-execution limits (16 MiB bytes read, 32k docs,
 * 4096 query calls): worst case is PAGE_SIZE play docs + PAGE_SIZE
 * unique-track `db.get`s ≈ 2001 calls / a few MB.
 */
const REPORT_PAGE_SIZE = 2000;

/**
 * `cursor === undefined` means the caller predates pagination (a stale
 * browser tab whose reactive subscription re-ran against this code) —
 * serve the old single-shot scan so it never silently receives a
 * one-page-truncated report. `null` starts a paginated read; a string
 * continues one. The legacy path can be dropped once old sessions have
 * cycled out.
 */
const cursorArg = v.optional(v.union(v.string(), v.null()));

interface PlaysPage {
  page: Doc<"plays">[];
  isDone: boolean;
  continueCursor: string | null;
}

async function fetchPlaysPage(
  ctx: QueryCtx,
  stationId: Id<"stations">,
  startMs: number,
  endMs: number,
  cursor: string | null | undefined,
  legacyCap: number,
): Promise<PlaysPage> {
  const range = ctx.db
    .query("plays")
    .withIndex("by_station_played_at", (q) =>
      q.eq("stationId", stationId).gte("playedAt", startMs).lt("playedAt", endMs),
    );
  if (cursor === undefined) {
    return { page: await range.take(legacyCap), isDone: true, continueCursor: null };
  }
  const result = await range.paginate({ numItems: REPORT_PAGE_SIZE, cursor });
  return { page: result.page, isDone: result.isDone, continueCursor: result.continueCursor };
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
 *   - DURATION_SECONDS         → track.durationSec (may be blank)
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
    limit: v.optional(v.number()),
    cursor: cursorArg,
  },
  handler: async (ctx, { stationSlug, startMs, endMs, limit, cursor }) => {
    const emptyResult = {
      rows: [],
      stationName: null,
      totalPlays: 0,
      isDone: true,
      continueCursor: null,
    };
    if (endMs <= startMs) return emptyResult;

    const station = await ctx.db
      .query("stations")
      .withIndex("by_slug", (q) => q.eq("slug", stationSlug))
      .first();
    if (station === null) return emptyResult;

    const legacyCap = Math.min(limit ?? 10_000, 50_000);
    const {
      page: plays,
      isDone,
      continueCursor,
    } = await fetchPlaysPage(ctx, station._id, startMs, endMs, cursor, legacyCap);

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

    // The by_station_played_at index already yields ascending playedAt,
    // so pages concatenate in order on the client; this sort is a
    // per-page no-op kept for the legacy single-shot path.
    rows.sort((a, b) => a.playedAt - b.playedAt);
    return { rows, stationName: station.name, totalPlays: rows.length, isDone, continueCursor };
  },
});

/**
 * Count-only companion to `soundExchangePlaylist` — populates
 * "preview: N plays, M missing label" without shipping every row to
 * the browser. Same filters and pagination contract as the full query;
 * callers sum the per-page counts.
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
      isDone: true,
      continueCursor: null,
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
    } = await fetchPlaysPage(ctx, station._id, startMs, endMs, cursor, 50_000);

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
      isDone,
      continueCursor,
    };
  },
});
