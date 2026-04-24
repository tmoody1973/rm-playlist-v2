/**
 * Apple Music catalog client — search + song detail.
 *
 * The worker uses the search endpoint for match-on-artist+title lookup.
 * The detail endpoint is available if a later session needs full track
 * metadata (album art at multiple sizes, durationMs, ISRC).
 */

import type { FetchLike } from "../types";

const API_BASE = "https://api.music.apple.com/v1";
const USER_AGENT = "rm-playlist-v2/0.1 (enrichment)";

export type AppleMusicErrorCode = "unauthorized" | "rate_limited" | "upstream_5xx" | "other";

export class AppleMusicError extends Error {
  public readonly code: AppleMusicErrorCode;
  public readonly status: number;
  constructor(code: AppleMusicErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "AppleMusicError";
  }
}

export interface SearchSongInput {
  readonly artist: string;
  readonly title: string;
  readonly token: string;
  readonly storefront?: string;
  readonly fetch?: FetchLike;
}

export interface NormalizedSong {
  readonly songId: string;
  readonly name: string;
  readonly artistName: string;
  /** Primary Apple Music artist ID (first entry from `relationships.artists.data`). */
  readonly artistAppleMusicId?: string;
  readonly albumName?: string;
  /** Apple Music often omits this; kept for SoundExchange compliance where present. */
  readonly recordLabel?: string;
  readonly isrc?: string;
  /** Seconds, derived from Apple's `durationInMillis`. */
  readonly durationSec?: number;
  readonly previewUrl?: string;
  readonly artworkUrl?: string;
}

interface SongAttributes {
  name: string;
  artistName: string;
  albumName?: string;
  recordLabel?: string;
  isrc?: string;
  durationInMillis?: number;
  previews?: Array<{ url?: string }>;
  artwork?: { url?: string };
}

interface RelationshipArtistRef {
  id: string;
  type?: string;
}

interface SongRelationships {
  artists?: { data?: RelationshipArtistRef[] };
}

interface SongResource {
  id: string;
  attributes?: SongAttributes;
  relationships?: SongRelationships;
}

interface SearchResponse {
  results?: {
    songs?: { data?: SongResource[] };
  };
}

export async function searchSong(input: SearchSongInput): Promise<NormalizedSong | null> {
  const storefront = input.storefront ?? "us";
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const term = encodeURIComponent(`${input.artist} ${input.title}`);
  // `include[songs]=artists` returns the song's artist relationship list
  // inline, so we get the Apple Music artist ID (for deep-link + dedup)
  // in the same response — no second round trip.
  const url = `${API_BASE}/catalog/${storefront}/search?term=${term}&types=songs&limit=1&include%5Bsongs%5D=artists`;

  const res = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${input.token}`,
      "User-Agent": USER_AGENT,
    },
  });

  if (!res.ok) throw classifyError(res.status, await safeText(res));

  const json = (await res.json()) as SearchResponse;
  const first = json.results?.songs?.data?.[0];
  if (!first?.attributes) return null;
  return normalize(first);
}

function normalize(resource: SongResource): NormalizedSong | null {
  const attrs = resource.attributes;
  if (!attrs) return null;
  const primaryArtist = resource.relationships?.artists?.data?.[0];
  const durationMs = attrs.durationInMillis;
  return {
    songId: resource.id,
    name: attrs.name,
    artistName: attrs.artistName,
    artistAppleMusicId: primaryArtist?.id,
    albumName: attrs.albumName,
    recordLabel: attrs.recordLabel,
    isrc: attrs.isrc,
    durationSec:
      typeof durationMs === "number" && Number.isFinite(durationMs)
        ? Math.floor(durationMs / 1000)
        : undefined,
    previewUrl: attrs.previews?.[0]?.url,
    artworkUrl: attrs.artwork?.url,
  };
}

function classifyError(status: number, body: string): AppleMusicError {
  if (status === 401 || status === 403) {
    return new AppleMusicError("unauthorized", status, `apple music ${status}: ${body}`);
  }
  if (status === 429) {
    return new AppleMusicError("rate_limited", status, `apple music 429: ${body}`);
  }
  if (status >= 500) {
    return new AppleMusicError("upstream_5xx", status, `apple music ${status}: ${body}`);
  }
  return new AppleMusicError("other", status, `apple music ${status}: ${body}`);
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "<body unavailable>";
  }
}
