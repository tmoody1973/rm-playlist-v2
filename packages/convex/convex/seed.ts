import { internalMutation } from "./_generated/server";

/**
 * Seed the RM organization + four stations.
 *
 * Run once after deploying: `bunx convex run internal/seed:rmOrg`
 * Idempotent — re-running is a no-op if rows exist.
 */
export const rmOrg = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", "radiomilwaukee"))
      .first();

    const now = Date.now();

    const orgId =
      existing?._id ??
      (await ctx.db.insert("organizations", {
        slug: "radiomilwaukee",
        name: "Radio Milwaukee",
        createdAt: now,
      }));

    const stationSeeds = [
      {
        slug: "hyfin" as const,
        name: "HYFIN",
        embedSlug: "hyfin",
        tagline: "Diaspora music from Milwaukee.",
      },
      {
        slug: "88nine" as const,
        name: "88Nine",
        embedSlug: "88nine",
        tagline: "Radio Milwaukee's flagship.",
      },
      {
        slug: "414music" as const,
        name: "414 Music",
        embedSlug: "414music",
        tagline: "The sound of Milwaukee.",
      },
      {
        slug: "rhythmlab" as const,
        name: "Rhythm Lab",
        embedSlug: "rhythmlab",
        tagline: "Rhythm Lab Radio.",
      },
    ];

    let created = 0;
    for (const seed of stationSeeds) {
      const existingStation = await ctx.db
        .query("stations")
        .withIndex("by_slug", (q) => q.eq("slug", seed.slug))
        .first();
      if (existingStation) continue;

      await ctx.db.insert("stations", {
        orgId,
        slug: seed.slug,
        name: seed.name,
        embedSlug: seed.embedSlug,
        tagline: seed.tagline,
        createdAt: now,
      });
      created++;
    }

    return {
      orgId,
      stationsCreated: created,
      alreadyExisted: stationSeeds.length - created,
    };
  },
});
