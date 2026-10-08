/**
 * On-air length of a play inferred from when the next play started.
 *
 * SGmetadata (88Nine, HYFIN, 414 Music) reports start times but no
 * lengths, and local releases rarely exist in any catalog. On automation
 * the next start is the previous song's end to within a few seconds, so a
 * gap up to CAP is the length, short ones included (a song cut off after
 * 12 s aired 12 s). A longer gap usually swallowed a talk break, so the
 * length is estimated instead. No filled length ever runs past the next
 * play's start: NPR's playlist log would show overlapping rows.
 */

export const OBSERVED_DURATION_CAP_SEC = 8 * 60;

/**
 * NPR rejects a playlist-log row without a length, so a play whose gap
 * hides a talk break gets an estimate instead of a blank. 210 s is a
 * typical song; the row is flagged "estimated" so staff can correct it in
 * Needs Attention.
 */
export const DEFAULT_ESTIMATED_DURATION_SEC = 210;

const MS_PER_SEC = 1000;

/**
 * Whole seconds between two starts, each floored the way the playlist log
 * prints it, so a length no longer than this can't overlap the next row.
 */
export function gapSec(playedAt: number, nextPlayedAt: number): number {
  return Math.floor(nextPlayedAt / MS_PER_SEC) - Math.floor(playedAt / MS_PER_SEC);
}

/** A gap too long to be the song itself (a talk break swallowed): estimate instead. */
export function gapNeedsEstimate(gap: number): boolean {
  return gap > OBSERVED_DURATION_CAP_SEC;
}

/** How a filled length was arrived at; only "observed" is a measurement. */
export type DurationBasis = "observed" | "track" | "default";

export interface DurationFill {
  readonly durationSec: number;
  readonly basis: DurationBasis;
}

export function hasLength(sec: number | undefined): sec is number {
  return typeof sec === "number" && Number.isFinite(sec) && sec > 0;
}

/** Middle known length in whole seconds; null when there is none. */
export function medianSec(lengthsSec: readonly number[]): number | null {
  const sorted = lengthsSec.filter(hasLength).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return Math.round(median);
}

/**
 * The estimate rule. `gap` is gapSec to the next play on the station. A gap
 * up to the cap is the length (observed); a longer one gets the median of
 * the same song's other known lengths, else the default, capped at the gap.
 * Null when the next play started in the same second: no length fits.
 */
export function fillDurationSec(
  gap: number,
  songLengthsSec: readonly number[],
): DurationFill | null {
  if (gap <= 0) return null;
  if (!gapNeedsEstimate(gap)) return { durationSec: gap, basis: "observed" };
  const median = medianSec(songLengthsSec);
  const estimate: DurationFill =
    median === null
      ? { durationSec: DEFAULT_ESTIMATED_DURATION_SEC, basis: "default" }
      : { durationSec: median, basis: "track" };
  return { ...estimate, durationSec: Math.min(estimate.durationSec, gap) };
}

export function durationSourceOf(basis: DurationBasis): "observed" | "estimated" {
  return basis === "observed" ? "observed" : "estimated";
}

/**
 * Pair each play with the start of the play after it. The last play of a
 * batch has no next play yet, so it comes back as the carry for the next
 * batch; that is what keeps batch edges from losing a pair.
 */
export function pairWithNext<T extends { playedAt: number }>(
  carry: T | null,
  batch: readonly T[],
): { pairs: Array<{ play: T; nextPlayedAt: number }>; carry: T | null } {
  const ordered = carry === null ? [...batch] : [carry, ...batch];
  const pairs = ordered
    .slice(1)
    .map((next, i) => ({ play: ordered[i]!, nextPlayedAt: next.playedAt }));
  return { pairs, carry: ordered[ordered.length - 1] ?? null };
}
