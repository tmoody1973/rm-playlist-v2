/**
 * Which shows the playlist widget's Concerts tab lists. Runs in the widget
 * with the listener's clock, so the server query stays free of Date.now()
 * and Convex can keep serving its cached answer between cache refreshes.
 */

export const CONCERTS_HORIZON_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ConcertTiming {
  readonly startsAtMs: number;
  /** True when the source gave only a date: startsAtMs is a midnight placeholder. */
  readonly dateOnly: boolean;
}

export function concertsWithinHorizon<T extends ConcertTiming>(
  concerts: readonly T[],
  nowMs: number,
  horizonDays: number = CONCERTS_HORIZON_DAYS,
): T[] {
  const horizonEndMs = nowMs + horizonDays * DAY_MS;
  return concerts
    .filter((concert) => {
      const stillOnMs = concert.dateOnly ? concert.startsAtMs + DAY_MS : concert.startsAtMs;
      return stillOnMs > nowMs && concert.startsAtMs <= horizonEndMs;
    })
    .sort((a, b) => a.startsAtMs - b.startsAtMs);
}
