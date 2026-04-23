import { render as preactRender, h } from "preact";
import type { WidgetConfig } from "../types";

/**
 * Milestone 7 stub — the full `playlist` widget variant ships in Week 4+
 * per docs/implementation/001-week-1-2-scaffold.md. This stub exists so
 * that partner stations can put the <script> tag on their site today and
 * verify the end-to-end CDN path (DNS → Cloudflare Pages → loader
 * → variant chunk → shadow DOM → render).
 *
 * The stub respects the same integration contract the real widget will:
 *   - receives a WidgetConfig
 *   - mounts into a shadow-DOM root supplied by the loader
 *   - inherits host-page typography + color via CSS custom properties
 *   - renders a visible-but-calm placeholder, not a broken-looking error
 */

interface StubProps {
  config: WidgetConfig;
}

function Stub({ config }: StubProps) {
  return (
    <div class="rmke-stub">
      <style>{STYLE}</style>
      <span class="rmke-stub__badge">rm-playlist-v2 · preview</span>
      <div class="rmke-stub__body">
        <strong>{stationLabel(config.station)}</strong>
        <span class="rmke-stub__variant">
          {config.variant}
          {config.variant === "playlist" ? ` (${config.layout ?? "list"})` : ""}
        </span>
      </div>
      <span class="rmke-stub__note">Playlist widget goes live Week 4.</span>
    </div>
  );
}

function stationLabel(slug: WidgetConfig["station"]): string {
  return {
    hyfin: "HYFIN",
    "88nine": "88Nine",
    "414music": "414 Music",
    rhythmlab: "Rhythm Lab",
  }[slug];
}

/**
 * Stub styles. Inside a shadow root so host-page CSS can't clobber us,
 * host `--rmke-*` custom properties can still pierce in for theming.
 * Matches DESIGN.md widget mode B (host-native, NPR-adjacent).
 */
const STYLE = `
  :host {
    display: block;
  }
  .rmke-stub {
    font-family: var(--rmke-font-body, inherit);
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px 20px;
    border: 1px solid var(--rmke-border, #e8e5de);
    border-radius: 8px;
    background: var(--rmke-bg, #f7f3ee);
    color: var(--rmke-text, #1a1a1a);
    max-width: 440px;
  }
  .rmke-stub__badge {
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--rmke-muted, #94989e);
  }
  .rmke-stub__body {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .rmke-stub__body strong {
    font-size: 16px;
    font-weight: 600;
  }
  .rmke-stub__variant {
    font-family: var(--rmke-font-mono, ui-monospace, monospace);
    font-size: 12px;
    color: var(--rmke-secondary, #6b6e73);
  }
  .rmke-stub__note {
    font-size: 12px;
    color: var(--rmke-muted, #94989e);
  }
`;

export function render(mount: HTMLElement, config: WidgetConfig): void {
  preactRender(h(Stub, { config }), mount);
}
