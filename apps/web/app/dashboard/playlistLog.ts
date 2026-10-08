/**
 * NPR music-rights playlist log, rendered client-side from
 * `reports.soundExchangePlaylist` rows. NPR's rules: tab-delimited UTF-8;
 * headers Title, Artist, Album, Label, Start Time and End Time and/or
 * Duration ("make sure the math checks out"), a length on every record;
 * one row per play, chronological; times `MM/dd/yyyy HH:mm:ss`, 24-hour,
 * station-local, no offset; Duration `m:ss` with hours folded into minutes.
 */

export interface PlaylistRow {
  playedAt: number;
  channelName: string;
  featuredArtist: string;
  soundRecordingTitle: string;
  albumTitle: string;
  marketingLabel: string;
  isrc: string;
  durationSec: number | null;
}

export const MILWAUKEE_TIMEZONE = "America/Chicago";

const HEADER = ["Start Time", "End Time", "Duration", "Title", "Artist", "Album", "Label"];
const MS_PER_SEC = 1000;
const SEC_PER_MIN = 60;

const PLAYLIST_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: MILWAUKEE_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** `MM/dd/yyyy HH:mm:ss` in Milwaukee local time, the zone NPR assumes when no offset is given. */
export function formatPlaylistTimestamp(epochMs: number): string {
  const parts = PLAYLIST_DATE_FMT.formatToParts(new Date(epochMs));
  const get = (type: Intl.DateTimeFormatPart["type"]): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour");
  // Intl can emit "24" for midnight under hour12:false on some engines.
  const normalizedHour = hour === "24" ? "00" : hour;
  return `${get("month")}/${get("day")}/${get("year")} ${normalizedHour}:${get("minute")}:${get("second")}`;
}

/** `m:ss`; NPR omits leading zero hours, so an hour-plus length stays in minutes (62:03). */
export function formatDuration(totalSec: number): string {
  const minutes = Math.floor(totalSec / SEC_PER_MIN);
  const seconds = totalSec % SEC_PER_MIN;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Render rows as NPR's tab-delimited playlist log. Lengths are rounded to
 * whole seconds and both times are taken from the whole-second start, so
 * End Time − Start Time always equals Duration. No row runs past the
 * next row's start. A row with no length (should be none once durations
 * are filled) leaves both blank.
 */
export function toPlaylistTxt(rows: readonly PlaylistRow[]): string {
  const body = rows.map((row, i) =>
    [...timeColumns(row, rows[i + 1]?.playedAt), ...textColumns(row)].join("\t"),
  );
  return [HEADER.join("\t"), ...body].join("\n");
}

function timeColumns(row: PlaylistRow, nextPlayedAt: number | undefined): [string, string, string] {
  const startMs = wholeSecondMs(row.playedAt);
  const start = formatPlaylistTimestamp(startMs);
  const lengthSec = onAirLengthSec(row, startMs, nextPlayedAt);
  if (lengthSec <= 0) return [start, "", ""];
  const end = formatPlaylistTimestamp(startMs + lengthSec * MS_PER_SEC);
  return [start, end, formatDuration(lengthSec)];
}

/**
 * The row's length, cut at the next row's start. A catalog length can
 * belong to a longer version than the one aired (album cut, live take) and
 * ignores crossfades, so on its own it would overlap the next song. A next
 * play in the same second leaves 1 s, since NPR wants a length on every row.
 */
function onAirLengthSec(
  row: PlaylistRow,
  startMs: number,
  nextPlayedAt: number | undefined,
): number {
  const lengthSec = row.durationSec === null ? 0 : Math.round(row.durationSec);
  if (lengthSec <= 0 || nextPlayedAt === undefined || nextPlayedAt < row.playedAt) {
    return lengthSec;
  }
  const untilNextSec = (wholeSecondMs(nextPlayedAt) - startMs) / MS_PER_SEC;
  return Math.min(lengthSec, Math.max(untilNextSec, 1));
}

function wholeSecondMs(epochMs: number): number {
  return Math.floor(epochMs / MS_PER_SEC) * MS_PER_SEC;
}

function textColumns(row: PlaylistRow): string[] {
  return [row.soundRecordingTitle, row.featuredArtist, row.albumTitle, row.marketingLabel].map(
    tsvEscape,
  );
}

/**
 * Tab, CR, and LF are the only characters that can break TSV row / field
 * boundaries. Collapse each run to a single space.
 */
function tsvEscape(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ");
}

interface CursorPage {
  isDone: boolean;
  continueCursor: string | null;
}

/**
 * Fetch every page of a cursor-paginated Convex query, in order. Report
 * queries are paged because a month of a busy station is too much work
 * for one execution.
 */
export async function collectPages<Page extends CursorPage>(
  fetchPage: (cursor: string | null) => Promise<Page>,
  onPage?: (page: Page) => void,
): Promise<Page[]> {
  const pages: Page[] = [];
  let cursor: string | null = null;
  do {
    const page: Page = await fetchPage(cursor);
    pages.push(page);
    onPage?.(page);
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor !== null);
  return pages;
}

/**
 * Share (0–1) of the date range a paged report read has covered, from the
 * page's `scannedThroughMs`. Plays are spread across the day on every
 * station, so time read tracks work done. Null when the server sent no
 * position (a deploy that predates it); show an open-ended bar then.
 */
export function rangeProgress(
  page: { scannedThroughMs?: number; isDone: boolean },
  range: { startMs: number; endMs: number },
): number | null {
  if (page.isDone) return 1;
  if (typeof page.scannedThroughMs !== "number") return null;
  const share = (page.scannedThroughMs - range.startMs) / (range.endMs - range.startMs);
  return Math.min(1, Math.max(0, share));
}
