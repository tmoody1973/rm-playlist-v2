import { h, render as preactRender } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { PublicPlay, WidgetConfig } from "../types";
import { ListItem } from "../components/ListItem";
import { GridItem } from "../components/GridItem";
import { StationBadge } from "../components/StationBadge";
import { Skeleton } from "../components/Skeleton";
import { useRecentPlays, useSearchPlays, useTopSongs } from "../use-current-play";
import { DatePicker } from "../components/DatePicker";
import { TopSongsList } from "../components/TopSongsList";
import { AboutTab } from "../components/AboutTab";
import tokensCss from "../tokens.css?inline";

/**
 * Playlist widget — V1 carry-forward in 4 chunks. Chunks 1-3 shipped:
 *   - Chunk 1: list/grid layout, station badge header, Load More pagination
 *   - Chunk 2: search box + date filter + autoUpdate, showLoadMore, etc.
 *   - Chunk 3: tabs (Recent / Top 20 Songs / Top 20 30-days / About)
 *
 * Remaining chunk:
 *   - Chunk 4: related-tracks carousel + concerts (events-blocked) +
 *              cursor pagination to honor `unlimitedSongs`
 *
 * Reactive: when no filter is active we subscribe to `recentByStation`;
 * when a search term or date range is set we subscribe to
 * `searchByStation`. Both push live updates by default — set
 * `data-auto-update="false"` for a one-shot snapshot. Top 20 tabs use
 * `topSongsByStation` which also live-updates as new plays land.
 */
const INITIAL_PAGE = 20;
const PAGE_INCREMENT = 20;
// Both queries cap `take` at 100. `unlimitedSongs` waits on chunk 4's
// cursor-paginated query.
const PAGE_CEILING = 100;
const SEARCH_DEBOUNCE_MS = 300;

type TabId = "recent" | "top7" | "top30" | "about";

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "recent", label: "Recent" },
  { id: "top7", label: "Last 7 days" },
  { id: "top30", label: "Last 30 days" },
  { id: "about", label: "About" },
];

function PlaylistWidget({ config }: { config: WidgetConfig }) {
  const [activeTab, setActiveTab] = useState<TabId>("recent");

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
            {TAB_HEADINGS[activeTab]}
          </h3>
          <StationBadge station={config.station} variant="inline" />
        </header>
      )}

      <TabNav activeTab={activeTab} onSelect={setActiveTab} />

      {activeTab === "recent" && <RecentPane config={config} />}
      {activeTab === "top7" && <TopSongsPane config={config} windowDays={7} />}
      {activeTab === "top30" && <TopSongsPane config={config} windowDays={30} />}
      {activeTab === "about" && <AboutTab station={config.station} />}

      <footer
        style={{
          borderTop: "1px solid var(--rmke-border)",
          paddingTop: "var(--rmke-space-sm)",
          fontSize: "13px",
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

const TAB_HEADINGS: Record<TabId, string> = {
  recent: "Recently played",
  top7: "Top 20 — last 7 days",
  top30: "Top 20 — last 30 days",
  about: "About",
};

function TabNav({ activeTab, onSelect }: { activeTab: TabId; onSelect: (id: TabId) => void }) {
  return (
    <div
      // Positioning wrapper hosts the right-edge fade overlay. The nav
      // itself stays scrollable; the fade signals that more tabs exist
      // off-screen-right at narrow viewports (~320px mobile portrait,
      // where 'About' was previously hidden with no affordance).
      style={{
        position: "relative",
        borderBottom: "1px solid var(--rmke-border)",
      }}
    >
      <nav
        role="tablist"
        style={{
          display: "flex",
          gap: "var(--rmke-space-xs, 4px)",
          overflowX: "auto",
        }}
      >
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(tab.id)}
              style={{
                // Older-listener a11y (2026-04-28): 14px (was 12px) lifts to
                // DESIGN.md UI/Label tier for legibility. minHeight 44px hits
                // the WCAG touch-target minimum without thickening padding,
                // which would have broken the editorial nav density.
                display: "inline-flex",
                alignItems: "center",
                minHeight: "44px",
                padding: "var(--rmke-space-sm) var(--rmke-space-md)",
                background: "transparent",
                border: "none",
                borderBottom: isActive
                  ? "2px solid var(--rmke-text-primary)"
                  : "2px solid transparent",
                fontSize: "14px",
                fontFamily: "var(--rmke-font-mono)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: isActive ? "var(--rmke-text-primary)" : "var(--rmke-text-muted)",
                cursor: "pointer",
                fontWeight: isActive ? 600 : 400,
                whiteSpace: "nowrap",
                marginBottom: "-1px",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
      {/* Right-edge fade. Sits on whitespace at wide viewports (invisible);
          becomes a visible gradient over clipped tab content at narrow
          viewports so users know more tabs are scrollable to the right. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: "24px",
          pointerEvents: "none",
          background:
            "linear-gradient(to right, color-mix(in oklab, var(--rmke-bg-base) 0%, transparent), var(--rmke-bg-base))",
        }}
      />
    </div>
  );
}

function RecentPane({ config }: { config: WidgetConfig }) {
  const layout = config.layout ?? "list";
  const initial = config.maxItems ?? INITIAL_PAGE;
  const [limit, setLimit] = useState<number>(Math.min(initial, PAGE_CEILING));

  const showSearch = config.showSearch !== false;
  const enableDateSearch = config.enableDateSearch === true;
  const showLoadMore = config.showLoadMore !== false;
  const autoUpdate = config.autoUpdate !== false;

  const [searchInput, setSearchInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [dateRangeOn, setDateRangeOn] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQ(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const { afterMs, beforeMs } = useMemo(
    () => parseDateRange(dateRangeOn, startDate, endDate),
    [dateRangeOn, startDate, endDate],
  );

  const filtersActive =
    debouncedQ.trim().length > 0 || afterMs !== undefined || beforeMs !== undefined;

  const recentPlays = useRecentPlays(config.station, limit, autoUpdate);
  const searchPlays = useSearchPlays({
    station: config.station,
    q: debouncedQ,
    afterMs,
    beforeMs,
    limit,
    autoUpdate,
  });
  const plays = filtersActive ? searchPlays : recentPlays;
  const enablePreview = config.enablePreview !== false;

  const canLoadMore =
    showLoadMore && plays !== undefined && plays.length === limit && limit < PAGE_CEILING;
  const onLoadMore = () => setLimit((prev) => Math.min(prev + PAGE_INCREMENT, PAGE_CEILING));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--rmke-space-md)" }}>
      {(showSearch || enableDateSearch) && (
        <FilterBar
          showSearch={showSearch}
          enableDateSearch={enableDateSearch}
          searchInput={searchInput}
          onSearchChange={setSearchInput}
          dateRangeOn={dateRangeOn}
          onDateToggle={setDateRangeOn}
          startDate={startDate}
          endDate={endDate}
          onStartChange={setStartDate}
          onEndChange={setEndDate}
        />
      )}

      {plays === undefined ? (
        <PlaylistLoading layout={layout} />
      ) : plays.length === 0 ? (
        <PlaylistEmpty filtered={filtersActive} />
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
            fontSize: "13px",
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
    </div>
  );
}

function TopSongsPane({ config, windowDays }: { config: WidgetConfig; windowDays: 7 | 30 }) {
  const songs = useTopSongs(config.station, windowDays);
  return <TopSongsList songs={songs} windowDays={windowDays} />;
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

function PlaylistEmpty({ filtered }: { filtered: boolean }) {
  return (
    <p
      style={{
        margin: 0,
        padding: "var(--rmke-space-md) 0",
        color: "var(--rmke-text-muted)",
        fontSize: "14px",
      }}
    >
      {filtered ? "No plays match these filters." : "No plays yet on this station."}
    </p>
  );
}

interface FilterBarProps {
  showSearch: boolean;
  enableDateSearch: boolean;
  searchInput: string;
  onSearchChange: (v: string) => void;
  dateRangeOn: boolean;
  onDateToggle: (v: boolean) => void;
  startDate: string;
  endDate: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
}

function FilterBar(props: FilterBarProps) {
  const inputStyle = {
    fontSize: "13px",
    fontFamily: "var(--rmke-font-body)",
    padding: "var(--rmke-space-sm) var(--rmke-space-md)",
    background: "var(--rmke-bg-base)",
    border: "1px solid var(--rmke-border)",
    borderRadius: "var(--rmke-radius-sm)",
    color: "var(--rmke-text-primary)",
    width: "100%",
    boxSizing: "border-box" as const,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--rmke-space-sm)" }}>
      {props.showSearch && (
        <input
          type="search"
          placeholder="Search songs or artists…"
          value={props.searchInput}
          onInput={(e) => props.onSearchChange((e.target as HTMLInputElement).value)}
          style={inputStyle}
          aria-label="Search songs or artists"
        />
      )}

      {props.enableDateSearch && (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--rmke-space-sm)",
            fontSize: "13px",
            fontFamily: "var(--rmke-font-mono)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--rmke-text-muted)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={props.dateRangeOn}
            onChange={(e) => props.onDateToggle((e.target as HTMLInputElement).checked)}
          />
          Filter by date
        </label>
      )}

      {props.enableDateSearch && props.dateRangeOn && (
        <div style={{ display: "flex", gap: "var(--rmke-space-sm)" }}>
          <DatePicker
            value={props.startDate}
            onChange={props.onStartChange}
            ariaLabel="Start date"
            placeholder="Start date"
          />
          <DatePicker
            value={props.endDate}
            onChange={props.onEndChange}
            ariaLabel="End date"
            placeholder="End date"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Parse the date toggle + start/end strings into UTC ms bounds.
 *
 * Native `<input type="date">` returns "YYYY-MM-DD". We construct a Date
 * with the local-TZ ctor (year, month-0idx, day) so that "2026-04-27" in
 * a Milwaukee browser means Milwaukee local midnight, not UTC midnight.
 * Most viewers of these widgets ARE in Milwaukee — that semantic matches
 * V1 + the SoundExchange CSV export's date picker.
 *
 * Returns `undefined` for either bound when the toggle is off or the
 * field is empty.
 */
function parseDateRange(
  on: boolean,
  startDate: string,
  endDate: string,
): { afterMs: number | undefined; beforeMs: number | undefined } {
  if (!on) return { afterMs: undefined, beforeMs: undefined };
  return {
    afterMs: parseLocalDateStartOfDay(startDate),
    beforeMs: parseLocalDateEndOfDay(endDate),
  };
}

function parseLocalDateStartOfDay(s: string): number | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function parseLocalDateEndOfDay(s: string): number | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
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
