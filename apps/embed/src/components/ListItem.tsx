import { h } from "preact";
import type { PublicPlay } from "../types";
import { AlbumArt } from "./AlbumArt";
import { PreviewButton } from "./PreviewButton";
import { formatPlayedAtClock } from "../format";

interface ListItemProps {
  readonly play: PublicPlay;
  readonly enablePreview: boolean;
}

/**
 * One row in the `playlist` widget's `list` layout. Thumb + title + artist
 * on the left, preview button + relative time on the right. Truncates
 * title/artist with ellipsis so long names don't push the time off-row.
 *
 * Why so many inline styles: the widget renders inside a shadow root so
 * host-page CSS can't reach in, but that also means we can't rely on a
 * shared CSS file loaded on the host. Tokens come from `:host` via
 * `tokens.css?inline` which the variant entrypoint injects into the
 * shadow root. Keeping styles inline here avoids a second class-name
 * system to maintain.
 */
export function ListItem({ play, enablePreview }: ListItemProps) {
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--rmke-space-md)",
        padding: "var(--rmke-space-sm) 0",
        borderBottom: "1px solid var(--rmke-border)",
      }}
    >
      <AlbumArt src={play.artworkUrl} alt={`${play.title} — ${play.artist}`} size={56} />

      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1, gap: "2px" }}>
        <span
          style={{
            fontSize: "16px",
            fontWeight: 600,
            color: "var(--rmke-text-primary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {play.title}
        </span>
        <span
          style={{
            fontSize: "14px",
            fontWeight: 500,
            color: "var(--rmke-text-secondary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {play.artist}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--rmke-space-sm)",
          flexShrink: 0,
        }}
      >
        <time
          dateTime={new Date(play.playedAt).toISOString()}
          style={{
            fontSize: "14px",
            color: "var(--rmke-text-muted)",
            fontFamily: "var(--rmke-font-mono)",
          }}
        >
          {formatPlayedAtClock(play.playedAt)}
        </time>
        {enablePreview && (
          <PreviewButton
            appleMusicSongId={play.appleMusicSongId}
            previewUrl={play.previewUrl}
            trackLabel={`${play.title} by ${play.artist}`}
          />
        )}
      </div>
    </li>
  );
}
