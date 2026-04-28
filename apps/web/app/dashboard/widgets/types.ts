export type Variant = "playlist" | "now-playing-card" | "now-playing-strip";
export type Theme = "auto" | "light" | "dark";
export type Layout = "list" | "grid";

export interface Station {
  readonly _id: string;
  readonly slug: string;
  readonly name: string;
  readonly embedSlug: string;
  readonly tagline?: string;
}

export interface WidgetConfig {
  readonly variant: Variant;
  readonly stationSlug: string;
  readonly theme: Theme;
  readonly layout: Layout;
  readonly maxItems: number;
  readonly unlimitedSongs: boolean;
  readonly height: number;
  readonly showSearch: boolean;
  readonly enableDateSearch: boolean;
  readonly showHeader: boolean;
  readonly showLoadMore: boolean;
  readonly compact: boolean;
  readonly enablePreview: boolean;
  readonly autoUpdate: boolean;
}

export const DEFAULT_CONFIG: Omit<WidgetConfig, "stationSlug"> = {
  variant: "playlist",
  theme: "auto",
  layout: "list",
  maxItems: 20,
  unlimitedSongs: false,
  height: 720,
  showSearch: true,
  enableDateSearch: false,
  showHeader: true,
  showLoadMore: true,
  compact: false,
  enablePreview: true,
  autoUpdate: true,
};

export const PREVIEW_HEIGHT_BY_VARIANT: Record<Variant, number> = {
  playlist: 720,
  "now-playing-card": 320,
  "now-playing-strip": 96,
};

/**
 * Build the iframe preview URL from the active config. Only includes
 * params that are (a) relevant to the current variant and (b) different
 * from the default — so the URL stays short for the common case.
 */
export function buildPreviewUrl(config: WidgetConfig, widgetCdnBase: string): string | null {
  if (!config.stationSlug) return null;
  const url = new URL(`${widgetCdnBase}/iframe.html`);
  url.searchParams.set("station", config.stationSlug);
  url.searchParams.set("variant", config.variant);
  if (config.theme !== DEFAULT_CONFIG.theme) {
    url.searchParams.set("theme", config.theme);
  }

  if (config.variant === "playlist") {
    if (config.layout !== DEFAULT_CONFIG.layout) {
      url.searchParams.set("layout", config.layout);
    }
    if (config.maxItems !== DEFAULT_CONFIG.maxItems) {
      url.searchParams.set("maxItems", String(config.maxItems));
    }
    if (config.unlimitedSongs !== DEFAULT_CONFIG.unlimitedSongs) {
      url.searchParams.set("unlimitedSongs", String(config.unlimitedSongs));
    }
    if (config.showSearch !== DEFAULT_CONFIG.showSearch) {
      url.searchParams.set("showSearch", String(config.showSearch));
    }
    if (config.enableDateSearch !== DEFAULT_CONFIG.enableDateSearch) {
      url.searchParams.set("enableDateSearch", String(config.enableDateSearch));
    }
    if (config.showHeader !== DEFAULT_CONFIG.showHeader) {
      url.searchParams.set("showHeader", String(config.showHeader));
    }
    if (config.showLoadMore !== DEFAULT_CONFIG.showLoadMore) {
      url.searchParams.set("showLoadMore", String(config.showLoadMore));
    }
    if (config.compact !== DEFAULT_CONFIG.compact) {
      url.searchParams.set("compact", String(config.compact));
    }
    if (config.enablePreview !== DEFAULT_CONFIG.enablePreview) {
      url.searchParams.set("enablePreview", String(config.enablePreview));
    }
    if (config.autoUpdate !== DEFAULT_CONFIG.autoUpdate) {
      url.searchParams.set("autoUpdate", String(config.autoUpdate));
    }
  } else if (config.variant === "now-playing-card") {
    if (config.enablePreview !== DEFAULT_CONFIG.enablePreview) {
      url.searchParams.set("enablePreview", String(config.enablePreview));
    }
    if (config.autoUpdate !== DEFAULT_CONFIG.autoUpdate) {
      url.searchParams.set("autoUpdate", String(config.autoUpdate));
    }
  } else if (config.variant === "now-playing-strip") {
    if (config.autoUpdate !== DEFAULT_CONFIG.autoUpdate) {
      url.searchParams.set("autoUpdate", String(config.autoUpdate));
    }
  }

  return url.toString();
}

/**
 * Reduce a config to the data-* attribute pairs that should appear in
 * the JavaScript embed snippet. Skip defaults to keep the snippet clean.
 * Keys are kebab-case to match HTML attribute conventions.
 */
export function configToDataAttrs(config: WidgetConfig): ReadonlyArray<readonly [string, string]> {
  const out: Array<readonly [string, string]> = [];
  out.push(["data-station", config.stationSlug]);
  out.push(["data-variant", config.variant]);
  if (config.theme !== DEFAULT_CONFIG.theme) out.push(["data-theme", config.theme]);

  if (config.variant === "playlist") {
    if (config.layout !== DEFAULT_CONFIG.layout) out.push(["data-layout", config.layout]);
    if (config.maxItems !== DEFAULT_CONFIG.maxItems) {
      out.push(["data-max-items", String(config.maxItems)]);
    }
    if (config.unlimitedSongs !== DEFAULT_CONFIG.unlimitedSongs) {
      out.push(["data-unlimited-songs", String(config.unlimitedSongs)]);
    }
    if (config.showSearch !== DEFAULT_CONFIG.showSearch) {
      out.push(["data-show-search", String(config.showSearch)]);
    }
    if (config.enableDateSearch !== DEFAULT_CONFIG.enableDateSearch) {
      out.push(["data-enable-date-search", String(config.enableDateSearch)]);
    }
    if (config.showHeader !== DEFAULT_CONFIG.showHeader) {
      out.push(["data-show-header", String(config.showHeader)]);
    }
    if (config.showLoadMore !== DEFAULT_CONFIG.showLoadMore) {
      out.push(["data-show-load-more", String(config.showLoadMore)]);
    }
    if (config.compact !== DEFAULT_CONFIG.compact) {
      out.push(["data-compact", String(config.compact)]);
    }
    if (config.enablePreview !== DEFAULT_CONFIG.enablePreview) {
      out.push(["data-enable-preview", String(config.enablePreview)]);
    }
    if (config.autoUpdate !== DEFAULT_CONFIG.autoUpdate) {
      out.push(["data-auto-update", String(config.autoUpdate)]);
    }
  } else if (config.variant === "now-playing-card") {
    if (config.enablePreview !== DEFAULT_CONFIG.enablePreview) {
      out.push(["data-enable-preview", String(config.enablePreview)]);
    }
    if (config.autoUpdate !== DEFAULT_CONFIG.autoUpdate) {
      out.push(["data-auto-update", String(config.autoUpdate)]);
    }
  } else if (config.variant === "now-playing-strip") {
    if (config.autoUpdate !== DEFAULT_CONFIG.autoUpdate) {
      out.push(["data-auto-update", String(config.autoUpdate)]);
    }
  }

  return out;
}
