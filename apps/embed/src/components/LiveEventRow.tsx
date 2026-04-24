import { h } from "preact";
import type { LiveEventSummary } from "../types";

interface LiveEventRowProps {
  readonly liveEvent: LiveEventSummary | null;
}

/**
 * "See them live tonight" row — the one differentiator vs every other
 * now-playing widget (DESIGN.md § B tertiary tier). Renders `null` when
 * there's no upcoming local event for the currently-playing artist —
 * graceful absence, not a placeholder, not a disabled button.
 *
 * Visual vocabulary: amber LIVE badge + tinted background (DESIGN.md
 * `--bg-event-tinted`). Never competes with the CTA-red donate color.
 *
 * Data source is frozen at `liveEvent: null` today because events
 * ingestion is a later milestone (parked item #4). When Ticketmaster/AXS
 * adapters land, the widget query fills this slot and the component
 * starts rendering with zero changes here.
 */
export function LiveEventRow({ liveEvent }: LiveEventRowProps) {
  if (liveEvent === null) return null;

  const dateLabel = new Date(liveEvent.startsAtMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--rmke-space-md)",
        padding: "var(--rmke-space-sm) var(--rmke-space-md)",
        background: "var(--rmke-bg-event-tinted)",
        borderLeft: "3px solid var(--rmke-accent-live)",
        borderRadius: "var(--rmke-radius-sm)",
        marginTop: "var(--rmke-space-sm)",
      }}
    >
      <span
        style={{
          fontSize: "10px",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          fontWeight: 700,
          color: "var(--rmke-accent-live-hover)",
          fontFamily: "var(--rmke-font-mono)",
        }}
      >
        Live
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
        <span
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--rmke-text-primary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {liveEvent.venue}, {liveEvent.city}
        </span>
        <span
          style={{
            fontSize: "12px",
            color: "var(--rmke-text-secondary)",
            fontFamily: "var(--rmke-font-mono)",
          }}
        >
          {dateLabel}
        </span>
      </div>
      {liveEvent.ticketUrl !== null && (
        <a
          href={liveEvent.ticketUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            marginLeft: "auto",
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--rmke-accent-cta)",
            textDecoration: "none",
            padding: "var(--rmke-space-xs) var(--rmke-space-sm)",
            border: "1px solid var(--rmke-accent-cta)",
            borderRadius: "var(--rmke-radius-sm)",
            whiteSpace: "nowrap",
          }}
        >
          Get tickets
        </a>
      )}
    </div>
  );
}
