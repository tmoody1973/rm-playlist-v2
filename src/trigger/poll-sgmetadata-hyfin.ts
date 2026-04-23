import { logger, schedules } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { sgmetadataAdapter } from "../../packages/ingestion/src";
import { api } from "../../packages/convex/convex/_generated/api.js";

/**
 * HYFIN SGmetadata poll task — Milestone 4 authoritative source.
 *
 * SGmetadata is the primary source for all four RM streams per the brainstorm
 * shakedown table. Spinitron is supplementary (disabled until valid tokens);
 * ICY is shadow verification (Fly worker, Week 3+).
 *
 * Each run:
 *   1. Pulls the account-level SGmetadata API key from env.
 *   2. Calls `sgmetadataAdapter.poll({apiKey, scraperUuid})` — which GETs
 *      `https://jetapi.streamguys.com/<API_KEY>/scraper/<SCRAPER_UUID>/metadata`
 *      and normalizes the `{StreamTitle, timestamp}` response.
 *   3. Writes resulting NormalizedPlay[] via `plays.recordPolledPlays`.
 *   4. On failure, logs a `poll_error` and re-throws for Trigger retry.
 *
 * `sourceId` + `scraperUuid` are hardcoded for Milestone 4; Milestone 5+
 * adds a dispatcher that iterates `ingestionSources.listEnabled`.
 */

// Seeded via `bunx convex run ingestionSources:upsert` (HYFIN SGmetadata primary).
const HYFIN_SGMETADATA_SOURCE_ID = "jh7dp4dvgvx197b83w4f74ztzx85cvj7";

// The scraper UUID is a DB-level identifier (not a secret). Kept inline here
// for Milestone 4; Milestone 5 dispatcher reads it from Convex per-poll.
const HYFIN_SCRAPER_UUID = "6f277d5e-a183-4c91-b40e-bb3bada34229";

function getConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL or CONVEX_URL must be set on the Trigger.dev project");
  }
  return url;
}

function getApiKey(): string {
  const key = process.env.SGMETADATA_API_KEY;
  if (!key) {
    throw new Error("SGMETADATA_API_KEY must be set on the Trigger.dev project");
  }
  return key;
}

export const pollSgmetadataHyfin = schedules.task({
  id: "poll-sgmetadata-hyfin",
  // Every minute (Trigger v4 cron floor). SGmetadata updates can arrive
  // faster than that on busy streams; acceptable for shakedown.
  cron: "* * * * *",
  maxDuration: 60,
  run: async () => {
    const client = new ConvexHttpClient(getConvexUrl());
    const sourceId = HYFIN_SGMETADATA_SOURCE_ID as unknown as Parameters<
      typeof api.plays.recordPolledPlays
    >[0]["sourceId"];

    try {
      const apiKey = getApiKey();
      const plays = await sgmetadataAdapter.poll!(
        { apiKey, scraperUuid: HYFIN_SCRAPER_UUID, mode: "current" },
        { stationSlug: "hyfin" },
      );

      const result = await client.mutation(api.plays.recordPolledPlays, {
        sourceId,
        plays: plays.map((p) => ({
          artistRaw: p.artistRaw,
          titleRaw: p.titleRaw,
          albumRaw: p.albumRaw,
          labelRaw: p.labelRaw,
          durationSec: p.durationSec,
          playedAt: p.playedAt,
          raw: p.raw,
        })),
      });

      logger.log(
        `HYFIN SG poll: fetched=${plays.length} inserted=${result.inserted} skipped=${result.skipped}`,
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`HYFIN SG poll failed: ${message}`);
      try {
        await client.mutation(api.plays.recordPollFailure, {
          sourceId,
          errorMessage: message,
        });
      } catch (logErr) {
        logger.error(
          `Failed to write ingestionEvent: ${logErr instanceof Error ? logErr.message : String(logErr)}`,
        );
      }
      throw err;
    }
  },
});
