"use client";

import { RichTextEditor } from "./RichTextEditor";

function rec(config: unknown): Record<string, unknown> {
  return config !== null && typeof config === "object" ? (config as Record<string, unknown>) : {};
}
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function numOrEmpty(value: unknown): number | "" {
  return typeof value === "number" ? value : "";
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-neutral-500">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-neutral-300 px-3 py-2"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | "";
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-neutral-500">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28 rounded-md border border-neutral-300 px-3 py-2"
      />
    </label>
  );
}

type CtaButton = { label: string; href: string; variant?: "primary" | "secondary" };

function ctaButtons(config: unknown): CtaButton[] {
  const raw = rec(config).buttons;
  if (!Array.isArray(raw)) return [];
  return raw.map((b) => {
    const r = rec(b);
    return {
      label: str(r.label),
      href: str(r.href),
      variant: r.variant === "secondary" ? "secondary" : "primary",
    };
  });
}

/**
 * Per-block-type config form. Receives the block's `config` (loosely typed
 * during editing) and emits a new config object on every change.
 */
export function BlockForm({
  type,
  config,
  onChange,
}: {
  type: string;
  config: unknown;
  onChange: (config: unknown) => void;
}) {
  const c = rec(config);

  switch (type) {
    case "hero": {
      const cta = rec(c.cta);
      const ctaLabel = str(cta.label);
      const setCta = (label: string, href: string) =>
        onChange({ ...c, cta: label.length > 0 ? { label, href } : undefined });
      return (
        <div className="flex flex-col gap-3">
          <TextField
            label="Title"
            value={str(c.title)}
            onChange={(v) => onChange({ ...c, title: v })}
          />
          <TextField
            label="Subtitle"
            value={str(c.subtitle)}
            onChange={(v) => onChange({ ...c, subtitle: v })}
          />
          <TextField
            label="Background image URL"
            value={str(c.backgroundImageUrl)}
            onChange={(v) => onChange({ ...c, backgroundImageUrl: v.length > 0 ? v : undefined })}
          />
          <div className="flex flex-wrap gap-3">
            <TextField
              label="Button label"
              value={ctaLabel}
              onChange={(v) => setCta(v, str(cta.href))}
            />
            <TextField
              label="Button link"
              value={str(cta.href)}
              onChange={(v) => setCta(ctaLabel, v)}
            />
          </div>
        </div>
      );
    }
    case "rich-text":
      return (
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-500">Content</span>
          <RichTextEditor value={c.doc} onChange={(doc) => onChange({ doc })} />
        </div>
      );
    case "image":
      return (
        <div className="flex flex-col gap-3">
          <TextField
            label="Image URL"
            value={str(c.url)}
            onChange={(v) => onChange({ ...c, url: v })}
          />
          <TextField
            label="Alt text"
            value={str(c.alt)}
            onChange={(v) => onChange({ ...c, alt: v })}
          />
          <TextField
            label="Caption"
            value={str(c.caption)}
            onChange={(v) => onChange({ ...c, caption: v.length > 0 ? v : undefined })}
          />
          <TextField
            label="Link (optional)"
            value={str(c.href)}
            onChange={(v) => onChange({ ...c, href: v.length > 0 ? v : undefined })}
          />
        </div>
      );
    case "cta": {
      const buttons = ctaButtons(config);
      const setButtons = (next: CtaButton[]) => onChange({ ...c, buttons: next });
      return (
        <div className="flex flex-col gap-3">
          {buttons.map((b, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <TextField
                label="Label"
                value={b.label}
                onChange={(v) =>
                  setButtons(buttons.map((x, j) => (j === i ? { ...x, label: v } : x)))
                }
              />
              <TextField
                label="Link"
                value={b.href}
                onChange={(v) =>
                  setButtons(buttons.map((x, j) => (j === i ? { ...x, href: v } : x)))
                }
              />
              <button
                type="button"
                onClick={() => setButtons(buttons.filter((_, j) => j !== i))}
                className="rounded-md border border-neutral-300 px-2 py-2 text-sm"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setButtons([...buttons, { label: "Button", href: "#" }])}
            className="self-start rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          >
            Add button
          </button>
        </div>
      );
    }
    case "playlist":
    case "touring":
      return (
        <NumberField
          label="Items to show"
          value={numOrEmpty(c.limit)}
          onChange={(v) => onChange({ ...c, limit: v })}
        />
      );
    case "upcoming-events":
      return (
        <div className="flex flex-wrap gap-3">
          <NumberField
            label="Items to show"
            value={numOrEmpty(c.limit)}
            onChange={(v) => onChange({ ...c, limit: v })}
          />
          <TextField
            label="Region (city, optional)"
            value={str(c.region)}
            onChange={(v) => onChange({ ...c, region: v.length > 0 ? v : undefined })}
          />
        </div>
      );
    case "fundraiser-progress":
      return (
        <div className="flex flex-wrap gap-3">
          <NumberField
            label="Goal"
            value={numOrEmpty(c.goal)}
            onChange={(v) => onChange({ ...c, goal: v })}
          />
          <NumberField
            label="Raised"
            value={numOrEmpty(c.raised)}
            onChange={(v) => onChange({ ...c, raised: v })}
          />
          <TextField
            label="Donate link"
            value={str(c.donateHref)}
            onChange={(v) => onChange({ ...c, donateHref: v })}
          />
        </div>
      );
    default:
      return <p className="text-sm text-neutral-400">No settings for this block.</p>;
  }
}
