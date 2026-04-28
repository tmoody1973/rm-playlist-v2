import { STATION_LABEL, type StationSlug } from "../types";

/**
 * About tab — station identity + how-to-use the playlist tool. Static
 * content (no Convex query). Uses station tagline + name from
 * `STATION_LABEL` for personalization.
 *
 * Mirrors V1 `AboutPlaylistTab.tsx` content structure, lightly trimmed
 * for embed scale.
 */
interface AboutTabProps {
  readonly station: StationSlug;
}

export function AboutTab({ station }: AboutTabProps) {
  const stationName = STATION_LABEL[station];
  const tagline = STATION_TAGLINES[station];

  return (
    <article
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--rmke-space-md)",
        fontSize: "14px",
        lineHeight: 1.55,
        color: "var(--rmke-text-primary)",
        fontFamily: "var(--rmke-font-body)",
      }}
    >
      <header>
        <h4
          style={{
            margin: 0,
            fontSize: "15px",
            fontFamily: "var(--rmke-font-display)",
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          About {stationName}
        </h4>
        <p style={{ margin: "4px 0 0 0", color: "var(--rmke-text-muted)", fontStyle: "italic" }}>
          {tagline}
        </p>
      </header>

      <p style={{ margin: 0 }}>
        This playlist updates in real time, every time a song changes on air. Browse what we've
        played, search for a track you heard last week, or filter by date to revisit a specific
        broadcast.
      </p>

      <section>
        <h5 style={sectionHeadingStyle}>What you can do</h5>
        <ul style={listStyle}>
          <li style={listItemStyle}>
            <strong>Live updates:</strong> the list refreshes automatically as new songs air.
          </li>
          <li style={listItemStyle}>
            <strong>Rich details:</strong> every track shows artist, title, album, and the moment it
            played.
          </li>
          <li style={listItemStyle}>
            <strong>Search & filter:</strong> find any song by name, artist, or date range.
          </li>
        </ul>
      </section>

      <section>
        <h5 style={sectionHeadingStyle}>Why this matters</h5>
        <p style={{ margin: 0 }}>
          More than a "now playing" widget — it's a discovery tool, a connection to upcoming shows,
          and a public archive of what {stationName} sounds like, week to week.
        </p>
      </section>

      <p style={{ margin: 0, fontSize: "13px", color: "var(--rmke-text-muted)" }}>
        Support more work like this at{" "}
        <a
          href="https://radiomilwaukee.org/donate"
          target="_blank"
          rel="noopener noreferrer"
          style={linkStyle}
        >
          radiomilwaukee.org/donate
        </a>
        . Feedback?{" "}
        <a href="mailto:digital@radiomilwaukee.org" style={linkStyle}>
          digital@radiomilwaukee.org
        </a>
      </p>
    </article>
  );
}

const STATION_TAGLINES: Record<StationSlug, string> = {
  hyfin: "Diaspora music from Milwaukee.",
  "88nine": "Radio Milwaukee's flagship.",
  "414music": "The sound of Milwaukee.",
  rhythmlab: "Rhythm Lab Radio.",
};

const sectionHeadingStyle = {
  margin: "0 0 6px 0",
  fontSize: "13px",
  fontFamily: "var(--rmke-font-mono)",
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  color: "var(--rmke-text-muted)",
};

const listStyle = {
  margin: 0,
  paddingLeft: "20px",
  display: "flex",
  flexDirection: "column" as const,
  gap: "4px",
};

const listItemStyle = {
  margin: 0,
};

const linkStyle = {
  color: "var(--rmke-text-primary)",
  textDecoration: "underline",
  textDecorationColor: "var(--rmke-border)",
  textUnderlineOffset: "2px",
};
