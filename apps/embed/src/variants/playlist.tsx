import { h, render as preactRender } from "preact";
import { useState } from "preact/hooks";
import type { PublicPlay, WidgetConfig } from "../types";
import { ListItem } from "../components/ListItem";
import { GridItem } from "../components/GridItem";
import { StationBadge } from "../components/StationBadge";
import { Skeleton } from "../components/Skeleton";
import { useRecentPlays } from "../use-current-play";
import tokensCss from "../tokens.css?inline";

/**
 * Playlist widget — V1 carry-forward in 4 chunks. This is CHUNK 1:
 *   - core rendering in both list and grid layouts
 *   - Load More pagination up to the underlying query's cap (100)
 *   - station badge header
 *
 * Chunks 2-4 land next:
 *   - Chunk 2: search box + date filter + remaining data-* attrs
 *   - Chunk 3: tabs (Recent / Top 20 Songs / Top 20 30-days / About)
 *   - Chunk 4: related-tracks carousel + concerts (events-blocked)
 *
 * Uses existing `plays.recentByStation` — no new Convex work in chunk 1.
 * Subscription driven, so a new song replaces the top of the list in
 * real time (same UX as the now-playing variants).
 */
const INITIAL_PAGE = 20;
const PAGE_INCREMENT = 20;
// `plays.recentByStation` caps `take` at 100. Anything past this needs a
// cursor-style query (chunk 2 or later).
const PAGE_CEILING = 100;

function PlaylistWidget({ config }: { config: WidgetConfig }) {
  const layout = config.layout ?? "list";
  const initial = config.maxItems ?? INITIAL_PAGE;
  const [limit, setLimit] = useState<number>(Math.min(initial, PAGE_CEILING));

  const plays = useRecentPlays(config.station, limit);
  const enablePreview = config.enablePreview !== false;

  const canLoadMore = plays !== undefined && plays.length === limit && limit < PAGE_CEILING;
  const onLoadMore = () => setLimit((prev) => Math.min(prev + PAGE_INCREMENT, PAGE_CEILING));

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--rmke-space-md)",
        padding: "var(--rmke-space-lg)",
        background: "var(--rmke-bg-surface)",
        border: "1px solid var(--rmke-border)",
        borderRadius: "var(--rmke-radius-md)",
        color: "var(--rmke-text-primary)",
      }}
    >
      {config.showHeader !== false && (
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3
            style={{
              margin: 0,
              fontSize: "14px",
              fontFamily: "var(--rmke-font-display)",
              fontWeight: 600,
              letterSpacing: "0.02em",
            }}
          >
            Recently played
          </h3>
          <StationBadge station={config.station} variant="inline" />
        </header>
      )}

      {plays === undefined ? (
        <PlaylistLoading layout={layout} />
      ) : plays.length === 0 ? (
        <PlaylistEmpty />
      ) : (
        <PlaylistItems plays={plays} layout={layout} enablePreview={enablePreview} />
      )}

      {canLoadMore && (
        <button
          type="button"
          onClick={onLoadMore}
          style={{
            alignSelf: "center",
            padding: "var(--rmke-space-sm) var(--rmke-space-lg)",
            background: "transparent",
            border: "1px solid var(--rmke-border)",
            borderRadius: "var(--rmke-radius-sm)",
            color: "var(--rmke-text-primary)",
            fontSize: "12px",
            fontFamily: "var(--rmke-font-mono)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            cursor: "pointer",
            transition: "border-color var(--rmke-dur-micro) ease-out",
          }}
        >
          Load more
        </button>
      )}

      <footer
        style={{
          borderTop: "1px solid var(--rmke-border)",
          paddingTop: "var(--rmke-space-sm)",
          fontSize: "11px",
          color: "var(--rmke-text-muted)",
          fontFamily: "var(--rmke-font-mono)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        Powered by Radio Milwaukee
      </footer>
    </section>
  );
}

function PlaylistItems({
  plays,
  layout,
  enablePreview,
}: {
  plays: readonly PublicPlay[];
  layout: "list" | "grid";
  enablePreview: boolean;
}) {
  if (layout === "grid") {
    return (
      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: "var(--rmke-space-md)",
        }}
      >
        {plays.map((play) => (
          <GridItem key={play._id} play={play} enablePreview={enablePreview} />
        ))}
      </ol>
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
      {plays.map((play) => (
        <ListItem key={play._id} play={play} enablePreview={enablePreview} />
      ))}
    </ol>
  );
}

function PlaylistLoading({ layout }: { layout: "list" | "grid" }) {
  const count = layout === "grid" ? 6 : 5;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: layout === "grid" ? "row" : "column",
        flexWrap: layout === "grid" ? "wrap" : "nowrap",
        gap: "var(--rmke-space-md)",
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          // Skeleton rows aren't content — position in the list is the only key.
          key={i}
          width={layout === "grid" ? "160px" : "100%"}
          height={layout === "grid" ? "200px" : "60px"}
        />
      ))}
    </div>
  );
}

function PlaylistEmpty() {
  return (
    <p
      style={{
        margin: 0,
        padding: "var(--rmke-space-md) 0",
        color: "var(--rmke-text-muted)",
        fontSize: "14px",
      }}
    >
      No plays yet on this station.
    </p>
  );
}

export function render(mount: HTMLElement, config: WidgetConfig): void {
  injectTokens(mount);
  preactRender(h(PlaylistWidget, { config }), mount);
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
