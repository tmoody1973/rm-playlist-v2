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

/**
 * Seed one default theme per CMS station (hyfin, 88nine, rhythmlab).
 * 414 Music is excluded — it has no public CMS pages (design doc 005).
 *
 * Run after rmOrg: `bunx convex run seed:cmsThemes`
 * Idempotent — re-running skips any station that already has a default theme.
 *
 * Token values are tasteful light-mode placeholders; real station branding is
 * Phase 4 (theme management). They exist now so the render-time theme cascade
 * (Phase 1) has a station default to resolve against.
 */
export const cmsThemes = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", "radiomilwaukee"))
      .first();
    if (org === null) {
      throw new Error("RM organization not seeded — run seed:rmOrg first");
    }

    const now = Date.now();

    const themeSeeds = [
      {
        stationSlug: "hyfin" as const,
        name: "HYFIN Default",
        tokens: {
          colorPrimary: "#0e0f11",
          colorBg: "#faf7f2",
          colorCard: "#ffffff",
          colorAccent: "#e84f2f",
          colorText: "#16191d",
          font: '"General Sans", ui-sans-serif, system-ui, sans-serif',
          radius: "12px",
        },
      },
      {
        stationSlug: "88nine" as const,
        name: "88Nine Default",
        tokens: {
          colorPrimary: "#0e0f11",
          colorBg: "#ffffff",
          colorCard: "#f4f5f7",
          colorAccent: "#2f6fe8",
          colorText: "#16191d",
          font: '"General Sans", ui-sans-serif, system-ui, sans-serif',
          radius: "12px",
        },
      },
      {
        stationSlug: "rhythmlab" as const,
        name: "Rhythm Lab Default",
        tokens: {
          colorPrimary: "#f1efeb",
          colorBg: "#101012",
          colorCard: "#1a1a1e",
          colorAccent: "#c542ff",
          colorText: "#f1efeb",
          font: '"General Sans", ui-sans-serif, system-ui, sans-serif',
          radius: "12px",
        },
      },
    ];

    let created = 0;
    for (const seed of themeSeeds) {
      const station = await ctx.db
        .query("stations")
        .withIndex("by_slug", (q) => q.eq("slug", seed.stationSlug))
        .first();
      if (station === null) {
        throw new Error(`Station not seeded: ${seed.stationSlug} — run seed:rmOrg first`);
      }

      const existingDefault = await ctx.db
        .query("themes")
        .withIndex("by_station", (q) => q.eq("stationId", station._id))
        .filter((q) => q.eq(q.field("isStationDefault"), true))
        .first();
      if (existingDefault !== null) continue;

      await ctx.db.insert("themes", {
        orgId: org._id,
        stationId: station._id,
        name: seed.name,
        isStationDefault: true,
        tokens: seed.tokens,
        createdAt: now,
      });
      created++;
    }

    return {
      orgId: org._id,
      themesCreated: created,
      alreadyExisted: themeSeeds.length - created,
    };
  },
});
