import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api } from "@rm/convex/api";
import { getConvexClient } from "../convex-client";
import {
  getPreviewPlayerState,
  play,
  stop,
  subscribe,
  type PreviewPlayerState,
} from "../preview-player";

interface PreviewButtonProps {
  readonly appleMusicSongId: string | null;
  readonly previewUrl: string | null;
  readonly trackLabel: string;
}

/**
 * 30-second Apple Music preview trigger (DESIGN.md preview decision
 * 2026-04-22). Two-level resolution:
 *
 *   1. `previewUrl` prop (already cached on the track, arrived via
 *      `plays.currentByStation`) → play immediately, no round trip.
 *   2. No cached URL but we have an `appleMusicSongId` → call the
 *      `preview.resolvePreviewUrl` action which fetches from Apple,
 *      caches on the track row, then returns. ~300ms first click per
 *      track; free thereafter for every visitor because the URL lands
 *      on the track row.
 *
 * Graceful absence when the track has no `appleMusicSongId` at all
 * (e.g., a MusicBrainz-only resolution) — button doesn't render.
 */
export function PreviewButton({ appleMusicSongId, previewUrl, trackLabel }: PreviewButtonProps) {
  const [playerState, setPlayerState] = useState<PreviewPlayerState>(getPreviewPlayerState);

  useEffect(() => subscribe(setPlayerState), []);

  if (appleMusicSongId === null) return null;

  const isThisTrack =
    playerState.kind !== "idle" && playerState.appleMusicSongId === appleMusicSongId;
  const isLoading = isThisTrack && playerState.kind === "loading";
  const isPlaying = isThisTrack && playerState.kind === "playing";
  const isError = isThisTrack && playerState.kind === "error";

  const onClick = async () => {
    if (isPlaying || isLoading) {
      stop();
      return;
    }
    if (previewUrl !== null) {
      await play(appleMusicSongId, previewUrl);
      return;
    }
    try {
      const client = getConvexClient();
      const result = (await client.action(api.preview.resolvePreviewUrl, {
        appleMusicSongId,
      })) as { previewUrl: string | null };
      if (result.previewUrl === null) return;
      await play(appleMusicSongId, result.previewUrl);
    } catch {
      // Action failure — swallowed; button returns to idle. A follow-up
      // could surface an inline error tooltip.
    }
  };

  const ariaLabel = isPlaying
    ? `Stop preview of ${trackLabel}`
    : `Play 30-second preview of ${trackLabel}`;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={isPlaying}
      onClick={onClick}
      disabled={isLoading}
      title={isError ? playerState.message : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "32px",
        height: "32px",
        border: `1px solid ${isPlaying ? "var(--rmke-accent-cta)" : "var(--rmke-border)"}`,
        borderRadius: "var(--rmke-radius-full)",
        background: isPlaying ? "var(--rmke-accent-cta)" : "var(--rmke-bg-surface)",
        color: isPlaying ? "var(--rmke-bg-base)" : "var(--rmke-text-primary)",
        cursor: isLoading ? "progress" : "pointer",
        flexShrink: 0,
        transition:
          "background var(--rmke-dur-micro) ease-out, border-color var(--rmke-dur-micro) ease-out, color var(--rmke-dur-micro) ease-out",
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        {isPlaying ? (
          <g>
            <rect x="3" y="2" width="2" height="8" rx="0.5" />
            <rect x="7" y="2" width="2" height="8" rx="0.5" />
          </g>
        ) : (
          <path d="M3 1.5v9l7-4.5-7-4.5z" />
        )}
      </svg>
    </button>
  );
}
