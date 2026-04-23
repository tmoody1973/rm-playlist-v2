/**
 * Shared parsing helpers used across adapters.
 *
 * Kept small and pure — no I/O, no throws. These are exercised indirectly by
 * every adapter's property test, so any helper added here must be fuzzable.
 */

/**
 * Split a stream-title string like "Artist - Title" into its two parts.
 *
 * SGmetadata and ICY deliver a single `StreamTitle` string with artist and
 * title concatenated. Different broadcasters use different separators. We try
 * the common ones in order and return null if none match cleanly (i.e. neither
 * side would be empty).
 *
 * Return value is null (not throw) for any shape that doesn't split cleanly.
 */
export function splitArtistTitle(streamTitle: string): { artist: string; title: string } | null {
  const seps = [" - ", " // ", " | ", " – "]; // includes en-dash seen on some broadcasters
  for (const sep of seps) {
    const idx = streamTitle.indexOf(sep);
    if (idx <= 0) continue;
    const artist = streamTitle.slice(0, idx).trim();
    const title = streamTitle.slice(idx + sep.length).trim();
    if (artist.length === 0 || title.length === 0) continue;
    return { artist, title };
  }
  return null;
}
