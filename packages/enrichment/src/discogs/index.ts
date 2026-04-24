import type { Throttle } from "../throttle";
import type { DiscogsMissReason, DiscogsResult, FetchLike } from "../types";
import { DiscogsError, type DiscogsErrorCode, searchRelease } from "./client";

export interface LookupDiscogsDeps {
  readonly throttle: Throttle;
  readonly token?: string;
  readonly signal?: AbortSignal;
  readonly fetch?: FetchLike;
}

export interface LookupDiscogsInput {
  readonly artist: string;
  readonly album: string;
}

/**
 * Fallback record-label lookup. Calls Discogs' release search with the
 * artist + album we already resolved (via Apple Music), returns the
 * first release's primary label. Intended to run AFTER Apple Music in
 * the orchestrator — only invoked when Apple returned no `recordLabel`.
 *
 * Never throws on upstream failures; returns a discriminated miss the
 * orchestrator can ignore.
 */
export async function lookupDiscogs(
  input: LookupDiscogsInput,
  deps: LookupDiscogsDeps,
): Promise<DiscogsResult> {
  if (input.album.trim().length === 0) {
    return { matched: false, reason: "no_album_hint" };
  }
  try {
    const results = await searchRelease({
      artist: input.artist,
      album: input.album,
      throttle: deps.throttle,
      token: deps.token,
      signal: deps.signal,
      fetch: deps.fetch,
    });
    const best = results[0];
    if (!best || best.labels.length === 0) {
      return { matched: false, reason: "no_results" };
    }
    const label = best.labels[0];
    if (!label) return { matched: false, reason: "no_results" };
    return {
      matched: true,
      releaseId: best.discogsReleaseId,
      label,
      labels: best.labels,
      year: best.year,
      country: best.country,
    };
  } catch (err) {
    if (err instanceof DiscogsError) {
      return { matched: false, reason: mapErrorToReason(err.code) };
    }
    return { matched: false, reason: "other" };
  }
}

function mapErrorToReason(code: DiscogsErrorCode): DiscogsMissReason {
  switch (code) {
    case "rate_limited":
      return "rate_limited";
    case "upstream_5xx":
      return "upstream_5xx";
    default:
      return "other";
  }
}

export { DiscogsError, searchRelease } from "./client";
export type { NormalizedRelease, SearchReleaseInput } from "./client";
