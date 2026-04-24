import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, query } from "./_generated/server";

/**
 * Apple Music preview URL resolution for the widget `PreviewButton`.
 *
 * Widget flow (happy path after enrichment has caught up):
 *   - `plays.currentByStation` returns `previewUrl` already populated
 *     → no action call, widget plays immediately.
 *
 * Widget flow (old track, or Apple didn't return a preview on first
 * enrichment):
 *   - `plays.currentByStation` returns `previewUrl: null` but
 *     `appleMusicSongId` is set
 *   - Widget calls `preview.resolvePreviewUrl({ appleMusicSongId })`
 *   - Action hits Apple `/v1/catalog/us/songs/{id}` once, stores the
 *     URL on the track row, returns it
 *   - All future plays of this track use the cached value
 *
 * This bounds Apple quota to "once per track that's missing previewUrl"
 * rather than "once per widget click."
 */

// TODO(security): unauthenticated public action — anyone with the Convex
// URL can trigger Apple API calls. Mitigations for session 3: (a) rate-
// limit per client IP, (b) require the requested songId to match an
// actual `tracks` row before hitting Apple (already enforced below).
export const resolvePreviewUrl = action({
  args: { appleMusicSongId: v.string() },
  handler: async (
    ctx,
    { appleMusicSongId },
  ): Promise<{ previewUrl: string | null; source: "cache" | "apple" | "none" }> => {
    const track = await ctx.runQuery(internal.preview.findTrackByAppleSongId, {
      appleMusicSongId,
    });
    if (track === null) return { previewUrl: null, source: "none" };
    if (track.previewUrl) return { previewUrl: track.previewUrl, source: "cache" };

    const token = await ctx.runQuery(api.appleMusic.getDeveloperToken, {});
    if (token === null) return { previewUrl: null, source: "none" };

    const fetched = await fetchApplePreviewUrl(appleMusicSongId, token.token);
    if (fetched !== null) {
      await ctx.runMutation(internal.preview.patchPreviewUrl, {
        trackId: track._id,
        previewUrl: fetched,
      });
    }
    return { previewUrl: fetched, source: fetched ? "apple" : "none" };
  },
});

export const findTrackByAppleSongId = internalQuery({
  args: { appleMusicSongId: v.string() },
  handler: async (ctx, { appleMusicSongId }) => {
    return await ctx.db
      .query("tracks")
      .withIndex("by_apple_music", (q) => q.eq("appleMusicSongId", appleMusicSongId))
      .first();
  },
});

export const patchPreviewUrl = internalMutation({
  args: {
    trackId: v.id("tracks"),
    previewUrl: v.string(),
  },
  handler: async (ctx, { trackId, previewUrl }) => {
    await ctx.db.patch(trackId, { previewUrl });
  },
});

/**
 * Public no-action read for bundle-size-sensitive widgets that want to
 * skip the full `plays.currentByStation` payload. Returns just the
 * cached preview URL for a known track. Returns `null` for unknown
 * tracks or tracks without a cached URL — widget falls back to
 * `resolvePreviewUrl` in that case.
 */
export const getCachedPreviewUrl = query({
  args: { appleMusicSongId: v.string() },
  handler: async (ctx, { appleMusicSongId }) => {
    const track = await ctx.db
      .query("tracks")
      .withIndex("by_apple_music", (q) => q.eq("appleMusicSongId", appleMusicSongId))
      .first();
    return track?.previewUrl ?? null;
  },
});

async function fetchApplePreviewUrl(songId: string, token: string): Promise<string | null> {
  const url = `https://api.music.apple.com/v1/catalog/us/songs/${encodeURIComponent(songId)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "rm-playlist-v2/0.1 (preview)",
    },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    data?: Array<{ attributes?: { previews?: Array<{ url?: string }> } }>;
  };
  const previewUrl = json.data?.[0]?.attributes?.previews?.[0]?.url;
  return typeof previewUrl === "string" && previewUrl.length > 0 ? previewUrl : null;
}

// Placate ts-unused-vars when this file is imported elsewhere.
export type _TrackIdRef = Id<"tracks">;
