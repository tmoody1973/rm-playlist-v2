"use client";

import { useQuery } from "convex/react";
import { api } from "@rm/convex/api";

/**
 * Row 2 right panel — "Needs Attention" per DESIGN.md 002 section C.
 *
 * Shows enrichment failures grouped by (station × reason × song) over the
 * last 24h. Grouping matters — a station ID that can't be resolved plays
 * every 20 minutes, which would otherwise flood the panel with 70+
 * identical rows. The count communicates pattern-vs-one-off at a glance.
 */
export function NeedsAttention() {
  const groups = useQuery(api.ingestionEvents.enrichmentProblemsGrouped, { limitGroups: 8 });

  return (
    <section
      role="region"
      aria-label="Items needing attention"
      className="flex flex-col gap-3 rounded-md border border-border bg-bg-surface p-5"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">Needs Attention</h3>
        {groups !== undefined && groups.length > 0 && (
          <span
            className="rounded-full bg-status-error/20 px-2 py-0.5 text-xs font-medium text-status-error"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {groups.length}
          </span>
        )}
      </header>

      {groups === undefined && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-sm bg-bg-elevated" />
          ))}
        </div>
      )}

      {groups !== undefined && groups.length === 0 && (
        <p className="text-sm text-text-muted">
          Everything is clean.{" "}
          <span className="text-xs text-text-muted/70" style={{ fontFamily: "var(--font-mono)" }}>
            Last 24h.
          </span>
        </p>
      )}

      {groups !== undefined && groups.length > 0 && (
        <ul role="list" className="flex flex-col gap-1.5">
          {groups.map((g, i) => (
            <li
              key={`${g.stationId}-${g.reason}-${g.artistRaw ?? ""}-${g.titleRaw ?? ""}-${i}`}
              className="flex items-start justify-between gap-3 rounded-sm px-2 py-1.5 text-xs transition-colors duration-[var(--dur-micro)] hover:bg-bg-elevated"
            >
              <div className="flex min-w-0 items-start gap-2">
                <SeverityDot reason={g.reason} />
                <div className="min-w-0">
                  <p className="truncate text-sm text-text-primary">{displaySong(g)}</p>
                  <p className="flex gap-2 text-text-muted">
                    <span>{g.station}</span>
                    <span aria-hidden>·</span>
                    <span>{friendlyReason(g.reason)}</span>
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                {g.count > 1 && (
                  <span
                    className="rounded-sm bg-bg-elevated px-1.5 text-xs text-text-muted"
                    style={{ fontFamily: "var(--font-mono)" }}
                    aria-label={`seen ${g.count} times`}
                  >
                    {g.count}×
                  </span>
                )}
                <time
                  dateTime={new Date(g.lastSeenAt).toISOString()}
                  className="text-text-muted"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {formatRelative(g.lastSeenAt)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface GroupRow {
  readonly artistRaw?: string;
  readonly titleRaw?: string;
  readonly reason: string;
  readonly station: string;
  readonly count: number;
  readonly lastSeenAt: number;
  readonly stationId: string;
}

function displaySong(g: GroupRow): string {
  if (!g.artistRaw && !g.titleRaw) return "Unknown (no artist/title captured)";
  const artist = g.artistRaw?.trim() ?? "";
  const title = g.titleRaw?.trim() ?? "";
  if (artist && title) return `${artist} — ${title}`;
  if (title) return title;
  if (artist) return artist;
  return "Unknown";
}

/**
 * Translate internal reason codes into what a music director actually
 * needs to understand. Keep copy tight — this shows in a narrow panel.
 */
function friendlyReason(reason: string): string {
  switch (reason) {
    case "mb_miss":
      return "on Apple Music, not MusicBrainz";
    case "no_match":
      return "not found on either source";
    case "other":
      return "upstream error";
    default:
      return reason;
  }
}

function SeverityDot({ reason }: { reason: string }) {
  // mb_miss is low severity — Apple still identified the track, we just
  // lack canonical MBID. no_match is the one worth actually looking at.
  const severity: Severity = reason === "mb_miss" ? "warn" : "error";
  const bgClass: Record<Severity, string> = {
    error: "bg-status-error",
    warn: "bg-status-warn",
    info: "bg-status-info",
  };
  return (
    <span
      aria-hidden
      className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${bgClass[severity]}`}
    />
  );
}

type Severity = "error" | "warn" | "info";

function formatRelative(epochMs: number): string {
  const ageSec = Math.floor((Date.now() - epochMs) / 1000);
  if (ageSec < 10) return "just now";
  if (ageSec < 60) return `${ageSec}s`;
  const ageMin = Math.floor(ageSec / 60);
  if (ageMin < 60) return `${ageMin}m`;
  const ageHr = Math.floor(ageMin / 60);
  if (ageHr < 24) return `${ageHr}h`;
  return `${Math.floor(ageHr / 24)}d`;
}
