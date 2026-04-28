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

/**
 * Read a `data-*` attribute resilient to whitespace-mangled attribute names.
 *
 * Some CMSes — Brightspot's HtmlModule observed 2026-04-28 on
 * `radio-milwaukee.prod.npr.psdops.com` — keep the attribute VALUE intact
 * but preserve leading whitespace from a multi-line embed snippet as part
 * of the attribute NAME. The result is a live-DOM attribute literally
 * named `"        data-station"` (eight spaces) that the standard
 * `dataset` / `getAttribute("data-station")` APIs cannot match.
 *
 * Trying `dataset` first keeps zero overhead on the well-formed path; the
 * attribute scan only runs when dataset misses, which matches the
 * mangled-CMS case. `key` is the camelCase form (same as `dataset`).
 */
function readDataAttr(el: HTMLElement, key: string): string | undefined {
  const fromDataset = el.dataset[key];
  if (fromDataset !== undefined) return fromDataset;

  const expected = "data-" + key.replace(/([A-Z])/g, "-$1").toLowerCase();
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.trim() === expected) return attr.value;
  }
  return undefined;
}

function parseConfig(el: HTMLElement): WidgetConfig | null {
  const station = readDataAttr(el, "station") as WidgetConfig["station"] | undefined;
  const variant = readDataAttr(el, "variant") as Variant | undefined;

  if (!station) {
    console.warn("[rmke-widget] missing data-station");
    return null;
  }
  if (!variant || !(variant in VARIANT_RENDERERS)) {
    console.warn(`[rmke-widget] unknown or missing data-variant: ${variant}`);
    return null;
  }

  const maxItemsRaw = readDataAttr(el, "maxItems");

  return {
    station,
    variant,
    layout: (readDataAttr(el, "layout") as WidgetConfig["layout"] | undefined) ?? "list",
    theme: (readDataAttr(el, "theme") as WidgetConfig["theme"] | undefined) ?? "auto",
    maxItems: maxItemsRaw ? Number(maxItemsRaw) : undefined,
    showSearch: readDataAttr(el, "showSearch") !== "false",
    showHeader: readDataAttr(el, "showHeader") !== "false",
    showLoadMore: readDataAttr(el, "showLoadMore") !== "false",
    enablePreview:
      readDataAttr(el, "enablePreview") !== "false" &&
      readDataAttr(el, "enableYoutube") !== "false",
    enableDateSearch: readDataAttr(el, "enableDateSearch") === "true",
    autoUpdate: readDataAttr(el, "autoUpdate") !== "false",
    unlimitedSongs: readDataAttr(el, "unlimitedSongs") === "true",
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

  if (ownScript) {
    const station = readDataAttr(ownScript, "station");
    const variant = readDataAttr(ownScript, "variant");
    if (station && variant) {
      const host = document.createElement("div");
      host.dataset.rmkeWidget = "";
      for (const key of SHORTHAND_DATA_KEYS) {
        const v = readDataAttr(ownScript, key);
        if (v != null) host.dataset[key] = v;
      }
      ownScript.parentNode?.insertBefore(host, ownScript.nextSibling);
      mounts.push(host);
    }
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
