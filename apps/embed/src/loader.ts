/**
 * rm-playlist-v2 widget loader.
 *
 * Partner stations drop a single <script> tag on their page; this file
 * discovers every widget mount point (either <script data-*> or a
 * <div data-rmke-widget data-*>), creates a shadow root per mount, and
 * dynamically imports the right variant chunk.
 *
 * Bundle target: ~5KB gzip (loader only, no variant code). Variants
 * are code-split and lazy-loaded.
 *
 * Usage patterns (DESIGN.md integration modes):
 *
 *   <!-- 1. Script-attribute shorthand — the most common partner case -->
 *   <script type="module"
 *           src="https://embed.radiomilwaukee.org/v1/widget.js"
 *           data-station="hyfin"
 *           data-variant="now-playing-card"></script>
 *
 *   <!-- 2. Declarative div + one script per page -->
 *   <div data-rmke-widget
 *        data-station="rhythmlab"
 *        data-variant="playlist"
 *        data-layout="list"></div>
 *   <script type="module" src=".../v1/widget.js"></script>
 *
 *   <!-- 3. Programmatic API (wired in Week 4+, not in Milestone 7) -->
 *
 * `type="module"` is REQUIRED. The loader uses ES dynamic imports with
 * `import.meta.url` for base-URL resolution of the code-split chunks, so
 * a classic `<script>` tag would fail to parse. Modules are also implicit-
 * async, so the `async` attribute is redundant and omitted.
 */

import type { WidgetConfig } from "./types";

type Variant = WidgetConfig["variant"];
type VariantModule = { render: (mount: HTMLElement, config: WidgetConfig) => void };

/**
 * Lazy chunk map. Vite code-splits each import() into its own chunk so a
 * partner loading the now-playing-strip never ships the playlist chunk's
 * search + tabs + carousel code. `playlist` still points at the stub —
 * the V1 carry-forward lands in a separate milestone.
 */
const VARIANT_LOADERS: Record<Variant, () => Promise<VariantModule>> = {
  playlist: () => import("./variants/playlist"),
  "now-playing-card": () => import("./variants/now-playing-card"),
  "now-playing-strip": () => import("./variants/now-playing-strip"),
};

function parseConfig(el: HTMLElement): WidgetConfig | null {
  const station = el.dataset.station as WidgetConfig["station"] | undefined;
  const variant = el.dataset.variant as Variant | undefined;

  if (!station) {
    console.warn("[rmke-widget] missing data-station");
    return null;
  }
  if (!variant || !(variant in VARIANT_LOADERS)) {
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

/** Find every mount point on the page. */
function findMounts(): HTMLElement[] {
  const mounts: HTMLElement[] = [];

  // 1. Declarative div mounts
  document.querySelectorAll<HTMLElement>("[data-rmke-widget]").forEach((el) => mounts.push(el));

  // 2. The <script> tag itself, if it has the data-* attributes (shorthand)
  const current = document.currentScript;
  if (current instanceof HTMLScriptElement && current.dataset.station && current.dataset.variant) {
    // Create a sibling div right after the script tag to host the widget.
    const host = document.createElement("div");
    host.dataset.rmkeWidget = "";
    for (const key of [
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
    ]) {
      const v = current.dataset[key];
      if (v != null) host.dataset[key] = v;
    }
    current.parentNode?.insertBefore(host, current.nextSibling);
    mounts.push(host);
  }

  return mounts;
}

async function mountOne(host: HTMLElement): Promise<void> {
  const config = parseConfig(host);
  if (!config) return;

  // Always reflect the resolved theme onto the host so the shadow's
  // `:host([data-theme="..."])` selectors match — the config defaults to
  // "auto" when the partner omits `data-theme`, so we must set it
  // explicitly here rather than relying on attribute presence.
  host.dataset.theme = config.theme ?? "auto";

  // Shadow DOM isolates our CSS from the host page. Host-page theming
  // still pierces via CSS custom properties — see DESIGN.md widget mode B.
  const shadow = host.attachShadow({ mode: "open" });
  const mount = document.createElement("div");
  mount.className = "rmke-root";
  shadow.appendChild(mount);

  try {
    const module = await VARIANT_LOADERS[config.variant]();
    module.render(mount, config);
  } catch (err) {
    // Graceful degradation per DESIGN.md state matrix — the widget shows
    // a single polite error, never a broken-looking stack.
    mount.textContent = "This playlist isn't available right now.";
    console.error("[rmke-widget] variant load failed", err);
  }
}

// Boot — run once after DOM is ready.
function boot() {
  findMounts().forEach((host) => {
    void mountOne(host);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
