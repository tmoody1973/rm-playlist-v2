"use client";

import { useMemo, useState } from "react";
import { useQuery, useConvex } from "convex/react";
import { api } from "@rm/convex/api";

type StationSlug = "hyfin" | "88nine" | "414music" | "rhythmlab";

const STATIONS: ReadonlyArray<{ slug: StationSlug; label: string }> = [
  { slug: "88nine", label: "88Nine" },
  { slug: "hyfin", label: "HYFIN" },
  { slug: "rhythmlab", label: "Rhythm Lab" },
  { slug: "414music", label: "414 Music" },
];

/**
 * Row 2 left — NPR music-rights playlist log export.
 *
 * Operators pick a station + date range, preview resolved-play count
 * (with per-column completeness), and download a tab-delimited TXT
 * file that matches NPR's SoundExchange playlist log format:
 *   Start Time <tab> End Time <tab> Title <tab> Artist <tab> Album <tab> Label
 * Times are rendered in Milwaukee local time (America/Chicago) as
 * `MM/dd/yyyy HH:mm:ss`. End Time = Start Time + durationSec when
 * duration is known; blank when it isn't (those rows must be filled
 * via Needs Attention before submission).
 *
 * Default range: previous calendar month — music-rights reporting is
 * monthly, and we'd rather default to a completed period than a partial
 * in-progress one.
 */
export function ReportsPanel() {
  const { start: defaultStart, end: defaultEnd } = usePreviousMonthRange();
  const [station, setStation] = useState<StationSlug>("88nine");
  const [startDate, setStartDate] = useState<string>(defaultStart);
  const [endDate, setEndDate] = useState<string>(defaultEnd);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const convex = useConvex();
  const range = useMemo(() => toEpochRange(startDate, endDate), [startDate, endDate]);

  const summary = useQuery(
    api.reports.soundExchangePlaylistSummary,
    range === null ? "skip" : { stationSlug: station, startMs: range.startMs, endMs: range.endMs },
  );

  const rangeValid = range !== null;
  const hasData = summary !== undefined && summary.resolvedPlays > 0;

  const onDownload = async () => {
    if (range === null) return;
    setDownloading(true);
    setError(null);
    try {
      const result = await convex.query(api.reports.soundExchangePlaylist, {
        stationSlug: station,
        startMs: range.startMs,
        endMs: range.endMs,
      });
      if (result.rows.length === 0) {
        setError("No resolved plays in that range.");
        return;
      }
      const txt = toPlaylistTxt(result.rows);
      const filename = `playlist-log-${station}-${startDate}-to-${endDate}.txt`;
      downloadTxt(txt, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section
      role="region"
      aria-label="Reports"
      className="flex flex-col gap-3 rounded-md border border-border bg-bg-surface p-5"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">Playlist log (NPR / SoundExchange)</h3>
        <span className="text-xs text-text-muted" style={{ fontFamily: "var(--font-mono)" }}>
          TXT
        </span>
      </header>

      <div className="flex flex-col gap-2 text-xs">
        <label className="flex items-center gap-2 text-text-muted">
          <span className="w-16 uppercase tracking-wide text-[10px]">Station</span>
          <select
            value={station}
            onChange={(e) => setStation(e.target.value as StationSlug)}
            className="flex-1 rounded-sm border border-border bg-bg-elevated px-2 py-1 text-text-primary focus:border-text-primary focus:outline-none"
          >
            {STATIONS.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <label className="flex flex-1 items-center gap-2 text-text-muted">
            <span className="w-16 uppercase tracking-wide text-[10px]">From</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="flex-1 rounded-sm border border-border bg-bg-elevated px-2 py-1 text-text-primary focus:border-text-primary focus:outline-none"
            />
          </label>
          <label className="flex flex-1 items-center gap-2 text-text-muted">
            <span className="uppercase tracking-wide text-[10px]">To</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="flex-1 rounded-sm border border-border bg-bg-elevated px-2 py-1 text-text-primary focus:border-text-primary focus:outline-none"
            />
          </label>
        </div>
      </div>

      <SummaryLine summary={summary} rangeValid={rangeValid} />

      {error !== null && (
        <p className="rounded-sm border border-status-error/50 bg-status-error/10 px-2 py-1 text-xs text-status-error">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={onDownload}
        disabled={downloading || !rangeValid || !hasData}
        className="rounded-md border border-border bg-bg-elevated px-4 py-2 text-left text-sm text-text-primary transition-colors hover:border-text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {downloading ? "Preparing playlist log…" : "Download playlist log"}
      </button>

      <p className="text-[10px] text-text-muted">
        Tab-delimited UTF-8 TXT, Milwaukee local time. Resolved plays only — pending, unresolved,
        and ignored rows are excluded. Triage those from Needs Attention before exporting.
      </p>
    </section>
  );
}

function SummaryLine({
  summary,
  rangeValid,
}: {
  summary:
    | {
        resolvedPlays: number;
        missingLabel: number;
        missingIsrc: number;
        missingDuration: number;
      }
    | undefined;
  rangeValid: boolean;
}) {
  if (!rangeValid) {
    return (
      <p className="text-[10px] text-status-warn" style={{ fontFamily: "var(--font-mono)" }}>
        End date must be after start date.
      </p>
    );
  }
  if (summary === undefined) {
    return <div className="h-4 w-full animate-pulse rounded-sm bg-bg-elevated/60" />;
  }
  if (summary.resolvedPlays === 0) {
    return (
      <p className="text-[10px] text-text-muted" style={{ fontFamily: "var(--font-mono)" }}>
        No resolved plays in that range.
      </p>
    );
  }
  return (
    <p
      className="flex gap-3 text-[10px] text-text-muted"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      <span className="text-text-secondary">{summary.resolvedPlays} plays</span>
      <span title="rows missing recordLabel — still valid for SoundExchange but flagged for completeness">
        missing label: {summary.missingLabel}
      </span>
      <span title="rows missing ISRC — optional for SOR">
        missing ISRC: {summary.missingIsrc}
      </span>
      <span title="rows missing duration">missing duration: {summary.missingDuration}</span>
    </p>
  );
}

// ---------- helpers ----------

/**
 * Compute the previous calendar month in UTC as YYYY-MM-DD strings.
 * Default range for the date pickers — SoundExchange reports monthly
 * against a completed period, so "last full month" is the right default.
 */
function usePreviousMonthRange() {
  return useMemo(() => {
    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    // endDate input is inclusive; the query's endMs is exclusive, so display
    // the last day of the prior month to the operator.
    const endDisplay = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    return { start: toIsoDate(start), end: toIsoDate(endDisplay) };
  }, []);
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Parse the YYYY-MM-DD date inputs into an epoch range (startMs inclusive,
 * endMs exclusive) in UTC. Returns null if either parse fails or the range
 * is empty/reversed.
 */
function toEpochRange(startDate: string, endDate: string): { startMs: number; endMs: number } | null {
  const startMs = Date.parse(`${startDate}T00:00:00.000Z`);
  const endDayMs = Date.parse(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(startMs) || Number.isNaN(endDayMs)) return null;
  const endMs = endDayMs + 24 * 60 * 60 * 1000;
  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

interface PlaylistRow {
  playedAt: number;
  channelName: string;
  featuredArtist: string;
  soundRecordingTitle: string;
  albumTitle: string;
  marketingLabel: string;
  isrc: string;
  durationSec: number | null;
}

const MILWAUKEE_TIMEZONE = "America/Chicago";

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

/**
 * Format an epoch-ms timestamp as `MM/dd/yyyy HH:mm:ss` in Milwaukee
 * local time. NPR's playlist log spec accepts this format by default
 * (it's one of the three listed formats, and they assume local time
 * unless an offset is appended).
 */
function formatPlaylistTimestamp(epochMs: number): string {
  const parts = PLAYLIST_DATE_FMT.formatToParts(new Date(epochMs));
  const get = (type: Intl.DateTimeFormatPart["type"]): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour");
  // Intl can emit "24" for midnight under hour12:false on some engines.
  const normalizedHour = hour === "24" ? "00" : hour;
  return `${get("month")}/${get("day")}/${get("year")} ${normalizedHour}:${get("minute")}:${get("second")}`;
}

/**
 * Render rows to NPR's tab-delimited playlist-log format. Columns:
 * Start Time, End Time, Title, Artist, Album, Label. One row per play,
 * chronological (query already sorts). End Time is blank when the
 * track's durationSec is unknown — that row needs the Duration filled
 * in Needs Attention before NPR will accept it.
 *
 * Tabs, CR, and LF are stripped from every field so they can't break
 * the row boundaries NPR parses on.
 */
function toPlaylistTxt(rows: readonly PlaylistRow[]): string {
  const header = ["Start Time", "End Time", "Title", "Artist", "Album", "Label"].join("\t");
  const body = rows.map((r) => {
    const startTime = formatPlaylistTimestamp(r.playedAt);
    const endTime =
      r.durationSec !== null && r.durationSec > 0
        ? formatPlaylistTimestamp(r.playedAt + r.durationSec * 1000)
        : "";
    return [
      startTime,
      endTime,
      tsvEscape(r.soundRecordingTitle),
      tsvEscape(r.featuredArtist),
      tsvEscape(r.albumTitle),
      tsvEscape(r.marketingLabel),
    ].join("\t");
  });
  return [header, ...body].join("\n");
}

/**
 * Tab, CR, and LF are the only characters that can break TSV row / field
 * boundaries. Collapse each to a single space so the file stays
 * parseable even if a track title contains them (rare but possible).
 */
function tsvEscape(value: string): string {
  if (value.length === 0) return "";
  return value.replace(/[\t\r\n]+/g, " ");
}

function downloadTxt(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
