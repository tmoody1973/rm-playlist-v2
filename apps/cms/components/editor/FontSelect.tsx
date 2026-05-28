"use client";

import { useEffect, useRef, useState } from "react";
import { FONT_OPTIONS, findFontByStack } from "@/lib/fonts";

/**
 * Font picker with per-option live preview. A native <select> can't do this —
 * browsers render <option> text in the system font regardless of CSS — so this
 * is a small custom listbox: each row renders its own label in its own face,
 * and the trigger button shows the current selection in that face too.
 *
 * Value is the CSS font stack stored in tokens.font; an unmatched value (a
 * legacy free-text font) is preserved as a "Custom (current)" row so picking
 * never silently drops it.
 */
export function FontSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (stack: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const matched = findFontByStack(value);
  const options = matched
    ? FONT_OPTIONS
    : [
        { id: "__custom", label: "Custom (current)", stack: value, category: "sans" as const },
        ...FONT_OPTIONS,
      ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-md border border-neutral-300 px-3 py-2 text-left text-base"
        style={{ fontFamily: value }}
      >
        <span className="truncate">{matched?.label ?? "Custom"}</span>
        <span className="ml-2 text-neutral-400" style={{ fontFamily: "system-ui" }}>
          ▾
        </span>
      </button>
      {open && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg">
          {options.map((f) => {
            const selected = f.stack === value;
            return (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(f.stack);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-neutral-50 ${
                    selected ? "bg-neutral-100" : ""
                  }`}
                  style={{ fontFamily: f.stack }}
                >
                  <span className="truncate text-base">{f.label}</span>
                  <span className="shrink-0 text-sm text-neutral-500">Aa Gg 123</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
