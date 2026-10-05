import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { creditsStatusValidator, factBodyFields, matchConfidenceValidator } from "./factValidators";

export const appleMusicStatusValidator = v.union(
  v.literal("not_linked"),
  v.literal("pending"),
  v.literal("added"),
  v.literal("failed"),
  v.literal("expired"),
);

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

/** One cached "rotation artist has a show coming up" entry; see events.refreshStationArtistShows. */
export const stationArtistShowValidator = v.object({
  artistName: v.string(),
  playCount: v.number(),
  venueName: v.string(),
  city: v.string(),
  region: v.string(),
  /** Milwaukee / Madison / Chicago, or the city when the event has no coordinates. */
  metro: v.string(),
  startsAtMs: v.number(),
  dateOnly: v.boolean(),
  ticketUrl: v.union(v.string(), v.null()),
  imageUrl: v.union(v.string(), v.null()),
  role: v.union(v.literal("headliner"), v.literal("support")),
});

/** One cached Cadence program; see cadence.refreshStationSchedule and scheduleLogic.ts. */
export const scheduleProgramValidator = v.object({
  programId: v.string(),
  name: v.string(),
  hosts: v.array(v.string()),
  description: v.optional(v.string()),
  link: v.optional(v.string()),
  /** Weekly, America/Chicago civil time; endMin passes 1440 when a show crosses midnight. */
  airtimes: v.array(v.object({ dayOfWeek: v.number(), startMin: v.number(), endMin: v.number() })),
});

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
    /**
     * Station-branded fallback shown on widgets/dashboard when a play's
     * track hasn't resolved artwork yet (414 Music's local catalog is
     * the common case — most tracks never land in Apple Music so they
     * stay artworkUrl-null forever). Widget's `AlbumArt` still treats
     * absence as a rendered gray tile; this just swaps that default
     * to something station-branded.
     */
    defaultArtworkUrl: v.optional(v.string()),
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
      v.literal("cadence_push_ok"),
      v.literal("cadence_push_error"),
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
  // Operational alerting
  // ------------------------------------------------------------------

  /**
   * Who gets emailed when a health check fails. Managed from the operator
   * settings page, read by the health cron in `health.ts`.
   *
   * Deliberately its own table rather than a flag on `users` — the people who
   * need to know the playlist stopped are not always the people who have
   * dashboard logins (engineering on-call, a shared ops inbox).
   */
  alertRecipients: defineTable({
    orgId: v.id("organizations"),
    email: v.string(),
    /** Optional human label, e.g. "ops inbox" or "Tarik (mobile)". */
    label: v.optional(v.string()),
    /** Uncheck to silence someone without losing the row. */
    enabled: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_email", ["orgId", "email"]),

  /**
   * Current state of each named alert, one row per (org, key).
   *
   * Exists purely so the health cron emails once when a problem starts and
   * once when it clears, instead of once per tick for the whole outage. An
   * alert people mute is worse than no alert.
   */
  systemAlerts: defineTable({
    orgId: v.id("organizations"),
    /** Stable alert identifier, e.g. "ingestion_stalled". */
    key: v.string(),
    firing: v.boolean(),
    /** Unix ms the current firing/clear state began. */
    since: v.number(),
    /** Human-readable summary from the most recent evaluation. */
    detail: v.string(),
    updatedAt: v.number(),
  }).index("by_org_key", ["orgId", "key"]),

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
    /** "observed" when durationSec was inferred from the next play's start (playDuration.ts). */
    durationSource: v.optional(v.literal("observed")),
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
    /** Unix ms when this play was sent to NPR Cadence (see cadence.ts). */
    cadencePushedAt: v.optional(v.number()),
    /** Audit copy of the adapter's raw payload. */
    raw: v.any(),
    createdAt: v.number(),
    /** artistRaw + " " + titleRaw for the search_text index (memoryLogic.playSearchFields). Optional only until backfills:backfillPlaySearchFields has run. */
    searchText: v.optional(v.string()),
    /** floor(playedAt / 14 days): the search window filters on this inside search_text. */
    playedFortnight: v.optional(v.number()),
  })
    .index("by_station_played_at", ["stationId", "playedAt"])
    .index("by_org_played_at", ["orgId", "playedAt"])
    .index("by_enrichment_status", ["enrichmentStatus"])
    .index("by_canonical_artist", ["canonicalArtistId"])
    .index("by_canonical_track", ["canonicalTrackId"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["stationId", "playedFortnight"],
    })
    // ponytail: legacy indexes kept only for runPlaySearch's migration fallback; drop both (and the fallback) once the backfill has run.
    .searchIndex("search_artist", { searchField: "artistRaw", filterFields: ["stationId"] })
    .searchIndex("search_title", { searchField: "titleRaw", filterFields: ["stationId"] }),

  // ------------------------------------------------------------------
  // Enrichment ignore rules (operator-curated skip list)
  //
  // When an operator clicks "Ignore" on a Needs Attention row, the
  // existing plays get flipped to `ignored` AND a row lands here. On
  // future ingestion, any play whose (stationId, normalized artistRaw,
  // normalized titleRaw) matches a rule is written straight to `ignored`
  // status without spending an enrichment API call. Typical payload:
  // station-ID spots ("WYMS", "Rhythm Lab Station ID"), legal IDs,
  // promos — noise that will never resolve to a Canonical track.
  // ------------------------------------------------------------------

  enrichmentIgnoreRules: defineTable({
    orgId: v.id("organizations"),
    stationId: v.id("stations"),
    /** trim+lowercase of artistRaw used for matching. */
    artistKey: v.string(),
    /** trim+lowercase of titleRaw used for matching. */
    titleKey: v.string(),
    /** Copy of the raw strings at rule-creation time — audit trail + UI display. */
    artistRaw: v.string(),
    titleRaw: v.string(),
    createdAt: v.number(),
    /** Clerk user id of the operator who created the rule, if known. */
    createdBy: v.optional(v.id("users")),
  })
    .index("by_station_match", ["stationId", "artistKey", "titleKey"])
    .index("by_station", ["stationId", "createdAt"]),

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
    /** Record label — required for SoundExchange compliance. Apple Music
     *  frequently omits this; MusicBrainz label lookup is session-3 work. */
    recordLabel: v.optional(v.string()),
    isrc: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    spotifyTrackId: v.optional(v.string()),
    appleMusicSongId: v.optional(v.string()),
    /** Album art URL — chosen once at enrichment time from the best source. */
    artworkUrl: v.optional(v.string()),
    /** Apple Music 30-second preview URL (from `attributes.previews[0].url`).
     *  Cached here so the widget PreviewButton doesn't hit Apple on every click. */
    previewUrl: v.optional(v.string()),
    /** MusicBrainz recording id, resolved by the credits phase (ISRC first). */
    recordingMbid: v.optional(v.string()),
    /** "high" = ISRC-exact or Apple+MB agreement; low tracks never become game questions. */
    matchConfidence: v.optional(matchConfidenceValidator),
    releaseYear: v.optional(v.number()),
    /** Precomputed recall tags: instrument families, decade, Discogs styles. */
    cueTags: v.optional(v.array(v.string())),
    /** Credits phase outcome; undefined = not yet tried. */
    creditsStatus: v.optional(creditsStatusValidator),
    creditsFetchedAt: v.optional(v.number()),
    verified: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_track_key", ["trackKey"])
    .index("by_artist", ["artistId"])
    .index("by_isrc", ["isrc"])
    .index("by_spotify", ["spotifyTrackId"])
    .index("by_apple_music", ["appleMusicSongId"])
    .index("by_credits_status", ["creditsStatus", "creditsFetchedAt"])
    .index("by_recording_mbid", ["recordingMbid"]),

  /**
   * One verified statement about a track, with every source that states
   * it. No source, no fact. Rewritten wholesale per track by
   * credits.writeTrackCredits. Spec: docs/superpowers/specs/2026-10-04-music-recall-tier1-facts-design.md
   */
  facts: defineTable({
    trackId: v.id("tracks"),
    ...factBodyFields,
  })
    .index("by_track", ["trackId"])
    .index("by_person", ["personKey"]),

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
  // Station regions — what geography each station cares about for events
  // ------------------------------------------------------------------

  /**
   * Stations enable one or more regions for events ingestion. Different
   * region kinds map to different upstream APIs:
   *
   *   - `dma`        Ticketmaster only. Cleanest match to TM's data model.
   *                  config: { dmaId: number }  (e.g. 632 for Milwaukee).
   *   - `radius`     TM and AXS both accept lat/long/radius. The portable
   *                  fallback when DMA isn't a clean fit.
   *                  config: { lat: number, long: number, radiusMiles: number }.
   *   - `venue_list` AXS-specific. Explicit venueId allowlist for venue
   *                  groups (Pabst Theater Group: Pabst, Riverside, Turner
   *                  Hall, Vivarium, Back Room at Colectivo).
   *                  config: { venueIds: number[] }.
   *   - `country`    Either source. ISO alpha-2 country code filter.
   *                  config: { cc: string }  (e.g. "US").
   *
   * Forward-compat: every row carries `orgId` even though RM is single-tenant
   * during shakedown. Same pattern as every other table in this schema.
   */
  stationRegions: defineTable({
    orgId: v.id("organizations"),
    stationId: v.id("stations"),
    kind: v.union(
      v.literal("dma"),
      v.literal("radius"),
      v.literal("venue_list"),
      v.literal("country"),
    ),
    /**
     * Region-kind-specific config. Discriminated by `kind`. See the
     * `eventRegionConfig` validators in events.ts for the typed shapes.
     */
    config: v.any(),
    /** Optional human label for the operator UI, e.g. "Milwaukee metro". */
    label: v.optional(v.string()),
    /** Polling pulls only enabled regions. Lets the operator pause sources. */
    enabled: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_station", ["stationId", "enabled"])
    .index("by_org", ["orgId"]),

  // ------------------------------------------------------------------
  // Events (Ticketmaster / AXS / custom DJ — Week 5 scope)
  // ------------------------------------------------------------------

  /**
   * Concert / show / event row. One per real-world event. Multi-source
   * dedup means two rows can describe the same show — the lower-priority
   * one carries `duplicateOf = winner._id` and is filtered from public
   * queries. Priority order is hardcoded `axs > custom > ticketmaster`
   * (see brainstorm § cross-source deduplication).
   *
   * Multi-artist events fan their headliners + supporting acts into the
   * `eventArtists` join table — `events.artistId` does NOT exist here.
   * The reverse-lookup query in plays.ts joins `eventArtists.artistKey`
   * against the artistKey of the currently-playing track.
   */
  events: defineTable({
    orgId: v.id("organizations"),
    source: v.union(v.literal("ticketmaster"), v.literal("axs"), v.literal("custom")),
    /**
     * Source's own event id. TM's event.id ("Z7r9jZ1A..."), AXS's eventId
     * ("959"). NOT unique on its own — composite with `source` for upsert.
     * Optional because custom DJ events have no upstream id.
     */
    externalId: v.optional(v.string()),
    /** Plain-text title. AXS title.eventTitle is HTML; adapter strips tags. */
    title: v.optional(v.string()),
    /** AXS `title.presentedBy` — sponsorship line, omitted if null. */
    presenterName: v.optional(v.string()),

    // Venue
    venueName: v.string(),
    /**
     * Source's venue id (AXS venueId or TM venue id). Different sources
     * have different namespaces, so this is paired with `source` for any
     * cross-source venue match. Helpful for dedup similarity scoring.
     */
    venueExternalId: v.optional(v.string()),
    city: v.string(),
    /** State/region code (e.g. "WI"). */
    region: v.string(),
    /** ISO alpha-2 country code (e.g. "US"). */
    country: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),

    // Time
    /** Unix ms of the event start (UTC). */
    startsAt: v.number(),
    /**
     * AXS `dateOnly` flag — true means the source has no specified time
     * and `startsAt` is midnight as a placeholder. Display layer should
     * show "Date TBD" or just the date without a time.
     */
    dateOnly: v.optional(v.boolean()),
    /** Optional door-open time (AXS doorDateTime). */
    doorsAt: v.optional(v.number()),
    /** Optional ticket on-sale start time. */
    onSaleAt: v.optional(v.number()),

    // Tickets
    ticketUrl: v.optional(v.string()),
    /**
     * Normalized ticketing status across sources. AXS has 38+ statusIds;
     * TM has its own enum; we collapse to a small public-facing set.
     * Public widget queries filter out `cancelled` and `postponed`.
     */
    status: v.optional(
      v.union(
        v.literal("buyTickets"),
        v.literal("soldOut"),
        v.literal("cancelled"),
        v.literal("postponed"),
        v.literal("rescheduled"),
        v.literal("venueChange"),
        v.literal("free"),
        v.literal("private"),
        v.literal("other"),
      ),
    ),

    // Media
    /** Single canonical image URL. AXS uses relatedMedia hierarchy. */
    imageUrl: v.optional(v.string()),

    // Genre (free-text label, not enum — AXS minorCategory varies)
    genre: v.optional(v.string()),

    // Cross-source dedup
    /**
     * Set when this row has been superseded by a higher-priority source's
     * row for the same real-world show (same venue + same date ±2h +
     * overlapping headliner artistKey). Public queries filter
     * `duplicateOf === undefined`. Lower-priority kept for audit / source
     * attribution.
     */
    duplicateOf: v.optional(v.id("events")),

    // Custom DJ events
    /** Set when a DJ created this event by hand via the dashboard. */
    createdBy: v.optional(v.id("users")),
    /**
     * `true` for source=axs|ticketmaster (these are authoritative),
     * defaults to `true` for source=custom. Reserved for a future
     * moderation flow.
     */
    verified: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_starts_at", ["startsAt"])
    .index("by_external_id", ["source", "externalId"])
    .index("by_org_starts", ["orgId", "startsAt"]),

  // ------------------------------------------------------------------
  // Event artists — the join from event → 1..N performers
  // ------------------------------------------------------------------

  /**
   * One row per performer per event. Headliners and supporting acts. The
   * reverse-lookup from "what's playing" to "see them tonight" pivots on
   * the `artistKey` index here — that's the join column shared with
   * `plays`'s normalized artist name.
   *
   * `artistKey` normalization is the canonical lowercase-strip-articles-
   * strip-non-alnum form. Identical for plays + events so "The Beatles"
   * (TM) matches "Beatles" (RM rotation log) on join.
   */
  eventArtists: defineTable({
    eventId: v.id("events"),
    /** Resolved canonical artist row. Optional until enrichment lands. */
    artistId: v.optional(v.id("artists")),
    /** Performer name as the source reported it. */
    artistNameRaw: v.string(),
    /** Normalized join key. Identical normalization as `plays`. */
    artistKey: v.string(),
    role: v.union(v.literal("headliner"), v.literal("support")),
    /** AXS performerId or TM attraction id, for future enrichment lookups. */
    externalPerformerId: v.optional(v.string()),
  })
    .index("by_event", ["eventId"])
    .index("by_artist_key", ["artistKey"])
    .index("by_artist", ["artistId"]),

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

  /**
   * A listener's saved songs (Alexa "save it"). Personal data: every function
   * touching this table requires Radio Commons' server key. listenerId is the
   * listener Clerk app's user id — no email or name is stored here.
   * Spec: docs/superpowers/specs/2026-10-04-finds-library-design.md
   */
  finds: defineTable({
    listenerId: v.string(),
    playId: v.id("plays"),
    trackId: v.optional(v.id("tracks")),
    dedupeKey: v.string(),
    artist: v.string(),
    title: v.string(),
    stationSlug: v.string(),
    savedAt: v.number(),
    appleMusic: v.object({
      status: appleMusicStatusValidator,
      reason: v.optional(v.string()),
      at: v.number(),
    }),
  })
    .index("by_listener_saved", ["listenerId", "savedAt"])
    .index("by_listener_dedupe", ["listenerId", "dedupeKey"]),

  /** A listener's Apple Music connection; the Music User Token is AES-256-GCM encrypted. */
  appleMusicLinks: defineTable({
    listenerId: v.string(),
    encryptedUserToken: v.string(),
    linkedAt: v.number(),
    status: v.union(v.literal("active"), v.literal("expired")),
  }).index("by_listener", ["listenerId"]),

  /** Artists a linked listener follows: from a save ("find") or by asking ("explicit"). */
  listenerFollows: defineTable({
    listenerId: v.string(),
    artistId: v.id("artists"),
    artistName: v.string(),
    status: v.union(v.literal("following"), v.literal("unfollowed")),
    source: v.union(v.literal("find"), v.literal("explicit")),
    updatedAt: v.number(),
  })
    .index("by_listener", ["listenerId", "status"])
    .index("by_listener_artist", ["listenerId", "artistId"])
    .index("by_artist", ["artistId", "status"]),

  /** Per-listener memory: the last song list shown (30 min) and the last "what's new" visit. */
  listenerState: defineTable({
    listenerId: v.string(),
    screen: v.optional(v.object({ shownAt: v.number(), playIds: v.array(v.id("plays")) })),
    lastDigestAt: v.optional(v.number()),
  }).index("by_listener", ["listenerId"]),

  /** Radio Milwaukee stories about an artist, gathered from Backstory; shared, no personal data. */
  artistWatch: defineTable({
    artistId: v.id("artists"),
    stories: v.array(
      v.object({
        storyId: v.string(),
        title: v.string(),
        show: v.string(),
        showSlug: v.string(),
        publishedAt: v.number(),
      }),
    ),
    checkedAt: v.number(),
  }).index("by_artist", ["artistId"]),

  /**
   * events.upcomingFromRotation is too slow for Alexa (7-11 s), so a cron
   * stores its answer here. key = station slug, or "all" for every station.
   */
  stationArtistShows: defineTable({
    key: v.string(),
    shows: v.array(stationArtistShowValidator),
    refreshedAt: v.number(),
  }).index("by_key", ["key"]),

  /** Cadence program schedule per station slug, refreshed every 15 minutes for alexa:stationSchedule. */
  stationSchedule: defineTable({
    station: v.string(),
    programs: v.array(scheduleProgramValidator),
    refreshedAt: v.number(),
  }).index("by_station", ["station"]),
});
