import { logger, schedules } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { spinitronAdapter } from "../../packages/ingestion/src";
import { api } from "../../packages/convex/convex/_generated/api.js";

/**
 * HYFIN Spinitron poll task — Milestone 4 end-to-end proof.
 *
 * Scheduled every 30 seconds, concurrency 1 (per brainstorm + plan-eng-review
 * Architecture Issue 3 decision). On each run:
 *   1. Pull the Spinitron API key from the runtime env (pushed to Trigger.dev
 *      project via `bunx trigger.dev env set`).
 *   2. Call `spinitronAdapter.poll()` with { apiKey, count: 20 }.
 *   3. Write the resulting NormalizedPlay[] to Convex via `plays.recordPolledPlays`
 *      (which dedups on (stationId, playedAt)).
 *   4. On poll failure, write an `ingestionEvents` row via `plays.recordPollFailure`
 *      and re-throw so Trigger's retry policy kicks in.
 *
 * Source row seeded via `bunx convex run ingestionSources:upsert` — see
 * docs/implementation/001-week-1-2-scaffold.md Milestone 4.
 *
 * Future (Milestone 5+): replace the hardcoded sourceId with a dispatcher
 * that iterates `ingestionSources.listEnabled` and fans out per source.
 */

// Seeded in Convex (see `bunx convex run ingestionSources:upsert` output).
// Hardcoded for Milestone 4; dispatcher comes later.
const HYFIN_SPINITRON_SOURCE_ID = "jh7ctaamvc9s6pz152n0bkvzzx85dcse";

// Convex URL must be available at task runtime (pushed to Trigger env).
function getConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_CONVEX_URL or CONVEX_URL must be set on the Trigger.dev project",
    );
  }
  return url;
}

function getApiKey(): string {
  const key = process.env.HYFIN_SPINITRON_KEY;
  if (!key) {
    throw new Error("HYFIN_SPINITRON_KEY must be set on the Trigger.dev project");
  }
  return key;
}

export const pollSpinitronHyfin = schedules.task({
  id: "poll-spinitron-hyfin",
  // Every minute. Trigger.dev v4 doesn't support sub-minute cron expressions.
  // If we need faster cadence later, switch to a self-rescheduling task that
  // delays its next run internally.
  cron: "* * * * *",
  maxDuration: 60, // seconds — poll should finish in under 10s
  run: async () => {
    const client = new ConvexHttpClient(getConvexUrl());
    const sourceId = HYFIN_SPINITRON_SOURCE_ID as unknown as Parameters<
      typeof api.plays.recordPolledPlays
    >[0]["sourceId"];

    try {
      const apiKey = getApiKey();
      const plays = await spinitronAdapter.poll!(
        { apiKey, count: 20 },
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
        `HYFIN poll: fetched=${plays.length} inserted=${result.inserted} skipped=${result.skipped}`,
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`HYFIN poll failed: ${message}`);
      // Best-effort: record the failure as an ingestionEvent. Don't let the
      // logging call mask the original error.
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
      throw err; // Re-throw so Trigger.dev's retry policy picks it up.
    }
  },
});
