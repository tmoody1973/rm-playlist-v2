export const DEFAULT_FINDS_LIMIT = 5;
export const MAX_FINDS_LIMIT = 10;

/** Same song saved from two spins collapses to one find; unidentified songs dedupe per spin. */
export function dedupeKeyFor(playId: string, trackId: string | undefined): string {
  return trackId ? `track:${trackId}` : `play:${playId}`;
}

export function clampFindsLimit(limit?: number): number {
  if (limit === undefined || Number.isNaN(limit)) return DEFAULT_FINDS_LIMIT;
  return Math.min(MAX_FINDS_LIMIT, Math.max(1, Math.floor(limit)));
}
