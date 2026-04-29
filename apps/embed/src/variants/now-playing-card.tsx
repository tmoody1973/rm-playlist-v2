import { h, render as preactRender } from "preact";
import type { WidgetConfig } from "../types";
import { AlbumArt } from "../components/AlbumArt";
import { StationBadge } from "../components/StationBadge";
import { LiveEventRow } from "../components/LiveEventRow";
import { PreviewButton } from "../components/PreviewButton";
import { Skeleton } from "../components/Skeleton";
import { useCurrentPlay } from "../use-current-play";
import { formatPlayedAt } from "../format";
import tokensCss from "../tokens.css?inline";

/**
 * now-playing-card — single-track editorial card (DESIGN.md § B).
 *
 * Four priority tiers implemented as layout regions:
 *   PRIMARY    — 88px album art + track title
 *   SECONDARY  — artist, album, "Playing since HH:MM"
 *   TERTIARY   — "ON AIR — <station>" header; LIVE event row when applicable
 *   QUATERNARY — "powered by Radio Milwaukee" footer
 *
 * LIVE row uses <LiveEventRow liveEvent={play.liveEvent} />. The query
 * always returns `null` today (events ingestion is a later milestone),
 * so the component renders nothing — graceful absence, zero layout cost.
 */
function CardWidget({ config }: { config: WidgetConfig }) {
  const play = useCurrentPlay(config.station);

  return (
    <article
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--rmke-space-md)",
        padding: "var(--rmke-space-lg)",
        background: "var(--rmke-bg-surface)",
        border: "1px solid var(--rmke-border)",
        borderRadius: "var(--rmke-radius-md)",
        color: "var(--rmke-text-primary)",
        maxWidth: "440px",
      }}
    >
      <StationBadge station={config.station} variant="onAir" />

      {play === undefined ? (
        <CardLoading />
      ) : play === null ? (
        <CardEmpty />
      ) : (
        <>
          <div
            style={{
              display: "flex",
              gap: "var(--rmke-space-md)",
              alignItems: "flex-start",
            }}
          >
            <AlbumArt src={play.artworkUrl} alt={`${play.title} — ${play.artist}`} size={88} />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--rmke-space-xs)",
                minWidth: 0,
                flex: 1,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: "18px",
                  lineHeight: 1.2,
                  fontWeight: 600,
                  fontFamily: "var(--rmke-font-display)",
                  color: "var(--rmke-text-primary)",
                }}
              >
                {play.title}
              </h3>
              <span
                style={{
                  fontSize: "14px",
                  color: "var(--rmke-text-secondary)",
                  fontWeight: 500,
                }}
              >
                {play.artist}
              </span>
              {play.album !== null && (
                <span
                  style={{
                    fontSize: "13px",
                    fontStyle: "italic",
                    color: "var(--rmke-text-muted)",
                  }}
                >
                  {play.album}
                </span>
              )}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--rmke-space-sm)",
                  marginTop: "var(--rmke-space-xs)",
                }}
              >
                <span
                  style={{
                    fontSize: "13px",
                    color: "var(--rmke-text-muted)",
                    fontFamily: "var(--rmke-font-mono)",
                  }}
                >
                  Playing {formatPlayedAt(play.playedAt)}
                </span>
                {config.enablePreview !== false && (
                  <PreviewButton
                    appleMusicSongId={play.appleMusicSongId}
                    previewUrl={play.previewUrl}
                    trackLabel={`${play.title} by ${play.artist}`}
                  />
                )}
              </div>
            </div>
          </div>

          <LiveEventRow liveEvent={play.liveEvent} />
        </>
      )}

      {config.showFooter === true && (
        <footer
          style={{
            borderTop: "1px solid var(--rmke-border)",
            paddingTop: "var(--rmke-space-sm)",
            fontSize: "14px",
            color: "var(--rmke-text-muted)",
            // Host-inherited body font + normal case (see types.ts showFooter
            // doc comment). Default OFF; partner sites stay native.
            fontFamily: "var(--rmke-font-body)",
          }}
        >
          Powered by Radio Milwaukee
        </footer>
      )}
    </article>
  );
}

function CardLoading() {
  return (
    <div style={{ display: "flex", gap: "var(--rmke-space-md)" }}>
      <Skeleton width="88px" height="88px" />
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
        <Skeleton width="80%" height="20px" />
        <Skeleton width="50%" height="14px" />
        <Skeleton width="60%" height="12px" />
      </div>
    </div>
  );
}

function CardEmpty() {
  return (
    <div
      style={{
        padding: "var(--rmke-space-md) 0",
        color: "var(--rmke-text-muted)",
        fontSize: "14px",
      }}
    >
      Off the air right now. Check back when a track starts playing.
    </div>
  );
}

export function render(mount: HTMLElement, config: WidgetConfig): void {
  injectTokens(mount);
  preactRender(h(CardWidget, { config }), mount);
}

function injectTokens(mount: HTMLElement): void {
  const host = mount.getRootNode();
  if (!(host instanceof ShadowRoot)) return;
  if (host.querySelector("style[data-rmke-tokens]")) return;
  const style = document.createElement("style");
  style.setAttribute("data-rmke-tokens", "");
  style.textContent = tokensCss;
  host.prepend(style);
}
