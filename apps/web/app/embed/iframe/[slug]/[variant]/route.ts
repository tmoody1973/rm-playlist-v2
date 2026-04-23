import type { NextRequest } from "next/server";

/**
 * V1 → V2 iframe compatibility shim.
 *
 * V1 (Supabase-era) station sites have live <iframe> tags pointing at
 * `playlist.radiomilwaukee.org/iframe/:slug/:variant`. We can't break
 * those — partners have embed code in the wild. This route accepts the
 * same URL shape and redirects to the V2 widget-CDN iframe fallback on
 * Cloudflare Pages, preserving all query params.
 *
 * Example:
 *   OLD: https://playlist.radiomilwaukee.org/iframe/88nine/recently-played?theme=dark
 *   NEW: https://embed.radiomilwaukee.org/v1/iframe.html?station=88nine&variant=recently-played&theme=dark
 *
 * This route lives in apps/web (the Next.js app, deployed separately)
 * rather than apps/embed so we have access to Next's routing +
 * incoming-request handling. 302 (not 301) is intentional — we reserve
 * the right to change the target without partners needing to clear
 * browser caches.
 */

/**
 * Target CDN base. Override via RM_WIDGET_CDN_BASE env var when the
 * embed.radiomilwaukee.org custom domain is DNS-attached to Pages.
 * Default points at the pages.dev URL where the widget deploys today.
 */
const WIDGET_CDN_BASE_DEFAULT = "https://rm-playlist-v2-embed.pages.dev/v1";

type Params = Promise<{ slug: string; variant: string }>;

export async function GET(request: NextRequest, context: { params: Params }): Promise<Response> {
  const { slug, variant } = await context.params;

  // Preserve any incoming query params (theme, maxItems, etc.).
  const incoming = new URL(request.url);
  const out = new URL(`${pickBase()}/iframe.html`);
  out.searchParams.set("station", slug);
  out.searchParams.set("variant", normalizeVariant(variant));
  for (const [key, value] of incoming.searchParams.entries()) {
    // Don't clobber the ones we just set.
    if (key === "station" || key === "variant") continue;
    out.searchParams.set(key, value);
  }

  return Response.redirect(out.toString(), 302);
}

function pickBase(): string {
  const override = process.env.RM_WIDGET_CDN_BASE;
  if (override && override.startsWith("https://")) return override;
  return WIDGET_CDN_BASE_DEFAULT;
}

/**
 * V1 used a slightly different variant vocabulary. Map to V2 names so
 * legacy embed codes keep working without rewrites.
 */
function normalizeVariant(v1Variant: string): string {
  const map: Record<string, string> = {
    "recently-played": "playlist", // V1 "recently-played" → V2 playlist widget (default list layout)
    "now-playing": "now-playing-card",
    "now-playing-strip": "now-playing-strip",
    "now-playing-card": "now-playing-card",
    playlist: "playlist",
  };
  return map[v1Variant] ?? v1Variant;
}
// Note: only HTTP verb exports are valid in Next App Router route handlers.
// HEAD is auto-handled by Next. Add POST/PUT/etc. if we ever need them.
