import type { Throttle } from "../throttle";
import type {
  FetchLike,
  MusicBrainzMissReason,
  MusicBrainzResult,
  PlayIdentity,
} from "../types";
import { type MusicBrainzErrorCode, MusicBrainzError, searchRecording } from "./client";

export interface LookupMusicBrainzDeps {
  readonly throttle: Throttle;
  /** Score threshold for `matched: true`. Defaults to 90 per brainstorm. */
  readonly minScore?: number;
  readonly signal?: AbortSignal;
  readonly fetch?: FetchLike;
}

const DEFAULT_MIN_SCORE = 90;

export async function lookupMusicBrainz(
  play: PlayIdentity,
  deps: LookupMusicBrainzDeps,
): Promise<MusicBrainzResult> {
  try {
    const results = await searchRecording({
      artist: play.artist,
      title: play.title,
      throttle: deps.throttle,
      signal: deps.signal,
      fetch: deps.fetch,
    });
    if (results.length === 0) {
      return { matched: false, reason: "no_results" };
    }
    const best = results[0];
    if (!best) return { matched: false, reason: "no_results" };

    const minScore = deps.minScore ?? DEFAULT_MIN_SCORE;
    if (best.score < minScore) {
      return { matched: false, reason: "below_threshold" };
    }
    return {
      matched: true,
      recordingMbid: best.recordingMbid,
      title: best.title,
      artistMbid: best.artistMbid,
      artistName: best.artistName,
      score: best.score,
    };
  } catch (err) {
    if (err instanceof MusicBrainzError) {
      return { matched: false, reason: mapErrorToReason(err.code) };
    }
    return { matched: false, reason: "other" };
  }
}

function mapErrorToReason(code: MusicBrainzErrorCode): MusicBrainzMissReason {
  switch (code) {
    case "rate_limited":
      return "rate_limited";
    case "upstream_5xx":
      return "upstream_5xx";
    default:
      return "other";
  }
}

export { MusicBrainzError, lookupLabelByRecording, searchRecording } from "./client";
export type { NormalizedRecording, SearchRecordingInput } from "./client";
