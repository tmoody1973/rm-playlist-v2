import { v } from "convex/values";
import { getCmsUser, requireCmsUser } from "./cmsAuth";
import { buildTemplate, isCmsPageKind } from "./cmsTemplates";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

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

// ------------------------------------------------------------------
// Admin (write) side — gated by requireCmsUser. Phase 3a.
// Drafts are visible here; the public getPublishedPage filters them out.
// ------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * List all CMS pages for the admin builder, with their station slug attached
 * so the UI can group by station. Returns `[]` when there's no CMS user yet
 * (e.g. the users row hasn't been created on first admin mount) — a read query
 * degrades gracefully rather than throwing.
 */
export const listPages = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCmsUser(ctx);
    if (user === null) return [];

    const [pages, stations] = await Promise.all([
      ctx.db.query("pages").collect(),
      ctx.db.query("stations").collect(),
    ]);
    const stationById = new Map(stations.map((s) => [s._id, s]));

    return pages
      .map((page) => ({
        _id: page._id,
        stationSlug: stationById.get(page.stationId)?.slug ?? "unknown",
        stationName: stationById.get(page.stationId)?.name ?? "Unknown",
        kind: page.kind,
        slug: page.slug,
        title: page.title,
        status: page.status,
        updatedAt: page.publishedAt ?? page.createdAt,
      }))
      .sort((a, b) => a.stationSlug.localeCompare(b.stationSlug) || a.kind.localeCompare(b.kind));
  },
});

/**
 * Create a page from its kind's template. operator+ may create. Enforces
 * one station-home per station, and a valid unique slug for event/fundraiser.
 */
export const create = mutation({
  args: {
    stationSlug: v.string(),
    kind: v.string(),
    title: v.optional(v.string()),
    slug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireCmsUser(ctx);

    if (!isCmsStation(args.stationSlug)) {
      throw new Error(`Not a CMS station: ${args.stationSlug}`);
    }
    if (!isCmsPageKind(args.kind)) {
      throw new Error(`Unknown page kind: ${args.kind}`);
    }

    const cmsStationSlug = args.stationSlug;
    const station = await ctx.db
      .query("stations")
      .withIndex("by_slug", (q) => q.eq("slug", cmsStationSlug))
      .first();
    if (station === null) throw new Error("Station not found");

    let slug = "";
    let title: string;

    if (args.kind === "station-home") {
      title = station.name;
      const existing = await ctx.db
        .query("pages")
        .withIndex("by_station_kind_slug", (q) =>
          q.eq("stationId", station._id).eq("kind", "station-home").eq("slug", ""),
        )
        .first();
      if (existing !== null) throw new Error(`${station.name} already has a home page`);
    } else {
      slug = (args.slug ?? "").trim().toLowerCase();
      if (!SLUG_RE.test(slug)) {
        throw new Error("Slug must be lowercase letters, numbers, and hyphens.");
      }
      const trimmedTitle = args.title?.trim() ?? "";
      if (trimmedTitle.length === 0) throw new Error("Title is required.");
      title = trimmedTitle;

      const existing = await ctx.db
        .query("pages")
        .withIndex("by_station_kind_slug", (q) =>
          q.eq("stationId", station._id).eq("kind", args.kind).eq("slug", slug),
        )
        .first();
      if (existing !== null) {
        throw new Error(`A ${args.kind} page with slug "${slug}" already exists for this station.`);
      }
    }

    const now = Date.now();
    const pageId = await ctx.db.insert("pages", {
      orgId: station.orgId,
      stationId: station._id,
      kind: args.kind,
      slug,
      title,
      status: "draft",
      blocks: buildTemplate(args.kind, {
        slug: station.slug,
        name: station.name,
        tagline: station.tagline,
      }),
      createdBy: user._id,
      updatedBy: user._id,
      createdAt: now,
    });

    return { pageId };
  },
});

/** Publish or unpublish a page. operator+ . */
export const setStatus = mutation({
  args: {
    pageId: v.id("pages"),
    status: v.union(v.literal("draft"), v.literal("published")),
  },
  handler: async (ctx, { pageId, status }) => {
    const user = await requireCmsUser(ctx);
    const page = await ctx.db.get(pageId);
    if (page === null) throw new Error("Page not found");

    await ctx.db.patch(pageId, {
      status,
      updatedBy: user._id,
      // Stamp publishedAt the first time it goes live; keep it thereafter.
      publishedAt: status === "published" ? (page.publishedAt ?? Date.now()) : page.publishedAt,
    });
    return { ok: true };
  },
});

/** Delete a page. admin only (design doc 005 role split). */
export const remove = mutation({
  args: { pageId: v.id("pages") },
  handler: async (ctx, { pageId }) => {
    await requireCmsUser(ctx, "admin");
    const page = await ctx.db.get(pageId);
    if (page === null) throw new Error("Page not found");
    await ctx.db.delete(pageId);
    return { ok: true };
  },
});
