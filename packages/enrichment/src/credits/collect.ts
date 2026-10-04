import type { DiscogsAuth } from "../discogs/client";
import { fetchRelease, searchRelease } from "../discogs/client";
import { fetchGeniusSong, searchGeniusSong } from "../genius/client";
import {
  fetchRecordingRelations,
  lookupRecordingByIsrc,
  searchRecording,
} from "../musicbrainz/client";
import type { Throttle } from "../throttle";
import type { FetchLike } from "../types";
import { deriveCueTags, deriveMatchConfidence, mergeFacts } from "./merge";
import { parseDiscogsRelease } from "./parseDiscogs";
import { parseGeniusSong } from "./parseGenius";
import { parseMusicBrainzRelations } from "./parseMusicBrainz";
import type { CreditFact, RecordingVia, TrackCreditsResult, TrackForCredits } from "./types";

const MIN_SEARCH_SCORE = 90;

export interface CollectDeps {
  readonly mbThrottle: Throttle;
  readonly discogsThrottle: Throttle;
  readonly geniusThrottle: Throttle;
  readonly discogsAuth: DiscogsAuth;
  readonly geniusToken?: string;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
  /** Bounds the whole track (every source); an abort is a transient failure. */
  readonly signal?: AbortSignal;
}

interface SourceOutcome {
  facts: CreditFact[];
  styles?: string[];
  year?: number;
  recordingMbid?: string;
  via?: RecordingVia;
}

/** Our parser choked on the payload: retrying won't help, so it's a recorded problem, not a retry. */
class ParseError extends Error {}

function parsing<T>(parse: () => T): T {
  try {
    return parse();
  } catch (err) {
    throw new ParseError(err instanceof Error ? err.message : String(err));
  }
}

async function resolveRecording(
  track: TrackForCredits,
  deps: CollectDeps,
): Promise<{ mbid: string; via: RecordingVia } | null> {
  if (track.recordingMbid) return { mbid: track.recordingMbid, via: "stored" };
  const common = { throttle: deps.mbThrottle, fetch: deps.fetch, signal: deps.signal };
  if (track.isrc) {
    const mbid = await lookupRecordingByIsrc({ ...common, isrc: track.isrc, title: track.title });
    if (mbid) return { mbid, via: "isrc" };
  }
  const best = (await searchRecording({ ...common, artist: track.artist, title: track.title }))[0];
  return best && best.score >= MIN_SEARCH_SCORE
    ? { mbid: best.recordingMbid, via: "search" }
    : null;
}

async function fromMusicBrainz(
  track: TrackForCredits,
  deps: CollectDeps,
  fetchedAt: number,
): Promise<SourceOutcome> {
  const recording = await resolveRecording(track, deps);
  if (recording === null) return { facts: [] };
  const json = await fetchRecordingRelations({
    recordingMbid: recording.mbid,
    throttle: deps.mbThrottle,
    fetch: deps.fetch,
    signal: deps.signal,
  });
  const parsed = json ? parsing(() => parseMusicBrainzRelations(json, fetchedAt)) : { facts: [] };
  return { ...parsed, year: parsed.releaseYear, recordingMbid: recording.mbid, via: recording.via };
}

async function fromDiscogs(
  track: TrackForCredits,
  deps: CollectDeps,
  fetchedAt: number,
): Promise<SourceOutcome> {
  if (!track.album) return { facts: [] };
  const common = {
    ...deps.discogsAuth,
    throttle: deps.discogsThrottle,
    fetch: deps.fetch,
    signal: deps.signal,
  };
  const hit = (await searchRelease({ ...common, artist: track.artist, album: track.album }))[0];
  const json = hit ? await fetchRelease({ ...common, releaseId: hit.discogsReleaseId }) : null;
  return json ? parsing(() => parseDiscogsRelease(json, track.title, fetchedAt)) : { facts: [] };
}

async function fromGenius(
  track: TrackForCredits,
  deps: CollectDeps,
  fetchedAt: number,
): Promise<SourceOutcome> {
  if (!deps.geniusToken) return { facts: [] };
  const common = {
    token: deps.geniusToken,
    throttle: deps.geniusThrottle,
    fetch: deps.fetch,
    signal: deps.signal,
  };
  const songId = await searchGeniusSong({ ...common, artist: track.artist, title: track.title });
  const song = songId === null ? null : await fetchGeniusSong({ ...common, songId });
  return { facts: song ? parsing(() => parseGeniusSong(song, fetchedAt)) : [] };
}

type Settled = { outcome: SourceOutcome } | { transient: true } | { problem: string };

/**
 * Every source failure except our own parser is transient: auth (401/403), rate limits,
 * 5xx, network errors and timeouts all keep old facts and retry later.
 */
async function settle(name: string, run: () => Promise<SourceOutcome>): Promise<Settled> {
  try {
    return { outcome: await run() };
  } catch (err) {
    if (err instanceof ParseError) return { problem: `${name}: ${err.message}` };
    return { transient: true };
  }
}

function assemble(track: TrackForCredits, settled: Settled[]): TrackCreditsResult {
  const outcomes = settled.flatMap((s) => ("outcome" in s ? [s.outcome] : []));
  const problems = settled.flatMap((s) => ("problem" in s ? [s.problem] : []));
  const mb = outcomes.find((o) => o.recordingMbid !== undefined);
  const facts = mergeFacts(outcomes.flatMap((o) => o.facts));
  const releaseYear = mb?.year ?? outcomes.find((o) => o.year !== undefined)?.year;
  const styles = outcomes.flatMap((o) => o.styles ?? []);
  const transient = settled.some((s) => "transient" in s);
  return {
    creditsStatus: transient ? "error" : facts.length > 0 ? "found" : "none",
    facts,
    cueTags: deriveCueTags({ facts, releaseYear, styles }),
    recordingMbid: mb?.recordingMbid,
    releaseYear,
    matchConfidence: deriveMatchConfidence(mb?.via ?? null, track.hasAppleMatch),
    problems,
  };
}

/** Slow path only: three rate-limited sources in parallel lanes (each source has its own throttle). */
export async function collectTrackCredits(
  track: TrackForCredits,
  deps: CollectDeps,
): Promise<TrackCreditsResult> {
  const fetchedAt = (deps.now ?? Date.now)();
  const settled = await Promise.all([
    settle("musicbrainz", () => fromMusicBrainz(track, deps, fetchedAt)),
    settle("discogs", () => fromDiscogs(track, deps, fetchedAt)),
    settle("genius", () => fromGenius(track, deps, fetchedAt)),
  ]);
  return assemble(track, settled);
}
