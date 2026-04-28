"use client";

import { useMemo, useState } from "react";
import { buildPreviewUrl, configToDataAttrs } from "./types";
import type { WidgetConfig } from "./types";

type Tab = "javascript" | "iframe" | "url";

interface EmbedCodeTabsProps {
  readonly config: WidgetConfig;
  readonly widgetCdnBase: string;
}

const TABS: ReadonlyArray<{ readonly value: Tab; readonly label: string }> = [
  { value: "javascript", label: "JavaScript" },
  { value: "iframe", label: "Iframe" },
  { value: "url", label: "Embed URL" },
];

const IFRAME_HEIGHT_BY_VARIANT: Record<WidgetConfig["variant"], number> = {
  playlist: 720,
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
    return "Best UX. Real-time updates, shadow-DOM isolated, full feature set. Drop into any HTML page.";
  }
  if (tab === "iframe") {
    return "Use when the host page can't run third-party scripts (CMS limitations, security policies).";
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
  const iframeUrl = buildPreviewUrl(config, widgetCdnBase) ?? "";

  const dataAttrs = configToDataAttrs(config);
  const indented = dataAttrs.map(([k, v]) => `        ${k}="${v}"`).join("\n");
  const javascript = `<script type="module"
        src="${widgetJsUrl}"
${indented}></script>`;

  const iframeHeight = IFRAME_HEIGHT_BY_VARIANT[config.variant];
  const iframe = `<iframe src="${iframeUrl}"
        width="100%"
        height="${iframeHeight}"
        style="border: 0;"
        loading="lazy"
        title="Radio Milwaukee playlist widget"></iframe>`;

  return {
    javascript,
    iframe,
    url: iframeUrl,
  };
}
