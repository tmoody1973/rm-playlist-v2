import type { PublicTopSong } from "../types";
import { AlbumArt } from "./AlbumArt";
import { Skeleton } from "./Skeleton";

/**
 * Top 20 songs list — renders a numbered, ranked list of the most-played
 * tracks in a window (7 or 30 days). Updates reactively via
 * `useTopSongs` upstream.
 */
interface TopSongsListProps {
  readonly songs: readonly PublicTopSong[] | undefined;
  readonly windowDays: 7 | 30;
}

export function TopSongsList({ songs, windowDays }: TopSongsListProps) {
  if (songs === undefined) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--rmke-space-md)",
        }}
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} width="100%" height="56px" />
        ))}
      </div>
    );
  }

  if (songs.length === 0) {
    return (
      <p
        style={{
          margin: 0,
          padding: "var(--rmke-space-md) 0",
          color: "var(--rmke-text-muted)",
          fontSize: "14px",
        }}
      >
        No spins in the last {windowDays} days.
      </p>
    );
  }

  return (
    <ol
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {songs.map((song, idx) => (
        <li
          key={song._id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--rmke-space-md)",
            padding: "var(--rmke-space-sm) 0",
            borderBottom: "1px solid var(--rmke-border)",
          }}
        >
          <span
            style={{
              minWidth: "24px",
              textAlign: "center",
              fontSize: "13px",
              fontFamily: "var(--rmke-font-mono)",
              color: "var(--rmke-text-muted)",
              fontWeight: 600,
            }}
          >
            {idx + 1}
          </span>
          <AlbumArt
            src={song.artworkUrl}
            alt={`${song.artist} — ${song.title} cover art`}
            size={48}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: "14px",
                fontFamily: "var(--rmke-font-display)",
                fontWeight: 600,
                color: "var(--rmke-text-primary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {song.artist} — {song.title}
            </div>
            <div
              style={{
                fontSize: "13px",
                fontFamily: "var(--rmke-font-mono)",
                color: "var(--rmke-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginTop: "2px",
              }}
            >
              Last {windowDays} days
            </div>
          </div>
          <span
            style={{
              fontSize: "13px",
              fontFamily: "var(--rmke-font-mono)",
              padding: "4px 10px",
              background: "var(--rmke-bg-base)",
              border: "1px solid var(--rmke-border)",
              borderRadius: "var(--rmke-radius-sm)",
              color: "var(--rmke-text-primary)",
              whiteSpace: "nowrap",
            }}
          >
            {song.playCount} {song.playCount === 1 ? "spin" : "spins"}
          </span>
        </li>
      ))}
    </ol>
  );
}
