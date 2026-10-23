import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

/**
 * Return all four stations for the RM org, ordered alphabetically by slug
 * so the dashboard row always paints in a stable order (414music / 88nine
 * / hyfin / rhythmlab). Used by the wall-of-status row on the dashboard.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const stations = await ctx.db.query("stations").collect();
    return stations
      .slice()
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .map((s) => ({
        _id: s._id,
        slug: s.slug,
        name: s.name,
        embedSlug: s.embedSlug,
        tagline: s.tagline,
        defaultArtworkUrl: s.defaultArtworkUrl,
      }));
  },
});

/**
 * Set (or clear) a station's fallback artwork URL. Internal — the only
 * caller is a one-off CLI invocation (`convex run` can call internal
 * functions). Make it public behind requireStaff if a dashboard panel
 * ever needs it:
 *
 *   bunx convex run stations:setDefaultArtwork \
 *     '{"stationSlug":"414music","defaultArtworkUrl":"https://..."}'
 *
 * Pass `null` for `defaultArtworkUrl` to clear. URLs must be `https://`
 * — widgets render inside secure embeds so `http://` images would be
 * mixed-content blocked by browsers.
 */
export const setDefaultArtwork = internalMutation({
  args: {
    stationSlug: v.union(
      v.literal("hyfin"),
      v.literal("88nine"),
      v.literal("414music"),
      v.literal("rhythmlab"),
    ),
    defaultArtworkUrl: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { stationSlug, defaultArtworkUrl }) => {
    const station = await ctx.db
      .query("stations")
      .withIndex("by_slug", (q) => q.eq("slug", stationSlug))
      .first();
    if (station === null) throw new Error(`Unknown station slug: ${stationSlug}`);

    if (defaultArtworkUrl !== null) {
      let parsed: URL;
      try {
        parsed = new URL(defaultArtworkUrl);
      } catch {
        throw new Error(`defaultArtworkUrl is not a valid URL: ${defaultArtworkUrl}`);
      }
      if (parsed.protocol !== "https:") {
        throw new Error("defaultArtworkUrl must be https:// (widgets run in secure embeds)");
      }
    }

    await ctx.db.patch(station._id, {
      defaultArtworkUrl: defaultArtworkUrl ?? undefined,
    });
    return { stationSlug, defaultArtworkUrl: defaultArtworkUrl ?? null };
  },
});
