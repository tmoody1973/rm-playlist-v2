import { z } from "zod";

/**
 * Block catalog for the Station Microsites CMS (design doc 005).
 *
 * Each stored block is `{ id, type, config }` with `config` persisted as
 * `v.any()` in Convex. Here we validate config per block type with a Zod
 * discriminated-by-`type` parser so the renderer (and, in Phase 3, the admin
 * write path) get type-safe, runtime-checked configs. A malformed block is
 * skipped rather than crashing the page — public pages read DB rows we treat
 * as a system boundary.
 *
 * Phase 1 implements the content blocks below. Live-data blocks
 * (now-playing, playlist, ...) are recognized but render a placeholder until
 * Phase 2 wires them to @rm/convex queries.
 */

export const heroConfig = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  backgroundImageUrl: z.string().url().optional(),
  cta: z.object({ label: z.string(), href: z.string() }).optional(),
});

export const richTextConfig = z.object({
  // Tiptap HTML. Phase 3 (admin write path) MUST sanitize on write; in Phase 1
  // the only writer is the seed, so this content is trusted.
  html: z.string(),
});

export const imageConfig = z.object({
  url: z.string(),
  alt: z.string().optional(),
  caption: z.string().optional(),
  href: z.string().optional(),
});

export const ctaConfig = z.object({
  buttons: z
    .array(
      z.object({
        label: z.string(),
        href: z.string(),
        variant: z.enum(["primary", "secondary"]).optional(),
      }),
    )
    .min(1),
});

export type HeroConfig = z.infer<typeof heroConfig>;
export type RichTextConfig = z.infer<typeof richTextConfig>;
export type ImageConfig = z.infer<typeof imageConfig>;
export type CtaConfig = z.infer<typeof ctaConfig>;

/** Block types that read live @rm/convex data — rendered in Phase 2. */
export const LIVE_DATA_BLOCK_TYPES = [
  "now-playing",
  "playlist",
  "upcoming-events",
  "touring",
  "fundraiser-progress",
] as const;
export type LiveDataBlockType = (typeof LIVE_DATA_BLOCK_TYPES)[number];

export type RenderableBlock =
  | { id: string; type: "hero"; config: HeroConfig }
  | { id: string; type: "rich-text"; config: RichTextConfig }
  | { id: string; type: "image"; config: ImageConfig }
  | { id: string; type: "cta"; config: CtaConfig }
  | { id: string; type: LiveDataBlockType; config: unknown };

export type RawBlock = { id: string; type: string; config: unknown };

function isLiveDataType(type: string): type is LiveDataBlockType {
  return (LIVE_DATA_BLOCK_TYPES as readonly string[]).includes(type);
}

/**
 * Validate a stored block. Returns a typed renderable block, or `null` for
 * unknown types / invalid config (caller skips it).
 */
export function parseBlock(raw: RawBlock): RenderableBlock | null {
  switch (raw.type) {
    case "hero": {
      const r = heroConfig.safeParse(raw.config);
      return r.success ? { id: raw.id, type: "hero", config: r.data } : null;
    }
    case "rich-text": {
      const r = richTextConfig.safeParse(raw.config);
      return r.success ? { id: raw.id, type: "rich-text", config: r.data } : null;
    }
    case "image": {
      const r = imageConfig.safeParse(raw.config);
      return r.success ? { id: raw.id, type: "image", config: r.data } : null;
    }
    case "cta": {
      const r = ctaConfig.safeParse(raw.config);
      return r.success ? { id: raw.id, type: "cta", config: r.data } : null;
    }
    default:
      if (isLiveDataType(raw.type)) {
        return { id: raw.id, type: raw.type, config: raw.config };
      }
      return null;
  }
}
