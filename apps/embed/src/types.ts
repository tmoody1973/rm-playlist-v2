/**
 * Public types for the rm-playlist-v2 widget bundle.
 *
 * `PublicPlay` and `LiveEventSummary` mirror the shapes returned by the
 * Convex public queries (`plays.currentByStation`, `plays.recentByStation`).
 * Duplicated here rather than imported from `@rm/convex` so the embed
 * bundle stays free of Convex's server-side codegen — the bundle uses
 * `@rm/convex/api` at runtime for typed query references, but the shapes
 * below are what arrives at the component boundary.
 */

export type StationSlug = "hyfin" | "88nine" | "414music" | "rhythmlab";

export type WidgetVariant = "playlist" | "now-playing-card" | "now-playing-strip";

export type WidgetTheme = "auto" | "light" | "dark";

export type WidgetLayout = "list" | "grid";

export interface WidgetConfig {
  readonly station: StationSlug;
  readonly variant: WidgetVariant;
  readonly layout?: WidgetLayout;
  readonly theme?: WidgetTheme;
  readonly maxItems?: number;
  readonly showSearch?: boolean;
  readonly showHeader?: boolean;
  readonly showLoadMore?: boolean;
  /**
   * Render the "Powered by Radio Milwaukee" footer line at the bottom of
   * the playlist widget. Default `false` so partner-site embeds stay native
   * to the host page. Opt in (`data-show-footer="true"`) when the host
   * wants the attribution chip — typically RM-owned pages.
   *
   * When shown, the footer renders in the host-inherited body font at
   * normal case, not mono uppercase. PRODUCT.md anti-references forbid
   * "'Powered by' footers in a different visual language than the host."
   */
  readonly showFooter?: boolean;
  readonly enablePreview?: boolean;
  readonly enableDateSearch?: boolean;
  /**
   * When `false`, the widget renders a one-shot snapshot instead of a live
   * subscription. Default `true` — matches V1 default + most embed cases.
   */
  readonly autoUpdate?: boolean;
  /**
   * Reserved for chunk 4 — when `true`, removes the 100-row cap and uses
   * a cursor-paginated query. Today still capped at 100; the attr is
   * accepted but has no extra effect. See playlist.tsx PAGE_CEILING.
   */
  readonly unlimitedSongs?: boolean;
}

/**
 * LIVE event slot on a play row — the product differentiator (DESIGN.md
 * § B tertiary tier). Populated by `findLiveEventForArtist` in
 * packages/convex/convex/plays.ts: when the play's artist has an upcoming
 * non-duplicate, non-cancelled event in the station's region, the
 * soonest one is returned here. `null` otherwise. Mirrors the server
 * `LiveEventSummary` interface (Id<"events"> serializes to string).
 */
export interface LiveEventSummary {
  readonly eventId: string;
  readonly artistName: string;
  readonly venue: string;
  readonly city: string;
  readonly startsAtMs: number;
  readonly ticketUrl: string | null;
}

export interface PublicPlay {
  readonly _id: string;
  readonly artistRaw: string;
  readonly titleRaw: string;
  readonly albumRaw: string | undefined;
  readonly playedAt: number;
  readonly artist: string;
  readonly title: string;
  readonly album: string | null;
  readonly label: string | null;
  readonly durationSec: number | null;
  readonly artworkUrl: string | null;
  readonly spotifyTrackId: string | null;
  readonly appleMusicSongId: string | null;
  readonly previewUrl: string | null;
  readonly liveEvent: LiveEventSummary | null;
}

/**
 * A `PublicPlay` extended with a play-count, returned by
 * `plays.topSongsByStation` for the Top 20 tabs.
 */
export interface PublicTopSong extends PublicPlay {
  readonly playCount: number;
}

export const STATION_LABEL: Record<StationSlug, string> = {
  hyfin: "HYFIN",
  "88nine": "88Nine",
  "414music": "414 Music",
  rhythmlab: "Rhythm Lab",
};
