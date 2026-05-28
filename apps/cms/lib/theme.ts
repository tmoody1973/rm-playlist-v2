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
