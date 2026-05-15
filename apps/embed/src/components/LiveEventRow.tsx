import { h, Fragment } from "preact";
import { useState } from "preact/hooks";
import type { LiveEventSummary } from "../types";
import { AlbumArt } from "./AlbumArt";
import { AxsWordmark } from "./AxsWordmark";
import { EventModal } from "./EventModal";

interface LiveEventRowProps {
  readonly liveEvent: LiveEventSummary | null;
}

const AXS_BLUE = "#0054A1";

/**
 * "See them live tonight" row — the playlist widget's signature differentiator
 * (DESIGN.md § B tertiary tier). Renders null when no upcoming event matches.
 *
 * Visual vocabulary forks by source:
 *   axs         — AXS Blue left border + blue-wash background + AxsWordmark badge.
 *                 AXS is the authoritative source for Pabst Theater Group shows;
 *                 the distinct brand treatment reflects that authority.
 *   ticketmaster/custom — amber left border + event-wash background + LIVE text label.
 *
 * Both variants show an event thumbnail (48×48) and are clickable — tapping
 * anywhere on the row opens the EventModal with full show details.
 */
export function LiveEventRow({ liveEvent }: LiveEventRowProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  if (liveEvent === null) return null;

  const isAxs = (liveEvent.source ?? "ticketmaster") === "axs";

  const dateLabel = new Date(liveEvent.startsAtMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <Fragment>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsModalOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsModalOpen(true);
          }
        }}
        aria-label={`${liveEvent.title ?? liveEvent.artistName} at ${liveEvent.venue} — tap for details`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--rmke-space-md)",
          padding: "var(--rmke-space-sm) var(--rmke-space-md)",
          background: isAxs ? "var(--rmke-bg-event-tinted-axs)" : "var(--rmke-bg-event-tinted)",
          borderLeft: `3px solid ${isAxs ? AXS_BLUE : "var(--rmke-accent-live)"}`,
          borderRadius: "var(--rmke-radius-sm)",
          marginTop: "var(--rmke-space-sm)",
          cursor: "pointer",
        }}
      >
        {/* Event thumbnail — 48×48, square per DESIGN.md */}
        <AlbumArt
          src={liveEvent.imageUrl ?? null}
          alt={liveEvent.title ?? liveEvent.artistName}
          size={48}
        />

        {/* Source badge: AXS wordmark pill or amber LIVE label */}
        {isAxs ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0",
              background: AXS_BLUE,
              borderRadius: "var(--rmke-radius-full)",
              padding: "3px 8px",
              flexShrink: 0,
            }}
          >
            <AxsWordmark color="white" height={10} />
          </div>
        ) : (
          <span
            style={{
              fontSize: "13px",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontWeight: 700,
              color: "var(--rmke-accent-live-hover)",
              fontFamily: "var(--rmke-font-mono)",
              flexShrink: 0,
            }}
          >
            Live
          </span>
        )}

        {/* Event info */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: 1 }}>
          {liveEvent.role === "support" && (
            <span
              style={{
                fontSize: "12px",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                fontWeight: 600,
                color: "var(--rmke-text-muted)",
                fontFamily: "var(--rmke-font-mono)",
                lineHeight: 1.3,
              }}
            >
              {liveEvent.artistName} opens for
            </span>
          )}
          {liveEvent.title !== null && (
            <span
              style={{
                fontSize: "16px",
                fontWeight: 600,
                color: "var(--rmke-text-primary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                lineHeight: 1.3,
              }}
            >
              {liveEvent.title}
            </span>
          )}
          <span
            style={{
              fontSize: "14px",
              fontWeight: liveEvent.title === null ? 600 : 400,
              color:
                liveEvent.title === null
                  ? "var(--rmke-text-primary)"
                  : "var(--rmke-text-secondary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {liveEvent.venue}, {liveEvent.city}
            {" · "}
            <span style={{ fontFamily: "var(--rmke-font-mono)" }}>{dateLabel}</span>
          </span>
        </div>

        {/* Ticket link — stopPropagation so the modal doesn't also open */}
        {liveEvent.ticketUrl !== null && (
          <a
            href={liveEvent.ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              marginLeft: "auto",
              fontSize: "13px",
              fontWeight: 600,
              color: isAxs ? AXS_BLUE : "var(--rmke-accent-cta)",
              textDecoration: "none",
              padding: "var(--rmke-space-xs) var(--rmke-space-sm)",
              border: `1px solid ${isAxs ? AXS_BLUE : "var(--rmke-accent-cta)"}`,
              borderRadius: "var(--rmke-radius-sm)",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            Tickets
          </a>
        )}
      </div>

      {isModalOpen && <EventModal event={liveEvent} onClose={() => setIsModalOpen(false)} />}
    </Fragment>
  );
}
