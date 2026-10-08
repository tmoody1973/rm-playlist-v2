"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@rm/convex/api";
import { MILWAUKEE_TIMEZONE, collectPages, toPlaylistTxt } from "./playlistLog";

type SummaryPage = FunctionReturnType<typeof api.reports.soundExchangePlaylistSummary>;

type StationSlug = "hyfin" | "88nine" | "414music" | "rhythmlab";

interface SummaryTotals {
  resolvedPlays: number;
  missingLabel: number;
  missingIsrc: number;
  missingDuration: number;
  estimatedDuration: number;
}

const EMPTY_TOTALS: SummaryTotals = {
  resolvedPlays: 0,
  missingLabel: 0,
  missingIsrc: 0,
  missingDuration: 0,
  estimatedDuration: 0,
};

function sumSummaryPages(pages: readonly SummaryPage[]): SummaryTotals {
  return pages.reduce<SummaryTotals>(
    (sum, page) => ({
      resolvedPlays: sum.resolvedPlays + page.resolvedPlays,
      missingLabel: sum.missingLabel + page.missingLabel,
      missingIsrc: sum.missingIsrc + page.missingIsrc,
      missingDuration: sum.missingDuration + page.missingDuration,
      estimatedDuration: sum.estimatedDuration + page.estimatedDuration,
    }),
    EMPTY_TOTALS,
  );
}

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
 *   Start Time, End Time, Duration, Title, Artist, Album, Label
 * (see playlistLog.ts for NPR's rules). Plays the feed gave no length get
 * an observed or estimated one at ingestion (playDuration.ts); estimated
 * rows are counted here and listed in Needs Attention for correction.
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
  const fillDurations = useAction(api.backfills.fillMissingDurationsFromApple);
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const range = useMemo(() => toEpochRange(startDate, endDate), [startDate, endDate]);

  // Imperative paginated fetch instead of a reactive useQuery: a busy
  // station over a month exceeds Convex's per-execution read limits in
  // one shot, and a throwing useQuery crashed the whole panel. The
  // preview no longer live-updates as plays enrich — fine for a report
  // preview; re-pick the range to refresh. undefined = loading,
  // null = failed (message lands in the shared error block).
  const [summary, setSummary] = useState<SummaryTotals | undefined | null>(undefined);

  useEffect(() => {
    if (range === null) {
      setSummary(undefined);
      return;
    }
    let cancelled = false;
    setSummary(undefined);
    setError(null);
    (async () => {
      try {
        const pages = await collectPages((cursor) =>
          convex.query(api.reports.soundExchangePlaylistSummary, {
            stationSlug: station,
            startMs: range.startMs,
            endMs: range.endMs,
            cursor,
          }),
        );
        if (cancelled) return;
        setSummary(sumSummaryPages(pages));
      } catch (err) {
        if (cancelled) return;
        setSummary(null);
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [convex, station, range]);

  const rangeValid = range !== null;
  const hasData = summary !== undefined && summary !== null && summary.resolvedPlays > 0;
  const missingDurationCount = summary?.missingDuration ?? 0;

  const onBackfillDurations = async () => {
    setBackfilling(true);
    setBackfillStatus(null);
    setError(null);
    try {
      const result = await fillDurations({ limit: 100 });
      if (result.tokenMissing === true) {
        setError(
          "Apple Music token not cached — trigger the refresh-apple-music-token task first.",
        );
        return;
      }
      const bits = [
        `filled ${result.filled}/${result.attempted}`,
        result.skippedNoDuration > 0
          ? `${result.skippedNoDuration} had no duration from Apple`
          : null,
        result.failed.length > 0 ? `${result.failed.length} failed` : null,
      ].filter((b): b is string => b !== null);
      setBackfillStatus(bits.join(" · "));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBackfilling(false);
    }
  };

  const onDownload = async () => {
    if (range === null) return;
    setDownloading(true);
    setError(null);
    try {
      // Pages arrive in playedAt order (index order server-side), so
      // straight concatenation keeps the log chronological.
      const pages = await collectPages((cursor) =>
        convex.query(api.reports.soundExchangePlaylist, {
          stationSlug: station,
          startMs: range.startMs,
          endMs: range.endMs,
          cursor,
        }),
      );
      const rows = pages.flatMap((page) => page.rows);
      if (rows.length === 0) {
        setError("No resolved plays in that range.");
        return;
      }
      const txt = toPlaylistTxt(rows);
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

      {missingDurationCount > 0 && (
        <div className="flex flex-col gap-1 rounded-sm border border-status-warn/40 bg-status-warn/5 px-2 py-1.5">
          <p className="text-[10px] text-status-warn">
            {missingDurationCount} resolved {missingDurationCount === 1 ? "track is" : "tracks are"}{" "}
            missing duration — those rows will be rejected by NPR. Most can be auto-filled from the
            Apple Music songId already on the track.
          </p>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onBackfillDurations}
              disabled={backfilling}
              className="rounded-sm border border-status-warn/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-status-warn transition-colors hover:border-status-warn hover:text-status-warn disabled:opacity-50"
            >
              {backfilling ? "Filling…" : "Auto-fill from Apple Music"}
            </button>
            {backfillStatus !== null && (
              <span
                className="text-[10px] text-text-muted"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {backfillStatus}
              </span>
            )}
          </div>
        </div>
      )}

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
  summary: SummaryTotals | undefined | null;
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
  // null = fetch failed; the panel's shared error block shows the message.
  if (summary === null) return null;
  if (summary.resolvedPlays === 0) {
    return (
      <p className="text-[10px] text-text-muted" style={{ fontFamily: "var(--font-mono)" }}>
        No resolved plays in that range.
      </p>
    );
  }
  return (
    <p
      className="flex flex-wrap gap-x-3 text-[10px] text-text-muted"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      <span className="text-text-secondary">{summary.resolvedPlays} plays</span>
      <span title="rows missing recordLabel — still valid for SoundExchange but flagged for completeness">
        missing label: {summary.missingLabel}
      </span>
      <span title="rows missing ISRC — optional for SOR">missing ISRC: {summary.missingIsrc}</span>
      <span title="rows exported with no length — NPR rejects these">
        missing duration: {summary.missingDuration}
      </span>
      <span title="rows exported with an estimated length — correct the track's duration in Needs Attention">
        estimated duration: {summary.estimatedDuration}
      </span>
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
 * endMs exclusive) interpreted as Milwaukee local midnight, NOT UTC
 * midnight. An operator who picks "March 1 → March 31" means "all 31
 * calendar days in America/Chicago" — using UTC midnight would shave
 * off (or tack on) the 5-6h offset at each boundary and drop plays that
 * happened in the first 5-6 hours of the last day of the month.
 *
 * Returns null if either date fails to parse or the range is
 * empty/reversed.
 */
function toEpochRange(
  startDate: string,
  endDate: string,
): { startMs: number; endMs: number } | null {
  const startMs = milwaukeeMidnightEpoch(startDate);
  const endDayMs = milwaukeeMidnightEpoch(endDate);
  if (startMs === null || endDayMs === null) return null;
  // endDate is inclusive in the picker; add 24h to make endMs exclusive.
  // Note this ignores the rare DST-day boundary (23h or 25h); the
  // resulting ±1h slop on the last day of March/November is
  // acceptable for monthly reporting.
  const endMs = endDayMs + 24 * 60 * 60 * 1000;
  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

/**
 * Convert a YYYY-MM-DD string to the epoch-ms of that calendar day's
 * midnight in America/Chicago. Strategy: parse the date as UTC midnight
 * and then add the timezone offset that America/Chicago was observing
 * on that moment (−5h during CDT, −6h during CST).
 */
function milwaukeeMidnightEpoch(ymd: string): number | null {
  const utcMidnight = Date.parse(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(utcMidnight)) return null;
  const offsetMinutes = chicagoOffsetMinutes(utcMidnight);
  if (offsetMinutes === null) return null;
  // America/Chicago midnight occurs |offsetMinutes| later than UTC midnight.
  // offsetMinutes is negative for west-of-UTC zones, so subtract to add.
  return utcMidnight - offsetMinutes * 60 * 1000;
}

const OFFSET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: MILWAUKEE_TIMEZONE,
  timeZoneName: "shortOffset",
});

/**
 * Return America/Chicago's UTC offset in minutes at the given instant.
 * Negative for CST (−360) or CDT (−300). Returns null only if the Intl
 * engine fails to emit a parseable offset — which shouldn't happen on
 * any modern browser we support.
 */
function chicagoOffsetMinutes(atEpochMs: number): number | null {
  const parts = OFFSET_FMT.formatToParts(new Date(atEpochMs));
  const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  // Shapes: "GMT-5", "GMT-05:30", "GMT" (for UTC). America/Chicago emits
  // "GMT-5" or "GMT-6"; handle the :mm case defensively.
  const match = raw.match(/^GMT(?:([+-]\d{1,2})(?::(\d{2}))?)?$/);
  if (match === null) return null;
  if (match[1] === undefined) return 0;
  const hours = Number.parseInt(match[1], 10);
  const minutes = match[2] === undefined ? 0 : Number.parseInt(match[2], 10);
  const sign = hours < 0 ? -1 : 1;
  return hours * 60 + sign * minutes;
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
