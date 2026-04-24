import type { Throttle } from "../throttle";
import type { FetchLike } from "../types";

/**
 * Discogs database search client.
 *
 * Discogs is a community-maintained release + label database. We use it
 * as a SoundExchange-compliance fallback for the `recordLabel` field
 * when Apple Music returns null (most common case). It's release-
 * oriented — the search takes `{ artist, release_title }` (album) and
 * returns release entries, each carrying a `label[]` array.
 *
 * Policy (per https://www.discogs.com/developers/):
 *   - 25 req/min unauthenticated, 60 req/min with a personal token
 *   - User-Agent REQUIRED (empty responses otherwise)
 *   - `token` passes either via ?token=... query or Authorization header
 */

const API_BASE = "https://api.discogs.com";
const USER_AGENT = "rm-playlist-v2/0.1 (+https://github.com/tmoody1973/rm-playlist-v2)";

export type DiscogsErrorCode = "rate_limited" | "upstream_5xx" | "other";

export class DiscogsError extends Error {
  public readonly code: DiscogsErrorCode;
  public readonly status: number;
  constructor(code: DiscogsErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "DiscogsError";
  }
}

/**
 * Auth options. Either (`token`) OR (`consumerKey` + `consumerSecret`)
 * — both raise the rate limit from 25/min to 60/min. `token` is a
 * user personal access token; `consumerKey`/`consumerSecret` is an
 * app-level OAuth 1.0a consumer pair used without a user grant
 * (Discogs lets this work as a bare key/secret for server-to-server).
 * Leave all empty for unauthenticated access.
 */
export interface DiscogsAuth {
  readonly token?: string;
  readonly consumerKey?: string;
  readonly consumerSecret?: string;
}

export interface SearchReleaseInput extends DiscogsAuth {
  readonly artist: string;
  readonly album: string;
  readonly throttle: Throttle;
  readonly signal?: AbortSignal;
  readonly fetch?: FetchLike;
}

export interface NormalizedRelease {
  readonly discogsReleaseId: number;
  readonly title: string;
  readonly labels: readonly string[];
  readonly year?: string;
  readonly country?: string;
}

interface DiscogsResultRaw {
  id?: number;
  title?: string;
  label?: string[];
  year?: string;
  country?: string;
  type?: string;
}

interface DiscogsSearchResponse {
  results?: DiscogsResultRaw[];
}

export async function searchRelease(input: SearchReleaseInput): Promise<NormalizedRelease[]> {
  const first = await runReleaseSearch(input, input.album);
  if (first.length > 0) return first;

  // Variant retry: strip trailing "(Deluxe Edition)" / "(Remastered)"
  // style suffixes and re-query. Discogs' search often doesn't match
  // "Sympathy for Life (Deluxe Edition)" against the canonical
  // "Sympathy for Life" release row.
  const stripped = normalizeAlbumForDiscogs(input.album);
  if (stripped !== input.album && stripped.length > 0) {
    return runReleaseSearch(input, stripped);
  }
  return [];
}

/**
 * Search Discogs for releases by this artist alone — no album filter —
 * and return the first label we can see. Used as a last-resort fallback
 * when both album-based searches (tiers 2a + 2b) and the MB release
 * lookup (tier 3) miss. Less accurate than album-matched labels — the
 * artist may have been on several labels — but usually produces
 * something SoundExchange-acceptable for a single-label artist.
 */
export async function searchArtistPrimaryLabel(input: {
  readonly artist: string;
  readonly throttle: Throttle;
  readonly token?: string;
  readonly consumerKey?: string;
  readonly consumerSecret?: string;
  readonly signal?: AbortSignal;
  readonly fetch?: FetchLike;
}): Promise<string | null> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const params = new URLSearchParams({
    type: "release",
    artist: input.artist,
    per_page: "10",
  });
  if (input.token) {
    params.set("token", input.token);
  } else if (input.consumerKey && input.consumerSecret) {
    params.set("key", input.consumerKey);
    params.set("secret", input.consumerSecret);
  }
  const url = `${API_BASE}/database/search?${params.toString()}`;

  await input.throttle.acquire(input.signal);
  const res = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    signal: input.signal,
  });
  if (!res.ok) throw classifyError(res.status, await safeText(res));

  const json = (await res.json()) as DiscogsSearchResponse;
  for (const r of json.results ?? []) {
    if (r.type !== "release") continue;
    const label = Array.isArray(r.label) ? r.label.find((l) => l && l.trim().length > 0) : null;
    if (label) return label.trim();
  }
  return null;
}

/**
 * Strip trailing parenthetical suffixes Discogs' search indexes don't
 * usually carry. Leaves mid-title parens alone — those often ARE the
 * canonical title ("Title (Subtitle)"). Exported for testing.
 */
export function normalizeAlbumForDiscogs(album: string): string {
  const suffixPatterns: readonly RegExp[] = [
    /\s*\(deluxe[^)]*\)\s*$/i,
    /\s*\(remaster(?:ed)?[^)]*\)\s*$/i,
    /\s*\(expanded[^)]*\)\s*$/i,
    /\s*\(bonus[^)]*\)\s*$/i,
    /\s*\([^)]*anniversary[^)]*\)\s*$/i,
    /\s*\(special edition\)\s*$/i,
    /\s*\(radio edit\)\s*$/i,
    /\s*\(live\)\s*$/i,
    /\s*\(ep\)\s*$/i,
  ];
  let out = album;
  for (const rx of suffixPatterns) {
    out = out.replace(rx, "");
  }
  return out.trim();
}

async function runReleaseSearch(
  input: SearchReleaseInput,
  albumTerm: string,
): Promise<NormalizedRelease[]> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const params = new URLSearchParams({
    type: "release",
    artist: input.artist,
    release_title: albumTerm,
    per_page: "5",
  });
  if (input.token) {
    params.set("token", input.token);
  } else if (input.consumerKey && input.consumerSecret) {
    params.set("key", input.consumerKey);
    params.set("secret", input.consumerSecret);
  }
  const url = `${API_BASE}/database/search?${params.toString()}`;

  await input.throttle.acquire(input.signal);
  const res = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    signal: input.signal,
  });

  if (!res.ok) throw classifyError(res.status, await safeText(res));

  const json = (await res.json()) as DiscogsSearchResponse;
  const releases = (json.results ?? []).filter((r) => r.type === "release");
  return releases.map(normalize).filter(isPresent);
}

function normalize(raw: DiscogsResultRaw): NormalizedRelease | null {
  if (!raw.id || !raw.title) return null;
  const labels = Array.isArray(raw.label) ? dedupeOrdered(raw.label) : [];
  return {
    discogsReleaseId: raw.id,
    title: raw.title,
    labels,
    year: raw.year,
    country: raw.country,
  };
}

function dedupeOrdered(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const trimmed = x.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function classifyError(status: number, body: string): DiscogsError {
  if (status === 429) {
    return new DiscogsError("rate_limited", status, `discogs 429: ${body}`);
  }
  if (status >= 500) {
    return new DiscogsError("upstream_5xx", status, `discogs ${status}: ${body}`);
  }
  return new DiscogsError("other", status, `discogs ${status}: ${body}`);
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "<body unavailable>";
  }
}
