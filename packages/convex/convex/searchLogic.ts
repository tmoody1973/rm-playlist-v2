/**
 * Rules for the playlist widget's text search. Pure so they can be tested;
 * plays.searchByStation uses them around the `search_text` index.
 *
 * Searching the last two weeks by default keeps each search to the plays
 * that actually match in that window, instead of scanning thousands of rows.
 * Listeners who want older plays pick a date range.
 */

export const DEFAULT_SEARCH_LOOKBACK_DAYS = 14;
/** Relevance-ranked candidates read per fortnight bucket (Convex search caps at 1024). */
export const SEARCH_HITS_PER_FORTNIGHT = 200;
/** About a year of buckets: bounds a search with a wide date range. */
export const MAX_SEARCH_FORTNIGHTS = 27;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SearchWindow {
  readonly startMs: number;
  readonly endMs: number;
}

export interface SearchablePlay {
  readonly artistRaw: string;
  readonly titleRaw: string;
  readonly playedAt: number;
  readonly deletedAt?: number;
  readonly enrichmentStatus?: string;
}

export function normalizeNeedle(query: string | undefined): string {
  return query?.trim().toLowerCase() ?? "";
}

export function searchWindow(nowMs: number, afterMs?: number, beforeMs?: number): SearchWindow {
  const endMs = Math.min(beforeMs ?? nowMs, nowMs);
  const startMs = afterMs ?? endMs - DEFAULT_SEARCH_LOOKBACK_DAYS * DAY_MS;
  return { startMs, endMs };
}

/** The search index matches whole words; this keeps the widget's substring rule and window exact. */
export function isSearchHit(play: SearchablePlay, needle: string, window: SearchWindow): boolean {
  if (play.deletedAt !== undefined || play.enrichmentStatus === "ignored") return false;
  if (play.playedAt < window.startMs || play.playedAt > window.endMs) return false;
  return (
    play.artistRaw.toLowerCase().includes(needle) || play.titleRaw.toLowerCase().includes(needle)
  );
}
