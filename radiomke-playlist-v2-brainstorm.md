# Radio Milwaukee Playlist App v2 — Architecture Brainstorm

Working doc for migrating `radiomke-playlist-app` from its Lovable + Supabase + Spinitron v1 into a multi-tenant SaaS that any public radio station can use. Conversation summary and architectural decisions so far, formatted to continue in Claude Code.

---

## Context

### v1 (current, live at playlist.radiomilwaukee.org)

Built in Lovable. React + TypeScript + Vite frontend, Supabase backend (Postgres + Edge Functions), pulls live data from Spinitron API for HYFIN and 88Nine. Features live playlist updates, historical song search, YouTube integration for previews, and embeddable widgets. Repo: https://github.com/tmoody1973/radiomke-playlist-app

### v2 goal

Productize it. Multi-tenant platform where any radio station (public or otherwise) can:

1. Sign up as an organization
2. Add one or more streams
3. Pick one or more ingestion sources per stream (Spinitron, Icecast status, StreamGuys, ICY audio-stream scraping, AzuraCast, Radio.co, HLS)
4. Get a dashboard with live "now playing," searchable history, embeddable widgets, and exportable reports
5. Benefit from a cross-tenant enrichment layer (MusicBrainz → Discogs → Spotify) that fills in missing metadata — labels, ISRCs, peak years, genres
6. Surface **upcoming live events** for artists played on the station — pulled from Ticketmaster (by station region), AXS (where available, e.g. Pabst Theater Group for Radio Milwaukee), and DJ-entered custom events. Events intersect with plays via `artistKey`, so a widget can show "Now playing: Sault — and Sault plays Turner Hall on May 14"

The Radio Milwaukee use case is the reference implementation: one org, four streams (HYFIN, 88Nine, 414 Music, Rhythm Lab), with both Spinitron and stream-ICY as parallel sources on at least some streams (Rhythm Lab in particular, where the stream is often more accurate than Spinitron logs).

---

## Stack decision

| Concern | Tool | Why |
|---------|------|-----|
| Data, real-time queries, auth context | **Convex** | Real-time subscriptions are the product's headline feature (live widgets). TypeScript-end-to-end. Already in use for Crate and Deskside, so stack-consistent. |
| Multi-tenant auth, orgs, roles | **Clerk Organizations** | One org per station (not per station-group), members with roles (admin/editor/viewer), org-scoped API keys for embeds. |
| Scheduled ingestion (API sources) | **Trigger.dev** | Multi-tenant schedules via `externalId`, concurrency keys for external API rate limits, durable retries with checkpointing, OTel-powered observability. |
| Enrichment pipeline | **Trigger.dev** | `queue: { concurrencyLimit: 1 }` on a `"musicbrainz"` key globally rate-limits every tenant's enrichment across the whole product. |
| Events ingestion (Ticketmaster, AXS) | **Trigger.dev** | Scheduled tasks, per-region queries, concurrency keys for API rate limits. Events change slowly (every 6h is fine); not real-time. |
| Persistent stream connections (ICY) | **Fly.io** | Trigger.dev isn't designed for 24/7 open sockets. One small Fly worker (shared-cpu-1x, ~$2-3/mo) holds all ICY sockets across all tenants, auto-discovers new sources via Convex subscription. |
| Frontend | **Next.js 15** | Pairs natively with Clerk and Convex. |

**What's explicitly NOT being used for v2:** Supabase (migrating off), Lovable (graduating out), per-station VMs (the Fly worker is one process for everyone).

---

## Multi-tenancy model

**Org = station**, not "org = station group." Each Radio Milwaukee stream becomes its own org (HYFIN, 88Nine, 414 Music, Rhythm Lab). Reasoning:

- Embed widgets are per-stream
- Station staff permissions differ (HYFIN music director ≠ 88Nine music director)
- Billing eventually lands per-stream
- If we onboard a station group down the road, the model scales without rework

Open: alternative is "one org with multiple stations." Decide when Clerk's org-switching UX feels right for the user flow. Current default: **one org per station**.

Roles (Clerk-native):
- `admin` — manage API keys, embeds, members, ingestion sources
- `editor` — correct metadata, flag tracks, manage widget configs
- `viewer` — dashboard access only

---

## Schema (Convex)

The key insight from the last round of brainstorming: **a station has multiple ingestion sources**, not just one. Sources can be authoritative (writes plays), supplementary (fills gaps), or verification (compares, doesn't write). The enrichment cache is **shared across all tenants** — that's the economic moat.

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  organizations: defineTable({
    clerkOrgId: v.string(),
    name: v.string(),
    slug: v.string(),                // "hyfin", "88nine"
    plan: v.union(v.literal("free"), v.literal("pro")),
  }).index("by_clerk_id", ["clerkOrgId"])
    .index("by_slug", ["slug"]),

  stations: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    slug: v.string(),
    timezone: v.string(),
    brandConfig: v.optional(v.any()),   // colors, logo, for widget theming
  }).index("by_org", ["orgId"])
    .index("by_slug", ["slug"]),

  ingestionSources: defineTable({
    stationId: v.id("stations"),
    orgId: v.id("organizations"),       // denormalized for fast queries
    kind: v.union(
      v.literal("spinitron"),
      v.literal("sgmetadata"),
      v.literal("icy"),
      v.literal("hls"),
      v.literal("icecast_status"),
      v.literal("shoutcast_v1"),
      v.literal("shoutcast_v2"),
      v.literal("azuracast"),
      v.literal("radioco"),
    ),
    config: v.any(),                    // kind-specific shape
    priority: v.number(),               // 1=primary, 2=secondary
    role: v.union(
      v.literal("authoritative"),       // writes plays directly
      v.literal("supplementary"),       // fills gaps only
      v.literal("verification"),        // compares, doesn't write
    ),
    enabled: v.boolean(),
    lastSeenAt: v.optional(v.number()),
  }).index("by_station", ["stationId"])
    .index("by_station_enabled", ["stationId", "enabled"])
    .index("by_kind_enabled", ["kind", "enabled"]),

  plays: defineTable({
    orgId: v.id("organizations"),
    stationId: v.id("stations"),
    sourceId: v.id("ingestionSources"), // which source reported this
    artist: v.string(),                 // as-reported, preserved for audit
    track: v.string(),                  // as-reported
    album: v.optional(v.string()),
    rawTitle: v.string(),
    artistKey: v.string(),              // FK to artists.artistKey — join to canonical
    trackKey: v.string(),               // FK to tracks.trackKey
    playedAt: v.number(),
    segmentType: v.optional(v.string()),
    alternates: v.optional(v.array(v.object({
      sourceId: v.id("ingestionSources"),
      artist: v.string(),
      track: v.string(),
      playedAt: v.number(),
    }))),
  }).index("by_station_recent", ["stationId", "playedAt"])
    .index("by_org_recent", ["orgId", "playedAt"])
    .index("by_artist_key", ["artistKey", "playedAt"])
    .index("by_track_key", ["trackKey", "playedAt"])
    .searchIndex("search_plays", {
      searchField: "rawTitle",
      filterFields: ["stationId", "orgId"],
    }),

  // ── SHARED CANONICAL REFERENCE (cross-tenant moat) ──
  // These tables are NOT scoped to org. One record per artist/track across the
  // entire product. When Station A pays for enrichment, Station B benefits.
  // When any station corrects a misattribution via the promotion flow, all
  // stations benefit.

  artists: defineTable({
    artistKey: v.string(),              // normalized join key
    name: v.string(),                   // canonical display name
    aliases: v.optional(v.array(v.string())),

    // External IDs
    mbid: v.optional(v.string()),
    discogsId: v.optional(v.string()),
    spotifyId: v.optional(v.string()),
    appleMusicId: v.optional(v.string()),
    isni: v.optional(v.string()),

    // Descriptive
    bio: v.optional(v.string()),
    bioSource: v.optional(v.string()),   // "wikipedia" | "musicbrainz" | "curated"
    bioUpdatedAt: v.optional(v.number()),
    genres: v.optional(v.array(v.string())),
    hometown: v.optional(v.string()),
    country: v.optional(v.string()),
    activeYears: v.optional(v.object({
      start: v.number(),
      end: v.optional(v.number()),
    })),

    // Demographics (for public-radio reporting)
    gender: v.optional(v.string()),
    vocalistGender: v.optional(v.string()),
    pronouns: v.optional(v.string()),

    // Media
    imageUrl: v.optional(v.string()),
    imageSource: v.optional(v.string()),

    // Provenance
    enrichedAt: v.number(),
    sources: v.array(v.string()),        // ["musicbrainz","discogs","curated"]
    confidence: v.number(),              // 0–1
  }).index("by_key", ["artistKey"])
    .index("by_mbid", ["mbid"]),

  tracks: defineTable({
    trackKey: v.string(),                // `${artistKey}:::${titleKey}`
    artistKey: v.string(),               // FK to artists
    title: v.string(),
    canonicalTitle: v.string(),          // stripped of "(feat. X)", "(Remastered)"

    // Recording identifiers
    isrc: v.optional(v.string()),
    mbid: v.optional(v.string()),
    spotifyId: v.optional(v.string()),
    appleMusicId: v.optional(v.string()),

    // Release context
    album: v.optional(v.string()),
    albumMbid: v.optional(v.string()),
    label: v.optional(v.string()),
    releaseDate: v.optional(v.string()),
    peakYear: v.optional(v.number()),
    durationMs: v.optional(v.number()),

    // Classification
    genres: v.optional(v.array(v.string())),
    moods: v.optional(v.array(v.string())),

    // Playback / preview
    youtubeVideoId: v.optional(v.string()),
    youtubeSearchedAt: v.optional(v.number()),
    spotifyPreviewUrl: v.optional(v.string()),
    bandcampUrl: v.optional(v.string()),

    // Structured featured artists
    featuredArtistKeys: v.optional(v.array(v.string())),

    // Provenance
    enrichedAt: v.number(),
    sources: v.array(v.string()),
    confidence: v.number(),
  }).index("by_key", ["trackKey"])
    .index("by_artist_key", ["artistKey"])
    .index("by_isrc", ["isrc"]),

  artistDiscography: defineTable({
    artistKey: v.string(),
    releaseType: v.union(
      v.literal("album"),
      v.literal("ep"),
      v.literal("single"),
      v.literal("compilation"),
      v.literal("live"),
    ),
    title: v.string(),
    releaseDate: v.optional(v.string()),
    mbid: v.optional(v.string()),
    discogsId: v.optional(v.string()),
    label: v.optional(v.string()),
    coverUrl: v.optional(v.string()),
  }).index("by_artist", ["artistKey", "releaseDate"]),

  artistLinks: defineTable({
    artistKey: v.string(),
    kind: v.union(
      v.literal("website"),
      v.literal("bandcamp"),
      v.literal("spotify"),
      v.literal("apple_music"),
      v.literal("youtube"),
      v.literal("instagram"),
      v.literal("twitter"),
      v.literal("tiktok"),
      v.literal("wikipedia"),
      v.literal("allmusic"),
      v.literal("rateyourmusic"),
      v.literal("genius"),
      v.literal("other"),
    ),
    url: v.string(),
    verifiedAt: v.optional(v.number()),
  }).index("by_artist", ["artistKey"]),

  // ── PER-TENANT OVERLAYS (editorial corrections, local context) ──
  // When a station disagrees with or wants to augment canonical data.
  // Read path merges overlay over canonical. Shared record keeps improving
  // via enrichment and the promotion flow; overlays preserve local intent.

  artistOverlays: defineTable({
    orgId: v.id("organizations"),
    artistKey: v.string(),
    fields: v.any(),                     // partial override
    reason: v.optional(v.string()),      // "local-artist spotlight", "DJ correction"
    createdBy: v.string(),
    updatedAt: v.number(),
  }).index("by_org_artist", ["orgId", "artistKey"]),

  trackOverlays: defineTable({
    orgId: v.id("organizations"),
    trackKey: v.string(),
    fields: v.any(),
    reason: v.optional(v.string()),
    createdBy: v.string(),
    updatedAt: v.number(),
  }).index("by_org_track", ["orgId", "trackKey"]),

  // ── PER-TENANT EDITORIAL/RELATIONAL (never shared) ──
  // Private notes, relationship context, programming decisions.

  artistNotes: defineTable({
    orgId: v.id("organizations"),
    artistKey: v.string(),
    note: v.string(),
    kind: v.optional(v.string()),        // "contact", "programming", "rotation", "general"
    createdBy: v.string(),
    createdAt: v.number(),
  }).index("by_org_artist", ["orgId", "artistKey"]),

  // ── CORRECTION PROMOTION QUEUE ──
  // When overlays across multiple orgs agree, surface for promotion into
  // canonical. The mechanism that turns cross-tenant signal into a better
  // shared corpus over time.

  canonicalProposals: defineTable({
    entityType: v.union(v.literal("artist"), v.literal("track")),
    entityKey: v.string(),
    field: v.string(),
    proposedValue: v.any(),
    supportingOrgs: v.array(v.id("organizations")),
    status: v.union(
      v.literal("open"),
      v.literal("accepted"),
      v.literal("rejected"),
    ),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.string()),
  }).index("by_status", ["status"])
    .index("by_entity", ["entityType", "entityKey"]),

  apiKeys: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    hashedKey: v.string(),
    scopes: v.array(v.string()),
    lastUsedAt: v.optional(v.number()),
  }).index("by_org", ["orgId"])
    .index("by_hash", ["hashedKey"]),

  ingestionEvents: defineTable({
    sourceId: v.id("ingestionSources"),
    stationId: v.id("stations"),
    kind: v.union(
      v.literal("poll_ok"),
      v.literal("poll_error"),
      v.literal("drift_detected"),
      v.literal("source_silent"),
    ),
    detail: v.optional(v.any()),
    at: v.number(),
  }).index("by_source_recent", ["sourceId", "at"]),

  // ── EVENTS LAYER ──

  stationRegions: defineTable({
    stationId: v.id("stations"),
    orgId: v.id("organizations"),
    name: v.string(),                   // "Milwaukee metro", "Madison"
    kind: v.union(
      v.literal("dma"),                 // Ticketmaster dmaId
      v.literal("radius"),              // lat/long + miles
      v.literal("venue_list"),          // explicit venues (AXS pre-filtered)
      v.literal("state"),               // state code
    ),
    config: v.any(),                    // { dmaId }, { lat, lng, radiusMiles }, { venueIds }, { stateCode }
    priority: v.number(),               // 1 = primary, 2+ = secondary
    enabled: v.boolean(),
  }).index("by_station", ["stationId"]),

  eventSources: defineTable({
    orgId: v.id("organizations"),
    stationId: v.optional(v.id("stations")),  // null = org-wide
    kind: v.union(
      v.literal("ticketmaster"),
      v.literal("axs"),
      v.literal("custom"),
    ),
    config: v.any(),                    // API keys, venue allowlist, etc.
    enabled: v.boolean(),
  }).index("by_org", ["orgId"])
    .index("by_kind_enabled", ["kind", "enabled"]),

  events: defineTable({
    orgId: v.id("organizations"),
    stationId: v.id("stations"),
    source: v.union(
      v.literal("ticketmaster"),
      v.literal("axs"),
      v.literal("custom"),
    ),
    sourceEventId: v.optional(v.string()),  // external ID for dedup & updates
    title: v.string(),
    venue: v.string(),
    venueExternalId: v.optional(v.string()),
    city: v.string(),
    region: v.optional(v.string()),
    country: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    startsAt: v.number(),
    endsAt: v.optional(v.number()),
    doorsAt: v.optional(v.number()),
    ticketUrl: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    priceMin: v.optional(v.number()),
    priceMax: v.optional(v.number()),
    currency: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("cancelled"),
      v.literal("postponed"),
      v.literal("sold_out"),
    ),
    createdBy: v.optional(v.string()),  // Clerk user id, for custom events
    duplicateOf: v.optional(v.id("events")),  // set when AXS supersedes TM for same show
    lastSeenAt: v.number(),             // last time ingestion saw this event
    updatedAt: v.number(),
  }).index("by_station_upcoming", ["stationId", "startsAt"])
    .index("by_org_upcoming", ["orgId", "startsAt"])
    .index("by_source_external", ["source", "sourceEventId"])
    .searchIndex("search_events", {
      searchField: "title",
      filterFields: ["stationId", "status"],
    }),

  eventArtists: defineTable({
    eventId: v.id("events"),
    stationId: v.id("stations"),        // denormalized for cross-lookup queries
    orgId: v.id("organizations"),
    artistKey: v.string(),              // normalized, same key as plays/enrichments
    artistName: v.string(),             // display-friendly
    role: v.union(
      v.literal("headliner"),
      v.literal("support"),
      v.literal("special_guest"),
    ),
  }).index("by_event", ["eventId"])
    .index("by_artist_station_upcoming", ["artistKey", "stationId"]),
});
```

Two deliberate decisions worth flagging:

**`plays.orgId` is denormalized** (redundant with `stations.orgId`). Makes `by_org_recent` a single index lookup instead of a join. In Convex, denormalization is the right default.

**`enrichments` has no `orgId`**. When HYFIN plays "Sault - Wildfires" and then a station in Atlanta plays it three weeks later, only the first hit goes to MusicBrainz — forever. This shared cache is the economic moat and should never be scoped per-tenant.

---

---

## Adapter architecture (the backbone)

Every ingestion source is an adapter module with a standard shape. The rest of the system — reconciliation, enrichment, storage, widgets — only sees `NormalizedPlay`. Adding a new provider later is writing one file that conforms to the interface.

Two runtime modes, decided at the adapter level:

- **`mode: "poll"`** — runs inside a Trigger.dev scheduled task. Adapter exports a `poll(config)` that returns `NormalizedPlay[]`. Good for APIs with their own provider timestamps (Spinitron, SGmetadata, Icecast status, AzuraCast).
- **`mode: "stream"`** — runs inside the Fly worker, holds a persistent connection. Adapter exports a `listen(config, signal)` async generator yielding `NormalizedPlay` on each change. Good for ICY and anything else where exact-moment precision matters.

```typescript
// packages/ingestion/src/types.ts
export interface NormalizedPlay {
  artist: string;
  track: string;
  album?: string;
  rawTitle: string;
  playedAt: number;            // epoch ms, provider-authoritative when possible
  segmentType?: "music" | "psa" | "promo" | "talk" | "id";
  externalId?: string;         // provider's play id, for dedup
  extra?: Record<string, any>;
}

export interface Adapter {
  kind: string;
  mode: "poll" | "stream";
  poll?(config: unknown): Promise<NormalizedPlay[]>;
  listen?(config: unknown, signal: AbortSignal): AsyncIterable<NormalizedPlay>;
}
```

### Adapter set

MVP: **spinitron, sgmetadata, icy.** Everything else is additive.

| Adapter | Mode | Notes |
|---------|------|-------|
| `spinitron` | poll | DJ-logged, includes segment type and show context. Per-station API key. |
| `sgmetadata` | poll | StreamGuys paid service. Requires account API key + scraper UUID per stream. |
| `icy` | stream | **Universal fallback.** Any stream URL with ICY metadata — StreamGuys streams, self-hosted Icecast/Shoutcast, CDN-fronted. No vendor involvement. |
| `hls` | poll | ID3 tags in `.ts`/`.aac` segments. Needed for modern simulcasts (NPR apps, iHeart). De-prioritize until requested. |
| `icecast_status` | poll | Self-hosted Icecast `/status-json.xsl`. |
| `shoutcast_v1` | poll | Legacy `/7.html`. |
| `shoutcast_v2` | poll | `/stats?sid=N`. |
| `azuracast` | poll | `/api/nowplaying`. Growing in community radio. |
| `radioco` | poll | Public `radio.co/stations/{id}/status`. |

### Important distinction: `sgmetadata` vs `icy` for StreamGuys streams

These are **different adapters for the same vendor**. SGmetadata is StreamGuys' paid REST API — requires account key. Pointing `icy` at a StreamGuys stream URL (like `wyms.streamguys1.com/live?platform=NPR`) is the generic ICY reader hitting a URL that happens to be hosted by StreamGuys — no StreamGuys relationship required. Both are valid; they have different tradeoffs.

Onboarding UX: when a station picks StreamGuys as their host, ask "Do you have an SGmetadata API key?" If yes → `sgmetadata` adapter. If no → `icy` adapter on their stream URL.

### Per-adapter config types (Zod-validated)

Each adapter exports a config schema and a runtime parser. The `config: v.any()` on `ingestionSources` is runtime-validated by the adapter before use, so schema-level looseness doesn't become application-level looseness.

```typescript
// packages/ingestion/src/adapters/spinitron.ts
export const SpinitronConfig = z.object({
  stationId: z.string(),
  apiKey: z.string(),
});

export const spinitronAdapter: Adapter = {
  kind: "spinitron",
  mode: "poll",
  poll: async (raw) => {
    const config = SpinitronConfig.parse(raw);
    // ... fetch & normalize
  },
};

// packages/ingestion/src/adapters/sgmetadata.ts
export const SGMetadataConfig = z.object({
  apiKey: z.string(),
  scraperUuid: z.string(),
  baseUrl: z.string().optional(),    // confirm per-account URL with SG rep
});

// packages/ingestion/src/adapters/icy.ts
export const IcyConfig = z.object({
  streamUrl: z.string().url(),
  userAgent: z.string().optional(),
});

// packages/ingestion/src/adapters/hls.ts
export const HlsConfig = z.object({
  playlistUrl: z.string().url(),     // .m3u8
});
```

### Adapter registry

```typescript
// packages/ingestion/src/registry.ts
import { spinitronAdapter } from "./adapters/spinitron";
import { sgmetadataAdapter } from "./adapters/sgmetadata";
import { icyAdapter } from "./adapters/icy";
import { hlsAdapter } from "./adapters/hls";

export const adapters = {
  spinitron: spinitronAdapter,
  sgmetadata: sgmetadataAdapter,
  icy: icyAdapter,
  hls: hlsAdapter,
  // add more as built
} as const;

export type AdapterKind = keyof typeof adapters;
```

### Orchestration is source-agnostic

With the registry in place, neither the Trigger.dev tasks nor the Fly worker contains provider-specific branches. They iterate sources from Convex, look up the adapter by kind, and call `poll()` or `listen()`.

```typescript
// trigger/poll-sources.ts  (replaces per-provider tasks)
export const pollSources = schedules.task({
  id: "poll-sources",
  cron: "*/20 * * * * *",
  run: async () => {
    const sources = await convexFetch("/sources/by-mode/poll");
    for (const src of sources) {
      const adapter = adapters[src.kind as AdapterKind];
      if (!adapter?.poll) continue;
      try {
        const plays = await adapter.poll(src.config);
        await convexPost("/ingest", {
          sourceId: src._id, stationId: src.stationId, orgId: src.orgId, plays,
        });
      } catch (e) {
        await convexPost("/ingestion-events", {
          sourceId: src._id, kind: "poll_error", detail: { message: String(e) },
        });
      }
    }
  },
});
```

The Fly worker does the same loop over `mode: "stream"` adapters.

**Net effect:** adding Radio.co support in six months is one new file in `packages/ingestion/src/adapters/`, one registry line, zero changes anywhere else.

---

## Adapter testing strategy

Shipping adapters for stations you don't own means you'll release code having never seen the real provider's production response. The goal isn't 100% certainty — it's "catch breakage before the station notices, fix before they churn." Six layers, each compensating for the others.

### Layer 1 — Contract tests against recorded fixtures (offline, fast, free)

The foundation. Every adapter splits `fetch()` from `parse()`. Parse is pure and operates on raw response data with zero network. Tests exercise parse against a growing fixture library.

```typescript
export const spinitronAdapter: Adapter = {
  kind: "spinitron",
  mode: "poll",
  parse(raw: unknown): NormalizedPlay[] {  // PURE — tests hit this
    const data = SpinitronResponse.parse(raw);
    return data.items.map(normalizeSpinitronItem);
  },
  poll: async (rawConfig) => {
    const config = SpinitronConfig.parse(rawConfig);
    const r = await fetch(...);
    return spinitronAdapter.parse(await r.json());
  },
};
```

Collect fixtures aggressively. Real response payloads from real providers, committed to the repo. Each bug found in production becomes a new fixture so it never regresses. Fixtures grow over time — that's the point.

### Layer 2 — Live-read tests against public endpoints (CI-scheduled, cheap)

A nightly CI job curls a list of public endpoints (Icecast status URLs, public Shoutcast boxes, public ICY streams) and runs adapter parse over the response. Catches provider-side breaking changes within 24 hours. Every adapter has a growing list of known-good public targets.

```typescript
// packages/ingestion/scripts/liveness.ts — runs nightly in CI
const liveTargets = [
  { kind: "icecast_status", url: "https://stream.somafm.com/status-json.xsl" },
  { kind: "icy",            url: "https://wyms.streamguys1.com/live" },
  // ... 10-20 public endpoints per adapter
];
for (const t of liveTargets) {
  const plays = await adapters[t.kind].poll({ url: t.url });
  assertValid(plays);
}
```

### Layer 3 — Mock servers for end-to-end tests

Small Fastify servers (or MSW handlers) that replay fixtures. In dev, adapters point at `localhost:4501` instead of real endpoints. Full pipeline runs — poll → ingest → dedupe → enrich → widget render — without external services.

Extends into a **simulator** for reconciliation scenarios: scripted sequences that emit paired plays on two mock sources to test merge rules, drift detection, silence alarms. Every reconciliation rule should have a simulator test; this is hard to exercise against real services.

### Layer 4 — Shadow mode against Radio Milwaukee (the best layer)

This is why SGmetadata for Radio Milwaukee is more than a data-quality decision — it's a continuous adapter test harness. With SGmetadata as authoritative, you can run other adapters in `verification` role against the same streams and compare.

WYMS stream supports both SGmetadata (paid, structured, authoritative) and generic ICY scraping (free, universal). Run both. SGmetadata plays get written to the main `plays` table. ICY plays flow into a parallel comparison view. Over two months, you accumulate thousands of paired observations:

- How often does `icy` parse the artist correctly?
- What's the typical timestamp drift between structured and ICY metadata?
- What tracks break the `splitTitle()` heuristic?
- What ad-break patterns show up in ICY that SGmetadata filters?

You're testing the universal-fallback adapter against ground truth on your own streams, free, continuous. Every lesson learned ships to every external station.

### Layer 5 — Pre-flight validation at onboarding

When a station adds an ingestion source, the dashboard runs a live sample fetch and shows a preview:

```typescript
export const validateSource = action({
  args: { kind: v.string(), config: v.any() },
  handler: async (ctx, { kind, config }) => {
    const adapter = adapters[kind];
    const plays = adapter.mode === "poll"
      ? await adapter.poll(config)
      : await sampleStreamOnce(adapter, config, 15_000);
    return {
      ok: true,
      sample: plays.slice(0, 5),
      warnings: validatePlays(plays),  // "empty artist on 3/5", etc.
    };
  },
});
```

Station sees "we pulled these 5 plays — does this look right?" before committing. Catches 90% of misconfigurations at onboarding. Wrong API key, wrong scraper UUID, stream doesn't emit ICY, normalizer producing garbage — all surface immediately, not in a ticket two days later.

### Layer 6 — Production health monitoring (always-on)

Every poll logs to `ingestionEvents`. Source-health dashboard flags:

- Source silent > expected interval × 3 → `source_silent`
- Parse error rate > 10% in last hour → `parse_degraded`
- Play volume anomaly (typical 20/hr, suddenly 3) → `volume_anomaly`
- Artist-key resolution rate drops < 70% → `enrichment_degraded`

During the shakedown, these page Slack. When external stations onboard, each org gets its own notification preferences.

### Radio Milwaukee shakedown configuration

SGmetadata as authoritative primary across all four streams; Spinitron as supplementary for segment context; ICY as shadow-mode verification on selected streams for continuous adapter QA:

| Stream | Primary (authoritative) | Supplementary | Verification (shadow) |
|--------|------------------------|----------------|------------------------|
| HYFIN | SGmetadata | Spinitron | ICY |
| 88Nine | SGmetadata | Spinitron | — |
| Rhythm Lab | SGmetadata | Spinitron | ICY |
| 414 Music | SGmetadata | Spinitron | — |

Radio Milwaukee gets best-quality data; the product gets a continuous test harness for the universal-fallback `icy` adapter with SGmetadata as ground truth.

### Blocking action: SGmetadata credentials from StreamGuys

Email StreamGuys rep now (lead time is a few days):

1. Account API key
2. Scraper UUID for WYMS (88Nine)
3. Scraper UUID for HYFIN
4. Scraper UUID for 414 Music
5. Scraper UUID for Rhythm Lab
6. Confirmation of REST base URL for the account
7. Whether SmartMetadata (fingerprinting) is enabled — unlocks structured label/ISRC fields

Build the `sgmetadata` adapter against published docs + fixtures while waiting; swap in credentials when they land.

---



---

## Ingestion architecture

Three layers, split by source shape:

```
┌───────────────────────────────────────────────┐
│  Trigger.dev                                  │
│  - Scheduled tasks per provider type          │
│    (poll-spinitron, poll-icecast, etc.)       │
│  - Enrichment tasks with concurrency keys     │
│  - POST results → Convex /ingest HTTP action  │
└───────────────────────────────────────────────┘
                      │
                      ▼
┌───────────────────────────────────────────────┐
│  Convex                                       │
│  - Schema, mutations, queries                 │
│  - Real-time subscriptions (widgets, dashes)  │
│  - HTTP actions: /ingest, /widget/:slug       │
│  - Auth context from Clerk JWT                │
└───────────────────────────────────────────────┘
                      ▲
                      │
┌───────────────────────────────────────────────┐
│  Fly.io (one cheap VM, not per-station)       │
│  - Holds all ICY/stream persistent sockets    │
│  - Auto-discovers new sources via Convex sub  │
│  - Reports exact-moment changes to /ingest    │
└───────────────────────────────────────────────┘
```

### Trigger.dev scheduled polling (API sources)

One scheduled task per provider type, iterating all stations of that type. Only split to per-station schedules if different stations need different cadences.

```typescript
// trigger/poll-spinitron.ts
import { schedules } from "@trigger.dev/sdk";

export const pollSpinitron = schedules.task({
  id: "poll-spinitron",
  cron: "*/20 * * * * *",            // every 20s
  maxDuration: 60,
  run: async () => {
    const sources = await convexFetch("/sources/by-kind/spinitron");
    await Promise.all(sources.map(pollOne));
  },
});

async function pollOne(source) {
  const r = await fetch(
    `https://spinitron.com/api/spins?station=${source.config.stationId}&count=5`,
    { headers: { Authorization: `Bearer ${source.config.apiKey}` }}
  );
  const { items } = await r.json();
  if (!items?.length) return;
  await convexPost("/ingest", {
    sourceId: source._id,
    stationId: source.stationId,
    orgId: source.orgId,
    plays: items.map(i => ({
      artist: i.artist,
      track: i.song,
      album: i.release,
      rawTitle: `${i.artist} - ${i.song}`,
      playedAt: new Date(i.start).getTime(),  // provider timestamp is authoritative
      segmentType: i.type,
    })),
  });
}
```

### Fly.io persistent stream worker

One process, one deployment, handles every ICY/stream source across every tenant. Auto-discovers new sources via Convex subscription.

```typescript
// worker/icy-worker.ts  (runs on Fly)
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const convex = new ConvexClient(process.env.CONVEX_URL!);
const connections = new Map<string, AbortController>();

convex.onUpdate(api.sources.streamSources, {}, (sources) => {
  const activeIds = new Set(sources.map(s => s._id));

  // Close connections for sources no longer active
  for (const [id, ctrl] of connections) {
    if (!activeIds.has(id)) {
      ctrl.abort();
      connections.delete(id);
    }
  }

  // Open connections for new sources
  for (const source of sources) {
    if (!connections.has(source._id)) {
      const ctrl = new AbortController();
      connections.set(source._id, ctrl);
      streamLoop(source, ctrl.signal).catch(err => {
        console.error(`stream ${source._id} died:`, err);
        connections.delete(source._id);
      });
    }
  }
});

async function streamLoop(source, signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      for await (const np of readIcyStream(source.config.streamUrl, signal)) {
        await fetch(`${process.env.CONVEX_URL}/ingest`, {
          method: "POST",
          headers: {
            "x-ingest-key": process.env.INGEST_KEY!,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            sourceId: source._id,
            stationId: source.stationId,
            orgId: source.orgId,
            artist: np.artist,
            track: np.track,
            rawTitle: np.rawTitle,
            playedAt: Date.now(),       // exact moment of change
          }),
        });
      }
    } catch (e) {
      if (signal.aborted) return;
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

async function* readIcyStream(url: string, signal: AbortSignal) {
  const headers = { "Icy-MetaData": "1", "User-Agent": "playlist-logger/1.0" };
  const r = await fetch(url, { headers, signal });
  const metaint = parseInt(r.headers.get("icy-metaint") ?? "0");
  if (!metaint) throw new Error("No icy-metaint header");
  const reader = r.body!.getReader();
  let last: string | null = null;
  let buffer = new Uint8Array(0);

  while (!signal.aborted) {
    // read until we have metaint + 1 bytes
    while (buffer.length < metaint + 1) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer = concat(buffer, value);
    }
    const metaLen = buffer[metaint] * 16;
    while (buffer.length < metaint + 1 + metaLen) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer = concat(buffer, value);
    }
    if (metaLen > 0) {
      const metaBytes = buffer.slice(metaint + 1, metaint + 1 + metaLen);
      const meta = new TextDecoder("utf-8").decode(metaBytes).replace(/\0+$/, "");
      const m = meta.match(/StreamTitle='([^']*)'/);
      if (m && m[1] && m[1] !== last) {
        last = m[1];
        const [artist, track] = splitTitle(m[1]);
        yield { artist, track, rawTitle: m[1] };
      }
    }
    buffer = buffer.slice(metaint + 1 + metaLen);
  }
}

function splitTitle(t: string): [string, string] {
  if (t.includes(" - ")) {
    const [a, ...rest] = t.split(" - ");
    return [a.trim(), rest.join(" - ").trim()];
  }
  return ["", t.trim()];
}

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length);
  return out;
}
```

**Sizing note:** one `shared-cpu-1x` with 256MB RAM can comfortably hold 50-100 ICY sockets because each is a sleeping I/O handle. Run two machines in different regions for redundancy; Convex dedupes at the play level via `(stationId, playedAt)` + small tolerance window.

---

## Multi-source reconciliation

The Radio Milwaukee reality: some streams have Spinitron AND stream-ICY as parallel sources. They disagree. Spinitron is sometimes late, sometimes wrong, sometimes missing entries. Stream-ICY doesn't have show/segment context. The product needs to merge them intelligently.

Rules (draft — needs refinement):

1. **Authoritative source writes a play.** Priority 1 authoritative source is the ground truth.
2. **Supplementary source within tolerance window** (default ±45s) → merged into existing play as an `alternate`, fields filled in where authoritative source has gaps (album, label, segment type).
3. **Supplementary source outside window** → new play, flagged as "supplementary orphan" for review.
4. **Conflicting text** (same artist, different spelling) → authoritative wins; alternate recorded; `ingestionEvents` fires a `drift_detected` event if conflicts exceed N per day per station.
5. **Silence alarm:** if a source hasn't reported in > expected interval × 3, fire `source_silent` event, surface in dashboard.

Open questions for later:
- What's the right tolerance window for "same play"?
- When sources disagree, should dashboard show the authoritative version or a "merged" view?
- Is there a station-configurable tie-breaking rule (e.g., "Spinitron wins for metadata, ICY wins for timestamp")?

---

## Shared canonical data (the moat)

**The single most important architectural decision in the product.** Artists, tracks, discographies, and external links are factual data about the world, not tenant-owned data. Scoping them per-tenant means every station pays to rediscover the same facts; sharing them means the product gets smarter and cheaper with every tenant added.

This is why the schema has **three layers** for music reference data:

1. **Canonical (shared, cross-tenant):** `artists`, `tracks`, `artistDiscography`, `artistLinks`. One record per artist/track across the entire product. Built by enrichment adapters (MusicBrainz, Discogs, Spotify, Wikipedia). Read-everyone, write-system-only.
2. **Overlays (per-tenant, additive):** `artistOverlays`, `trackOverlays`. When a station disagrees with or wants to augment canonical data. Read path merges overlay over canonical. Shared record keeps improving via enrichment; overlays preserve local intent.
3. **Editorial (per-tenant, private):** `artistNotes`. Programming decisions, contact info, relationship context. Never shared. Another station should never see Rhythm Lab's internal note that "artist declined interview in 2024."

### What belongs where

The principle: **if another station would benefit from knowing this, it's shared; if it's editorial/relational/private, it's per-tenant.**

| Field | Layer | Reasoning |
|-------|-------|-----------|
| MBID, ISRC, Spotify/Apple IDs | canonical | Factual, immutable, identifier data |
| Canonical name, aliases | canonical | One truth |
| Bio (Wikipedia, MusicBrainz source) | canonical | Public-domain / permissively-licensed facts |
| Discography, release dates, labels | canonical | Same |
| Public social links (Bandcamp, IG, Spotify) | canonical | Public-facing, non-controversial |
| YouTube video ID for playback preview | canonical | Expensive to search per-tenant; same result everywhere |
| Genre tags, peak year | canonical | Factual but sometimes contested — use `confidence` + overlays for disagreement |
| Hometown (where contested) | canonical + overlay | Canonical from MB/Wikipedia; overlay if station knows better (local artist case) |
| Station's Sound Code or internal genre | overlay | Each station's classification system differs |
| DJ's hand-written bio for local artist | overlay | Station's editorial voice |
| "Artist declined interview 2024" | note | Private, relationship |
| "Booking contact is xyz@mgmt.com" | note | Private, operational |

### The feedback loop that turns overlays into a better corpus

When multiple stations independently overlay the same field with the same value, that's signal: the canonical record is probably wrong. The `canonicalProposals` table surfaces these agreements for review. A curator (Radio Milwaukee staff, or a trusted-station network moderator) accepts or rejects; accepted proposals promote into canonical.

Implementation sketch:

```typescript
// convex/overlays.ts — runs after any overlay write
export const detectConvergence = internalMutation({
  args: { entityType: v.string(), entityKey: v.string(), field: v.string() },
  handler: async (ctx, { entityType, entityKey, field }) => {
    const table = entityType === "artist" ? "artistOverlays" : "trackOverlays";
    const keyField = entityType === "artist" ? "artistKey" : "trackKey";
    const overlays = await ctx.db
      .query(table)
      .withIndex("by_key", q => q.eq(keyField, entityKey))
      .collect();

    // Group by value of the field
    const valueGroups = new Map<string, typeof overlays>();
    for (const o of overlays) {
      if (!(field in o.fields)) continue;
      const v = JSON.stringify(o.fields[field]);
      if (!valueGroups.has(v)) valueGroups.set(v, []);
      valueGroups.get(v)!.push(o);
    }

    // If 3+ orgs agree on a value, open a promotion proposal
    for (const [value, group] of valueGroups) {
      if (group.length >= 3) {
        await ctx.db.insert("canonicalProposals", {
          entityType: entityType as "artist" | "track",
          entityKey,
          field,
          proposedValue: JSON.parse(value),
          supportingOrgs: group.map(g => g.orgId),
          status: "open",
          createdAt: Date.now(),
        });
      }
    }
  },
});
```

Thresholds are tunable; start at 3 supporting orgs and adjust. The point is that tenants become quality sensors for the shared corpus without any explicit work on their part.

### Read-path merging

Every query that returns artist or track data must merge overlay over canonical. One utility function:

```typescript
// convex/lib/merge.ts
export async function getArtistForOrg(ctx, orgId, artistKey) {
  const [canonical, overlay] = await Promise.all([
    ctx.db.query("artists").withIndex("by_key", q => q.eq("artistKey", artistKey)).unique(),
    ctx.db.query("artistOverlays")
      .withIndex("by_org_artist", q => q.eq("orgId", orgId).eq("artistKey", artistKey))
      .unique(),
  ]);
  if (!canonical) return overlay ? { artistKey, ...overlay.fields, _overlayOnly: true } : null;
  return overlay
    ? { ...canonical, ...overlay.fields, _hasOverlay: true, _overlaySource: overlay.reason }
    : canonical;
}
```

The `_hasOverlay` flag is consumed by the dashboard UI to show "this field has been customized for your station" with an option to revert to canonical.

### Enrichment waterfall (writes canonical)

The `gselector-enricher` logic extracts into `packages/enrichment` and runs as Trigger.dev tasks with concurrency keys for external API rate limits:

```typescript
// trigger/enrich-artist.ts
export const enrichArtist = task({
  id: "enrich-artist",
  queue: { name: "musicbrainz", concurrencyLimit: 1 },  // global MB rate
  retry: { maxAttempts: 5, factor: 2, minTimeoutInMs: 1000 },
  run: async ({ artistKey }: { artistKey: string }) => {
    const existing = await convexQuery("/artists/byKey", { artistKey });
    if (existing && existing.confidence > 0.8 && recentEnough(existing.enrichedAt)) return;

    const mb = await musicbrainzArtistLookup(artistKey);
    const dc = await discogsArtistLookup(artistKey);
    const sp = await spotifyArtistLookup(artistKey);
    const wiki = mb?.wikipediaTitle ? await wikipediaExtract(mb.wikipediaTitle) : null;

    await convexMutation("/artists/upsert", {
      artistKey,
      ...mergeArtistSources(mb, dc, sp, wiki),
    });

    // Fan out to discography and links
    if (mb?.id) await enrichDiscography.trigger({ mbid: mb.id, artistKey });
    await enrichArtistLinks.trigger({ artistKey, seed: { mb, dc, sp } });
  },
});

// Similar enrichTrack — triggered from play ingestion when trackKey isn't in tracks yet
```

Enrichment is triggered from the ingestion path: `/ingest` HTTP action checks if `artistKey` and `trackKey` exist in canonical tables; if not, enqueues enrichment tasks. Enrichment never blocks ingestion — plays are written immediately, enrichment backfills asynchronously.

### Why this is the moat

Competitors can scrape ICY metadata and poll Spinitron. They cannot easily replicate a cross-tenant enrichment corpus that's been running against hundreds of public radio stations for years — with every station's corrections flowing back into a canonical database that nobody else has. Every new station makes the shared data better; every correction anywhere improves the product everywhere. This compounds over time in a way single-tenant competitors structurally can't match.

It also unlocks product directions beyond playlist logging: a public artist-reference API, a curated music-discovery feed, SoundExchange-ready metadata export. Those are all downstream of the same shared corpus.

---

## Events layer

Events is a second data graph that intersects with plays via `artistKey`. Three sources feed it: Ticketmaster (geographic — by station region), AXS (venue-scoped — Pabst Theater Group for Radio Milwaukee, possibly other venue groups later), and custom DJ-entered events. All three normalize into the same `events` + `eventArtists` shape so downstream widgets and queries don't care where the event came from.

### Why events intersect with plays

The core unlock: when a track plays, a reverse-lookup query finds upcoming events in this station's region featuring that artist. Convex makes this trivially real-time — the widget subscribes to both the current play and the matching events, and updates the moment either changes. This turns "now playing" into **"now playing + see them live,"** which is a real product for public radio (and a concrete piece of value the station can sell to venue partners).

The reverse direction is equally useful: when the music director is planning a week, they want to see "artists in our rotation who are touring within 200 miles in the next 60 days." That's a single query: join `eventArtists` to recent `plays` via `artistKey`, filter by station region and date range.

### Region model

Each station has one or more regions they care about. Milwaukee-based stations probably want Milwaukee metro primary, Madison and Chicago as secondary. The `stationRegions` table supports four kinds:

- **`dma`** — Ticketmaster's `dmaId`. Cleanest match to Ticketmaster's own data model.
- **`radius`** — lat/long + miles. Flexible; works for any provider that accepts coordinates.
- **`venue_list`** — explicit venue IDs. How AXS integration works (pre-filtered to Pabst venues).
- **`state`** — state code. Catches events at venues that don't have clean DMA/geo tagging.

Stations enable the regions they want at onboarding. Ticketmaster queries fan out across regions; AXS queries ignore regions and use the venue allowlist instead.

### Ticketmaster adapter

Ticketmaster Discovery API, `/discovery/v2/events.json`, classification = Music, filtered by `dmaId` or `latlong` + `radius`. Returns events with attractions (artists), venue, dates, price range, ticket URL, images. Rate limits are conservative (5 req/s, 5000/day default — request higher quota for multi-tenant use).

```typescript
// trigger/poll-ticketmaster.ts
import { schedules } from "@trigger.dev/sdk";

export const pollTicketmaster = schedules.task({
  id: "poll-ticketmaster",
  cron: "0 */6 * * *",              // every 6 hours; events don't change that fast
  queue: { name: "ticketmaster", concurrencyLimit: 2 },
  run: async () => {
    const sources = await convexFetch("/eventSources/by-kind/ticketmaster");
    for (const src of sources) {
      const regions = await convexFetch(`/stations/${src.stationId}/regions`);
      const events = [];
      for (const region of regions) {
        events.push(...await fetchTMEvents(region, src.config.apiKey));
      }
      await convexPost("/events/upsert-batch", {
        orgId: src.orgId,
        stationId: src.stationId,
        source: "ticketmaster",
        events,
      });
    }
  },
});

async function fetchTMEvents(region, apiKey: string) {
  const params = new URLSearchParams({
    apikey: apiKey,
    classificationName: "Music",
    size: "200",
    sort: "date,asc",
    startDateTime: new Date().toISOString().slice(0, 19) + "Z",
  });
  if (region.kind === "dma") params.set("dmaId", String(region.config.dmaId));
  if (region.kind === "radius") {
    params.set("latlong", `${region.config.lat},${region.config.lng}`);
    params.set("radius", String(region.config.radiusMiles));
    params.set("unit", "miles");
  }
  if (region.kind === "state") params.set("stateCode", region.config.stateCode);

  const r = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);
  const data = await r.json();
  return (data._embedded?.events ?? []).map(normalizeTMEvent);
}

function normalizeTMEvent(e) {
  const venue = e._embedded?.venues?.[0];
  const attractions = e._embedded?.attractions ?? [];
  return {
    sourceEventId: e.id,
    title: e.name,
    venue: venue?.name ?? "",
    venueExternalId: venue?.id,
    city: venue?.city?.name ?? "",
    region: venue?.state?.stateCode,
    country: venue?.country?.countryCode,
    latitude: venue?.location ? parseFloat(venue.location.latitude) : undefined,
    longitude: venue?.location ? parseFloat(venue.location.longitude) : undefined,
    startsAt: new Date(e.dates.start.dateTime).getTime(),
    ticketUrl: e.url,
    imageUrl: pickBestImage(e.images),
    priceMin: e.priceRanges?.[0]?.min,
    priceMax: e.priceRanges?.[0]?.max,
    currency: e.priceRanges?.[0]?.currency,
    status: mapTMStatus(e.dates.status.code),
    artists: attractions.map((a, i) => ({
      artistKey: normalize(a.name),
      artistName: a.name,
      role: i === 0 ? "headliner" : "support",
    })),
  };
}
```

### AXS adapter

AXS is the interesting one because it's authoritative for specific venue groups that Ticketmaster often doesn't list (or lists late with worse metadata). For Radio Milwaukee, AXS covers Pabst Theater Group venues — The Pabst, Riverside, Turner Hall, Vivarium, Back Room at Colectivo. When AXS and Ticketmaster both list the same Pabst show, AXS wins.

```typescript
// trigger/poll-axs.ts
export const pollAxs = schedules.task({
  id: "poll-axs",
  cron: "0 */4 * * *",              // AXS is authoritative; poll more often
  queue: { name: "axs", concurrencyLimit: 1 },
  run: async () => {
    const sources = await convexFetch("/eventSources/by-kind/axs");
    for (const src of sources) {
      const events = await fetchAxsEvents(src.config);
      await convexPost("/events/upsert-batch", {
        orgId: src.orgId,
        stationId: src.stationId,
        source: "axs",
        events,
      });
    }
  },
});
```

Exact endpoint shape is TBD based on the license agreement docs. The key is that `upsert-batch` dedupes against `(source, sourceEventId)` and handles cross-source deduplication (see below).

### Cross-source deduplication

Ticketmaster and AXS will list the same Pabst show. The Convex mutation `events.upsertBatch` handles this:

1. Upsert by `(source, sourceEventId)` — preserves external IDs per source.
2. Run a similarity pass: for each new event, look for existing events at same venue + same date (within ±2h window) + overlapping headliner `artistKey`.
3. If match found and incoming source has higher priority than existing, set existing `duplicateOf = newEventId`. Higher-priority source wins for display; lower-priority kept for audit.
4. Priority order (configurable per station): `axs > custom > ticketmaster`. AXS beats TM for Pabst shows; custom DJ notes beat TM for shows the DJ has extra context on.
5. Widget and dashboard queries filter out `duplicateOf != null` by default.

### Custom DJ events

The v1 feature stays and gets modernized. UI in the dashboard (editor role+):

- Title, venue, city, start time
- Ticket URL (optional)
- Multi-artist input with autocomplete against `enrichments` (canonical artist names seen in the station's plays)
- Free-text artist also works, normalized via `artistKey`
- Option: "copy from Ticketmaster" — pre-fills from a TM event but flips source to `custom` and preserves DJ annotations

When a DJ adds a custom event, the form side-shows "this artist has been played N times in the last 30 days" as a feedback loop. When a DJ enters an artist the station hasn't played, a gentle nudge — "artist not in rotation; consider for spotlight?"

### Artist matching — the join key

The `artistKey` normalization must be identical between plays, enrichments, and eventArtists. Shared utility:

```typescript
// packages/enrichment/src/normalize.ts
export function artistKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // strip accents
    .replace(/\b(the|a|an)\b/g, "")                      // strip articles
    .replace(/[^a-z0-9]/g, "")
    .trim();
}
```

"The Beatles", "Beatles", "THE BEATLES" → `"beatles"`. "Sault" → `"sault"`. "Flying Lotus" → `"flyinglotus"`. Not perfect — "Prince" is a problem, and featured-artist strings ("Kendrick Lamar feat. SZA") need splitting — but this is the bar to start from. Ambiguous matches get queued for manual review.

### Reverse lookup: "what's touring from our rotation?"

A single Convex query powers the music director's "artists in our rotation who are touring nearby" view:

```typescript
// convex/events.ts
export const touringFromRotation = query({
  args: { stationId: v.id("stations"), withinDays: v.number() },
  handler: async (ctx, { stationId, withinDays }) => {
    // Get recent plays for this station (last 30 days)
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentPlays = await ctx.db
      .query("plays")
      .withIndex("by_station_recent", q =>
        q.eq("stationId", stationId).gte("playedAt", since))
      .collect();

    // Unique artistKeys, ranked by spin count
    const artistCounts = new Map<string, number>();
    for (const p of recentPlays) {
      const k = artistKey(p.artist);
      artistCounts.set(k, (artistCounts.get(k) ?? 0) + 1);
    }

    // For each artist, find upcoming events at this station's regions
    const horizon = Date.now() + withinDays * 24 * 60 * 60 * 1000;
    const results = [];
    for (const [key, spinCount] of artistCounts) {
      const matches = await ctx.db
        .query("eventArtists")
        .withIndex("by_artist_station_upcoming", q =>
          q.eq("artistKey", key).eq("stationId", stationId))
        .collect();
      for (const ea of matches) {
        const event = await ctx.db.get(ea.eventId);
        if (event && event.startsAt <= horizon && !event.duplicateOf) {
          results.push({ event, artist: ea.artistName, spinCount });
        }
      }
    }
    return results.sort((a, b) => b.spinCount - a.spinCount);
  },
});
```

This becomes a dashboard page: "Top artists in rotation with upcoming Milwaukee-area shows." Music directors will immediately use this.

### Widget surfacing

The public widget has a new optional section: when the current play's artist has upcoming events, show a compact "LIVE:" row beneath the track. Tap/click expands to venue + date + ticket link. Embedded partner revenue hook if the station has affiliate agreements with Ticketmaster or AXS.

---

## Embeddable widgets (JS-first, iframe fallback)

v1 used iframes. v2 defaults to **JavaScript embeds**, with iframes as a fallback for CMSes that strip `<script>` tags. The reasoning is practical: the widget ecosystem is the main public touchpoint of the product, and iframes bottleneck nearly every dimension we care about — performance, SEO, responsive sizing, theming, real-time coalescing, and integration UX.

### Why JS, concretely

- **Responsive sizing just works.** Iframes need fixed heights or `postMessage` dances. JS renders into a container the host already sized; the widget flows with the page.
- **One Convex subscription shared across all widgets on a page.** Three iframes = three WebSocket connections. Three JS widgets = one connection, three subscribers.
- **SEO and accessibility.** Iframe content isn't in the host DOM — doesn't get indexed, doesn't appear in page search, screen readers treat it as a separate document. Public radio stations care about "recently played" tracklists being searchable on their site.
- **Theming inherits.** JS widgets can read CSS custom properties (`--font-family`, `--color-primary`) from the host page, so widgets look native instead of pasted-in. Iframes can't without explicit config copying.
- **Events surfacing works naturally.** The "Now playing + see them live" feature needs plays and events on the same surface. JS widget: one bundle, one query subscription. Iframe: either duplicate the events logic inside the iframe or post-message across the boundary.
- **Partner DX.** One `<script>` tag that works is a smoother onboarding than picking a height, styling the iframe element, dealing with sandbox attributes, and fielding "iframe looks broken on mobile" tickets.

### Where iframes still win (keep as fallback, not default)

Iframes are truly isolated — no CSS collisions, no JS conflicts, no risk a host page's CSS blows up your widget. Some CMSes (older SquareSpace, locked-down SharePoint, a few public-sector intranets) strip `<script>` tags entirely. Ship an iframe route as the escape hatch, same widget bundle, hosted at `/embed/iframe/:slug`.

### Three integration modes

```html
<!-- 1. One-line drop-in — the default -->
<script src="https://embed.radiomke-v2.example/widget.js"
        data-station="hyfin"
        data-variant="now-playing-strip"
        async></script>
```

```html
<!-- 2. Declarative placement with config -->
<div id="rmke-widget"
     data-station="rhythmlab"
     data-variant="recently-played"
     data-max-items="10"
     data-show-events="true"
     data-theme="auto"></div>
<script src="https://embed.radiomke-v2.example/widget.js" async></script>
```

```html
<!-- 3. Programmatic API for deep integrations -->
<script src="https://embed.radiomke-v2.example/widget.js" async></script>
<script>
  RMKEWidget.ready(() => {
    const w = RMKEWidget.mount("#container", {
      station: "88nine",
      variant: "recently-played",
      onTrackChange: (play) => { /* host-side analytics hook */ },
      onEventClick: (event) => { /* ticketing click-through */ },
    });
    w.update({ maxItems: 20 });
    w.destroy();
  });
</script>
```

```html
<!-- 4. Iframe fallback for script-hostile CMSes -->
<iframe src="https://embed.radiomke-v2.example/iframe/hyfin/now-playing-strip?theme=dark"
        style="width:100%; height:120px; border:none;"></iframe>
```

### Technical approach — keep the bundle small

The failure mode of most JS embeds is shipping React + a full design system and blowing up the host page. To avoid that:

- **Preact, not React**, for the embed build target specifically (~3KB vs ~45KB). Convex's client works with Preact via its framework-agnostic core. The dashboard stays on React; the embed is a separate build.
- **Code-split by variant.** `widget.js` is a ~5KB loader that reads `data-variant` and dynamically imports only that variant's chunk (`now-playing-strip.js`, `recently-played.js`, `events-feed.js`, `search.js`).
- **Shadow DOM for style isolation.** Gets the one advantage iframes had (no CSS leak in either direction) without the iframe. CSS custom properties still pierce the shadow boundary, so host-page theming still works.
- **Shared connection detection.** On second `<script>` load on a page, reuse the existing Convex connection instead of opening a new one.

Budget to hold: **~15KB gzip** for loader + one variant. Larger than `<iframe src="...">` but smaller than most analytics scripts stations already run.

### Widget variants (MVP set)

| Variant | Purpose |
|---------|---------|
| `now-playing-strip` | Compact current-track bar. Most common embed. |
| `now-playing-card` | Larger card with album art, optional "see them live" event surfacing. |
| `recently-played` | Scrollable list of last N tracks with search. |
| `events-feed` | Upcoming events in station region (Ticketmaster/AXS/custom), with "played on this station" badges. |
| `schedule` | Live show / program schedule from Spinitron. |

### Widgets schema

```typescript
widgets: defineTable({
  orgId: v.id("organizations"),
  stationId: v.id("stations"),
  slug: v.string(),                    // short id used in data-station
  variant: v.string(),                 // "now-playing-strip" | "recently-played" | ...
  config: v.any(),                     // variant-specific defaults (maxItems, showEvents, theme)
  allowedOrigins: v.optional(v.array(v.string())),  // optional CORS whitelist
  createdBy: v.string(),
  updatedAt: v.number(),
}).index("by_org", ["orgId"])
  .index("by_slug", ["slug"]),
```

Stations can have multiple widgets — a homepage "now-playing-strip" and an archive-page "recently-played" with different configs, each with its own slug. The dashboard's embed generator (the v1 `/demo` route, carried forward) becomes "pick a variant, configure it, get your tag."

### Widget data access

Public read-only queries on Convex, keyed by `widgets.slug`. No authentication needed for read (public widget = public data); origin checks happen in the HTTP action if `allowedOrigins` is set. Write operations (DJ-corrected metadata, custom event creation) require Clerk auth and never happen from the widget surface.

### Migration from v1

v1 iframe embeds have live embed codes out in the wild on station websites and partner sites. Can't just break them.

1. Host `/iframe/:slug/:variant` route at the v2 domain that renders the same widget as JS but iframe-wrapped, behind a redirect from the v1 domain.
2. Issue new JS embed codes via the updated `/demo` generator.
3. Include migration guidance in station dashboard: "Your iframe embeds still work; switch to the new JS embed for [list of benefits]."
4. Don't sunset iframes. They remain the official fallback forever.

---

## Public radio reporting layer (the real differentiator)

The "now playing widget" is table stakes. What makes this worth paying for is the reporting public radio stations genuinely struggle with:

- **SoundExchange quarterly reports** — legally required, painful to generate without clean ISRC data
- **PRO reports** (ASCAP / BMI / SESAC) — by-track performance reporting
- **CPB reporting** — grants require demographic and cultural data
- **Local / independent / Black-owned label percentages** — music director KPIs
- **Rotation diversity** — gender, genre, era breakdowns
- **Unclassified tracks queue** — tracks that failed enrichment, surfaced for manual cleanup

This is where the cross-tenant enrichment cache pays the real dividend. When Station A pays for enrichment, Station B benefits. When Radio Milwaukee flags a misattribution, everyone gets the fix.

---

## Rollout plan — clean start, Radio Milwaukee shakedown

**No migration from v1.** v2 launches with an empty database. v1 keeps running on its current Supabase stack; v2 runs at a new domain (or subdomain). No dual-write, no sync workers, no source-of-truth confusion. When v2 is proven, v1 gets redirected and archived — and the historical playlist data stays queryable in v1 for anyone who needs it.

**Why clean, not migrated:**
- v1 is a Lovable scaffold with some cleanup issues — data quality is mixed and not worth preserving at the schema level
- The shakedown period is the only time in the product's life when breaking changes are free
- Fresh enrichment means every track flows through the new waterfall with new confidence scoring and overlay mechanics
- Radio Milwaukee rebuilds its own archive in 2–3 months of normal operation

**Pre-launch work (in `v1-reference/`, don't skip):**
1. Ask Claude Code (or spend an hour) to produce `V1_LEARNINGS.md` — what v1 got right, what it got wrong, what broke in production, what partners complained about
2. Ask Claude Code to produce `V1_EDGE_CASES.md` — specific artist names, show formats, ad-break patterns, Spinitron oddities the v1 code has accumulated fixes for
3. These inform v2 design; the code isn't worth porting but the institutional knowledge absolutely is

### Shakedown scope (all active from week 1)

The temptation is to start small and add scope. Resist. The reconciliation, artist-matching, and widget-contract decisions only get stress-tested under realistic load, and a half-loaded Radio Milwaukee isn't realistic.

**All four streams, not two:**
- HYFIN (Spinitron only) — easy case
- 88Nine (Spinitron only) — easy case
- **Rhythm Lab (Spinitron + ICY, dual-source)** — the reconciliation test bed
- 414 Music (Spinitron, maybe + ICY) — its own quirks

**Events active immediately:**
- Ticketmaster pulling Milwaukee DMA
- AXS pulling Pabst Theater Group venues
- Custom event UI available for DJs

**Widgets live on radiomilwaukee.org:**
- Replace v1 iframe embeds with v2 JS embeds
- If something breaks, break it here — not on a future partner's site

**Reports generated monthly against real data:**
- SoundExchange-format export
- Rotation diversity metrics
- Local-artist percentages
- If reports don't produce useful output on Radio Milwaukee's actual rotation, the differentiator isn't real yet

### Rollout gates (not a calendar)

"A couple of months" is shorthand for "until v2 is stable enough for an outside station." Define the gates, not the duration:

- **Uptime:** 99.5%+ across all four streams for 30 consecutive days
- **Reconciliation accuracy:** On Rhythm Lab (dual-source), <1% plays where Spinitron and ICY produce irreconcilable conflicts after manual review
- **Enrichment coverage:** >90% of distinct tracks have `artistKey` resolved to a canonical artist within 24h of first play
- **Widget stability:** Zero breaking changes to embed API for the previous 14 days
- **Reporting correctness:** One full month of SoundExchange export reviewed and verified by Radio Milwaukee staff

Hit all gates → onboard first external station (beta).
Miss any gate for two weeks → fix before adding scope.

### Safety mechanisms to build day one

These are cheap now, painful to retrofit:

**Ingestion pause/resume per source.** Admin panel toggle that stops `ingestionSources.enabled` for one source without affecting others. Lets you freeze a bad source while investigating.

**Play rewind per station + time range.** Soft-delete (`deletedAt` field, not actual deletion) plays for a specific station between two timestamps. When you discover a bug that wrote bad data for the last 48 hours, you can rewind that window without nuking everything.

**Ingestion event log with queryable dashboard.** The `ingestionEvents` table is already in the schema — use it aggressively. Every poll result, every error, every drift detection. The dashboard view is "show me the last 24h of weird for this station."

**Breaking-change versioning on public contracts.** Embed URLs include `/v1/` from day one. Public API endpoints are versioned. Breaking changes ship as `/v2/` and migrate gradually, never in place. Stations in the shakedown understand they're on pre-release; partners after the shakedown get contract stability.

### Rollout phases

1. **Week 0 (pre-build):** v1-reference learnings/edge-cases docs; v2 repo scaffold; CLAUDE.md; this brainstorm doc in `docs/`. Email StreamGuys for SGmetadata credentials (blocking).
2. **Weeks 1–2:** Convex scaffold, Clerk wiring, schema deployed. Build `sgmetadata` adapter against docs + fixtures. First Trigger.dev task polling HYFIN via SGmetadata once credentials arrive. Plays flowing. Dashboard read-only view.
3. **Weeks 3–4:** All four streams ingesting via SGmetadata. Add Spinitron as supplementary source (segment type + show context). Add ICY as verification shadow on HYFIN and Rhythm Lab — not writing, just comparing. Reconciliation + enrichment waterfall live.
4. **Weeks 5–6:** Events ingestion (Ticketmaster + AXS), custom events UI, artist-to-event join queries. `touringFromRotation` dashboard view. Shadow-mode comparison dashboard showing SGmetadata-vs-ICY agreement rate.
5. **Weeks 7–8:** JS widget (now-playing-strip + recently-played variants) deployed on radiomilwaukee.org, replacing v1 iframes. Pre-flight validation at onboarding.
6. **Weeks 9–12:** Reporting layer, overlay/notes UI, SoundExchange export, production health monitoring alerts to Slack. Soak time: find bugs, stabilize.
7. **Gate check → onboard first external station in beta.**

### What not to do during shakedown

- Do not onboard external stations, even free, even friendly. Every external station is an implicit contract.
- Do not promise feature parity with v1 on day one. v1's features were v1's. v2 has different features with different tradeoffs. Radio Milwaukee's team is on the plane with you; they accept this.
- Do not preserve v1 URL structure for dashboard pages. Only `/embed/*` routes get backward compatibility (via redirects) because those live in partner sites. Everything else is free to redesign.
- Do not defer the decision log. Every schema change, every API rename, every "we thought X, turns out Y" — one paragraph in `docs/decisions/NNN-short-title.md`. These become the migration guide for external tenants.

---

## Open questions / next decisions

1. **Tolerance window** for reconciliation — start at ±45s or tighter?
2. **Clerk Org model** — "one org per station" vs "one org with multiple stations." Default is per-station; revisit once onboarding flows are prototyped.
3. **Pricing model** — free tier (how many plays/mo?), paid tier (per-station? per-play? flat?). Public radio budget reality matters here.
4. **StreamGuys SGmetadata adapter** — worth building if any customer has it and an API key, but not blocking MVP. ICY scraping works for StreamGuys streams too.
5. **HLS adapter** — needed for modern simulcasts (NPR apps, iHeart). De-prioritize until a customer asks.
6. **Ad / promo filter** — regex-based per-station filter list for `StreamTitle` strings that aren't real tracks. Needed for clean playlists. Store filters in `stations.config`?
7. **Public API** — rate limits, auth via `apiKeys` table, scopes. Worth documenting with OpenAPI from day one.
8. **SmartMetadata (StreamGuys fingerprinting)** — if any StreamGuys customer has it enabled, the structured fields (ISRC, label) feed directly into enrichment. Worth a pass-through adapter.
9. **Legal** — we're not rebroadcasting audio, just logging public metadata. Confirm with counsel before offering this to stations we don't have a relationship with.
10. **Event deduplication tolerance** — same venue + ±2h window + overlapping headliner seems right as a default; needs edge-case testing (two-night residencies, early/late shows same day).
11. **Artist matching edge cases** — "Prince" (too generic), featured-artist splits ("X feat. Y"), DJ names vs. producer names, classical ensembles. Start with manual review queue; iterate on the normalizer.
12. **AXS API scope** — what's the venue coverage beyond Pabst Theater Group in the license? Can other stations benefit from AXS, or is it effectively Radio-Milwaukee-only until another venue group signs?
13. **Ticketmaster quota** — default 5000/day is tight for multi-tenant. Request higher limit early; potentially route per-org API keys if a station brings their own key.
14. **Event cache tenancy** — unlike enrichments, event data is regional, not universal. Two Milwaukee stations could share Ticketmaster cache. Worth building a regional event cache layer, or keep it per-station for simplicity? Default: per-station, revisit if cost becomes real.
15. **Custom event conflict UX** — if a DJ enters a custom event and Ticketmaster later imports the same show, how do we surface that for reconciliation without nagging?
16. **Widget bundle hosting** — same domain as the app (`embed.radiomke-v2.example`) or a CDN subdomain? Matters for cache-control, CORS, and failure-mode isolation.
17. **Shadow DOM support floor** — shadow DOM is well-supported in modern browsers but station sites occasionally load on ancient mobile browsers via embedded webviews. Decide the minimum browser matrix.
18. **Analytics in widgets** — do we track embed views and play-click-throughs? If yes, what's the PII posture? Station self-reporting vs aggregated across-product stats are different questions.
19. **Canonical promotion threshold** — how many overlaying orgs before a proposal opens? Start at 3, revisit as sample size grows.
20. **Canonical promotion authority** — who reviews proposals? Radio Milwaukee staff initially, but long-term model needs defining. Community moderation? Trusted-station network?
21. **Bio licensing** — Wikipedia content is CC BY-SA (attribution + share-alike). MusicBrainz is CC0 for most fields but CC BY-NC-SA for artist annotations. Need attribution UI on bios and clear provenance in the `bioSource` field. Decide if we're comfortable with SA obligations for downstream consumers (our public API).
22. **Artist images** — most sources have licensing restrictions. Spotify images have terms that restrict use outside Spotify-branded surfaces. Wikipedia images are mixed-license. Start with no images in canonical, add carefully with explicit per-source licensing logic.
23. **Confidence scoring** — how is `confidence` computed? Simple (count of corroborating sources) or nuanced (per-field, per-source weighting)? Start simple, add fidelity when the correction flow gives us training signal.

---

## File map (target v2 repo)

```
radiomke-playlist-v2/
├── apps/
│   ├── web/                      # Next.js 15, Clerk, Convex client (dashboard)
│   │   ├── app/
│   │   │   ├── (dashboard)/      # org-scoped
│   │   │   ├── (public)/         # public widgets, /embed generator
│   │   │   └── api/
│   │   └── components/
│   └── embed/                    # separate build target — Preact, small bundle
│       ├── src/
│       │   ├── loader.ts         # entry; reads data-* attrs, code-splits variants
│       │   ├── variants/
│       │   │   ├── now-playing-strip.tsx
│       │   │   ├── recently-played.tsx
│       │   │   ├── events-feed.tsx
│       │   │   └── ...
│       │   └── shared/           # Convex client, shadow-DOM root, theming
│       └── build/widget.js       # shipped to CDN/embed domain
├── packages/
│   ├── convex/                   # schema, queries, mutations, HTTP actions
│   ├── ingestion/                # adapters + registry (shared by trigger/ and icy-worker/)
│   │   └── src/
│   │       ├── types.ts          # NormalizedPlay, Adapter interface
│   │       ├── registry.ts       # export { adapters }
│   │       └── adapters/
│   │           ├── spinitron.ts
│   │           ├── sgmetadata.ts
│   │           ├── icy.ts
│   │           ├── hls.ts
│   │           └── ...
│   ├── enrichment/               # MB/Discogs/Spotify adapters (shared w/ gselector-enricher)
│   │   └── src/
│   │       └── normalize.ts      # artistKey() — shared join-key utility
│   └── types/                    # shared TS types
├── services/
│   ├── trigger/                  # scheduled tasks, enrichment tasks
│   └── icy-worker/               # Fly.io stream worker
├── scripts/
│   └── migrate-supabase.ts       # one-shot v1 -> v2 data import
└── README.md
```

---

## Related personal context

- `gselector-enricher` shares the enrichment waterfall — likely extract into shared package
- Public Radio Agents framework could eventually provide the agentic reporting layer (e.g., "show me rotation diversity for Q3 in plain English")
- Crate / Deskside patterns (Convex + Clerk + Next.js 15) are directly reusable
- Radio Milwaukee Coupler.io data pipeline work is adjacent — playlist data could eventually feed the exec dashboard alongside GA4, Triton, Mailchimp

---

## Continue from here

The next productive moves in Claude Code, in rough order:

1. **Pre-work in `v1-reference/`:** produce `V1_LEARNINGS.md` and `V1_EDGE_CASES.md` before touching v2 code
2. Scaffold v2 repo with the schema (including events + shared canonical + overlays + proposals tables)
3. Wire Clerk Orgs + Convex auth helper (`requireOrg`)
4. Build `/ingest` HTTP action with reconciliation + dedup logic
5. First Trigger.dev task: adapter-agnostic `poll-sources`, starting with the `spinitron` adapter pointed at HYFIN
6. Read-only dashboard shell (list plays for authenticated user's org)
7. Add 88Nine, 414 Music, Rhythm Lab as Spinitron sources
8. Build ICY adapter + Fly worker; add ICY source to Rhythm Lab as secondary
9. Run reconciliation live on Rhythm Lab; iterate until drift is <1%
10. Enrichment waterfall: `enrichArtist` and `enrichTrack` tasks, wired to fire on `/ingest` when keys are new to canonical
11. Events ingestion: `poll-ticketmaster` task and Ticketmaster adapter, then AXS once license docs land
12. Custom events UI (ports v1 feature)
13. `touringFromRotation` dashboard view
14. JS embed widget (Preact + shadow DOM + Convex subscription): loader + `now-playing-strip` first, then `recently-played` and `events-feed`
15. Iframe fallback route for script-hostile CMSes
16. Replace v1 iframe embeds on radiomilwaukee.org with v2 JS embeds
17. Overlay UI (DJ corrections, local-artist augmentation) + notes UI (private editorial)
18. Reporting layer: SoundExchange export, rotation diversity, local-artist percentages — monthly cadence, verified by Radio Milwaukee staff
19. Soak period; decision log; bug fixes; gate checks
20. **Gate check → onboard first external beta station**

Keep the `gselector-enricher` waterfall logic portable so the enrichment service can share it.
