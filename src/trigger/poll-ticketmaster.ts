import { logger, schedules } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../packages/convex/convex/_generated/api.js";
import type { Id } from "../../packages/convex/convex/_generated/dataModel.js";
import { getConvexUrl } from "./env";

/**
 * Poll Ticketmaster every 6 hours for upcoming Music events across the
 * three regions Radio Milwaukee's audience cares about: Milwaukee metro,
 * Madison, and Chicago. Normalize each event into the source-agnostic
 * shape that `events.upsertBatch` accepts; the mutation handles upsert,
 * artist fanout, and cross-source dedup.
 *
 * Why 6 hours: events don't change that fast (announcements, on-sale
 * dates, occasional postponements). 6h is the right cadence for a
 * read-mostly source given TM's 5/req/s + 5000/day rate-limit envelope.
 *
 * Geo strategy: three lat/long anchors with bounded radii instead of one
 * large sweep. Cleaner coverage of the actual scenes (Milwaukee + Pabst
 * group, Madison metro, Chicago downtown + north shore) without
 * grabbing rural Wisconsin or Aurora/Joliet. Same shape AXS uses
 * (Step 6) so when the AXS adapter lands we're not maintaining
 * two different region models for shakedown.
 *
 * Once the dashboard custom-DJ-events UI lands (Step 5), this task will
 * read enabled regions from the `stationRegions` table instead of the
 * hardcoded constant below — at that point regions become first-class
 * data and operators can add/remove them without code changes.
 */

// ---------------------------------------------------------------- //
// Regions — hardcoded for shakedown; promotes to stationRegions table
// in Step 5 when the operator UI lands.
//
// TM's radius search expands from a single point. To cover Milwaukee
// metro + Madison + Chicago without a single 100mi sweep that grabs a
// lot of irrelevant suburbs, we run three smaller-radius searches and
// union via the (source, externalId) upsert. Same TM event id won't
// double-insert if it shows up in two anchors (rare — usually only
// happens on the regional spillover boundaries).
// ---------------------------------------------------------------- //

interface SearchAnchor {
  readonly label: string;
  readonly lat: number;
  readonly long: number;
  readonly radiusMiles: number;
}

const SEARCH_ANCHORS: readonly SearchAnchor[] = [
  // Downtown Milwaukee → covers the metro + Pabst Theater Group venues.
  { label: "Milwaukee", lat: 43.0389, long: -87.9065, radiusMiles: 50 },
  // Capitol Square Madison → covers Madison + Sun Prairie + Stoughton.
  // Smaller radius (35mi) because Madison shows are usually downtown +
  // immediate suburbs; 50 would start grabbing rural Wisconsin.
  { label: "Madison", lat: 43.0731, long: -89.4012, radiusMiles: 35 },
  // The Loop Chicago → covers downtown Chicago, north shore, near suburbs.
  // 40mi radius keeps Aurora / Joliet / Gary out (different scenes the
  // station audience doesn't follow).
  { label: "Chicago", lat: 41.8781, long: -87.6298, radiusMiles: 40 },
];

/** Look 90 days into the future per poll. Matches the brainstorm spec
 *  and stays well under the 5000/day TM rate envelope even at this
 *  cadence (three anchors × ~3-5 paginated requests each = ≤15 req/cron;
 *  4 crons/day = ~60 req/day, ceiling 5000). */
const SEARCH_HORIZON_DAYS = 90;

/** TM's classification id for "Music". Stable; not the human "Music"
 *  string filter (which is fragile across locales). */
const MUSIC_CLASSIFICATION_ID = "KZFzniwnSyZfZ7v7nJ";

/** TM API max page size. Default is 20; 200 minimizes round trips. */
const PAGE_SIZE = 200;

const ORG_SLUG = "radiomilwaukee";

// ---------------------------------------------------------------- //
// Types — what TM Discovery API actually returns (not exhaustive)
// ---------------------------------------------------------------- //

interface TmImage {
  url: string;
  width: number;
  height: number;
  ratio?: string;
}

interface TmAttraction {
  id: string;
  name: string;
}

interface TmVenue {
  id?: string;
  name?: string;
  city?: { name?: string };
  state?: { stateCode?: string };
  country?: { countryCode?: string };
  location?: { latitude?: string; longitude?: string };
}

interface TmEvent {
  id: string;
  name: string;
  url?: string;
  images?: TmImage[];
  classifications?: { genre?: { name?: string } }[];
  dates: {
    start: {
      dateTime?: string;
      localDate?: string;
      dateTBD?: boolean;
      timeTBA?: boolean;
      noSpecificTime?: boolean;
    };
    status: { code?: string };
  };
  _embedded?: {
    venues?: TmVenue[];
    attractions?: TmAttraction[];
  };
}

interface TmResponse {
  _embedded?: { events?: TmEvent[] };
  page?: { totalPages?: number; number?: number };
}

// ---------------------------------------------------------------- //
// Status mapping — TM's enum → our normalized enum
// ---------------------------------------------------------------- //

type EventStatus =
  | "buyTickets"
  | "soldOut"
  | "cancelled"
  | "postponed"
  | "rescheduled"
  | "venueChange"
  | "free"
  | "private"
  | "other";

/**
 * TM `dates.status.code` is one of:
 *   onsale, offsale, cancelled, postponed, rescheduled
 * Anything else lands in "other".
 */
function mapTmStatus(code: string | undefined): EventStatus | undefined {
  switch (code) {
    case "onsale":
      return "buyTickets";
    case "offsale":
      // Could be sold out OR not yet on sale. TM doesn't disambiguate at
      // the status level — we default to "soldOut" since that's the more
      // common offsale meaning post-announcement.
      return "soldOut";
    case "cancelled":
      return "cancelled";
    case "postponed":
      return "postponed";
    case "rescheduled":
      return "rescheduled";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------- //
// Image picker — choose the best 16:9 image for our card display
// ---------------------------------------------------------------- //

/**
 * TM returns 5–10 images per event in different aspect ratios + sizes.
 * Prefer 16:9 ratio at largest available width; fall back to first image
 * if no 16:9 exists.
 */
function pickBestImage(images: TmImage[] | undefined): string | undefined {
  if (!images || images.length === 0) return undefined;
  const sixteenNine = images
    .filter((img) => img.ratio === "16_9")
    .sort((a, b) => b.width - a.width);
  if (sixteenNine.length > 0) return sixteenNine[0]!.url;
  // Fallback: any image, largest width first.
  return [...images].sort((a, b) => b.width - a.width)[0]!.url;
}

// ---------------------------------------------------------------- //
// Normalize — TmEvent → NORMALIZED_EVENT (matches events.upsertBatch)
// ---------------------------------------------------------------- //

type NormalizedArtist = {
  artistNameRaw: string;
  role: "headliner" | "support";
  externalPerformerId?: string;
};

type NormalizedEvent = {
  externalId: string;
  title?: string;
  venueName: string;
  venueExternalId?: string;
  city: string;
  region: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  startsAt: number;
  dateOnly?: boolean;
  ticketUrl?: string;
  status?: EventStatus;
  imageUrl?: string;
  genre?: string;
  artists: NormalizedArtist[];
};

function normalizeTmEvent(event: TmEvent): NormalizedEvent | null {
  // Hard requirement: a date we can index. TM occasionally returns
  // `dates.start.localDate` only with `noSpecificTime: true` — we accept
  // those with `dateOnly: true` and the localDate parsed as midnight.
  const startsAt = parseStartTime(event);
  if (startsAt === null) return null;

  const venue = event._embedded?.venues?.[0];
  const attractions = event._embedded?.attractions ?? [];

  // No venue means we can't dedup or render a "see them tonight" line.
  // Skip rather than store a row missing the join key.
  if (!venue?.name) return null;

  const lat = venue.location?.latitude;
  const long = venue.location?.longitude;

  return {
    externalId: event.id,
    title: event.name || undefined,
    venueName: venue.name,
    venueExternalId: venue.id,
    city: venue.city?.name ?? "",
    region: venue.state?.stateCode ?? "",
    country: venue.country?.countryCode,
    latitude: lat ? parseFloat(lat) : undefined,
    longitude: long ? parseFloat(long) : undefined,
    startsAt,
    dateOnly:
      event.dates.start.noSpecificTime === true || event.dates.start.timeTBA === true
        ? true
        : undefined,
    ticketUrl: event.url,
    status: mapTmStatus(event.dates.status.code),
    imageUrl: pickBestImage(event.images),
    genre: event.classifications?.[0]?.genre?.name,
    artists: attractions.map((attraction, index) => ({
      artistNameRaw: attraction.name,
      role: (index === 0 ? "headliner" : "support") as "headliner" | "support",
      externalPerformerId: attraction.id,
    })),
  };
}

function parseStartTime(event: TmEvent): number | null {
  if (event.dates.start.dateTime) {
    const ms = Date.parse(event.dates.start.dateTime);
    return Number.isNaN(ms) ? null : ms;
  }
  if (event.dates.start.localDate) {
    // Local date as midnight UTC. The dateOnly flag flows through so the
    // UI can render "Date TBD" instead of an actual time.
    const ms = Date.parse(`${event.dates.start.localDate}T00:00:00Z`);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

// ---------------------------------------------------------------- //
// Fetch — paginate through TM until we run out of pages
// ---------------------------------------------------------------- //

async function fetchAllTmEvents(apiKey: string): Promise<TmEvent[]> {
  const now = new Date();
  const startDateTime = now.toISOString().slice(0, 19) + "Z";
  const horizon = new Date(now.getTime() + SEARCH_HORIZON_DAYS * 86_400_000);
  const endDateTime = horizon.toISOString().slice(0, 19) + "Z";

  // Union all anchors. The events.upsertBatch dedup pass (composite
  // by_external_id index on source+externalId) collapses any TM event
  // that shows up in two overlapping anchors — same TM id, single row.
  const allEvents: TmEvent[] = [];
  for (const anchor of SEARCH_ANCHORS) {
    const events = await fetchAnchorEvents(apiKey, anchor, startDateTime, endDateTime);
    logger.log(`[${anchor.label}] fetched ${events.length} events`);
    allEvents.push(...events);
  }
  return allEvents;
}

async function fetchAnchorEvents(
  apiKey: string,
  anchor: SearchAnchor,
  startDateTime: string,
  endDateTime: string,
): Promise<TmEvent[]> {
  const events: TmEvent[] = [];
  // TM caps page-iteration at 1000 results regardless of totalElements
  // (the "deep paging" limit). Stop early if the cap hits.
  const HARD_PAGE_CAP = Math.ceil(1000 / PAGE_SIZE);
  let page = 0;

  while (page < HARD_PAGE_CAP) {
    const params = new URLSearchParams({
      apikey: apiKey,
      classificationId: MUSIC_CLASSIFICATION_ID,
      latlong: `${anchor.lat},${anchor.long}`,
      radius: String(anchor.radiusMiles),
      unit: "miles",
      size: String(PAGE_SIZE),
      page: String(page),
      sort: "date,asc",
      startDateTime,
      endDateTime,
    });

    const response = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);

    if (!response.ok) {
      throw new Error(
        `Ticketmaster API ${response.status} for ${anchor.label}: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as TmResponse;
    const pageEvents = data._embedded?.events ?? [];
    events.push(...pageEvents);

    const totalPages = data.page?.totalPages ?? 0;
    page++;
    if (page >= totalPages) break;

    // Be polite to the rate envelope — TM allows 5 req/s, but at our
    // poll cadence (every 6h) sequential 200ms-spaced fetches cost
    // nothing and stay well under the burst limit.
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return events;
}

// ---------------------------------------------------------------- //
// Trigger.dev scheduled task
// ---------------------------------------------------------------- //

export const pollTicketmaster = schedules.task({
  id: "poll-ticketmaster",
  // Every 6 hours at minute 0. Runs at 00:00, 06:00, 12:00, 18:00 UTC.
  cron: "0 */6 * * *",
  // concurrencyLimit: 1 — we never want two pollers racing the same API
  // pull and double-upserting; serializing is cheap at this cadence.
  queue: { concurrencyLimit: 1 },
  // Generous: TM rate-limited fetches + Convex roundtrips. Typical run
  // takes <30s. 5min covers cold-start + retries + the rare big page.
  maxDuration: 300,
  run: async () => {
    const client = new ConvexHttpClient(getConvexUrl());
    const apiKey = process.env["TICKETMASTER_CONSUMER_KEY"];

    // Graceful idle when the env var isn't configured yet — Trigger.dev's
    // dashboard makes adding it a one-step config change. Crashing the
    // cron every 6h would just create alert noise; logging once per run
    // is enough until ops adds the key.
    if (!apiKey) {
      logger.warn("TICKETMASTER_CONSUMER_KEY not set on Trigger.dev project — skipping poll");
      return {
        fetched: 0,
        normalized: 0,
        inserted: 0,
        updated: 0,
        dedupedNew: 0,
        dedupedExisting: 0,
        skipped: 0,
        skippedReason: "missing-api-key" as const,
      };
    }

    const orgId = await client.query(api.events.getOrgIdBySlug, {
      slug: ORG_SLUG,
    });
    if (orgId === null) {
      logger.error(`Org with slug "${ORG_SLUG}" not found — seed.ts may be missing`);
      return {
        fetched: 0,
        normalized: 0,
        inserted: 0,
        updated: 0,
        dedupedNew: 0,
        dedupedExisting: 0,
        skipped: 0,
      };
    }

    const tmEvents = await fetchAllTmEvents(apiKey);
    logger.log(
      `Fetched ${tmEvents.length} TM events across ${SEARCH_ANCHORS.length} regions ` +
        `(${SEARCH_ANCHORS.map((a) => a.label).join(", ")})`,
    );

    let skipped = 0;
    const normalized: NormalizedEvent[] = [];
    for (const tmEvent of tmEvents) {
      const norm = normalizeTmEvent(tmEvent);
      if (norm === null) {
        skipped++;
        continue;
      }
      normalized.push(norm);
    }

    if (normalized.length === 0) {
      logger.log(`No normalizable events (skipped=${skipped})`);
      return {
        fetched: tmEvents.length,
        normalized: 0,
        inserted: 0,
        updated: 0,
        dedupedNew: 0,
        dedupedExisting: 0,
        skipped,
      };
    }

    const result = await client.mutation(api.events.upsertBatch, {
      orgId: orgId as Id<"organizations">,
      source: "ticketmaster",
      events: normalized,
    });

    logger.log(
      `Upserted: inserted=${result.inserted} updated=${result.updated} ` +
        `dedupedNew=${result.dedupedNew} dedupedExisting=${result.dedupedExisting} skipped=${skipped}`,
    );

    return { fetched: tmEvents.length, normalized: normalized.length, ...result, skipped };
  },
});
