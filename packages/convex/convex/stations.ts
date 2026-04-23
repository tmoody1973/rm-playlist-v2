import { query } from "./_generated/server";

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
      }));
  },
});
