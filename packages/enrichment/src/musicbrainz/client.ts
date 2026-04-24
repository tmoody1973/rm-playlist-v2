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

export async function searchRecording(
  input: SearchRecordingInput,
): Promise<NormalizedRecording[]> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const query = luceneQuery(
    normalizeArtistForMb(input.artist),
    normalizeTitleForMb(input.title),
  );
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
  const first = artist
    .split(/\s+feat\.?\s+|\s+featuring\s+|\s+with\s+|[,&]/i)[0]
    ?.trim();
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
