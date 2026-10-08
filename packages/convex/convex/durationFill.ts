import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { matchKey } from "./matchKey";
import { searchTerms } from "./memoryLogic";
import {
  type DurationBasis,
  durationSourceOf,
  fillDurationSec,
  hasLength,
  observedDurationSec,
} from "./playDuration";

/**
 * Database side of the estimate rule in playDuration.ts: deciding which
 * plays need a length, gathering a song's other lengths, and writing the
 * result. Shared by live ingestion (stampPreviousPlayDuration) and the
 * historical backfill (backfills:backfillPlayDurations).
 */

/** Recent plays of a song sampled for its median length. */
const SONG_LENGTH_SAMPLE = 25;

/**
 * True when the playlist log would have no length for this play: it is
 * reportable (not rewound, not a station ID) and neither the play nor its
 * catalog track has a length.
 */
export async function needsReportLength(ctx: QueryCtx, play: Doc<"plays">): Promise<boolean> {
  if (hasLength(play.durationSec)) return false;
  if (play.deletedAt !== undefined || play.enrichmentStatus === "ignored") return false;
  if (play.canonicalTrackId === undefined) return true;
  const track = await ctx.db.get(play.canonicalTrackId);
  return !hasLength(track?.durationSec);
}

/**
 * Apply the estimate rule to one play and write it unless `dryRun`.
 * `observedSec` is the gap to the next play (null when out of range).
 */
export async function fillPlayDuration(
  ctx: MutationCtx,
  play: Doc<"plays">,
  observedSec: number | null,
  dryRun: boolean,
): Promise<DurationBasis> {
  const songLengths = observedSec === null ? await songLengthsSec(ctx, play) : [];
  const fill = fillDurationSec(observedSec, songLengths);
  if (!dryRun) {
    await ctx.db.patch(play._id, {
      durationSec: fill.durationSec,
      durationSource: durationSourceOf(fill.basis),
    });
  }
  return fill.basis;
}

/**
 * A new play's start is the previous play's end. When the previous play
 * has no length from its feed, write the observed gap (any play, as since
 * PR #52); when the gap can't be trusted and the log would otherwise be
 * blank, write an estimate so the NPR export never loses the row. A play
 * recovered late (outage backfill) can still turn our own estimate into
 * the observed gap; feed and observed lengths are never overwritten.
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
  if (hasLength(previous.durationSec) && previous.durationSource !== "estimated") return;
  const observedSec = observedDurationSec(previous.playedAt, newPlayedAt);
  if (observedSec === null && !(await needsReportLength(ctx, previous))) return;
  await fillPlayDuration(ctx, previous, observedSec, false);
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
