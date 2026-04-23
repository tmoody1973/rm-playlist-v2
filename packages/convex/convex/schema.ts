import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * rm-playlist-v2 Convex schema — single-tenant shakedown edition.
 *
 * Every table carries an `orgId` even though there is exactly one org row
 * during shakedown (Radio Milwaukee). Decision doc 001 explains why — it's
 * forward-compat for multi-tenant activation without a schema rewrite.
 *
 * See docs/design/001-information-architecture.md for surface-by-surface
 * descriptions, and docs/decisions/002-secrets-at-rest.md for the
 * `apiKeyRef` / env-var indirection pattern in `ingestionSources.config`.
 */

export default defineSchema({
  // ------------------------------------------------------------------
  // Organizations + stations (forward-compat multi-tenant)
  // ------------------------------------------------------------------

  organizations: defineTable({
    slug: v.string(), // "radiomilwaukee" during shakedown
    name: v.string(),
    createdAt: v.number(),
  }).index("by_slug", ["slug"]),

  stations: defineTable({
    orgId: v.id("organizations"),
    slug: v.union(
      v.literal("hyfin"),
      v.literal("88nine"),
      v.literal("414music"),
      v.literal("rhythmlab"),
    ),
    name: v.string(), // "HYFIN", "88Nine", "414 Music", "Rhythm Lab"
    /** Host-facing station identifier for embed widgets (e.g. "hyfin"). */
    embedSlug: v.string(),
    /** Optional publicly displayed tagline. */
    tagline: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_slug", ["slug"]),

  // ------------------------------------------------------------------
  // Users + roles (Clerk-mirrored)
  // ------------------------------------------------------------------

  users: defineTable({
    orgId: v.id("organizations"),
    clerkUserId: v.string(), // Clerk's user.id
    email: v.string(),
    fullName: v.optional(v.string()),
    /** Role model per docs/design/004-unresolved-decisions.md#1. */
    role: v.union(v.literal("operator"), v.literal("admin")),
    createdAt: v.number(),
  })
    .index("by_clerk_user", ["clerkUserId"])
    .index("by_org", ["orgId"]),

  // ------------------------------------------------------------------
  // Ingestion
  // ------------------------------------------------------------------

  ingestionSources: defineTable({
    orgId: v.id("organizations"),
    stationId: v.id("stations"),
    /** Which adapter owns this source. Matches @rm/types AdapterKind. */
    adapter: v.union(v.literal("spinitron"), v.literal("sgmetadata"), v.literal("icy")),
    /** What role this source plays for its station. */
    role: v.union(v.literal("primary"), v.literal("supplementary"), v.literal("shadow")),
    /** Adapter-specific config. Contains `apiKeyRef` pointing at an env var. */
    config: v.any(),
    /** Poll interval in seconds; ICY sources ignore this. */
    pollIntervalSec: v.optional(v.number()),
    enabled: v.boolean(),
    /** Unix ms of the most recent successful poll, for dashboard "last poll Xm ago". */
    lastSuccessAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_station", ["stationId"])
    .index("by_enabled", ["enabled"]),

  /**
   * Append-only log of every poll attempt, enrichment step, and anomaly.
   * Drives the "Needs Attention" dashboard panel and the per-stream
   * "last 24h of weird" view.
   */
  ingestionEvents: defineTable({
    orgId: v.id("organizations"),
    stationId: v.id("stations"),
    sourceId: v.id("ingestionSources"),
    kind: v.union(
      v.literal("poll_ok"),
      v.literal("poll_error"),
      v.literal("source_paused"),
      v.literal("source_resumed"),
      v.literal("drift_detected"),
      v.literal("enrichment_ok"),
      v.literal("enrichment_error"),
    ),
    /** Brief human-readable summary. */
    message: v.string(),
    /** Arbitrary structured context — HTTP status, error codes, etc. */
    context: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_station", ["stationId"])
    .index("by_created", ["createdAt"])
    .index("by_kind", ["kind"]),

  // ------------------------------------------------------------------
  // Plays (the core time-series)
  // ------------------------------------------------------------------

  plays: defineTable({
    orgId: v.id("organizations"),
    stationId: v.id("stations"),
    sourceId: v.id("ingestionSources"),
    /** Source-reported artist string before enrichment. */
    artistRaw: v.string(),
    /** Source-reported title string. */
    titleRaw: v.string(),
    albumRaw: v.optional(v.string()),
    labelRaw: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    /** Unix ms when the play started (source timestamp, not ingestion time). */
    playedAt: v.number(),
    /** Canonical artist ID assigned by enrichment, when resolved. */
    canonicalArtistId: v.optional(v.id("artists")),
    /** Canonical track ID assigned by enrichment, when resolved. */
    canonicalTrackId: v.optional(v.id("tracks")),
    /** Enrichment status. */
    enrichmentStatus: v.union(
      v.literal("pending"),
      v.literal("resolved"),
      v.literal("unresolved"),
      v.literal("ignored"),
    ),
    /** Soft-delete for "play rewind" per docs/design/001-IA.md#K. */
    deletedAt: v.optional(v.number()),
    /** Audit copy of the adapter's raw payload. */
    raw: v.any(),
    createdAt: v.number(),
  })
    .index("by_station_played_at", ["stationId", "playedAt"])
    .index("by_org_played_at", ["orgId", "playedAt"])
    .index("by_enrichment_status", ["enrichmentStatus"])
    .index("by_canonical_artist", ["canonicalArtistId"])
    .index("by_canonical_track", ["canonicalTrackId"]),

  // ------------------------------------------------------------------
  // Canonical catalog (cross-tenant scope locked under single-tenant;
  // schema preserved for forward-compat per decision 001)
  // ------------------------------------------------------------------

  artists: defineTable({
    /** Normalized key (lowercased, simplified) used for dedup lookups. */
    artistKey: v.string(),
    /** Display name as it should render. */
    displayName: v.string(),
    /** External IDs. */
    mbid: v.optional(v.string()), // MusicBrainz
    discogsId: v.optional(v.string()),
    spotifyId: v.optional(v.string()),
    appleMusicId: v.optional(v.string()),
    /** Whether this artist has been manually verified by an admin. */
    verified: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_artist_key", ["artistKey"])
    .index("by_mbid", ["mbid"])
    .index("by_spotify", ["spotifyId"])
    .index("by_apple_music", ["appleMusicId"]),

  tracks: defineTable({
    /** Normalized (artistKey, titleKey) dedup key. */
    trackKey: v.string(),
    displayTitle: v.string(),
    artistId: v.id("artists"),
    albumDisplayName: v.optional(v.string()),
    isrc: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    spotifyTrackId: v.optional(v.string()),
    appleMusicSongId: v.optional(v.string()),
    /** Album art URL — chosen once at enrichment time from the best source. */
    artworkUrl: v.optional(v.string()),
    verified: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_track_key", ["trackKey"])
    .index("by_artist", ["artistId"])
    .index("by_isrc", ["isrc"])
    .index("by_spotify", ["spotifyTrackId"])
    .index("by_apple_music", ["appleMusicSongId"]),

  // ------------------------------------------------------------------
  // Apple Music developer token cache (per decisions/002)
  // ------------------------------------------------------------------

  appleMusicTokenCache: defineTable({
    /** The signed ES256 JWT. */
    token: v.string(),
    /** Unix ms when the JWT expires (kid will reject after this). */
    expiresAt: v.number(),
    /** Unix ms when we minted it — for cron refresh logic. */
    mintedAt: v.number(),
  }),

  // ------------------------------------------------------------------
  // Widgets (embed generator)
  // ------------------------------------------------------------------

  widgets: defineTable({
    orgId: v.id("organizations"),
    stationId: v.id("stations"),
    /** Short public slug used in `data-station`. */
    slug: v.string(),
    /** Which variant — matches DESIGN.md widget catalog. */
    variant: v.union(
      v.literal("playlist"),
      v.literal("now-playing-strip"),
      v.literal("now-playing-card"),
    ),
    /** Layout mode for `playlist` variant; ignored for now-playing variants. */
    layout: v.optional(v.union(v.literal("list"), v.literal("grid"))),
    /** Variant-specific defaults (maxItems, theme, showEvents, etc.). */
    config: v.any(),
    /** CORS-like allowlist. If non-empty, HTTP actions enforce it. */
    allowedOrigins: v.optional(v.array(v.string())),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_station", ["stationId"])
    .index("by_slug", ["slug"]),

  // ------------------------------------------------------------------
  // Events (Ticketmaster / AXS / custom DJ — Week 5 scope)
  // ------------------------------------------------------------------

  events: defineTable({
    orgId: v.id("organizations"),
    source: v.union(v.literal("ticketmaster"), v.literal("axs"), v.literal("custom")),
    externalId: v.optional(v.string()), // TM event id, AXS event id
    artistId: v.optional(v.id("artists")),
    /** Artist name as the event source reported it, before canonical resolution. */
    artistNameRaw: v.string(),
    venueName: v.string(),
    city: v.string(),
    region: v.string(),
    /** Unix ms of the event start. */
    startsAt: v.number(),
    ticketUrl: v.optional(v.string()),
    /** When a DJ created this event by hand. */
    createdBy: v.optional(v.id("users")),
    verified: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_starts_at", ["startsAt"])
    .index("by_artist", ["artistId"])
    .index("by_external_id", ["externalId"]),

  // ------------------------------------------------------------------
  // Touring from rotation (cached derived table — Week 6 perf decision)
  // ------------------------------------------------------------------

  /**
   * Nightly Trigger.dev cron materializes this view. Dashboard row 3 reads
   * from here, not computing the cross-join on each load. See
   * plan-eng-review perf decision #8.
   */
  touringFromRotation: defineTable({
    orgId: v.id("organizations"),
    stationId: v.id("stations"),
    artistId: v.id("artists"),
    /** Plays by this artist in the lookback window (default 30 days). */
    playCount: v.number(),
    /** Soonest upcoming event for this artist in region. */
    nextEventId: v.id("events"),
    /** When this row was last refreshed by cron. */
    computedAt: v.number(),
  })
    .index("by_station", ["stationId", "computedAt"])
    .index("by_artist", ["artistId"]),
});
