/**
 * On-air length of a play inferred from when the next play started.
 *
 * SGmetadata (88Nine, HYFIN, 414 Music) reports start times but no
 * lengths, and local releases rarely exist in any catalog. On automation
 * the next start is the previous song's end to within a few seconds; the
 * exception is a song followed by a talk break, whose gap includes the
 * break. Gaps outside [MIN, CAP] are treated as unknown rather than
 * written down as a wrong number.
 */

export const OBSERVED_DURATION_MIN_SEC = 30;
export const OBSERVED_DURATION_CAP_SEC = 8 * 60;

const MS_PER_SEC = 1000;

export function observedDurationSec(playedAt: number, nextPlayedAt: number): number | null {
  const gapSec = Math.round((nextPlayedAt - playedAt) / MS_PER_SEC);
  if (gapSec < OBSERVED_DURATION_MIN_SEC || gapSec > OBSERVED_DURATION_CAP_SEC) return null;
  return gapSec;
}

/**
 * NPR rejects a playlist-log row without a length, so a play the gap
 * can't measure (talk break, re-poll glitch, last song before an outage)
 * gets an estimate instead of a blank. 210 s is a typical song; the row
 * is flagged "estimated" so staff can correct it in Needs Attention.
 */
export const DEFAULT_ESTIMATED_DURATION_SEC = 210;

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
 * The estimate rule, in order: the observed gap to the next play; else the
 * median of the same song's other known lengths; else the default.
 */
export function fillDurationSec(
  observedSec: number | null,
  songLengthsSec: readonly number[],
): DurationFill {
  if (observedSec !== null) return { durationSec: observedSec, basis: "observed" };
  const median = medianSec(songLengthsSec);
  if (median !== null) return { durationSec: median, basis: "track" };
  return { durationSec: DEFAULT_ESTIMATED_DURATION_SEC, basis: "default" };
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
