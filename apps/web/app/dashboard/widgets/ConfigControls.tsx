"use client";

import { ConfigField, NumberField, SegmentedControl, Toggle } from "./primitives";
import type { Layout, WidgetConfig } from "./types";

interface ConfigControlsProps {
  readonly config: WidgetConfig;
  readonly onChange: <K extends keyof WidgetConfig>(key: K, value: WidgetConfig[K]) => void;
}

const LAYOUTS: ReadonlyArray<{ readonly value: Layout; readonly label: string }> = [
  { value: "list", label: "List" },
  { value: "grid", label: "Grid" },
];

export function ConfigControls({ config, onChange }: ConfigControlsProps) {
  if (config.variant === "playlist")
    return <PlaylistControls config={config} onChange={onChange} />;
  if (config.variant === "now-playing-card") {
    return <CardControls config={config} onChange={onChange} />;
  }
  return <StripControls config={config} onChange={onChange} />;
}

function PlaylistControls({ config, onChange }: ConfigControlsProps) {
  return (
    <>
      <ConfigField label="Layout">
        <SegmentedControl
          options={LAYOUTS}
          value={config.layout}
          onChange={(v) => onChange("layout", v)}
          ariaLabel="Playlist layout"
        />
      </ConfigField>

      <ConfigField label="Display">
        <div className="flex flex-col gap-2">
          <NumberField
            label="Max items"
            hint="How many tracks to fetch on initial load."
            value={config.maxItems}
            onChange={(v) => onChange("maxItems", v)}
            min={1}
            max={100}
          />
          <Toggle
            label="Unlimited songs"
            hint="Ignore Max items, paginate forever via Load More."
            checked={config.unlimitedSongs}
            onChange={(v) => onChange("unlimitedSongs", v)}
          />
          <Toggle
            label="Compact rows"
            hint="Smaller artwork, denser list."
            checked={config.compact}
            onChange={(v) => onChange("compact", v)}
          />
        </div>
      </ConfigField>

      <ConfigField label="Chrome">
        <div className="flex flex-col gap-2">
          <Toggle
            label="Show header"
            checked={config.showHeader}
            onChange={(v) => onChange("showHeader", v)}
          />
          <Toggle
            label="Show search"
            checked={config.showSearch}
            onChange={(v) => onChange("showSearch", v)}
          />
          <Toggle
            label="Enable date filter"
            hint="Adds a date picker to the search row."
            checked={config.enableDateSearch}
            onChange={(v) => onChange("enableDateSearch", v)}
            disabled={!config.showSearch}
          />
          <Toggle
            label="Show Load More"
            checked={config.showLoadMore}
            onChange={(v) => onChange("showLoadMore", v)}
          />
        </div>
      </ConfigField>

      <ConfigField label="Behavior">
        <div className="flex flex-col gap-2">
          <Toggle
            label="Audio preview"
            hint="30-second clips on each row when available."
            checked={config.enablePreview}
            onChange={(v) => onChange("enablePreview", v)}
          />
          <Toggle
            label="Auto update"
            hint="Live-refresh as new songs play."
            checked={config.autoUpdate}
            onChange={(v) => onChange("autoUpdate", v)}
          />
        </div>
      </ConfigField>
    </>
  );
}

function CardControls({ config, onChange }: ConfigControlsProps) {
  return (
    <ConfigField label="Behavior">
      <div className="flex flex-col gap-2">
        <Toggle
          label="Audio preview"
          hint="30-second clip of the current track."
          checked={config.enablePreview}
          onChange={(v) => onChange("enablePreview", v)}
        />
        <Toggle
          label="Auto update"
          hint="Live-refresh when the song changes."
          checked={config.autoUpdate}
          onChange={(v) => onChange("autoUpdate", v)}
        />
      </div>
    </ConfigField>
  );
}

function StripControls({ config, onChange }: ConfigControlsProps) {
  return (
    <ConfigField label="Behavior">
      <Toggle
        label="Auto update"
        hint="Live-refresh when the song changes."
        checked={config.autoUpdate}
        onChange={(v) => onChange("autoUpdate", v)}
      />
    </ConfigField>
  );
}
