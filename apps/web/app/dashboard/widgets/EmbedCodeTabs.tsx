"use client";

import { useMemo, useState } from "react";
import { buildPreviewUrl, configToDataAttrs } from "./types";
import type { WidgetConfig } from "./types";

type Tab = "javascript" | "classic" | "iframe" | "url";

interface EmbedCodeTabsProps {
  readonly config: WidgetConfig;
  readonly widgetCdnBase: string;
}

const TABS: ReadonlyArray<{ readonly value: Tab; readonly label: string }> = [
  { value: "javascript", label: "JavaScript" },
  { value: "classic", label: "Classic Script" },
  { value: "iframe", label: "Iframe" },
  { value: "url", label: "Embed URL" },
];

const NON_PLAYLIST_IFRAME_HEIGHT: Record<Exclude<WidgetConfig["variant"], "playlist">, number> = {
  "now-playing-card": 320,
  "now-playing-strip": 96,
};

export function EmbedCodeTabs({ config, widgetCdnBase }: EmbedCodeTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("javascript");

  const snippets = useMemo(() => buildSnippets(config, widgetCdnBase), [config, widgetCdnBase]);
  const activeSnippet = snippets[activeTab];

  return (
    <section
      aria-label="Embed code"
      className="flex flex-col gap-3 rounded-md border border-border bg-bg-surface p-5"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Embed code</h2>
        <CopyButton text={activeSnippet} />
      </header>

      <div
        role="tablist"
        aria-label="Embed format"
        className="grid auto-cols-fr grid-flow-col gap-1 rounded-md border border-border bg-bg-base p-1"
      >
        {TABS.map((tab) => {
          const selected = tab.value === activeTab;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveTab(tab.value)}
              className={
                "rounded px-3 py-1.5 text-sm transition-colors duration-[var(--dur-micro)] " +
                (selected
                  ? "bg-bg-elevated text-text-primary"
                  : "text-text-muted hover:text-text-primary")
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <pre
        className="overflow-x-auto rounded-md border border-border bg-bg-base p-3 text-xs leading-relaxed text-text-primary"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        <code>{activeSnippet}</code>
      </pre>

      <p className="text-xs text-text-muted">{describeTab(activeTab)}</p>
    </section>
  );
}

function describeTab(tab: Tab): string {
  if (tab === "javascript") {
    return "Best UX. Real-time updates, shadow-DOM isolated, full feature set. Drop into any modern HTML page (Elementor, Webflow, hand-coded sites).";
  }
  if (tab === "classic") {
    return "For older CMSes that strip type=module (Grove CMS, older WordPress, Joomla). Same widget, slightly larger bundle (~31KB gzip vs 28KB for the modern path), single script tag — no marker div needed.";
  }
  if (tab === "iframe") {
    return "Universal fallback. Use when the host blocks third-party scripts entirely (some Squarespace plans, locked-down enterprise editors).";
  }
  return "Just the iframe URL — useful for sharing previews or testing.";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard API unavailable — silently no-op rather than break.
        }
      }}
      className="rounded-md border border-border bg-bg-base px-3 py-1.5 text-xs font-medium text-text-primary transition-colors duration-[var(--dur-micro)] hover:border-accent-cta hover:text-accent-cta"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function buildSnippets(config: WidgetConfig, widgetCdnBase: string): Record<Tab, string> {
  const widgetJsUrl = `${widgetCdnBase}/widget.js`;
  const widgetLegacyJsUrl = `${widgetCdnBase}/widget-legacy.js`;
  const iframeUrl = buildPreviewUrl(config, widgetCdnBase) ?? "";

  const dataAttrs = configToDataAttrs(config);

  // JavaScript (modern, ES module): declarative pattern (marker div +
  // script) per industry standard (Twitter, Mastodon, Disqus). Required
  // because document.currentScript is null inside ES modules per spec,
  // so script-shorthand can't auto-create a host div for module scripts.
  //
  // Both snippets emit attributes inline on a single tag rather than
  // line-broken — Brightspot's HtmlModule (and other strict CMSes)
  // preserve leading whitespace as part of attribute names when they
  // re-render multi-line embeds, breaking `dataset` lookups. Single-line
  // sidesteps the issue entirely; the loaders also tolerate the mangled
  // form as a defense-in-depth fallback.
  const divAttrs = dataAttrs.map(([k, v]) => `${k}="${v}"`).join(" ");
  const javascript = `<div data-rmke-widget ${divAttrs}></div>
<script type="module" src="${widgetJsUrl}"></script>`;

  // Classic Script (legacy, IIFE): script-shorthand pattern works here
  // because document.currentScript is valid in non-deferred classic
  // scripts. One tag, data-* attrs on the script itself, NPR-style.
  const scriptAttrs = dataAttrs.map(([k, v]) => `${k}="${v}"`).join(" ");
  const classic = `<script src="${widgetLegacyJsUrl}" ${scriptAttrs}></script>`;

  const iframeHeight =
    config.variant === "playlist" ? config.height : NON_PLAYLIST_IFRAME_HEIGHT[config.variant];
  const iframe = `<iframe src="${iframeUrl}"
        width="100%"
        height="${iframeHeight}"
        style="border: 0;"
        loading="lazy"
        title="Radio Milwaukee playlist widget"></iframe>`;

  return {
    javascript,
    classic,
    iframe,
    url: iframeUrl,
  };
}
