import { logger, schedules, tasks } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { enrichPlay } from "../../packages/enrichment/src";
import { lookupDiscogs } from "../../packages/enrichment/src/discogs";
import { searchArtistPrimaryLabel } from "../../packages/enrichment/src/discogs/client";
import { lookupLabelByRecording } from "../../packages/enrichment/src/musicbrainz/client";
import { createThrottle, type Throttle } from "../../packages/enrichment/src/throttle";
import type {
  AppleMusicResult,
  FetchLike,
  MusicBrainzResult,
} from "../../packages/enrichment/src/types";
import { api } from "../../packages/convex/convex/_generated/api.js";
import type { Id } from "../../packages/convex/convex/_generated/dataModel";
import { getConvexUrl } from "./env";

export type UnresolvedReason = "mb_miss" | "no_match" | "other";

/**
 * Enrich pending plays.
 *
 * Every minute: pull up to 20 `enrichmentStatus: "pending"` plays from
 * Convex, resolve each against Apple Music + MusicBrainz in parallel,
 * and write canonical artist/track IDs back via the public enrichment
 * mutations. MusicBrainz's 1-req/sec limit is enforced by a
 * process-local throttle shared across plays in each tick.
 *
 * Matching decision tree:
 *   - MB hit + AM hit  -> upsertArtistByMbid + upsertTrack + markPlayEnriched
 *   - MB hit, AM miss  -> upsertArtistByMbid + markPlayEnriched (partial)
 *   - MB miss, AM hit  -> markPlayUnresolved (no artist identity to anchor)
 *   - Both miss        -> markPlayUnresolved
 *
 * If the Apple Music JWT cache is empty or near-expiry, fire the refresh
 * cron and skip this tick; the next tick (60s later) should have a
 * valid token.
 */

const PENDING_BATCH = 20;
const MB_RATE_PER_SEC = 1;
const DISCOGS_RATE_PER_SEC = 1;

export interface PendingPlay {
  readonly _id: string;
  readonly artistRaw: string;
  readonly titleRaw: string;
}

export interface BatchSummary {
  total: number;
  resolved: number;
  partial: number;
  unresolved: number;
  errored: number;
  /**
   * Plays left as `pending` because the upstream failure was transient
   * (Apple 401/429/5xx, etc.). They'll be re-tried on the next cron tick
   * after token refresh / backoff, instead of polluting `Needs Attention`.
   */
  deferred: number;
  skipped?: boolean;
  reason?: string;
}

/**
 * Apple reason codes that indicate a retryable upstream condition rather
 * than an actual "this song does not exist on Apple Music" answer. Plays
 * that hit one of these should stay `pending` so the next tick retries,
 * NOT get marked unresolved.
 */
function isTransientAppleReason(reason: string): boolean {
  return reason === "unauthorized" || reason === "rate_limited" || reason === "upstream_5xx";
}

export interface EnrichBatchDeps {
  readonly client: ConvexHttpClient;
  readonly pending: PendingPlay[];
  readonly appleMusicToken: string | null;
  readonly throttle: Throttle;
  /** Separate throttle for Discogs — its 25-60 req/min limit is independent of MB's 1 req/sec. */
  readonly discogsThrottle?: Throttle;
  /** Optional personal Discogs token (raises 25/min → 60/min). */
  readonly discogsToken?: string;
  /** Consumer key+secret pair (same elevated rate, no user OAuth). */
  readonly discogsConsumerKey?: string;
  readonly discogsConsumerSecret?: string;
  /** Test seam — override `fetch` passed into enrichPlay. */
  readonly fetch?: FetchLike;
  /** Test seam — skip tasks.trigger() side-effect. */
  readonly onTokenRefreshNeeded?: () => Promise<void> | void;
  readonly log?: (msg: string) => void;
}

/**
 * Pure(-ish) orchestrator — given a batch of pending plays, a Convex
 * client, and an Apple Music token, run the enrichment decision tree.
 * Extracted from the schedules.task wrapper so it's unit-testable
 * without the Trigger.dev runtime.
 */
export async function enrichBatch(deps: EnrichBatchDeps): Promise<BatchSummary> {
  const log = deps.log ?? (() => undefined);

  if (deps.pending.length === 0) {
    return { total: 0, resolved: 0, partial: 0, unresolved: 0, errored: 0, deferred: 0 };
  }

  if (deps.appleMusicToken === null) {
    await deps.onTokenRefreshNeeded?.();
    return {
      total: deps.pending.length,
      resolved: 0,
      partial: 0,
      unresolved: 0,
      errored: 0,
      deferred: deps.pending.length,
      skipped: true,
      reason: "token_refresh",
    };
  }

  const summary: BatchSummary = {
    total: deps.pending.length,
    resolved: 0,
    partial: 0,
    unresolved: 0,
    errored: 0,
    deferred: 0,
  };

  let tokenAbort = false;
  for (const play of deps.pending) {
    if (tokenAbort) {
      // Every remaining play stays pending — next tick (post-refresh) retries.
      summary.deferred += 1;
      continue;
    }
    try {
      const unauthorized = await enrichOne(
        deps.client,
        play,
        deps.appleMusicToken,
        deps.throttle,
        summary,
        deps.fetch,
        deps.discogsThrottle,
        deps.discogsToken,
        deps.discogsConsumerKey,
        deps.discogsConsumerSecret,
      );
      if (unauthorized) {
        // Token dead mid-batch — trigger refresh once, abort the rest so we
        // don't burn Apple quota (or mark plays unresolved) with a bad JWT.
        tokenAbort = true;
        log(`[${play._id}] apple 401 — aborting batch, triggering token refresh`);
        await deps.onTokenRefreshNeeded?.();
      }
    } catch (err) {
      summary.errored += 1;
      const message = err instanceof Error ? err.message : String(err);
      log(`[${play._id}] enrichment crashed: ${message}`);
    }
  }

  if (tokenAbort && summary.reason === undefined) {
    summary.reason = "token_expired_mid_batch";
  }

  return summary;
}

export const enrichPendingPlays = schedules.task({
  id: "enrich-pending-plays",
  cron: "* * * * *",
  queue: { concurrencyLimit: 1 },
  maxDuration: 240,
  run: async () => {
    const client = new ConvexHttpClient(getConvexUrl());

    const pending = (await client.query(api.enrichment.pendingPlays, {
      limit: PENDING_BATCH,
    })) as PendingPlay[];
    if (pending.length === 0) {
      logger.log("No pending plays — enrichment idle");
    }

    const tokenRow = await client.query(api.appleMusic.getDeveloperToken, {});
    const summary = await enrichBatch({
      client,
      pending,
      appleMusicToken: tokenRow?.token ?? null,
      throttle: createThrottle({ ratePerSec: MB_RATE_PER_SEC }),
      discogsThrottle: createThrottle({ ratePerSec: DISCOGS_RATE_PER_SEC }),
      discogsToken: process.env.DISCOGS_TOKEN,
      discogsConsumerKey: process.env.DISCOGS_CONSUMER_KEY,
      discogsConsumerSecret: process.env.DISCOGS_CONSUMER_SECRET,
      onTokenRefreshNeeded: async () => {
        logger.warn("Apple Music JWT cache empty or near-expiry — triggering refresh");
        await tasks.trigger("refresh-apple-music-token", {});
      },
      log: (msg) => logger.error(msg),
    });

    if (summary.skipped) {
      logger.log(`Skipped batch: ${summary.reason}`);
    } else if (summary.total > 0) {
      logger.log(
        `Enriched ${summary.resolved} resolved, ${summary.partial} partial, ${summary.unresolved} unresolved, ${summary.deferred} deferred, ${summary.errored} errored (total ${summary.total})${summary.reason ? ` [${summary.reason}]` : ""}`,
      );
    }
    return summary;
  },
});

/**
 * Enrich a single play. Returns `true` iff Apple Music returned 401 —
 * batch caller uses this to abort and trigger a token refresh rather
 * than continuing to burn quota with a dead JWT.
 */
async function enrichOne(
  client: ConvexHttpClient,
  play: PendingPlay,
  appleMusicToken: string,
  throttle: Throttle,
  summary: BatchSummary,
  fetchOverride?: FetchLike,
  discogsThrottle?: Throttle,
  discogsToken?: string,
  discogsConsumerKey?: string,
  discogsConsumerSecret?: string,
): Promise<boolean> {
  const playId = play._id as Id<"plays">;
  const identity = { artist: play.artistRaw, title: play.titleRaw };
  const result = await enrichPlay(identity, {
    appleMusicToken,
    musicBrainzThrottle: throttle,
    fetch: fetchOverride,
  });

  const { appleMusic, musicBrainz } = result;
  const mbHit = musicBrainz.matched;
  const amHit = appleMusic.matched;

  if (mbHit && amHit) {
    const resolvedLabel = await resolveRecordLabel(
      appleMusic,
      musicBrainz,
      throttle,
      discogsThrottle,
      discogsToken,
      fetchOverride,
      discogsConsumerKey,
      discogsConsumerSecret,
    );
    await resolveBoth(client, playId, appleMusic, musicBrainz, resolvedLabel);
    summary.resolved += 1;
    return false;
  }
  if (mbHit && !amHit) {
    await resolveMbOnly(client, playId, musicBrainz, appleMusic);
    summary.partial += 1;
    return false;
  }

  // Both sides missed. If Apple's miss was transient (401/429/5xx), leave
  // the play pending — the next tick retries once the token is refreshed
  // or the rate-limit window passes. Only persistent "not found" misses
  // earn a markUnresolved write (which surfaces in Needs Attention).
  const amTransient = !amHit && isTransientAppleReason(appleMusic.reason);
  if (amTransient) {
    summary.deferred += 1;
    return appleMusic.reason === "unauthorized";
  }

  await markUnresolved(client, playId, result);
  summary.unresolved += 1;
  return false;
}

/**
 * Apple Music frequently returns `recordLabel: null` even on well-known
 * tracks. For SoundExchange compliance we fall back to Discogs'
 * release label when Apple's is empty and we have an album hint.
 * Never throws — missing label just means the track row stays
 * recordLabel-null until a future play provides better data.
 */
/**
 * Record-label resolution priority (each tier only runs if the previous
 * tier produced no value). Every Apple-resolved track goes through
 * this chain — missing `recordLabel` is the biggest SoundExchange gap.
 *
 *   1.  Apple Music's recordLabel attribute — free, already fetched
 *       during the primary search.
 *   2a. Discogs release search by (artist, album).
 *   2b. Discogs release search with "(Deluxe Edition)" / "(Remastered)"
 *       style suffixes stripped from the album — catches canonical
 *       releases Discogs' full-title match doesn't hit. Handled
 *       inside searchRelease — orchestrator sees one call.
 *   3.  MusicBrainz release lookup by recordingMbid with inc=labels.
 *       Uses the MBID we already hold from enrichPlay's recording
 *       search — one extra MB request. Catches releases Discogs
 *       doesn't index well (N.W.A. "Express Yourself" is
 *       Ruthless/Priority on MB).
 *   4.  Discogs artist-only search — take the first label across the
 *       artist's discography. Less precise than album-matched labels
 *       (artist may have switched labels), but gives SoundExchange
 *       a plausible value for single-label indie artists rather
 *       than nothing.
 */
async function resolveRecordLabel(
  am: AppleMusicResult & { matched: true },
  mb: MusicBrainzResult & { matched: true },
  mbThrottle: Throttle,
  discogsThrottle: Throttle | undefined,
  discogsToken: string | undefined,
  fetchOverride: FetchLike | undefined,
  discogsConsumerKey?: string,
  discogsConsumerSecret?: string,
): Promise<string | undefined> {
  // Tier 1 — Apple Music
  if (am.recordLabel && am.recordLabel.trim().length > 0) return am.recordLabel;

  // Tier 2a + 2b — Discogs release search (variant retry inside)
  if (discogsThrottle && am.albumName && am.albumName.trim().length > 0) {
    const discogs = await lookupDiscogs(
      { artist: am.artistName, album: am.albumName },
      {
        throttle: discogsThrottle,
        token: discogsToken,
        consumerKey: discogsConsumerKey,
        consumerSecret: discogsConsumerSecret,
        fetch: fetchOverride,
      },
    );
    if (discogs.matched) return discogs.label;
  }

  // Tier 3 — MB release lookup via MBID
  try {
    const mbLabel = await lookupLabelByRecording({
      recordingMbid: mb.recordingMbid,
      throttle: mbThrottle,
      fetch: fetchOverride,
    });
    if (mbLabel && mbLabel.length > 0) return mbLabel;
  } catch {
    // non-fatal — track resolves without a label, same as no release data
  }

  // Tier 4 — Discogs artist-only (last-resort approximate)
  if (discogsThrottle) {
    try {
      const artistLabel = await searchArtistPrimaryLabel({
        artist: am.artistName,
        throttle: discogsThrottle,
        token: discogsToken,
        consumerKey: discogsConsumerKey,
        consumerSecret: discogsConsumerSecret,
        fetch: fetchOverride,
      });
      if (artistLabel && artistLabel.length > 0) return artistLabel;
    } catch {
      // non-fatal
    }
  }

  return undefined;
}

async function resolveBoth(
  client: ConvexHttpClient,
  playId: Id<"plays">,
  am: AppleMusicResult & { matched: true },
  mb: MusicBrainzResult & { matched: true },
  resolvedLabel: string | undefined,
): Promise<void> {
  const artistId = (await client.mutation(api.enrichment.upsertArtistByMbid, {
    mbid: mb.artistMbid,
    displayName: mb.artistName,
    appleMusicId: am.artistAppleMusicId,
  })) as Id<"artists">;

  const trackId = (await client.mutation(api.enrichment.upsertTrack, {
    artistId,
    displayTitle: am.title,
    appleMusicSongId: am.songId,
    albumDisplayName: am.albumName,
    recordLabel: resolvedLabel,
    isrc: am.isrc,
    durationSec: am.durationSec,
    artworkUrl: am.artworkUrl,
  })) as Id<"tracks">;

  await client.mutation(api.enrichment.markPlayEnriched, {
    playId,
    canonicalArtistId: artistId,
    canonicalTrackId: trackId,
    context: { mbScore: mb.score, appleMusicSongId: am.songId },
  });
}

async function resolveMbOnly(
  client: ConvexHttpClient,
  playId: Id<"plays">,
  mb: MusicBrainzResult & { matched: true },
  am: AppleMusicResult,
): Promise<void> {
  const artistId = (await client.mutation(api.enrichment.upsertArtistByMbid, {
    mbid: mb.artistMbid,
    displayName: mb.artistName,
  })) as Id<"artists">;

  await client.mutation(api.enrichment.markPlayEnriched, {
    playId,
    canonicalArtistId: artistId,
    context: {
      mbScore: mb.score,
      appleMusicMissReason: am.matched === false ? am.reason : undefined,
    },
  });
}

async function markUnresolved(
  client: ConvexHttpClient,
  playId: Id<"plays">,
  result: { appleMusic: AppleMusicResult; musicBrainz: MusicBrainzResult },
): Promise<void> {
  const amReason = result.appleMusic.matched === false ? result.appleMusic.reason : "matched";
  const mbReason = result.musicBrainz.matched === false ? result.musicBrainz.reason : "matched";
  await client.mutation(api.enrichment.markPlayUnresolved, {
    playId,
    reason: classifyUnresolvedReason(result),
    context: { amReason, mbReason },
  });
}

function classifyUnresolvedReason(result: {
  appleMusic: AppleMusicResult;
  musicBrainz: MusicBrainzResult;
}): UnresolvedReason {
  const amHit = result.appleMusic.matched;
  const mbHit = result.musicBrainz.matched;
  if (amHit && !mbHit) return "mb_miss";
  if (!amHit && !mbHit) return "no_match";
  return "other";
}
