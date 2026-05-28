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
  // Structured Tiptap/ProseMirror doc JSON. Rendered via lib/richtext.tsx's
  // allowlist serializer (no raw HTML → XSS-safe). `doc` is validated
  // structurally by the serializer, so we keep it loose here. Legacy {text}
  // blocks parse with doc undefined and render nothing until re-edited.
  doc: z.unknown(),
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

// Live-data blocks read @rm/convex. Configs are small and all-optional;
// an absent config (`undefined`) parses to `{}`.
const limitField = z.number().int().positive().max(50).optional();

export const nowPlayingConfig = z.object({});
export const playlistConfig = z.object({ limit: limitField });
export const upcomingEventsConfig = z.object({ limit: limitField, region: z.string().optional() });
export const touringConfig = z.object({ limit: limitField });

export type HeroConfig = z.infer<typeof heroConfig>;
export type RichTextConfig = z.infer<typeof richTextConfig>;
export type ImageConfig = z.infer<typeof imageConfig>;
export type CtaConfig = z.infer<typeof ctaConfig>;
export type NowPlayingConfig = z.infer<typeof nowPlayingConfig>;
export type PlaylistConfig = z.infer<typeof playlistConfig>;
export type UpcomingEventsConfig = z.infer<typeof upcomingEventsConfig>;
export type TouringConfig = z.infer<typeof touringConfig>;

export type RenderableBlock =
  | { id: string; type: "hero"; config: HeroConfig }
  | { id: string; type: "rich-text"; config: RichTextConfig }
  | { id: string; type: "image"; config: ImageConfig }
  | { id: string; type: "cta"; config: CtaConfig }
  | { id: string; type: "now-playing"; config: NowPlayingConfig }
  | { id: string; type: "playlist"; config: PlaylistConfig }
  | { id: string; type: "upcoming-events"; config: UpcomingEventsConfig }
  | { id: string; type: "touring"; config: TouringConfig }
  | { id: string; type: "fundraiser-progress"; config: unknown };

export type RawBlock = { id: string; type: string; config: unknown };

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
    case "now-playing": {
      const r = nowPlayingConfig.safeParse(raw.config ?? {});
      return r.success ? { id: raw.id, type: "now-playing", config: r.data } : null;
    }
    case "playlist": {
      const r = playlistConfig.safeParse(raw.config ?? {});
      return r.success ? { id: raw.id, type: "playlist", config: r.data } : null;
    }
    case "upcoming-events": {
      const r = upcomingEventsConfig.safeParse(raw.config ?? {});
      return r.success ? { id: raw.id, type: "upcoming-events", config: r.data } : null;
    }
    case "touring": {
      const r = touringConfig.safeParse(raw.config ?? {});
      return r.success ? { id: raw.id, type: "touring", config: r.data } : null;
    }
    case "fundraiser-progress":
      return { id: raw.id, type: "fundraiser-progress", config: raw.config };
    default:
      return null;
  }
}
