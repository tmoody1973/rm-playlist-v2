import { h } from "preact";
import type { PublicPlay } from "../types";
import { AlbumArt } from "./AlbumArt";
import { PreviewButton } from "./PreviewButton";
import { formatPlayedAtClock } from "../format";

interface GridItemProps {
  readonly play: PublicPlay;
  readonly enablePreview: boolean;
}

/**
 * One cell in the `playlist` widget's `grid` layout. Square-ish card with
 * 132px album art, track title, artist, and a hover-time overlay. The
 * grid container (in the variant entrypoint) controls column count via
 * `repeat(auto-fill, minmax(160px, 1fr))`, so a narrow sidebar renders
 * single-column and a full-width page renders 4–5 across without any
 * breakpoint math here.
 */
export function GridItem({ play, enablePreview }: GridItemProps) {
  return (
    <li
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--rmke-space-xs)",
        padding: "var(--rmke-space-sm)",
        background: "var(--rmke-bg-surface)",
        border: "1px solid var(--rmke-border)",
        borderRadius: "var(--rmke-radius-sm)",
        minWidth: 0,
      }}
    >
      <div style={{ position: "relative" }}>
        <AlbumArt src={play.artworkUrl} alt={`${play.title} — ${play.artist}`} size={132} />
        {enablePreview && (
          <div style={{ position: "absolute", right: "4px", bottom: "4px" }}>
            <PreviewButton
              appleMusicSongId={play.appleMusicSongId}
              previewUrl={play.previewUrl}
              trackLabel={`${play.title} by ${play.artist}`}
            />
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
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
        <time
          dateTime={new Date(play.playedAt).toISOString()}
          style={{
            fontSize: "14px",
            color: "var(--rmke-text-muted)",
            fontFamily: "var(--rmke-font-mono)",
            marginTop: "2px",
          }}
        >
          {formatPlayedAtClock(play.playedAt)}
        </time>
      </div>
    </li>
  );
}
