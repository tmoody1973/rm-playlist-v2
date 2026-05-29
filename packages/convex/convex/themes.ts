import { v } from "convex/values";
import { getCmsUser, requireCmsUser } from "./cmsAuth";
import { isCmsStation } from "./cmsStations";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

/**
 * Theme management for the Station Microsites CMS (apps/cms) — Phase 4.
 *
 * Reads are gated to any signed-in CMS user (operator+); every write requires
 * the `admin` role (design doc 005: admins manage theme presets + the
 * per-station default). The render-time cascade (station default → page.themeId
 * → page.themeOverrides) lives in pages.ts; this file owns the preset CRUD.
 */

/**
 * Full theme token set. Mirrors the `themes.tokens` schema validator so create
 * and update stay type-safe instead of leaning on `v.any()`.
 */
export const tokensValidator = v.object({
  colorPrimary: v.string(),
  colorBg: v.string(),
  colorCard: v.string(),
  colorAccent: v.string(),
  colorText: v.string(),
  font: v.string(),
  radius: v.string(),
});

/**
 * List the themes available to a single station's pages: that station's own
 * themes plus org-wide shared presets. Used by the page editor's theme picker.
 * Returns `[]` when there's no CMS user (read degrades gracefully).
 */
export const listForStation = query({
  args: { stationSlug: v.string() },
  handler: async (ctx, { stationSlug }) => {
    const user = await getCmsUser(ctx);
    if (user === null) return [];
    if (!isCmsStation(stationSlug)) return [];

    const station = await ctx.db
      .query("stations")
      .withIndex("by_slug", (q) => q.eq("slug", stationSlug))
      .first();
    if (station === null) return [];

    const [stationThemes, orgThemes] = await Promise.all([
      ctx.db
        .query("themes")
        .withIndex("by_station", (q) => q.eq("stationId", station._id))
        .collect(),
      ctx.db
        .query("themes")
        .withIndex("by_org", (q) => q.eq("orgId", station.orgId))
        .collect(),
    ]);

    // Org-wide presets are the by_org rows with no stationId. The station-scoped
    // rows already came back from the by_station query.
    const orgWide = orgThemes.filter((t) => t.stationId === undefined);

    return [...stationThemes, ...orgWide].map((t) => ({
      _id: t._id,
      name: t.name,
      tokens: t.tokens,
      isStationDefault: t.isStationDefault,
      scope: t.stationId === undefined ? ("org" as const) : ("station" as const),
    }));
  },
});

/**
 * List every theme for the admin theme manager, grouped-ready (station slug/name
 * attached; org-wide presets flagged). getCmsUser-gated; returns [] when no user.
 */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCmsUser(ctx);
    if (user === null) return [];

    const [themes, stations] = await Promise.all([
      ctx.db.query("themes").collect(),
      ctx.db.query("stations").collect(),
    ]);
    const stationById = new Map(stations.map((s) => [s._id, s]));

    return themes
      .map((t) => {
        const station = t.stationId ? stationById.get(t.stationId) : undefined;
        return {
          _id: t._id,
          name: t.name,
          tokens: t.tokens,
          isStationDefault: t.isStationDefault,
          stationSlug: station?.slug ?? null,
          stationName: station?.name ?? "Org-wide presets",
        };
      })
      .sort(
        (a, b) =>
          (a.stationSlug ?? "zzz").localeCompare(b.stationSlug ?? "zzz") ||
          a.name.localeCompare(b.name),
      );
  },
});

/**
 * Create a theme preset. admin only. `stationSlug` scopes it to a station;
 * omit it for an org-wide shared preset. Never created as a station default —
 * use setStationDefault to promote one explicitly.
 */
export const createTheme = mutation({
  args: {
    name: v.string(),
    stationSlug: v.optional(v.string()),
    tokens: tokensValidator,
  },
  handler: async (ctx, { name, stationSlug, tokens }) => {
    const user = await requireCmsUser(ctx, "admin");

    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error("Theme name is required.");

    let stationId: Id<"stations"> | undefined;
    if (stationSlug !== undefined) {
      if (!isCmsStation(stationSlug)) {
        throw new Error(`Not a CMS station: ${stationSlug}`);
      }
      const station = await ctx.db
        .query("stations")
        .withIndex("by_slug", (q) => q.eq("slug", stationSlug))
        .first();
      if (station === null) throw new Error("Station not found");
      stationId = station._id;
    }

    const themeId = await ctx.db.insert("themes", {
      orgId: user.orgId,
      stationId,
      name: trimmed,
      isStationDefault: false,
      tokens,
      createdAt: Date.now(),
    });
    return { themeId };
  },
});

/** Update a theme's name and/or tokens. admin only. */
export const updateTheme = mutation({
  args: {
    themeId: v.id("themes"),
    name: v.optional(v.string()),
    tokens: v.optional(tokensValidator),
  },
  handler: async (ctx, { themeId, name, tokens }) => {
    await requireCmsUser(ctx, "admin");
    const theme = await ctx.db.get(themeId);
    if (theme === null) throw new Error("Theme not found");

    const patch: { name?: string; tokens?: typeof tokens } = {};
    if (name !== undefined) {
      const trimmed = name.trim();
      if (trimmed.length === 0) throw new Error("Theme name cannot be empty.");
      patch.name = trimmed;
    }
    if (tokens !== undefined) patch.tokens = tokens;

    await ctx.db.patch(themeId, patch);
    return { ok: true };
  },
});

/**
 * Promote a station-scoped theme to its station's default, unsetting whatever
 * was default before (only one default per station). admin only. Org-wide
 * presets can't be a station default — they're not bound to a station.
 */
export const setStationDefault = mutation({
  args: { themeId: v.id("themes") },
  handler: async (ctx, { themeId }) => {
    await requireCmsUser(ctx, "admin");
    const theme = await ctx.db.get(themeId);
    if (theme === null) throw new Error("Theme not found");
    if (theme.stationId === undefined) {
      throw new Error("Org-wide themes can't be a station default. Scope it to a station first.");
    }

    const stationId = theme.stationId;
    const currentDefaults = await ctx.db
      .query("themes")
      .withIndex("by_station", (q) => q.eq("stationId", stationId))
      .filter((q) => q.eq(q.field("isStationDefault"), true))
      .collect();

    for (const prior of currentDefaults) {
      if (prior._id !== themeId) await ctx.db.patch(prior._id, { isStationDefault: false });
    }
    await ctx.db.patch(themeId, { isStationDefault: true });
    return { ok: true };
  },
});

/**
 * Delete a theme. admin only. Refuses to delete a station default (would break
 * the cascade fallback) or a theme any page still references (no silent
 * page breakage — reassign the page's theme first).
 */
export const removeTheme = mutation({
  args: { themeId: v.id("themes") },
  handler: async (ctx, { themeId }) => {
    await requireCmsUser(ctx, "admin");
    const theme = await ctx.db.get(themeId);
    if (theme === null) throw new Error("Theme not found");
    if (theme.isStationDefault) {
      throw new Error("Can't delete a station default theme. Set another default first.");
    }

    const pages = await ctx.db.query("pages").collect();
    const referencing = pages.find((p) => p.themeId === themeId);
    if (referencing !== undefined) {
      throw new Error(
        `Theme is in use by "${referencing.title}". Reassign that page's theme first.`,
      );
    }

    await ctx.db.delete(themeId);
    return { ok: true };
  },
});
