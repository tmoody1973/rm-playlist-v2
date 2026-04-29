"use client";

import { useQuery } from "convex/react";
import { api } from "@rm/convex/api";
import type { FunctionReturnType } from "convex/server";

/**
 * Row 3 — Upcoming from rotation.
 *
 * Joins recent plays × eventArtists × events on artistKey. Powered by
 * `events.upcomingFromRotation`, which honors cross-source dedup,
 * filters cancelled / postponed events, and caps cost via top-N artist
 * selection.
 *
 * Lookback / horizon defaults match the data the cron actually has:
 *   - 30 days of play history (matches "in rotation" intuition)
 *   - 90 days of upcoming events (matches the TM poll horizon)
 *
 * The brainstorm originally spec'd a nightly Trigger.dev cron that
 * materializes touringFromRotation for sub-100ms reads. At shakedown
 * scale the live query is fast enough; if latency creeps up, swap
 * over to the cached materialized view without changing this component.
 */
export function UpcomingFromRotation() {
  const matches = useQuery(api.events.upcomingFromRotation, {
    orgSlug: "radiomilwaukee",
    lookbackDays: 30,
    horizonDays: 90,
    limit: 50,
  });

  return (
    <section
      role="region"
      aria-label="Upcoming from rotation"
      className="flex flex-col gap-3 rounded-md border border-border bg-bg-surface p-5"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">Upcoming from rotation</h3>
        <span className="text-xs text-text-muted" style={{ fontFamily: "var(--font-mono)" }}>
          {matches === undefined ? "Loading…" : `${matches.length} upcoming · 30d / 90d window`}
        </span>
      </header>

      <p className="text-sm text-text-muted">
        Artists currently in rotation across all four streams who have an upcoming local event in
        Milwaukee, Madison, or Chicago.
      </p>

      {matches === undefined ? (
        <RotationLoading />
      ) : matches.length === 0 ? (
        <RotationEmpty />
      ) : (
        <ul className="flex flex-col gap-3" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {matches.map((match) => (
            <RotationRow key={match.eventId + match.artistKey} match={match} />
          ))}
        </ul>
      )}
    </section>
  );
}

type Match = FunctionReturnType<typeof api.events.upcomingFromRotation>[number];

function RotationRow({ match }: { match: Match }) {
  const dateLabel = formatEventDate(match.startsAtMs, match.dateOnly);
  const isHeadliner = match.role === "headliner";

  return (
    <li
      className="flex items-center gap-3 rounded-md border border-border bg-bg-base p-3"
      style={{ borderLeft: "3px solid var(--accent-live)" }}
    >
      <div className="flex flex-1 flex-col gap-1" style={{ minWidth: 0 }}>
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {match.artistName}
          </span>
          {!isHeadliner && (
            <span
              className="text-xs uppercase"
              style={{
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.06em",
                color: "var(--text-muted)",
              }}
            >
              opening
            </span>
          )}
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {match.playCount} {match.playCount === 1 ? "spin" : "spins"} · 30d
          </span>
        </div>
        <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
          <span className="font-medium" style={{ color: "var(--text-primary)" }}>
            {match.venueName}
          </span>
          {" · "}
          {match.city}
          {match.region ? `, ${match.region}` : ""}
          {" · "}
          <span style={{ fontFamily: "var(--font-mono)" }}>{dateLabel}</span>
        </div>
      </div>
      {match.ticketUrl !== null && (
        <a
          href={match.ticketUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md px-3 py-1.5 text-xs font-semibold uppercase"
          style={{
            border: "1px solid var(--accent-cta)",
            color: "var(--accent-cta)",
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
          }}
        >
          Tickets
        </a>
      )}
    </li>
  );
}

function RotationLoading() {
  return (
    <ul className="flex flex-col gap-3" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <li
          key={i}
          className="rounded-md border border-border bg-bg-base p-3"
          style={{ height: "76px", opacity: 0.6 }}
          aria-hidden="true"
        />
      ))}
    </ul>
  );
}

function RotationEmpty() {
  return (
    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
      No matches yet. Either no rotation artists have upcoming local events in the next 90 days, or
      the Ticketmaster poll hasn&apos;t fired yet.
    </p>
  );
}

/**
 * Format an event start time. Honors the `dateOnly` flag from AXS / TM
 * by suppressing the time component when the source didn't provide one.
 * Uses Milwaukee local time since the dashboard audience is RM staff.
 */
function formatEventDate(startsAtMs: number, dateOnly: boolean): string {
  const d = new Date(startsAtMs);
  const dateOpts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    timeZone: "America/Chicago",
  };
  if (dateOnly) {
    return new Intl.DateTimeFormat(undefined, dateOpts).format(d);
  }
  return new Intl.DateTimeFormat(undefined, {
    ...dateOpts,
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  }).format(d);
}
