"use client";

import { useMemo, useState } from "react";

type Variant = "playlist" | "now-playing-card" | "now-playing-strip";
type Theme = "auto" | "light" | "dark";

interface Station {
  readonly _id: string;
  readonly slug: string;
  readonly name: string;
  readonly embedSlug: string;
  readonly tagline?: string;
}

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

const PREVIEW_HEIGHT_BY_VARIANT: Record<Variant, number> = {
  playlist: 720,
  "now-playing-card": 320,
  "now-playing-strip": 96,
};

export function WidgetsClient({ stations, widgetCdnBase }: WidgetsClientProps) {
  const firstStation = stations[0];
  const [variant, setVariant] = useState<Variant>("playlist");
  const [stationSlug, setStationSlug] = useState<string>(firstStation?.embedSlug ?? "");
  const [theme, setTheme] = useState<Theme>("auto");

  const previewSrc = useMemo(() => {
    if (!stationSlug) return null;
    const url = new URL(`${widgetCdnBase}/iframe.html`);
    url.searchParams.set("station", stationSlug);
    url.searchParams.set("variant", variant);
    url.searchParams.set("theme", theme);
    return url.toString();
  }, [widgetCdnBase, stationSlug, variant, theme]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
      <section
        aria-label="Widget configuration"
        className="flex flex-col gap-5 rounded-md border border-border bg-bg-surface p-5"
      >
        <ConfigField label="Widget type">
          <SegmentedControl
            options={VARIANTS}
            value={variant}
            onChange={setVariant}
            ariaLabel="Widget variant"
          />
        </ConfigField>

        <ConfigField label="Station">
          <StationPicker stations={stations} value={stationSlug} onChange={setStationSlug} />
        </ConfigField>

        <ConfigField label="Theme">
          <SegmentedControl
            options={THEMES}
            value={theme}
            onChange={setTheme}
            ariaLabel="Widget theme"
          />
        </ConfigField>
      </section>

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
        <PreviewFrame src={previewSrc} height={PREVIEW_HEIGHT_BY_VARIANT[variant]} />
      </section>
    </div>
  );
}

function ConfigField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span
        className="text-xs uppercase tracking-wider text-text-muted"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-md border border-border bg-bg-base p-1"
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={
              "rounded px-3 py-1.5 text-sm transition-colors duration-[var(--dur-micro)] " +
              (selected
                ? "bg-bg-elevated text-text-primary"
                : "text-text-muted hover:text-text-primary")
            }
          >
            {opt.label}
          </button>
        );
      })}
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
