import { v } from "convex/values";
import { getCmsUser, requireCmsUser } from "./cmsAuth";
import { mutation, query } from "./_generated/server";

/**
 * Admin-uploaded custom fonts for CMS theming (Canva-style).
 *
 * Files are stored in Convex storage (our own infra — no third-party CDN), so
 * a face is self-hosted yet addable with no redeploy. Upload/delete are
 * admin-only; `listForRender` is public (fonts are public assets served on the
 * microsites) while `listForOrg` is the gated admin-manager read.
 */

const FONT_FORMAT = v.union(v.literal("woff2"), v.literal("ttf"), v.literal("otf"));

/** Admin requests a one-time upload URL, then POSTs the file to it directly. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCmsUser(ctx, "admin");
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Register an uploaded font. admin only. `format` is constrained by the
 * validator (rejects anything outside woff2/ttf/otf at the boundary), and
 * `licenseAck` must be true — RM must hold web-embedding rights.
 */
export const createFont = mutation({
  args: {
    label: v.string(),
    family: v.string(),
    storageId: v.id("_storage"),
    format: FONT_FORMAT,
    licenseAck: v.boolean(),
  },
  handler: async (ctx, { label, family, storageId, format, licenseAck }) => {
    const user = await requireCmsUser(ctx, "admin");
    if (!licenseAck) {
      throw new Error("You must confirm Radio Milwaukee is licensed to embed this font.");
    }
    const trimmedLabel = label.trim();
    const trimmedFamily = family.trim();
    if (trimmedLabel.length === 0) throw new Error("Font label is required.");
    if (trimmedFamily.length === 0) throw new Error("Font family name is required.");
    // family is interpolated into an @font-face rule on public pages — keep it to
    // a safe charset so a stray quote/semicolon can't break or inject CSS.
    if (!/^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(trimmedFamily)) {
      throw new Error("Font family name may only contain letters, numbers, spaces, and hyphens.");
    }

    const fontId = await ctx.db.insert("fonts", {
      orgId: user.orgId,
      label: trimmedLabel,
      family: trimmedFamily,
      storageId,
      format,
      licenseAck,
      uploadedBy: user._id,
      createdAt: Date.now(),
    });
    return { fontId };
  },
});

/**
 * Public render list — the @font-face injector reads this on public pages (no
 * Clerk identity there). Fonts are public assets, so this is intentionally
 * ungated. Drops any row whose storage URL didn't resolve.
 */
export const listForRender = query({
  args: { orgSlug: v.string() },
  handler: async (ctx, { orgSlug }) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", orgSlug))
      .first();
    if (org === null) return [];

    const fonts = await ctx.db
      .query("fonts")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();

    const rows = await Promise.all(
      fonts.map(async (f) => ({
        family: f.family,
        format: f.format,
        url: await ctx.storage.getUrl(f.storageId),
      })),
    );
    return rows.filter(
      (r): r is { family: string; format: "woff2" | "ttf" | "otf"; url: string } => r.url !== null,
    );
  },
});

/**
 * Admin-manager list — gated to CMS users; includes the row id for delete and
 * the resolved URL. Returns [] when there's no CMS user (graceful read).
 */
export const listForOrg = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCmsUser(ctx);
    if (user === null) return [];

    const fonts = await ctx.db
      .query("fonts")
      .withIndex("by_org", (q) => q.eq("orgId", user.orgId))
      .collect();

    return await Promise.all(
      fonts.map(async (f) => ({
        _id: f._id,
        label: f.label,
        family: f.family,
        format: f.format,
        url: await ctx.storage.getUrl(f.storageId),
      })),
    );
  },
});

/**
 * Delete an uploaded font. admin only. Refuses if any theme's font stack still
 * references the family (no silent theme breakage), then removes the stored
 * file and the row.
 */
export const removeFont = mutation({
  args: { fontId: v.id("fonts") },
  handler: async (ctx, { fontId }) => {
    await requireCmsUser(ctx, "admin");
    const font = await ctx.db.get(fontId);
    if (font === null) throw new Error("Font not found");

    const themes = await ctx.db.query("themes").collect();
    const inUse = themes.find((t) => t.tokens.font.includes(`"${font.family}"`));
    if (inUse !== undefined) {
      throw new Error(`Font is used by theme "${inUse.name}". Change that theme's font first.`);
    }

    await ctx.storage.delete(font.storageId);
    await ctx.db.delete(fontId);
    return { ok: true };
  },
});
