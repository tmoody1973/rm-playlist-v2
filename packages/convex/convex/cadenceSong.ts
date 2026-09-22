/**
 * Pure mapping from a resolved play to NPR Cadence's `Song` shape, plus
 * the helpers the push action needs to find the right episode. No Convex
 * imports so it stays unit-testable with `bun test`.
 *
 * Cadence reference: PUT /api/cadence/episode/{episodeId}/add-now wants
 * `start` (ISO-8601, offset optional) and `duration` (milliseconds per
 * SongDto), and refuses an `end` field.
 */

export interface CadencePlayInput {
  artistRaw: string;
  titleRaw: string;
  /** Unix ms when the play started. */
  playedAt: number;
  /** Source-reported duration, used only when no track was matched. */
  durationSec: number | undefined;
  artist?: { displayName: string };
  track?: {
    displayTitle: string;
    albumDisplayName?: string;
    recordLabel?: string;
    durationSec?: number;
    artworkUrl?: string;
  };
}

export interface CadenceSong {
  title: string;
  artist: string[];
  start: string;
  duration: number;
  album?: string;
  label?: string;
  artworkUrl?: string;
}

export type BuildResult = { ok: true; song: CadenceSong } | { ok: false; reason: string };

const MS_PER_SEC = 1000;

/** Apple Music artwork URLs are templates; Cadence needs a concrete size. */
const ARTWORK_PX = "600";

export function buildCadenceSong(input: CadencePlayInput): BuildResult {
  const durationSec = input.track?.durationSec ?? input.durationSec ?? 0;
  if (durationSec <= 0) return { ok: false, reason: "no duration" };
  const start = new Date(input.playedAt);
  if (Number.isNaN(start.getTime())) return { ok: false, reason: "invalid playedAt" };

  const song: CadenceSong = {
    title: input.track?.displayTitle ?? input.titleRaw,
    artist: [input.artist?.displayName ?? input.artistRaw],
    start: start.toISOString(),
    duration: Math.round(durationSec * MS_PER_SEC),
  };
  return { ok: true, song: withOptional(song, input.track) };
}

function withOptional(song: CadenceSong, track: CadencePlayInput["track"]): CadenceSong {
  const extras: Partial<CadenceSong> = {};
  if (nonEmpty(track?.albumDisplayName)) extras.album = track.albumDisplayName;
  if (nonEmpty(track?.recordLabel)) extras.label = track.recordLabel;
  if (nonEmpty(track?.artworkUrl)) extras.artworkUrl = materializeArtwork(track.artworkUrl);
  return { ...song, ...extras };
}

function materializeArtwork(url: string): string {
  return url.replace(/\{w\}|%7Bw%7D/g, ARTWORK_PX).replace(/\{h\}|%7Bh%7D/g, ARTWORK_PX);
}

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

export interface CadenceEpisode {
  episodeId: string;
  programName?: string;
  startUtc: string;
  endUtc: string;
}

/** Episode whose [start, end) window contains the play, or null. */
export function pickEpisode(
  episodes: readonly CadenceEpisode[],
  playedAt: number,
): CadenceEpisode | null {
  return (
    episodes.find((e) => Date.parse(e.startUtc) <= playedAt && playedAt < Date.parse(e.endUtc)) ??
    null
  );
}

/** `yyyy-MM-dd` for the instant in the given IANA time zone. */
export function localDateKey(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPart["type"]): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
