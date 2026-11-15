import { h } from "preact";
import { concertsWithinHorizon } from "@rm/convex/concertsLogic";
import type { LiveEventSummary } from "../types";
import { LiveEventRow } from "./LiveEventRow";
import { Skeleton } from "./Skeleton";

/**
 * Concerts tab (V1 StationEventsTab carry-forward, docs/design/001 § D):
 * upcoming shows by artists the station plays, next 60 days, soonest first.
 * Each show reuses the inline LIVE card so the anatomy matches the playlist.
 */
interface ConcertsListProps {
  readonly concerts: readonly LiveEventSummary[] | undefined;
}

const SKELETON_ROWS = 4;

const noteStyle = {
  margin: 0,
  padding: "var(--rmke-space-md) 0",
  color: "var(--rmke-text-muted)",
  fontSize: "14px",
} as const;

export function ConcertsList({ concerts }: ConcertsListProps) {
  if (concerts === undefined) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--rmke-space-md)" }}>
        {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
          <Skeleton key={index} width="100%" height="72px" />
        ))}
      </div>
    );
  }

  const upcoming = concertsWithinHorizon(concerts, Date.now());
  if (upcoming.length === 0) {
    return (
      <p style={noteStyle}>
        No upcoming events in the next 60 days for artists this station plays.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--rmke-space-sm)" }}>
      <p style={{ ...noteStyle, paddingTop: 0 }}>Events from artists we play — next 60 days</p>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--rmke-space-sm)",
        }}
      >
        {upcoming.map((concert) => (
          <li key={concert.eventId}>
            <LiveEventRow liveEvent={concert} />
          </li>
        ))}
      </ul>
    </div>
  );
}
