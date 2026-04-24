import { h } from "preact";
import type { StationSlug } from "../types";
import { STATION_LABEL } from "../types";

interface StationBadgeProps {
  readonly station: StationSlug;
  readonly variant?: "onAir" | "inline";
}

/**
 * "ON AIR — 88Nine" label used on now-playing-card per DESIGN.md § B
 * tertiary tier; "inline" mode is the compact right-side badge on
 * now-playing-strip.
 */
export function StationBadge({ station, variant = "inline" }: StationBadgeProps) {
  const label = STATION_LABEL[station];

  if (variant === "onAir") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--rmke-space-sm)",
          fontSize: "11px",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--rmke-text-muted)",
          fontFamily: "var(--rmke-font-mono)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: "8px",
            height: "8px",
            borderRadius: "var(--rmke-radius-full)",
            background: "var(--rmke-accent-cta)",
            flexShrink: 0,
          }}
        />
        On Air — {label}
      </div>
    );
  }

  return (
    <span
      style={{
        fontSize: "11px",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--rmke-text-muted)",
        fontFamily: "var(--rmke-font-mono)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}
