"use client";

import { useMemo, useState } from "react";
import { ConfigControls } from "./ConfigControls";
import { EmbedCodeTabs } from "./EmbedCodeTabs";
import { ConfigField, SegmentedControl, VerticalPicker } from "./primitives";
import {
  buildPreviewUrl,
  DEFAULT_CONFIG,
  PREVIEW_HEIGHT_BY_VARIANT,
  type Station,
  type Theme,
  type Variant,
  type WidgetConfig,
} from "./types";

interface WidgetsClientProps {
  readonly stations: ReadonlyArray<Station>;
  readonly widgetCdnBase: string;
}

const VARIANTS: ReadonlyArray<{ readonly value: Variant; readonly label: string }> = [
  { value: "playlist", label: "Playlist" },
  { value: "now-playing-card", label: "Now Playing Card" },
  { value: "now-playing-strip", label: "Now Playing Strip" },
];

const THEMES: ReadonlyArray<{ readonly value: Theme; readonly label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function WidgetsClient({ stations, widgetCdnBase }: WidgetsClientProps) {
  const firstStation = stations[0];
  const [config, setConfig] = useState<WidgetConfig>({
    ...DEFAULT_CONFIG,
    stationSlug: firstStation?.embedSlug ?? "",
  });

  const updateConfig = <K extends keyof WidgetConfig>(key: K, value: WidgetConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const previewSrc = useMemo(() => buildPreviewUrl(config, widgetCdnBase), [config, widgetCdnBase]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
      <section
        aria-label="Widget configuration"
        className="flex flex-col gap-5 rounded-md border border-border bg-bg-surface p-5"
      >
        <ConfigField label="Widget type">
          <VerticalPicker
            options={VARIANTS}
            value={config.variant}
            onChange={(v) => updateConfig("variant", v)}
            ariaLabel="Widget variant"
          />
        </ConfigField>

        <ConfigField label="Station">
          <StationPicker
            stations={stations}
            value={config.stationSlug}
            onChange={(slug) => updateConfig("stationSlug", slug)}
          />
        </ConfigField>

        <ConfigField label="Theme">
          <SegmentedControl
            options={THEMES}
            value={config.theme}
            onChange={(v) => updateConfig("theme", v)}
            ariaLabel="Widget theme"
          />
        </ConfigField>

        <ConfigControls config={config} onChange={updateConfig} />
      </section>

      <div className="flex flex-col gap-6">
        <section
          aria-label="Live preview"
          className="flex min-h-0 flex-col gap-2 rounded-md border border-border bg-bg-surface p-5"
        >
          <header className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight">Preview</h2>
            <span style={{ fontFamily: "var(--font-mono)" }} className="text-xs text-text-muted">
              live
            </span>
          </header>
          <PreviewFrame src={previewSrc} height={PREVIEW_HEIGHT_BY_VARIANT[config.variant]} />
        </section>

        <EmbedCodeTabs config={config} widgetCdnBase={widgetCdnBase} />
      </div>
    </div>
  );
}

function StationPicker({
  stations,
  value,
  onChange,
}: {
  stations: ReadonlyArray<Station>;
  value: string;
  onChange: (slug: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Station" className="flex flex-col gap-1.5">
      {stations.map((station) => {
        const selected = station.embedSlug === value;
        return (
          <button
            key={station._id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(station.embedSlug)}
            className={
              "flex items-center justify-between rounded-md border px-3 py-2 text-left transition-colors duration-[var(--dur-micro)] " +
              (selected
                ? "border-accent-cta bg-bg-elevated"
                : "border-border bg-bg-base hover:border-[color-mix(in_oklab,var(--border)_50%,var(--text-muted))]")
            }
          >
            <span className="text-sm font-medium">{station.name}</span>
            <span style={{ fontFamily: "var(--font-mono)" }} className="text-xs text-text-muted">
              {station.embedSlug}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PreviewFrame({ src, height }: { src: string | null; height: number }) {
  if (!src) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-border bg-bg-base p-6 text-sm text-text-muted"
        style={{ minHeight: height }}
      >
        Select a station to load the preview.
      </div>
    );
  }
  return (
    <iframe
      key={src}
      src={src}
      title="Widget preview"
      className="w-full rounded-md border border-border bg-bg-base"
      style={{ height }}
      loading="lazy"
      sandbox="allow-scripts allow-same-origin"
    />
  );
}
