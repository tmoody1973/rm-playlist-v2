/**
 * Cross-package type primitives for rm-playlist-v2.
 *
 * All source-agnostic types (NormalizedPlay, StationSlug, AdapterKind) live
 * here so @rm/ingestion, @rm/enrichment, @rm/convex, and services/icy-worker
 * share one contract.
 */

/** Radio Milwaukee's four active streams. Stable identifiers, used everywhere. */
export type StationSlug = "hyfin" | "88nine" | "414music" | "rhythmlab";

/** Ingestion source kinds. Extend as new adapters land. */
export type AdapterKind = "spinitron" | "sgmetadata" | "icy";

/**
 * A single play, normalized across all adapters.
 *
 * Pre-enrichment: `artistRaw` + `titleRaw` are the strings the source gave us.
 * Post-enrichment: the reconciliation pipeline writes a companion `canonicalArtistId`
 * on the stored Convex row, NOT here — this type is the wire shape between adapter
 * and Convex mutation.
 */
export interface NormalizedPlay {
  /** Station this play belongs to. */
  stationSlug: StationSlug;
  /** Which adapter produced this play. */
  source: AdapterKind;
  /** Raw artist string as observed (trimmed; never empty). */
  artistRaw: string;
  /** Raw track title as observed (trimmed; never empty). */
  titleRaw: string;
  /** Album / release name when available. */
  albumRaw?: string;
  /** Record label when available. */
  labelRaw?: string;
  /** Play duration in seconds when the source reports it. */
  durationSec?: number;
  /** Unix milliseconds when the play started. */
  playedAt: number;
  /** Adapter-specific raw object, for audit + replay. */
  raw: unknown;
}
