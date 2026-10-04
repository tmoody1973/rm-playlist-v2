import { v } from "convex/values";

export const factSourceValidator = v.object({
  source: v.union(v.literal("musicbrainz"), v.literal("discogs"), v.literal("genius")),
  sourceUrl: v.string(),
  sourceRef: v.string(),
  fetchedAt: v.number(),
});

export const factGroupValidator = v.union(
  v.literal("performer"),
  v.literal("writer"),
  v.literal("producer"),
  v.literal("engineer"),
  v.literal("release"),
  v.literal("connection"),
);

/** Fields of one fact, minus the owning track. Shared by schema and credits.ts. */
export const factBodyFields = {
  group: factGroupValidator,
  role: v.string(),
  value: v.string(),
  personKey: v.optional(v.string()),
  linkedRecording: v.optional(
    v.object({ title: v.string(), artist: v.optional(v.string()), mbid: v.optional(v.string()) }),
  ),
  scope: v.union(v.literal("track"), v.literal("album")),
  sources: v.array(factSourceValidator),
};

export const matchConfidenceValidator = v.union(v.literal("high"), v.literal("low"));
export const creditsStatusValidator = v.union(
  v.literal("found"),
  v.literal("none"),
  v.literal("error"),
);
