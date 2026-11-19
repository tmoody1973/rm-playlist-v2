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

// --- for the HYFIN site's events pages -------------------------------------

/** The station cache knows each show's metro and how often the station played the artist. */
export function withStationContext<T extends object>(
  summary: T,
  show: { metro: string; playCount: number },
): T & { metro: string; playCount: number } {
  return { ...summary, metro: show.metro, playCount: show.playCount };
}

/** Event status (null when the source sent none) and region, for an event page. */
export function withEventDetails<T extends object>(
  summary: T,
  event: { status?: string; region: string },
): T & { status: string | null; region: string } {
  return { ...summary, status: event.status ?? null, region: event.region };
}

const MAX_DUPLICATE_HOPS = 5;

/** Follows `duplicateOf` to the canonical event; null when it's missing or the chain loops. */
export async function followDuplicates<E extends { _id: string; duplicateOf?: string }>(
  event: E,
  load: (id: string) => Promise<E | null>,
): Promise<E | null> {
  let current: E | null = event;
  for (let hop = 0; current && current.duplicateOf !== undefined; hop++) {
    if (hop >= MAX_DUPLICATE_HOPS) return null;
    current = await load(current.duplicateOf);
  }
  return current;
}
