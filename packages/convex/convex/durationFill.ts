import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { matchKey } from "./matchKey";
import { searchTerms } from "./memoryLogic";
import {
  type DurationBasis,
  durationSourceOf,
  fillDurationSec,
  gapNeedsEstimate,
  gapSec,
  hasLength,
} from "./playDuration";

/**
 * Database side of the estimate rule in playDuration.ts: deciding which
 * plays need a length, gathering a song's other lengths, and writing the
 * result. Shared by live ingestion (stampPreviousPlayDuration) and the
 * historical backfill (backfills:backfillPlayDurations).
 */

/** Recent plays of a song sampled for its median length. */
const SONG_LENGTH_SAMPLE = 25;

/** True when the playlist log has no length for this play and needs one. */
export async function needsReportLength(ctx: QueryCtx, play: Doc<"plays">): Promise<boolean> {
  return !hasLength(play.durationSec) && (await wouldExportBlank(ctx, play));
}

/**
 * Leaving aside any length on the play itself: it is reportable (not
 * rewound, not a station ID) and its catalog track has no length.
 */
async function wouldExportBlank(ctx: QueryCtx, play: Doc<"plays">): Promise<boolean> {
  if (play.deletedAt !== undefined || play.enrichmentStatus === "ignored") return false;
  if (play.canonicalTrackId === undefined) return true;
  const track = await ctx.db.get(play.canonicalTrackId);
  return !hasLength(track?.durationSec);
}

/**
 * Apply the estimate rule to one play, given `gap` (gapSec) to the next
 * play, and write it unless `dryRun` or nothing changed. Null when no
 * length fits (next play in the same second).
 */
export async function fillPlayDuration(
  ctx: MutationCtx,
  play: Doc<"plays">,
  gap: number,
  dryRun: boolean,
): Promise<DurationBasis | null> {
  const songLengths = gapNeedsEstimate(gap) ? await songLengthsSec(ctx, play) : [];
  const fill = fillDurationSec(gap, songLengths);
  if (fill === null) return null;
  const durationSource = durationSourceOf(fill.basis);
  const unchanged = play.durationSec === fill.durationSec && play.durationSource === durationSource;
  if (!dryRun && !unchanged) {
    await ctx.db.patch(play._id, { durationSec: fill.durationSec, durationSource });
  }
  return fill.basis;
}

/**
 * A new play's start is the previous play's end. Any gap up to the cap is
 * written as the observed length (any play, as since PR #52); a longer gap
 * gets an estimate, capped at the gap, only where the log would otherwise
 * be blank. Our own lengths (observed or estimated) are re-derived when a
 * play recovered late lands in between, so rows never overlap; a
 * feed-reported length is never overwritten.
 */
export async function stampPreviousPlayDuration(
  ctx: MutationCtx,
  stationId: Id<"stations">,
  newPlayedAt: number,
): Promise<void> {
  const previous = await ctx.db
    .query("plays")
    .withIndex("by_station_played_at", (q) =>
      q.eq("stationId", stationId).lt("playedAt", newPlayedAt),
    )
    .order("desc")
    .first();
  if (previous === null) return;
  if (hasLength(previous.durationSec) && previous.durationSource === undefined) return;
  const gap = gapSec(previous.playedAt, newPlayedAt);
  if (gapNeedsEstimate(gap) && !(await wouldExportBlank(ctx, previous))) return;
  await fillPlayDuration(ctx, previous, gap, false);
}

/** Feed-reported or observed lengths of other plays of the same song; an estimate never feeds another. */
async function songLengthsSec(ctx: QueryCtx, play: Doc<"plays">): Promise<number[]> {
  const others = await playsOfSameSong(ctx, play);
  return others.flatMap((other) =>
    other._id !== play._id && other.durationSource !== "estimated" && hasLength(other.durationSec)
      ? [other.durationSec]
      : [],
  );
}

/** Same canonical track; for a play with none, same normalized artist + title (matchKey). */
async function playsOfSameSong(ctx: QueryCtx, play: Doc<"plays">): Promise<Doc<"plays">[]> {
  const trackId = play.canonicalTrackId;
  if (trackId !== undefined) {
    return ctx.db
      .query("plays")
      .withIndex("by_canonical_track", (q) => q.eq("canonicalTrackId", trackId))
      .order("desc")
      .take(SONG_LENGTH_SAMPLE);
  }
  const terms = searchTerms(`${play.artistRaw} ${play.titleRaw}`);
  if (terms === "") return [];
  // ponytail: relevance-ranked sample, exact-filtered by matchKey; plays older than the searchText backfill (~60 days) are invisible here, which only costs a fallback to 210 s.
  const hits = await ctx.db
    .query("plays")
    .withSearchIndex("search_text", (q) => q.search("searchText", terms))
    .take(SONG_LENGTH_SAMPLE);
  const key = matchKey(play.artistRaw, play.titleRaw);
  return hits.filter((hit) => matchKey(hit.artistRaw, hit.titleRaw) === key);
}
