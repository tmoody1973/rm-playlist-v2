/**
 * Shared enrichment result shapes.
 *
 * Each adapter returns a discriminated union so the orchestrator and
 * downstream callers can reason about hit/miss without catching thrown
 * errors. Adapter errors that couldn't produce a result become
 * `matched: false` with a typed reason — only unexpected bugs throw.
 */

export interface PlayIdentity {
  readonly artist: string;
  readonly title: string;
}

/** Miss reasons every adapter can report. Each adapter extends this with its own. */
export type SharedMissReason = "no_results" | "rate_limited" | "upstream_5xx" | "other";

export type AppleMusicMissReason = SharedMissReason | "unauthorized";
export type MusicBrainzMissReason = SharedMissReason | "below_threshold";

export interface AppleMusicMatch {
  readonly matched: true;
  readonly songId: string;
  /** Primary Apple Music artist ID from the song's `relationships.artists` list. */
  readonly artistAppleMusicId?: string;
  readonly artistName: string;
  readonly title: string;
  readonly albumName?: string;
  /** Apple Music-supplied record label (often null). SoundExchange may require MB fallback. */
  readonly recordLabel?: string;
  readonly isrc?: string;
  readonly durationSec?: number;
  readonly previewUrl?: string;
  /** Template URL with `{w}x{h}` placeholders Apple wants the consumer to fill. */
  readonly artworkUrl?: string;
}

export interface AppleMusicMiss {
  readonly matched: false;
  readonly reason: AppleMusicMissReason;
}

export type AppleMusicResult = AppleMusicMatch | AppleMusicMiss;

export interface MusicBrainzMatch {
  readonly matched: true;
  readonly recordingMbid: string;
  readonly title: string;
  readonly artistMbid: string;
  readonly artistName: string;
  readonly score: number;
}

export interface MusicBrainzMiss {
  readonly matched: false;
  readonly reason: MusicBrainzMissReason;
}

export type MusicBrainzResult = MusicBrainzMatch | MusicBrainzMiss;

export interface DiscogsMatch {
  readonly matched: true;
  readonly releaseId: number;
  readonly label: string;
  readonly labels: readonly string[];
  readonly year?: string;
  readonly country?: string;
}

export type DiscogsMissReason =
  | "no_album_hint"
  | "no_results"
  | "rate_limited"
  | "upstream_5xx"
  | "other";

export interface DiscogsMiss {
  readonly matched: false;
  readonly reason: DiscogsMissReason;
}

export type DiscogsResult = DiscogsMatch | DiscogsMiss;

export interface EnrichmentResult {
  readonly appleMusic: AppleMusicResult;
  readonly musicBrainz: MusicBrainzResult;
}

/**
 * Minimal fetch signature the enrichment adapters accept. Bun's global
 * `fetch` carries extras (`preconnect`, Bun-specific init shape) that
 * test mocks shouldn't have to reproduce.
 */
export type FetchLike = (input: URL | string | Request, init?: RequestInit) => Promise<Response>;
