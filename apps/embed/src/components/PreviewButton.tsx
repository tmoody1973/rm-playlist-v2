import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api } from "@rm/convex/api";
import { getConvexClient } from "../convex-client";
import {
  getPreviewPlayerState,
  play,
  setResolveError,
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
      if (result.previewUrl === null) {
        setResolveError(appleMusicSongId, "Preview unavailable for this track.");
        return;
      }
      await play(appleMusicSongId, result.previewUrl);
    } catch {
      setResolveError(appleMusicSongId, "Preview couldn't load. Try again in a moment.");
    }
  };

  const ariaLabel = isPlaying
    ? `Stop preview of ${trackLabel}`
    : `Play 30-second preview of ${trackLabel}`;

  return (
    <span style={{ display: "inline-flex", flexShrink: 0, position: "relative" }}>
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
          // 44x44 hits WCAG 2.5.5 AAA target size (right floor for the
          // older-listener audience). Glyph stays 12x12 — padding does the work.
          width: "44px",
          height: "44px",
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
      {/*
        Visually-hidden live region so screen readers announce resolve / playback
        failures. Sighted users get the `title` tooltip on hover; keyboard users get
        the title on focus. Both already wired above.
      */}
      <span
        aria-live="polite"
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {isError ? playerState.message : ""}
      </span>
    </span>
  );
}
