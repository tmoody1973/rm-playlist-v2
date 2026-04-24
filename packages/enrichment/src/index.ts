import { lookupAppleMusic } from "./apple-music";
import { lookupMusicBrainz } from "./musicbrainz";
import type { Throttle } from "./throttle";
import type { EnrichmentResult, FetchLike, PlayIdentity } from "./types";

export interface EnrichPlayDeps {
  readonly appleMusicToken: string;
  readonly appleMusicStorefront?: string;
  readonly musicBrainzThrottle: Throttle;
  readonly minMusicBrainzScore?: number;
  readonly signal?: AbortSignal;
  readonly fetch?: FetchLike;
}

/**
 * Resolve a play against Apple Music and MusicBrainz in parallel.
 *
 * Both lookups run unconditionally — Apple Music supplies preview URL +
 * artwork + display polish, MusicBrainz supplies canonical MBID for
 * artist identity. They're complements, not fallbacks. One adapter's
 * failure never aborts the other.
 */
export async function enrichPlay(
  play: PlayIdentity,
  deps: EnrichPlayDeps,
): Promise<EnrichmentResult> {
  const [appleMusic, musicBrainz] = await Promise.all([
    lookupAppleMusic(play, {
      token: deps.appleMusicToken,
      storefront: deps.appleMusicStorefront,
      fetch: deps.fetch,
    }),
    lookupMusicBrainz(play, {
      throttle: deps.musicBrainzThrottle,
      minScore: deps.minMusicBrainzScore,
      signal: deps.signal,
      fetch: deps.fetch,
    }),
  ]);

  return { appleMusic, musicBrainz };
}

export { lookupAppleMusic } from "./apple-music";
export { lookupMusicBrainz } from "./musicbrainz";
export { createThrottle } from "./throttle";
export { signDeveloperToken } from "./apple-music/jwt";
export type { Throttle, ThrottleConfig } from "./throttle";
export type {
  AppleMusicMatch,
  AppleMusicMiss,
  AppleMusicResult,
  EnrichmentResult,
  MusicBrainzMatch,
  MusicBrainzMiss,
  MusicBrainzResult,
  PlayIdentity,
} from "./types";
