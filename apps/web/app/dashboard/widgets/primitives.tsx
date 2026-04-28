"use client";

import type { ReactNode } from "react";

export function ConfigField({ label, children }: { label: string; children: ReactNode }) {
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

export function SegmentedControl<T extends string>({
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

export function VerticalPicker<T extends string>({
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
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-col gap-1.5">
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
              "rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors duration-[var(--dur-micro)] " +
              (selected
                ? "border-accent-cta bg-bg-elevated"
                : "border-border bg-bg-base hover:border-[color-mix(in_oklab,var(--border)_50%,var(--text-muted))]")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        "flex w-full items-center justify-between gap-3 rounded-md border border-border bg-bg-base px-3 py-2 text-left transition-colors duration-[var(--dur-micro)] " +
        (disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:border-[color-mix(in_oklab,var(--border)_50%,var(--text-muted))]")
      }
    >
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-text-muted">{hint}</span>}
      </span>
      <span
        className={
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-[var(--dur-micro)] " +
          (checked ? "bg-accent-cta" : "bg-bg-elevated")
        }
      >
        <span
          className={
            "inline-block h-4 w-4 rounded-full bg-bg-surface shadow transition-transform duration-[var(--dur-micro)] " +
            (checked ? "translate-x-[18px]" : "translate-x-0.5")
          }
        />
      </span>
    </button>
  );
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-text-muted">{hint}</span>}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const next = Number(e.currentTarget.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        className="rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-cta"
        style={{ fontFamily: "var(--font-mono)" }}
      />
    </label>
  );
}
