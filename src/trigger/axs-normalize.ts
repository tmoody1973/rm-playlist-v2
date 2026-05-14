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
