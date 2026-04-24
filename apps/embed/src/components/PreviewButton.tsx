import { h } from "preact";

interface PreviewButtonProps {
  readonly appleMusicSongId: string | null;
  readonly trackLabel: string;
}

/**
 * 30-second Apple Music preview trigger (DESIGN.md preview decision
 * 2026-04-22). Today this is a **scaffolded shell** — the button renders
 * and announces itself to screen readers, but the actual audio fetch +
 * `<audio>` control lands in the dedicated Apple Music API session
 * (see TODO below). Graceful absence when the track has no resolved
 * `appleMusicSongId`.
 *
 * TODO(preview-apple-music): wire `onClick` to a Convex action that
 * returns `attributes.previews[0].url` from Apple Music's catalog API,
 * then play it in a shared `<audio>` element with a stop control.
 * Token minting + weekly refresh already exists in
 * `src/trigger/refresh-apple-music-token.ts`.
 */
export function PreviewButton({ appleMusicSongId, trackLabel }: PreviewButtonProps) {
  if (appleMusicSongId === null) return null;

  return (
    <button
      type="button"
      aria-label={`Play 30-second preview of ${trackLabel}`}
      onClick={() => {
        // Intentionally a no-op until the Apple Music preview action lands.
        // Button still renders so the scaffold surface is complete.
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "32px",
        height: "32px",
        border: "1px solid var(--rmke-border)",
        borderRadius: "var(--rmke-radius-full)",
        background: "var(--rmke-bg-surface)",
        color: "var(--rmke-text-primary)",
        cursor: "pointer",
        flexShrink: 0,
        transition: `background var(--rmke-dur-micro) ease-out, border-color var(--rmke-dur-micro) ease-out`,
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
        <path d="M3 1.5v9l7-4.5-7-4.5z" />
      </svg>
    </button>
  );
}
