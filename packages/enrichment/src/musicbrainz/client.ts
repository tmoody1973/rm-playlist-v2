import type { Throttle } from "../throttle";
import type { FetchLike } from "../types";

/**
 * MusicBrainz recording lookup client.
 *
 * Policy:
 *   - 1 req/sec per IP — enforced by the injected `throttle`
 *   - User-Agent MUST identify the application + contact, per
 *     https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting
 *   - Lucene-syntax queries against /ws/2/recording
 */

const API_BASE = "https://musicbrainz.org/ws/2";
const USER_AGENT = "rm-playlist-v2/0.1 ( tarik@radiomilwaukee.org )";

export type MusicBrainzErrorCode = "rate_limited" | "upstream_5xx" | "other";

export class MusicBrainzError extends Error {
  public readonly code: MusicBrainzErrorCode;
  public readonly status: number;
  constructor(code: MusicBrainzErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "MusicBrainzError";
  }
}

export interface SearchRecordingInput {
  readonly artist: string;
  readonly title: string;
  readonly throttle: Throttle;
  readonly signal?: AbortSignal;
  readonly fetch?: FetchLike;
}

export interface NormalizedRecording {
  readonly recordingMbid: string;
  readonly title: string;
  readonly artistMbid: string;
  readonly artistName: string;
  readonly score: number;
}

interface MbArtistCredit {
  name?: string;
  artist?: { id?: string; name?: string };
}

interface MbRecording {
  id: string;
  title: string;
  score?: number;
  "artist-credit"?: MbArtistCredit[];
}

interface MbSearchResponse {
  recordings?: MbRecording[];
}

/**
 * Given a recording MBID, fetch the first release that contains it
 * along with its label credits. Returns the first label name found
 * across the release's `label-info` array. Used as a 3rd-tier label
 * fallback AFTER Apple Music's `recordLabel` and Discogs' release
 * search both miss — we already have the recordingMbid from the
 * primary recording search, so this is one extra MB request.
 *
 * Returns null (not throws) when no release / no labels are attached.
 * Throws MusicBrainzError on upstream issues so the caller can choose
 * whether to swallow (current orchestrator policy).
 */
export async function lookupLabelByRecording(input: {
  readonly recordingMbid: string;
  readonly throttle: Throttle;
  readonly signal?: AbortSignal;
  readonly fetch?: FetchLike;
}): Promise<string | null> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const url = `${API_BASE}/release?recording=${encodeURIComponent(input.recordingMbid)}&inc=labels&limit=5&fmt=json`;

  await input.throttle.acquire(input.signal);
  const res = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    signal: input.signal,
  });
  if (!res.ok) throw classifyError(res.status, await safeText(res));

  const json = (await res.json()) as {
    releases?: Array<{
      "label-info"?: Array<{ label?: { name?: string } }>;
    }>;
  };
  for (const release of json.releases ?? []) {
    for (const li of release["label-info"] ?? []) {
      const name = li.label?.name?.trim();
      if (name && name.length > 0) return name;
    }
  }
  return null;
}

/**
 * MusicBrainz cover art is hosted at coverartarchive.org, keyed by release
 * MBID. This helper walks `/release?recording=...` (same call shape as
 * `lookupLabelByRecording`), then HEAD-probes
 * `https://coverartarchive.org/release/{mbid}/front-500` for each release
 * until one returns 200. Returns the probed URL (browsers follow the CAA
 * redirect transparently when rendering) or `null` if no release in the
 * list has front cover art.
 *
 * Motivation: when Apple Music misses a track but MusicBrainz hits,
 * `resolveMbOnly` previously upserted only the artist row — the play
 * showed up in widgets with no album art (station-default fallback). For
 * the ~6% of plays on Rhythm Lab that land this way, CAA usually has
 * real art we can surface instead.
 *
 * Never throws — all upstream failures coalesce to `null` so the
 * enrichment pipeline treats "no cover art" uniformly regardless of
 * whether it was a 404, 503, or network hiccup.
 */
export async function lookupCoverArtUrlByRecording(input: {
  readonly recordingMbid: string;
  readonly throttle: Throttle;
  readonly signal?: AbortSignal;
  readonly fetch?: FetchLike;
}): Promise<string | null> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const url = `${API_BASE}/release?recording=${encodeURIComponent(input.recordingMbid)}&inc=labels&limit=5&fmt=json`;

  await input.throttle.acquire(input.signal);
  let releaseIds: string[];
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: input.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { releases?: Array<{ id?: string }> };
    releaseIds = (json.releases ?? [])
      .map((r) => r.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return null;
  }

  // CAA is a separate origin and has its own (more lenient) rate limit; the
  // MB throttle covers the /release query above.
  for (const releaseMbid of releaseIds) {
    const coverUrl = `https://coverartarchive.org/release/${encodeURIComponent(releaseMbid)}/front-500`;
    try {
      const probe = await fetchImpl(coverUrl, {
        method: "HEAD",
        redirect: "follow",
        signal: input.signal,
      });
      if (probe.ok) return coverUrl;
    } catch {
      // Network error on this release — try the next one.
    }
  }
  return null;
}

export async function searchRecording(input: SearchRecordingInput): Promise<NormalizedRecording[]> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const query = luceneQuery(normalizeArtistForMb(input.artist), normalizeTitleForMb(input.title));
  const url = `${API_BASE}/recording?fmt=json&limit=5&query=${encodeURIComponent(query)}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await input.throttle.acquire(input.signal);
    const res = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      signal: input.signal,
    });

    if (res.status === 503 && attempt === 0) {
      const retryAfter = Number.parseInt(res.headers.get("Retry-After") ?? "1", 10);
      await sleep(Math.max(1, retryAfter) * 1000, input.signal);
      continue;
    }

    if (!res.ok) throw classifyError(res.status, await safeText(res));

    const json = (await res.json()) as MbSearchResponse;
    return (json.recordings ?? []).map(normalize).filter(isPresent);
  }

  throw new MusicBrainzError("upstream_5xx", 503, "musicbrainz 503 after retry");
}

function luceneQuery(artist: string, title: string): string {
  return `recording:"${escapeLucene(title)}" AND artist:"${escapeLucene(artist)}"`;
}

function escapeLucene(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * Strip feature credits and annotations from artistRaw before querying MB.
 * Input like `"4hero, Carina Andersson"` or `"Buddy feat. A$AP Ferg"` or
 * `"Artist A & Artist B"` becomes the primary artist (`4hero` / `Buddy` /
 * `Artist A`) — matches how MusicBrainz stores the authoritative artist
 * credit.
 */
export function normalizeArtistForMb(artist: string): string {
  const first = artist.split(/\s+feat\.?\s+|\s+featuring\s+|\s+with\s+|[,&]/i)[0]?.trim();
  return first && first.length > 0 ? first : artist;
}

/**
 * Strip title annotations that break MB exact-match: `(feat. X)`,
 * `(Radio Edit)`, `(Live)`, `(Remix)`, `(Remastered)`, and any trailing
 * parenthetical subtitle. Keeps trailing `!`/`.` punctuation intact since
 * MB honors those.
 */
export function normalizeTitleForMb(title: string): string {
  const stripped = title
    .replace(/\s*\(feat\.?[^)]*\)/gi, "")
    .replace(/\s*\(featuring[^)]*\)/gi, "")
    .replace(/\s*\(radio edit\)/gi, "")
    .replace(/\s*\(live\)/gi, "")
    .replace(/\s*\(remaster(?:ed)?\)/gi, "")
    .replace(/\s*\([^)]*\bmix\)/gi, "")
    .replace(/\s*\([^)]*\bremix\)/gi, "")
    .replace(/\s*\([^)]*\bversion\)/gi, "")
    .replace(/\s*\([^)]*\bedit\)/gi, "")
    .replace(/\s*\([^)]+\)\s*$/g, "")
    .trim();
  return stripped.length > 0 ? stripped : title;
}

function normalize(rec: MbRecording): NormalizedRecording | null {
  const credit = rec["artist-credit"]?.[0];
  const artistName = credit?.artist?.name ?? credit?.name;
  const artistMbid = credit?.artist?.id;
  if (!rec.id || !artistName || !artistMbid) return null;
  return {
    recordingMbid: rec.id,
    title: rec.title,
    artistMbid,
    artistName,
    score: typeof rec.score === "number" ? rec.score : 0,
  };
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function classifyError(status: number, body: string): MusicBrainzError {
  if (status === 429 || status === 503) {
    return new MusicBrainzError("rate_limited", status, `musicbrainz ${status}: ${body}`);
  }
  if (status >= 500) {
    return new MusicBrainzError("upstream_5xx", status, `musicbrainz ${status}: ${body}`);
  }
  return new MusicBrainzError("other", status, `musicbrainz ${status}: ${body}`);
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "<body unavailable>";
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
