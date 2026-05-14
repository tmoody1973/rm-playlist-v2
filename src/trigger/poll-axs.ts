import { logger, schedules } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../packages/convex/convex/_generated/api.js";
import type { Id } from "../../packages/convex/convex/_generated/dataModel.js";
import { getConvexUrl } from "./env";
import { normalizeAxsEvent } from "./axs-normalize";
import type { AxsEvent, AxsResponse, NormalizedEvent } from "./axs-normalize";

/**
 * Poll the AXS Event Discovery API every 6 hours for upcoming Pabst
 * Theater Group shows in Milwaukee, normalize each into the
 * source-agnostic shape events.upsertBatch accepts, and upsert them.
 *
 * Mirrors poll-ticketmaster.ts. Two intentional differences:
 *   1. Geo scoping is siteId=110 (Pabst), not lat/long radius anchors —
 *      so this task does not read stationRegions.
 *   2. The normalizer is extracted to axs-normalize.ts so it can be
 *      unit-tested. See docs/plans/2026-05-14-axs-events-adapter-design.md.
 *
 * Cadence is staggered to 03/09/15/21 UTC so it never runs alongside
 * poll-ticketmaster (00/06/12/18).
 */

/** Pabst Theater Group site. Confirmed with AXS 2026-05-14. */
const AXS_SITE_ID = "110";
/** AXS Primary tickets only (29 = Marketplace resale, excluded). */
const AXS_TICKETER_ID = "22";
/** AXS majorCat for Music. */
const AXS_MUSIC_MAJOR_CAT = "2";
/** Forward window per poll. Matches poll-ticketmaster.ts. */
const SEARCH_HORIZON_DAYS = 90;
/** AXS max page size (range 10-100). */
const PAGE_SIZE = 100;
/** Defensive cap on pagination — AXS shouldn't return 50+ pages for one
 *  venue group's 90-day horizon, but stop rather than loop forever. */
const HARD_PAGE_CAP = 50;
/** Per-request timeout. Without it, a stalled AXS page would block the
 *  whole task until maxDuration kills it — no error, no partial result. */
const AXS_REQUEST_TIMEOUT_MS = 30_000;

const ORG_SLUG = "radiomilwaukee";

/** AXS datetime params must be full UTC datetimes — date-only errors. */
function axsDateTime(date: Date): string {
  return date.toISOString().slice(0, 19);
}

async function fetchAllAxsEvents(accessToken: string): Promise<AxsEvent[]> {
  const now = new Date();
  const horizon = new Date(now.getTime() + SEARCH_HORIZON_DAYS * 86_400_000);

  const all: AxsEvent[] = [];
  let page = 1;

  while (page <= HARD_PAGE_CAP) {
    const params = new URLSearchParams({
      access_token: accessToken,
      siteId: AXS_SITE_ID,
      ticketerId: AXS_TICKETER_ID,
      majorCat: AXS_MUSIC_MAJOR_CAT,
      returnData: "complete",
      start: axsDateTime(now),
      end: axsDateTime(horizon),
      rows: String(PAGE_SIZE),
      page: String(page),
    });

    // The AXS doc shows http://; use https:// so the access_token is
    // never sent in plaintext. If AXS rejects https, escalate to them —
    // do not downgrade to http.
    //
    // AXS authenticates only via the access_token query param — their
    // docs document no Authorization-header alternative. The token is
    // therefore in the URL, so never log the full request URL anywhere
    // in this file (the error below interpolates status + page only).
    //
    // AbortSignal.timeout guards against a stalled page hanging the task.
    const response = await fetch(`https://api.axs.com/v1/events?${params}`, {
      signal: AbortSignal.timeout(AXS_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`AXS API page ${page} ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as AxsResponse;
    const pageEvents = data.events ?? [];
    all.push(...pageEvents);
    logger.log(`[AXS] page ${page} fetched ${pageEvents.length} events`);

    // AXS returns an empty event list once page > total pages.
    if (pageEvents.length < PAGE_SIZE) break;
    page++;

    // Polite spacing — at a 6h cadence this costs nothing.
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return all;
}

export const pollAxs = schedules.task({
  id: "poll-axs",
  // Staggered from poll-ticketmaster (00/06/12/18) to spread API load.
  cron: "0 3,9,15,21 * * *",
  queue: { concurrencyLimit: 1 },
  maxDuration: 300,
  run: async () => {
    const client = new ConvexHttpClient(getConvexUrl());
    const accessToken = process.env["AXS_ACCESS_TOKEN"];

    // Graceful idle when the token isn't configured on the Trigger.dev
    // project yet — mirrors poll-ticketmaster.ts. Crashing every 6h would
    // just be alert noise.
    if (!accessToken) {
      logger.warn("AXS_ACCESS_TOKEN not set on Trigger.dev project — skipping poll");
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

    const orgId = await client.query(api.events.getOrgIdBySlug, { slug: ORG_SLUG });
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
        skippedReason: "org-not-found" as const,
      };
    }

    const axsEvents = await fetchAllAxsEvents(accessToken);
    logger.log(`Fetched ${axsEvents.length} AXS events`);

    let skipped = 0;
    const normalized: NormalizedEvent[] = [];
    for (const axsEvent of axsEvents) {
      const norm = normalizeAxsEvent(axsEvent);
      if (norm === null) {
        skipped++;
        continue;
      }
      normalized.push(norm);
    }

    if (normalized.length === 0) {
      logger.log(`No normalizable events (skipped=${skipped})`);
      return {
        fetched: axsEvents.length,
        normalized: 0,
        inserted: 0,
        updated: 0,
        dedupedNew: 0,
        dedupedExisting: 0,
        skipped,
        skippedReason: "no-normalizable-events" as const,
      };
    }

    const result = await client.mutation(api.events.upsertBatch, {
      orgId: orgId as Id<"organizations">,
      source: "axs",
      events: normalized,
    });

    logger.log(
      `Upserted: inserted=${result.inserted} updated=${result.updated} ` +
        `dedupedNew=${result.dedupedNew} dedupedExisting=${result.dedupedExisting} skipped=${skipped}`,
    );

    return { fetched: axsEvents.length, normalized: normalized.length, ...result, skipped };
  },
});
