import { h } from "preact";
import { useEffect } from "preact/hooks";
import type { LiveEventSummary } from "../types";
import { AxsWordmark } from "./AxsWordmark";
import { formatEventDate, formatEventTime } from "../format";

interface EventModalProps {
  readonly event: LiveEventSummary;
  readonly onClose: () => void;
}

const AXS_BLUE = "#0054A1";

/**
 * Show-info modal. Triggered by clicking a LiveEventRow. Renders as a
 * fixed overlay (covers the viewport from inside the shadow DOM) with a
 * dark backdrop. Dismiss: click backdrop, press Escape, or click the × button.
 *
 * Styling forks on source:
 *   axs       — AXS Blue header + "TICKETING BY axs" CTA per the AXS brand guide.
 *   ticketmaster / custom — amber header tint + coral "Get Tickets" CTA.
 */
export function EventModal({ event, onClose }: EventModalProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const isAxs = (event.source ?? "ticketmaster") === "axs";
  const accentColor = isAxs ? AXS_BLUE : "var(--rmke-accent-live)";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={event.title ?? `${event.artistName} at ${event.venue}`}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(10, 12, 18, 0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        boxSizing: "border-box",
      }}
    >
      {/* Modal panel — stopPropagation keeps backdrop clicks from firing */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--rmke-bg-surface)",
          borderRadius: "var(--rmke-radius-lg)",
          maxWidth: "480px",
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        {/* Image header — full-width 16:9 hero, or branded color wash */}
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "16 / 9",
            background: isAxs ? AXS_BLUE : "var(--rmke-bg-event-tinted)",
            flexShrink: 0,
            borderRadius: "var(--rmke-radius-lg) var(--rmke-radius-lg) 0 0",
            overflow: "hidden",
          }}
        >
          {(event.imageUrl ?? null) !== null ? (
            <img
              src={event.imageUrl ?? undefined}
              alt={event.title ?? event.artistName}
              loading="lazy"
              decoding="async"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : isAxs ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <AxsWordmark color="rgba(255,255,255,0.25)" height={48} />
            </div>
          ) : null}

          {/* AXS logo watermark — bottom-right per AXS brand guide §1.6 */}
          {isAxs && (
            <div
              style={{
                position: "absolute",
                bottom: "10px",
                right: "12px",
              }}
            >
              <AxsWordmark color="rgba(255,255,255,0.9)" height={20} />
            </div>
          )}
        </div>

        {/* Badge row + close button */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px 0",
          }}
        >
          {isAxs ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: AXS_BLUE,
                borderRadius: "var(--rmke-radius-full)",
                padding: "4px 10px 4px 8px",
              }}
            >
              <AxsWordmark color="white" height={11} />
            </div>
          ) : (
            <span
              style={{
                fontSize: "12px",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontWeight: 700,
                color: "var(--rmke-accent-live-hover)",
                fontFamily: "var(--rmke-font-mono)",
              }}
            >
              Live
            </span>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "4px",
              color: "var(--rmke-text-muted)",
              fontSize: "20px",
              lineHeight: 1,
              borderRadius: "var(--rmke-radius-sm)",
            }}
          >
            ×
          </button>
        </div>

        {/* Event identity */}
        <div style={{ padding: "10px 16px 0" }}>
          {event.role === "support" && (
            <p
              style={{
                margin: "0 0 4px",
                fontSize: "13px",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                fontWeight: 600,
                color: "var(--rmke-text-muted)",
                fontFamily: "var(--rmke-font-mono)",
              }}
            >
              {event.artistName} opens for
            </p>
          )}
          <h2
            style={{
              margin: 0,
              fontSize: "22px",
              fontWeight: 700,
              fontFamily: "var(--rmke-font-display)",
              color: "var(--rmke-text-primary)",
              lineHeight: 1.2,
            }}
          >
            {event.title ?? event.artistName}
          </h2>
          {event.title !== null && (event.headliners ?? []).length > 0 && (
            <p
              style={{
                margin: "4px 0 0",
                fontSize: "14px",
                color: "var(--rmke-text-secondary)",
              }}
            >
              {(event.headliners ?? []).join(", ")}
            </p>
          )}
        </div>

        {/* Event details */}
        <div
          style={{
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          <DetailRow label="Venue" value={`${event.venue}, ${event.city}`} />
          <DetailRow label="Date" value={formatEventDate(event.startsAtMs, event.dateOnly)} />
          {event.doorsAt !== null && (
            <DetailRow label="Doors" value={formatEventTime(event.doorsAt)} />
          )}
          {event.genre !== null && <DetailRow label="Genre" value={event.genre} />}
          {(event.supports ?? []).length > 0 && (
            <DetailRow label="Also featuring" value={(event.supports ?? []).join(", ")} />
          )}
        </div>

        {/* CTA */}
        {event.ticketUrl !== null && (
          <div style={{ padding: "0 16px 20px" }}>
            {isAxs ? (
              <a
                href={event.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "10px",
                  background: AXS_BLUE,
                  color: "white",
                  textDecoration: "none",
                  borderRadius: "var(--rmke-radius-sm)",
                  padding: "13px 20px",
                  fontWeight: 600,
                  fontSize: "13px",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontFamily: "var(--rmke-font-mono)",
                }}
              >
                <span>Ticketing by</span>
                <AxsWordmark color="white" height={14} />
              </a>
            ) : (
              <a
                href={event.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "block",
                  textAlign: "center",
                  background: "var(--rmke-accent-cta)",
                  color: "white",
                  textDecoration: "none",
                  borderRadius: "var(--rmke-radius-sm)",
                  padding: "13px 20px",
                  fontWeight: 600,
                  fontSize: "13px",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontFamily: "var(--rmke-font-mono)",
                }}
              >
                Get Tickets
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
      <span
        style={{
          fontSize: "12px",
          fontFamily: "var(--rmke-font-mono)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--rmke-text-muted)",
          flexShrink: 0,
          minWidth: "60px",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "14px",
          color: "var(--rmke-text-primary)",
          fontWeight: 500,
        }}
      >
        {value}
      </span>
    </div>
  );
}
