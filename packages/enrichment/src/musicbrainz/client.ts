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

export async function searchRecording(
  input: SearchRecordingInput,
): Promise<NormalizedRecording[]> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const query = luceneQuery(input.artist, input.title);
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
