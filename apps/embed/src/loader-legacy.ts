/**
 * rm-playlist-v2 widget — CLASSIC-SCRIPT loader.
 *
 * Sister bundle to loader.ts. The default loader uses ES modules with
 * dynamic import() for code-splitting; this one uses classic-script
 * format (IIFE) with all variants statically inlined. Same widget,
 * different delivery.
 *
 * Why this exists: some CMSes (Grove, older WordPress installs, certain
 * locked-down enterprise editors) sanitize user-pasted HTML and either
 * strip `type="module"` or block ES modules entirely. Those hosts still
 * accept classic <script src="..."> tags — the embed pattern that
 * predates ES modules and has been the universally-trusted path since
 * the 1990s. NPR's `legacy.npr.org/forstations/newscasts/newscasts.js`
 * is a working example of this pattern.
 *
 * Usage (script-shorthand):
 *
 *   <script src="https://embed.radiomilwaukee.org/v1/widget-legacy.js"
 *           data-station="hyfin"
 *           data-variant="playlist"></script>
 *
 * The classic <script> tag has document.currentScript available during
 * synchronous execution, so the loader can find itself, read its own
 * dataset, create a sibling div, and mount the widget — all in one tag,
 * no marker-div required.
 *
 * Trade-off: bigger bundle (~30–35KB gzip vs the modular bundle's ~28KB
 * critical path) because all three variants ship together. For most
 * partner pages, this difference is invisible.
 */

import type { WidgetConfig } from "./types";
import { render as renderPlaylist } from "./variants/playlist";
import { render as renderNowPlayingCard } from "./variants/now-playing-card";
import { render as renderNowPlayingStrip } from "./variants/now-playing-strip";

type Variant = WidgetConfig["variant"];

const VARIANT_RENDERERS: Record<Variant, (mount: HTMLElement, config: WidgetConfig) => void> = {
  playlist: renderPlaylist,
  "now-playing-card": renderNowPlayingCard,
  "now-playing-strip": renderNowPlayingStrip,
};

/**
 * Capture the currently-executing <script> tag at module-eval time.
 * `document.currentScript` is only valid during synchronous script
 * execution; once we hand control to DOMContentLoaded or anything
 * async, it returns null. Capturing here lets the boot path still
 * reference our script even when boot runs later.
 *
 * Note: `defer` and `async` script attributes break this — the spec
 * makes currentScript null for those execution modes. Our generated
 * embed snippet doesn't include them; partner sites that add their
 * own defer/async lose script-shorthand auto-mount and need to use
 * the declarative pattern instead.
 */
const ownScript: HTMLScriptElement | null =
  document.currentScript instanceof HTMLScriptElement ? document.currentScript : null;

function parseConfig(el: HTMLElement): WidgetConfig | null {
  const station = el.dataset.station as WidgetConfig["station"] | undefined;
  const variant = el.dataset.variant as Variant | undefined;

  if (!station) {
    console.warn("[rmke-widget] missing data-station");
    return null;
  }
  if (!variant || !(variant in VARIANT_RENDERERS)) {
    console.warn(`[rmke-widget] unknown or missing data-variant: ${variant}`);
    return null;
  }

  return {
    station,
    variant,
    layout: (el.dataset.layout as WidgetConfig["layout"] | undefined) ?? "list",
    theme: (el.dataset.theme as WidgetConfig["theme"] | undefined) ?? "auto",
    maxItems: el.dataset.maxItems ? Number(el.dataset.maxItems) : undefined,
    showSearch: el.dataset.showSearch !== "false",
    showHeader: el.dataset.showHeader !== "false",
    showLoadMore: el.dataset.showLoadMore !== "false",
    enablePreview: el.dataset.enablePreview !== "false" && el.dataset.enableYoutube !== "false",
    enableDateSearch: el.dataset.enableDateSearch === "true",
    autoUpdate: el.dataset.autoUpdate !== "false",
    unlimitedSongs: el.dataset.unlimitedSongs === "true",
  };
}

const SHORTHAND_DATA_KEYS = [
  "station",
  "variant",
  "layout",
  "theme",
  "maxItems",
  "showSearch",
  "showHeader",
  "showLoadMore",
  "enablePreview",
  "enableYoutube",
  "enableDateSearch",
  "autoUpdate",
  "unlimitedSongs",
] as const;

/**
 * Locate every mount point — declarative div mounts already in the DOM,
 * plus the executing script tag itself if it has data-* attrs (the
 * shorthand pattern). The shorthand path is the *primary* reason this
 * legacy bundle exists, since document.currentScript actually works in
 * classic scripts (unlike ES modules where it's always null).
 */
function findMounts(): HTMLElement[] {
  const mounts: HTMLElement[] = [];

  document.querySelectorAll<HTMLElement>("[data-rmke-widget]").forEach((el) => mounts.push(el));

  if (ownScript && ownScript.dataset.station && ownScript.dataset.variant) {
    const host = document.createElement("div");
    host.dataset.rmkeWidget = "";
    for (const key of SHORTHAND_DATA_KEYS) {
      const v = ownScript.dataset[key];
      if (v != null) host.dataset[key] = v;
    }
    ownScript.parentNode?.insertBefore(host, ownScript.nextSibling);
    mounts.push(host);
  }

  return mounts;
}

function mountOne(host: HTMLElement): void {
  const config = parseConfig(host);
  if (!config) return;

  host.dataset.theme = config.theme ?? "auto";
  const shadow = host.attachShadow({ mode: "open" });
  const mount = document.createElement("div");
  mount.className = "rmke-root";
  shadow.appendChild(mount);

  try {
    VARIANT_RENDERERS[config.variant](mount, config);
  } catch (err) {
    mount.textContent = "This playlist isn't available right now.";
    console.error("[rmke-widget] render failed", err);
  }
}

function boot(): void {
  findMounts().forEach(mountOne);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
