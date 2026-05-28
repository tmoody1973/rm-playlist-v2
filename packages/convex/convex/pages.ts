import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";

/**
 * Public read side of the Station Microsites CMS (apps/cms).
 *
 * Stations with public CMS pages. 414music is intentionally excluded — it has
 * no microsite (design doc 005).
 */
const CMS_STATION_SLUGS = ["hyfin", "88nine", "rhythmlab"] as const;
type CmsStationSlug = (typeof CMS_STATION_SLUGS)[number];

function isCmsStation(slug: string): slug is CmsStationSlug {
  return (CMS_STATION_SLUGS as readonly string[]).includes(slug);
}

type ThemeTokens = Doc<"themes">["tokens"];

/**
 * Last-resort tokens if a station somehow has no default theme seeded. Keeps
 * the renderer from crashing; seed:cmsThemes is the real source.
 */
const FALLBACK_TOKENS: ThemeTokens = {
  colorPrimary: "#0e0f11",
  colorBg: "#ffffff",
  colorCard: "#f4f5f7",
  colorAccent: "#e84f2f",
  colorText: "#16191d",
  font: '"General Sans", ui-sans-serif, system-ui, sans-serif',
  radius: "12px",
};

/**
 * Resolve the theme cascade for a page, server-side, exactly once:
 *   station default theme → page.themeId → page.themeOverrides (token-level).
 * Returns a fully-resolved token set the renderer emits as CSS variables.
 */
async function resolveThemeTokens(
  ctx: QueryCtx,
  stationId: Id<"stations">,
  page: Doc<"pages">,
): Promise<ThemeTokens> {
  const stationDefault = await ctx.db
    .query("themes")
    .withIndex("by_station", (q) => q.eq("stationId", stationId))
    .filter((q) => q.eq(q.field("isStationDefault"), true))
    .first();

  let tokens: ThemeTokens = stationDefault?.tokens ?? FALLBACK_TOKENS;

  if (page.themeId !== undefined) {
    const pageTheme = await ctx.db.get(page.themeId);
    if (pageTheme !== null) tokens = pageTheme.tokens;
  }

  if (page.themeOverrides !== undefined && page.themeOverrides !== null) {
    tokens = { ...tokens, ...(page.themeOverrides as Partial<ThemeTokens>) };
  }

  return tokens;
}

/**
 * Fetch a published CMS page by station + kind + slug, with its theme already
 * resolved to CSS-ready tokens. Returns `null` when the station isn't a CMS
 * station, the page doesn't exist, or it isn't published — the route turns any
 * null into a 404 so drafts are invisible publicly.
 *
 * Read-only. Never touches core tables.
 */
export const getPublishedPage = query({
  args: {
    stationSlug: v.string(),
    kind: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, { stationSlug, kind, slug }) => {
    if (!isCmsStation(stationSlug)) return null;

    const station = await ctx.db
      .query("stations")
      .withIndex("by_slug", (q) => q.eq("slug", stationSlug))
      .first();
    if (station === null) return null;

    const page = await ctx.db
      .query("pages")
      .withIndex("by_station_kind_slug", (q) =>
        q.eq("stationId", station._id).eq("kind", kind).eq("slug", slug),
      )
      .first();
    if (page === null || page.status !== "published") return null;

    const tokens = await resolveThemeTokens(ctx, station._id, page);

    return {
      page: {
        _id: page._id,
        title: page.title,
        kind: page.kind,
        slug: page.slug,
        blocks: page.blocks,
        seo: page.seo ?? null,
      },
      tokens,
      station: {
        slug: station.slug,
        name: station.name,
        tagline: station.tagline ?? null,
      },
    };
  },
});
