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

export type BuildResult =
  | { ok: true; song: CadenceSong; durationEstimated: boolean }
  | { ok: false; reason: string };

const MS_PER_SEC = 1000;

/**
 * Cadence refuses a song without a duration. SGmetadata feeds carry none,
 * so an unmatched local song gets a nominal length rather than being
 * dropped from the live feed; the event flags it as estimated.
 */
const FALLBACK_DURATION_SEC = 180;

/** Apple Music artwork URLs are templates; Cadence needs a concrete size. */
const ARTWORK_PX = "600";

/**
 * `timeZone` is the Cadence channel's zone. Cadence's add-now compares the
 * song start against the episode window as wall-clock time and rejected a
 * UTC `Z` timestamp ("current time is outside episode bounds"), so `start`
 * is rendered as channel-local time with an explicit offset.
 */
export function buildCadenceSong(input: CadencePlayInput, timeZone: string): BuildResult {
  const knownSec = input.track?.durationSec ?? input.durationSec ?? 0;
  const durationEstimated = knownSec <= 0;
  const durationSec = durationEstimated ? FALLBACK_DURATION_SEC : knownSec;
  const start = new Date(input.playedAt);
  if (Number.isNaN(start.getTime())) return { ok: false, reason: "invalid playedAt" };

  const song: CadenceSong = {
    title: input.track?.displayTitle ?? input.titleRaw,
    artist: [input.artist?.displayName ?? input.artistRaw],
    start: localIso(input.playedAt, timeZone),
    duration: Math.round(durationSec * MS_PER_SEC),
  };
  return { ok: true, song: withOptional(song, input.track), durationEstimated };
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

interface LocalParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

function localParts(ms: number, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPart["type"]): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** `yyyy-MM-dd` for the instant in the given IANA time zone. */
export function localDateKey(ms: number, timeZone: string): string {
  const p = localParts(ms, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

const MS_PER_MINUTE = 60_000;

/** ISO-8601 wall-clock time with numeric offset, e.g. `2026-09-22T18:16:04-05:00`. */
export function localIso(ms: number, timeZone: string): string {
  const p = localParts(ms, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offsetMin = Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MS_PER_MINUTE);
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${hh}:${mm}`;
}
