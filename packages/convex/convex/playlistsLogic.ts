export const MAX_PLAYLISTS_PER_LISTENER = 20;
export const MAX_PLAYLIST_ITEMS = 100;
export const MAX_PLAYLIST_NAME_LENGTH = 60;

/** Trimmed name, or null when blank or too long: callers answer "bad_name" rather than silently truncating. */
export function cleanPlaylistName(name: string): string | null {
  const trimmed = name.trim();
  // Code points, not UTF-16 units, so an emoji counts as one character.
  const length = Array.from(trimmed).length;
  return length >= 1 && length <= MAX_PLAYLIST_NAME_LENGTH ? trimmed : null;
}

/** A playlist holds at most MAX_PLAYLIST_ITEMS, so the default returns all of it. */
export function clampPlaylistItemsLimit(limit?: number): number {
  if (limit === undefined || Number.isNaN(limit)) return MAX_PLAYLIST_ITEMS;
  return Math.min(MAX_PLAYLIST_ITEMS, Math.max(1, Math.floor(limit)));
}

/** Another listener's playlist must be indistinguishable from a missing one, so both come back null. */
export function ownedBy<Playlist extends { listenerId: string }>(
  playlist: Playlist | null,
  listenerId: string,
): Playlist | null {
  return playlist !== null && playlist.listenerId === listenerId ? playlist : null;
}
