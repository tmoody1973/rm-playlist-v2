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
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const params = new URLSearchParams({
    type: "release",
    artist: input.artist,
    release_title: input.album,
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
