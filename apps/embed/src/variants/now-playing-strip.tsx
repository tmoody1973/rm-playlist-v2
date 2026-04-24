import { h, render as preactRender } from "preact";
import type { WidgetConfig } from "../types";
import { AlbumArt } from "../components/AlbumArt";
import { StationBadge } from "../components/StationBadge";
import { Skeleton } from "../components/Skeleton";
import { useCurrentPlay } from "../use-current-play";
import tokensCss from "../tokens.css?inline";

/**
 * now-playing-strip — compact single-row current-track bar (DESIGN.md § C).
 *
 * Layout:
 *   [art 28px] [title · artist (truncated)]              [station badge]
 *
 * No LIVE row, no preview button — those are card-only affordances per the
 * IA tiers in DESIGN.md. Height fits in a 48px slot so it can sit in
 * sidebars, toolbars, or beneath navigation without forcing a layout
 * change on the host page.
 */
function StripWidget({ config }: { config: WidgetConfig }) {
  const play = useCurrentPlay(config.station);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--rmke-space-md)",
        padding: "var(--rmke-space-sm) var(--rmke-space-md)",
        background: "var(--rmke-bg-surface)",
        border: "1px solid var(--rmke-border)",
        borderRadius: "var(--rmke-radius-sm)",
        color: "var(--rmke-text-primary)",
        minHeight: "48px",
      }}
    >
      {play === undefined ? (
        <StripLoading />
      ) : play === null ? (
        <StripEmpty />
      ) : (
        <StripBody artworkUrl={play.artworkUrl} title={play.title} artist={play.artist} />
      )}
      <StationBadge station={config.station} variant="inline" />
    </div>
  );
}

function StripBody({
  artworkUrl,
  title,
  artist,
}: {
  artworkUrl: string | null;
  title: string;
  artist: string;
}) {
  return (
    <>
      <AlbumArt src={artworkUrl} alt={`${title} — ${artist}`} size={28} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          flex: 1,
          gap: "2px",
        }}
      >
        <span
          style={{
            fontSize: "14px",
            fontWeight: 600,
            color: "var(--rmke-text-primary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: "12px",
            color: "var(--rmke-text-secondary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {artist}
        </span>
      </div>
    </>
  );
}

function StripLoading() {
  return (
    <>
      <Skeleton width="28px" height="28px" />
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
        <Skeleton width="60%" height="12px" />
        <Skeleton width="40%" height="10px" />
      </div>
    </>
  );
}

function StripEmpty() {
  return (
    <div
      style={{
        flex: 1,
        color: "var(--rmke-text-muted)",
        fontSize: "13px",
      }}
    >
      Off the air.
    </div>
  );
}

export function render(mount: HTMLElement, config: WidgetConfig): void {
  injectTokens(mount);
  preactRender(h(StripWidget, { config }), mount);
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
