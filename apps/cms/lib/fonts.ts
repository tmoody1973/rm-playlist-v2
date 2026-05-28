/**
 * Curated font catalog for the theme `font` token (Phase 4 font picker).
 *
 * Each font here is loaded once in app/layout.tsx — General Sans via the
 * Fontshare stylesheet, the rest self-hosted via next/font/google as CSS
 * variables. The `stack` is exactly what gets stored in `themes.tokens.font`
 * and emitted as `--rm-font`, so picking an option is backward-compatible with
 * the free-text values seeded earlier (General Sans matches verbatim).
 *
 * Adding/removing a face is a deliberate code change: add the next/font import +
 * variable in layout.tsx and a row here. (Admin-managed lists and Canva-style
 * uploads are a considered fast-follow — see design notes.)
 */
export type FontOption = {
  id: string;
  label: string;
  /** CSS font-family stack stored in tokens.font. */
  stack: string;
  /** Rough classification, for grouping/labelling in the picker. */
  category: "sans" | "serif" | "display" | "mono";
};

const SANS_FALLBACK = "ui-sans-serif, system-ui, sans-serif";
const SERIF_FALLBACK = "Georgia, Cambria, serif";
const MONO_FALLBACK = "ui-monospace, SFMono-Regular, monospace";

export const FONT_OPTIONS: FontOption[] = [
  {
    id: "general-sans",
    label: "General Sans",
    stack: `"General Sans", ${SANS_FALLBACK}`,
    category: "sans",
  },
  { id: "geist", label: "Geist", stack: `var(--font-sans), ${SANS_FALLBACK}`, category: "sans" },
  { id: "inter", label: "Inter", stack: `var(--font-inter), ${SANS_FALLBACK}`, category: "sans" },
  {
    id: "manrope",
    label: "Manrope",
    stack: `var(--font-manrope), ${SANS_FALLBACK}`,
    category: "sans",
  },
  {
    id: "space-grotesk",
    label: "Space Grotesk",
    stack: `var(--font-space-grotesk), ${SANS_FALLBACK}`,
    category: "display",
  },
  { id: "sora", label: "Sora", stack: `var(--font-sora), ${SANS_FALLBACK}`, category: "display" },
  {
    id: "archivo",
    label: "Archivo",
    stack: `var(--font-archivo), ${SANS_FALLBACK}`,
    category: "display",
  },
  {
    id: "fraunces",
    label: "Fraunces",
    stack: `var(--font-fraunces), ${SERIF_FALLBACK}`,
    category: "serif",
  },
  {
    id: "source-serif",
    label: "Source Serif 4",
    stack: `var(--font-source-serif), ${SERIF_FALLBACK}`,
    category: "serif",
  },
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    stack: `var(--font-jetbrains-mono), ${MONO_FALLBACK}`,
    category: "mono",
  },
];

export function findFontByStack(stack: string): FontOption | undefined {
  return FONT_OPTIONS.find((f) => f.stack === stack);
}
