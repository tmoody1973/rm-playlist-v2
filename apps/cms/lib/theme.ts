import type { CSSProperties } from "react";

/**
 * Resolved theme tokens — the shape `pages.getPublishedPage` returns after
 * applying the theme cascade server-side. Kept in sync with the `themes.tokens`
 * Convex validator (packages/convex/convex/schema.ts).
 */
export type ThemeTokens = {
  colorPrimary: string;
  colorBg: string;
  colorCard: string;
  colorAccent: string;
  colorText: string;
  font: string;
  radius: string;
};

/**
 * The five color tokens that are page-overridable + editable as color pickers.
 * Font and radius stay preset-only (managed in /admin/themes), so they're not
 * here. Single source of truth shared by the theme manager form, the page
 * editor's override controls, and the live-preview resolver.
 */
export const COLOR_TOKEN_FIELDS = [
  { key: "colorPrimary", label: "Primary" },
  { key: "colorBg", label: "Background" },
  { key: "colorCard", label: "Card" },
  { key: "colorAccent", label: "Accent" },
  { key: "colorText", label: "Text" },
] as const satisfies readonly { key: keyof ThemeTokens; label: string }[];

export type ColorTokenKey = (typeof COLOR_TOKEN_FIELDS)[number]["key"];

/** Page-level token overrides — a subset of the color tokens. */
export type ThemeOverrides = Partial<Record<ColorTokenKey, string>>;

/**
 * Client-side mirror of the render cascade's override step, for live preview as
 * staff edit. Layers non-empty page overrides over a base theme's tokens. The
 * authoritative resolution still happens server-side in pages.resolveThemeTokens.
 */
export function applyOverrides(base: ThemeTokens, overrides?: ThemeOverrides | null): ThemeTokens {
  if (!overrides) return base;
  const nonEmpty = Object.fromEntries(
    Object.entries(overrides).filter(([, val]) => typeof val === "string" && val.length > 0),
  );
  return { ...base, ...nonEmpty };
}

/**
 * Emit resolved tokens as CSS custom properties on a page wrapper. Block
 * components read these (`var(--rm-color-accent)`, ...) so a single themed
 * wrapper drives the whole page — no per-block prop drilling.
 */
export function tokensToCssVars(tokens: ThemeTokens): CSSProperties {
  return {
    "--rm-color-primary": tokens.colorPrimary,
    "--rm-color-bg": tokens.colorBg,
    "--rm-color-card": tokens.colorCard,
    "--rm-color-accent": tokens.colorAccent,
    "--rm-color-text": tokens.colorText,
    "--rm-font": tokens.font,
    "--rm-radius": tokens.radius,
  } as CSSProperties;
}
