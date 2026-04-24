import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalQuery, mutation } from "./_generated/server";

/**
 * Operator-invoked backfills for tracks that landed with incomplete
 * metadata. Kept out of `enrichment.ts` (the per-play pipeline) to keep
 * the concerns separate — this file is "fix the data we already have",
 * enrichment.ts is "resolve new plays."
 *
 * Current backfills:
 *   - fillMissingDurationsFromApple: for every track with an
 *     `appleMusicSongId` set but no `durationSec`, fetch
 *     `/v1/catalog/us/songs/{id}` and patch. Addresses the NPR export
 *     gap where a missing End Time causes row rejection.
 *   - reEnrichMbOnlyPlays: flip plays that resolved via the MB-only
 *     path (artist-matched, no track row, no artworkUrl) back to
 *     `pending` so the next enrich cron tick re-runs them through
 *     the new CAA cover-art fallback.
 */

/** Apple Music's max quota is generous but the docs recommend pacing. */
const APPLE_INTER_REQUEST_DELAY_MS = 50;
/** Convex action timeout is 10min; keep batches well under that. */
const DEFAULT_BATCH_LIMIT = 100;
const MAX_BATCH_LIMIT = 300;

interface CandidateTrack {
  readonly trackId: Id<"tracks">;
  readonly appleMusicSongId: string;
  readonly displayTitle: string;
}

/**
 * Tracks that have an Apple Music songId but a missing or zero
 * durationSec. Used by `fillMissingDurationsFromApple`. Limited by the
 * caller — the action streams through the result sequentially.
 *
 * Note this scans the full tracks table (no indexed path for
 * "appleMusicSongId set AND durationSec missing"), but at Radio
 * Milwaukee's scale that's a few thousand rows at most.
 */
export const listTracksMissingDurationWithAppleSongId = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }): Promise<CandidateTrack[]> => {
    const cap = Math.min(Math.max(limit, 1), MAX_BATCH_LIMIT);
    const candidates: CandidateTrack[] = [];
    for await (const track of ctx.db.query("tracks")) {
      if (track.appleMusicSongId === undefined) continue;
      if (typeof track.durationSec === "number" && track.durationSec > 0) continue;
      candidates.push({
        trackId: track._id,
        appleMusicSongId: track.appleMusicSongId,
        displayTitle: track.displayTitle,
      });
      if (candidates.length >= cap) break;
    }
    return candidates;
  },
});

export interface BackfillResult {
  readonly attempted: number;
  readonly filled: number;
  readonly skippedNoDuration: number;
  readonly failed: ReadonlyArray<{
    readonly trackId: Id<"tracks">;
    readonly reason: string;
  }>;
  readonly tokenMissing?: true;
}

/**
 * Apple Music's GET /catalog/{storefront}/songs/{id} returns a single
 * song resource with `attributes.durationInMillis`. This function is
 * intentionally minimal — we reuse the cached developer JWT that
 * Trigger.dev refreshes weekly and patch only `durationSec`, nothing
 * else. If Apple returns unauthorized, we abort the whole batch
 * (token is dead) so we don't burn quota on doomed calls.
 */
// TODO(security): HMAC + user attribution. Session 3 security pass.
export const fillMissingDurationsFromApple = action({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }): Promise<BackfillResult> => {
    const requested = Math.min(Math.max(limit ?? DEFAULT_BATCH_LIMIT, 1), MAX_BATCH_LIMIT);

    const token = await ctx.runQuery(api.appleMusic.getDeveloperToken, {});
    if (token === null) {
      return {
        attempted: 0,
        filled: 0,
        skippedNoDuration: 0,
        failed: [],
        tokenMissing: true,
      };
    }

    const candidates = await ctx.runQuery(
      internal.backfills.listTracksMissingDurationWithAppleSongId,
      { limit: requested },
    );
    if (candidates.length === 0) {
      return { attempted: 0, filled: 0, skippedNoDuration: 0, failed: [] };
    }

    let filled = 0;
    let skippedNoDuration = 0;
    const failed: Array<{ trackId: Id<"tracks">; reason: string }> = [];

    for (const track of candidates) {
      try {
        const durationSec = await fetchAppleSongDurationSec(track.appleMusicSongId, token.token);
        if (durationSec === null) {
          skippedNoDuration += 1;
          continue;
        }
        await ctx.runMutation(api.enrichment.patchTrackMetadata, {
          trackId: track.trackId,
          durationSec,
        });
        filled += 1;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        failed.push({ trackId: track.trackId, reason });
        // 401 → token dead; abort rest of the batch.
        if (reason.includes("apple music 401") || reason.includes("apple music 403")) break;
      }
      await sleep(APPLE_INTER_REQUEST_DELAY_MS);
    }

    return {
      attempted: candidates.length,
      filled,
      skippedNoDuration,
      failed,
    };
  },
});

async function fetchAppleSongDurationSec(songId: string, token: string): Promise<number | null> {
  const url = `https://api.music.apple.com/v1/catalog/us/songs/${encodeURIComponent(songId)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "rm-playlist-v2/0.1 (backfill)",
    },
  });
  if (!res.ok) {
    const body = await safeText(res);
    throw new Error(`apple music ${res.status}: ${body}`);
  }
  const json = (await res.json()) as {
    data?: Array<{ attributes?: { durationInMillis?: number } }>;
  };
  const durationMs = json.data?.[0]?.attributes?.durationInMillis;
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  return Math.floor(durationMs / 1000);
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "<body unavailable>";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reference types retained so the candidate shape stays close to the
// `tracks` table. If the shape drifts, TS will catch this import.
type _CandidateTypeCheck = Doc<"tracks">;

/**
 * Retroactive backfill for plays that resolved via the MB-only path
 * before the Cover Art Archive fallback shipped (PR #16). Those plays
 * have `canonicalArtistId` set, `canonicalTrackId` undefined, and the
 * widget falls back to the station-default logo because there's no
 * track row carrying an `artworkUrl`.
 *
 * Flipping them to `enrichmentStatus: "pending"` makes them eligible
 * for the next 60s enrich cron tick, which will run through the new
 * CAA path and upsert a track row with real album art when available.
 * For plays where CAA also misses, the second pass produces no track
 * and the row re-resolves to the same artist-only shape as before —
 * net: no regression, recovery on best-effort.
 *
 * Invoke via:
 *
 *   bunx convex run backfills:reEnrichMbOnlyPlays '{}'
 *   bunx convex run backfills:reEnrichMbOnlyPlays '{"limit": 50}'
 *
 * Returns `{ flipped, scanned }`. Safe to invoke multiple times —
 * once a play has a canonicalTrackId, it's skipped.
 */
// TODO(security): HMAC + admin-role check. Session 3 security pass.
export const reEnrichMbOnlyPlays = mutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }): Promise<{ flipped: number; scanned: number }> => {
    const cap = Math.min(Math.max(limit ?? 200, 1), 2000);
    let scanned = 0;
    let flipped = 0;

    // Scan recent-resolved plays (by status index) — MB-only rows are rare
    // enough that the whole candidate set for RM fits in one pass well
    // under the cap. If we grow to multi-station scale later, convert to
    // a paginator.
    const trackCache = new Map<Id<"tracks">, Doc<"tracks"> | null>();
    for await (const play of ctx.db
      .query("plays")
      .withIndex("by_enrichment_status", (q) => q.eq("enrichmentStatus", "resolved"))) {
      scanned += 1;
      if (scanned >= cap) break;
      if (play.canonicalArtistId === undefined) continue; // defensive

      // Two shapes to flip:
      // (1) Pre-PR#16 MB-only resolution: no track row at all.
      // (2) Post-PR#16 MB-only with a track, but the track is missing
      //     artwork — happens when sanitizeArtworkUrl stripped a CAA
      //     URL during the pre-sanitizer-fix window. Clearing the
      //     track on the play lets the next cron re-run upsertTrack
      //     (trackKey dedup patches the existing row with art).
      let shouldFlip = false;
      if (play.canonicalTrackId === undefined) {
        shouldFlip = true;
      } else {
        let track = trackCache.get(play.canonicalTrackId);
        if (track === undefined) {
          track = await ctx.db.get(play.canonicalTrackId);
          trackCache.set(play.canonicalTrackId, track);
        }
        if (track !== null && !track.appleMusicSongId && !track.artworkUrl) {
          shouldFlip = true;
        }
      }

      if (shouldFlip) {
        await ctx.db.patch(play._id, {
          enrichmentStatus: "pending",
          canonicalArtistId: undefined,
          canonicalTrackId: undefined,
        });
        flipped += 1;
      }
    }

    return { flipped, scanned };
  },
});
