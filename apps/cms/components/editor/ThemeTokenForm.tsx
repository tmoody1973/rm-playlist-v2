"use client";

import { COLOR_TOKEN_FIELDS } from "@/lib/theme";
import type { ThemeTokens } from "@/lib/theme";
import { FontSelect } from "./FontSelect";

/**
 * Edit a full theme token set — color pickers for the five color tokens, a
 * font picker with live preview, and a radius text input. Used by the theme
 * manager (Phase 4) for both creating and editing presets. Controlled: parent
 * owns `value`.
 */
export function ThemeTokenForm({
  value,
  onChange,
}: {
  value: ThemeTokens;
  onChange: (next: ThemeTokens) => void;
}) {
  const set = (key: keyof ThemeTokens, v: string) => onChange({ ...value, [key]: v });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {COLOR_TOKEN_FIELDS.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input
              type="color"
              value={value[key]}
              onChange={(e) => set(key, e.target.value)}
              className="h-8 w-10 cursor-pointer rounded border border-neutral-300"
              aria-label={label}
            />
            <span className="w-20 text-neutral-500">{label}</span>
            <input
              type="text"
              value={value[key]}
              onChange={(e) => set(key, e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 font-mono text-xs"
            />
          </label>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-500">Font</span>
          <FontSelect value={value.font} onChange={(font) => set("font", font)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-500">Radius</span>
          <input
            type="text"
            value={value.radius}
            onChange={(e) => set("radius", e.target.value)}
            placeholder="12px"
            className="rounded-md border border-neutral-300 px-2 py-1 font-mono text-xs"
          />
        </label>
      </div>
    </div>
  );
}
