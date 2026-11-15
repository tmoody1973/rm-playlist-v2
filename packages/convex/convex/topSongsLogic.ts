/**
 * Pure ranking for the widget's Top 7 / Top 30 tabs. Kept free of Convex
 * context so it can be unit-tested and shared by the live fallback path and
 * the daily snapshot refresh.
 */

/** Snapshot keeps more than the widget shows so `limit` (max 50) never runs short. */
export const TOP_SONGS_SNAPSHOT_SIZE = 50;
export const TOP_SONGS_WINDOWS = [7, 30] as const;
export type TopSongsWindowDays = (typeof TOP_SONGS_WINDOWS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RankablePlay {
  readonly _id: string;
  readonly playedAt: number;
  readonly artistRaw: string;
  readonly titleRaw: string;
  readonly canonicalTrackId?: string;
  readonly deletedAt?: number;
  readonly enrichmentStatus?: string;
}

export interface RankedPlay<P extends RankablePlay> {
  readonly play: P;
  readonly playCount: number;
}

export function normalizeForDedup(value: string): string {
  return value.trim().toLowerCase();
}

export function windowStartMs(nowMs: number, windowDays: TopSongsWindowDays): number {
  return nowMs - windowDays * DAY_MS;
}

function songKey(play: RankablePlay): string {
  return play.canonicalTrackId !== undefined
    ? `track:${play.canonicalTrackId}`
    : `raw:${normalizeForDedup(play.artistRaw)}|${normalizeForDedup(play.titleRaw)}`;
}

function isCountable(play: RankablePlay, sinceMs: number): boolean {
  return (
    play.playedAt >= sinceMs && play.deletedAt === undefined && play.enrichmentStatus !== "ignored"
  );
}

/**
 * Spin counts per song since `sinceMs`, highest first. Each song is
 * represented by its most recent play so the row shows current artwork.
 */
export function rankTopPlays<P extends RankablePlay>(
  plays: readonly P[],
  sinceMs: number,
  take: number,
): RankedPlay<P>[] {
  const bySong = new Map<string, RankedPlay<P>>();
  for (const play of plays) {
    if (!isCountable(play, sinceMs)) continue;
    const key = songKey(play);
    const existing = bySong.get(key);
    const newest =
      existing === undefined || play.playedAt > existing.play.playedAt ? play : existing.play;
    bySong.set(key, { play: newest, playCount: (existing?.playCount ?? 0) + 1 });
  }
  return Array.from(bySong.values())
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, take);
}
