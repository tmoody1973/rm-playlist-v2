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
