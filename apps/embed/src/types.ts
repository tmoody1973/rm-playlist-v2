export interface WidgetConfig {
  station: "hyfin" | "88nine" | "414music" | "rhythmlab";
  variant: "playlist" | "now-playing-card" | "now-playing-strip";
  layout?: "list" | "grid";
  theme?: "auto" | "light" | "dark";
  maxItems?: number;
  showSearch?: boolean;
  showHeader?: boolean;
}
