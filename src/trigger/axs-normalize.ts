/**
 * Pure normalization logic for the AXS Events adapter. No IO, no SDK
 * imports — everything here is unit-tested in axs-normalize.test.ts.
 *
 * The Trigger.dev task (poll-axs.ts) imports normalizeAxsEvent and feeds
 * the result straight into events.upsertBatch. The output shape mirrors
 * the authoritative NormalizedEvent in packages/convex/convex/events.ts.
 */

// ---- AXS API response types (only the fields we consume) ---- //

export interface AxsMediaEntry {
  readonly width: string | number;
  readonly height: string | number;
  readonly file_name: string;
}

export interface AxsPerformer {
  readonly performerId?: string;
  readonly name?: string;
}

export interface AxsVenue {
  readonly venueId?: string;
  readonly title?: string;
  readonly city?: string;
  readonly state?: string;
  readonly country?: string;
  readonly latitude?: string;
  readonly longitude?: string;
}

export interface AxsTitle {
  readonly presentedBy?: string | null;
  readonly eventTitle?: string | null;
  readonly eventTitleText?: string | null;
}

export interface AxsTicketing {
  readonly statusId?: number;
  readonly url?: string;
  readonly eventUrl?: string;
}

export interface AxsEvent {
  readonly eventId?: string;
  readonly title?: AxsTitle;
  readonly eventDateTimeUTC?: string;
  readonly dateOnly?: boolean;
  readonly onsaleDateTimeUTC?: string;
  readonly ticketing?: AxsTicketing;
  readonly minorCategoryId1?: string;
  readonly venue?: AxsVenue;
  readonly associations?: {
    readonly headliners?: AxsPerformer[];
    readonly supportingActs?: AxsPerformer[];
  };
  readonly relatedMedia?: Record<string, AxsMediaEntry>;
}

export interface AxsResponse {
  readonly events?: AxsEvent[];
}

// ---- Normalized output types (match events.ts NORMALIZED_EVENT) ---- //
//
// This is a subset of the authoritative NormalizedEvent in
// packages/convex/convex/events.ts — every field here is accepted by
// events.upsertBatch. `doorsAt` is intentionally omitted: AXS only
// provides a venue-local doorDateTime with no UTC variant, so deriving
// it reliably needs timezone math (see the design doc's "Out of scope").

export type EventStatus =
  | "buyTickets"
  | "soldOut"
  | "cancelled"
  | "postponed"
  | "rescheduled"
  | "venueChange"
  | "free"
  | "private"
  | "other";

export type NormalizedArtist = {
  artistNameRaw: string;
  role: "headliner" | "support";
  externalPerformerId?: string;
};

export type NormalizedEvent = {
  externalId: string;
  title?: string;
  presenterName?: string;
  venueName: string;
  venueExternalId?: string;
  city: string;
  region: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  startsAt: number;
  dateOnly?: boolean;
  onSaleAt?: number;
  ticketUrl?: string;
  status?: EventStatus;
  imageUrl?: string;
  genre?: string;
  artists: NormalizedArtist[];
};

/** Affiliate tracking code appended to every ticket URL so Radio
 *  Milwaukee gets click-through attribution. */
export const TRACKING_CODE = "cid=usaffradiomilwaukee";

// ---- Pure text normalization functions ---- //

/**
 * AXS title fields (`headliners`, `eventTitle`) embed `<a>` tags. Strip
 * all tags and collapse whitespace. Used as a fallback when the plain
 * `eventTitleText` field is absent.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Append the Radio Milwaukee affiliate tracking code to an AXS ticket
 * URL. Picks `?` or `&` based on whether the URL already has a query
 * string. No-op if the code is already present.
 */
export function appendTrackingCode(url: string): string {
  if (url.includes(TRACKING_CODE)) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${TRACKING_CODE}`;
}

// ---- Field mapping functions ---- //

/**
 * AXS `ticketing.statusId` → our `EventStatus` enum. statusId values are
 * from AXS doc Appendix 1. Unmapped ids (TBD=8, Unavailable=12, Box
 * Office Only=14, Suspended=36, etc.) collapse to "other".
 */
const AXS_STATUS_BY_ID: Record<number, EventStatus> = {
  1: "buyTickets",
  27: "buyTickets",
  29: "buyTickets",
  30: "buyTickets",
  31: "buyTickets",
  32: "buyTickets",
  33: "buyTickets",
  7: "soldOut",
  2: "cancelled",
  5: "postponed",
  37: "postponed",
  6: "rescheduled",
  38: "rescheduled",
  11: "venueChange",
  3: "free",
  9: "free",
  10: "private",
};

export function mapAxsStatus(statusId: number | undefined): EventStatus {
  if (statusId === undefined) return "other";
  return AXS_STATUS_BY_ID[statusId] ?? "other";
}

/**
 * AXS `minorCategoryId1` → human genre label, from AXS doc Appendix 2
 * (Music minor categories). Returns undefined for unknown ids — genre is
 * an optional, display-only field.
 */
const AXS_GENRE_BY_ID: Record<string, string> = {
  "10": "Alternative/Punk",
  "11": "Christian",
  "12": "Rock",
  "13": "Classical",
  "15": "Country",
  "16": "International",
  "17": "Dance/Electronic",
  "18": "Festivals",
  "19": "Folk/Acoustic",
  "20": "Hip Hop/Rap",
  "21": "Indie/Emo",
  "22": "Hard Rock/Metal",
  "23": "Jazz/Blues",
  "24": "Latin",
  "25": "Pop",
  "26": "R&B",
  "27": "Reggae",
  "28": "Other",
  "49": "Kpop",
  "51": "Award Shows",
  "53": "Soundtrack",
  "54": "Bollywood/Desi",
};

export function mapGenre(minorCategoryId: string | undefined): string | undefined {
  if (!minorCategoryId) return undefined;
  return AXS_GENRE_BY_ID[minorCategoryId];
}

/** AXS doc: the primary event image width is 678 (678x399). */
const AXS_PRIMARY_IMAGE_WIDTH = 678;

/**
 * Pick the best image URL from an AXS `relatedMedia` map. Prefers the
 * 678-wide primary; otherwise the widest available. `relatedMedia`
 * follows the event→tour→performer→venue inheritance hierarchy, so it is
 * the AXS-recommended source over the raw `media` field.
 */
export function pickBestImage(
  relatedMedia: Record<string, AxsMediaEntry> | undefined,
): string | undefined {
  if (!relatedMedia) return undefined;
  const entries = Object.values(relatedMedia);
  if (entries.length === 0) return undefined;

  const primary = entries.find((e) => Number(e.width) === AXS_PRIMARY_IMAGE_WIDTH);
  if (primary) return primary.file_name;

  const widest = [...entries].sort((a, b) => Number(b.width) - Number(a.width))[0];
  return widest?.file_name;
}

// ---- Event normalization ---- //

/** AXS sends "United States"; the events pipeline expects ISO-style
 *  codes to match Ticketmaster. Extend this map if other countries
 *  appear. */
const COUNTRY_CODE_BY_NAME: Record<string, string> = {
  "United States": "US",
  Canada: "CA",
};

function normalizeCountry(country: string | undefined): string | undefined {
  if (!country) return undefined;
  return COUNTRY_CODE_BY_NAME[country] ?? country;
}

/** AXS eventDateTimeUTC has no trailing "Z"; parse it as UTC explicitly.
 *  Returns null when the value is missing or unparseable. */
function parseAxsUtc(value: string | undefined): number | null {
  if (!value) return null;
  const withZone = value.endsWith("Z") ? value : `${value}Z`;
  const ms = Date.parse(withZone);
  return Number.isNaN(ms) ? null : ms;
}

/** Resolve the display title: prefer the plain `eventTitleText`, fall
 *  back to HTML-stripped `eventTitle`. */
function resolveTitle(title: AxsTitle | undefined): string | undefined {
  if (!title) return undefined;
  if (title.eventTitleText && title.eventTitleText.trim().length > 0) {
    return title.eventTitleText.trim();
  }
  if (title.eventTitle) {
    const stripped = stripHtml(title.eventTitle);
    return stripped.length > 0 ? stripped : undefined;
  }
  return undefined;
}

/** Map AXS performer arrays to NormalizedArtist[], dropping entries with
 *  no name. Headliners first, then supporting acts. */
function resolveArtists(associations: AxsEvent["associations"]): NormalizedArtist[] {
  const headliners = (associations?.headliners ?? [])
    .filter(
      (p): p is AxsPerformer & { name: string } =>
        typeof p.name === "string" && p.name.length > 0,
    )
    .map((p) => ({
      artistNameRaw: p.name,
      role: "headliner" as const,
      externalPerformerId: p.performerId,
    }));
  const support = (associations?.supportingActs ?? [])
    .filter(
      (p): p is AxsPerformer & { name: string } =>
        typeof p.name === "string" && p.name.length > 0,
    )
    .map((p) => ({
      artistNameRaw: p.name,
      role: "support" as const,
      externalPerformerId: p.performerId,
    }));
  return [...headliners, ...support];
}

/**
 * Normalize one AXS event into the shape `events.upsertBatch` accepts.
 * Returns null — and the caller increments a skip count — when the event
 * lacks a parseable start time, a venue name, or any named artist. These
 * mirror the skip rules in poll-ticketmaster.ts's normalizeTmEvent.
 */
export function normalizeAxsEvent(event: AxsEvent): NormalizedEvent | null {
  // eventId is the upsert dedup key — without it the event is unstoreable,
  // so check it before doing any other work.
  if (!event.eventId) return null;

  const startsAt = parseAxsUtc(event.eventDateTimeUTC);
  if (startsAt === null) return null;

  const venueName = event.venue?.title;
  if (!venueName) return null;

  const artists = resolveArtists(event.associations);
  if (artists.length === 0) return null;

  const ticketUrlRaw = event.ticketing?.url ?? event.ticketing?.eventUrl;
  const lat = event.venue?.latitude ? parseFloat(event.venue.latitude) : undefined;
  const long = event.venue?.longitude ? parseFloat(event.venue.longitude) : undefined;
  const onSaleAt = parseAxsUtc(event.onsaleDateTimeUTC);

  return {
    externalId: event.eventId,
    title: resolveTitle(event.title),
    presenterName: event.title?.presentedBy ?? undefined,
    venueName,
    venueExternalId: event.venue?.venueId,
    city: event.venue?.city ?? "",
    region: event.venue?.state ?? "",
    country: normalizeCountry(event.venue?.country),
    latitude: lat !== undefined && !Number.isNaN(lat) ? lat : undefined,
    longitude: long !== undefined && !Number.isNaN(long) ? long : undefined,
    startsAt,
    dateOnly: event.dateOnly === true ? true : undefined,
    onSaleAt: onSaleAt ?? undefined,
    ticketUrl: ticketUrlRaw ? appendTrackingCode(ticketUrlRaw) : undefined,
    status: mapAxsStatus(event.ticketing?.statusId),
    imageUrl: pickBestImage(event.relatedMedia),
    genre: mapGenre(event.minorCategoryId1),
    artists,
  };
}
