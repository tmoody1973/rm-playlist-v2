import { logger, schedules } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import type { NormalizedPlay, StationSlug } from "../../packages/types/src";
import { sgmetadataAdapter, spinitronAdapter } from "../../packages/ingestion/src";
import type { AdapterContract } from "../../packages/ingestion/src/types";
import { api } from "../../packages/convex/convex/_generated/api.js";

/**
 * Dispatcher task — polls every enabled ingestion source once per minute.
 *
 * Milestone 5 fan-out pattern: one scheduled task queries Convex for the
 * enabled-source list, then calls each adapter's `poll()` in parallel.
 * Adding a new station is now a single `ingestionSources:upsert` call —
 * no new Trigger task file.
 *
 *   Convex (ingestionSources.listEnabledForPolling)
 *                │
 *                ▼
 *     ┌────────────────────────┐
 *     │  poll-all-sources @ 1m │
 *     └────────────────────────┘
 *                │  Promise.allSettled — one source's failure doesn't block others
 *      ┌─────────┼──────────┐
 *      ▼         ▼          ▼
 *   hyfin     88nine     414music ...   (one poll per source)
 *   /sgmeta   /sgmeta    /sgmeta        (adapter per source.adapter)
 *                │
 *                ▼
 *     plays.recordPolledPlays (Convex) → writes rows, logs ingestionEvents
 */

/** Adapters with a `poll()` impl. ICY is a long-running listener and is
 *  owned by the Fly worker (Week 3+); skip it in the dispatcher. */
const POLLABLE_ADAPTERS: Record<string, AdapterContract | null> = {
  spinitron: spinitronAdapter,
  sgmetadata: sgmetadataAdapter,
  icy: null,
};

function getConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL or CONVEX_URL must be set on the Trigger.dev project");
  }
  return url;
}

type SourceToPoll = {
  _id: string;
  stationSlug: string;
  adapter: "spinitron" | "sgmetadata" | "icy";
  role: "primary" | "supplementary" | "shadow";
  config: {
    apiKeyRef?: string;
    scraperUuid?: string;
    count?: number;
  };
};

async function pollOneSource(
  client: ConvexHttpClient,
  source: SourceToPoll,
): Promise<{ inserted: number; skipped: number } | null> {
  const label = `${source.stationSlug}/${source.adapter}/${source.role}`;
  const adapter = POLLABLE_ADAPTERS[source.adapter];

  if (adapter === null || adapter === undefined) {
    logger.log(`[${label}] skipping — no poll impl (likely ICY, owned by Fly worker)`);
    return null;
  }
  if (typeof adapter.poll !== "function") {
    logger.log(`[${label}] skipping — adapter has no poll()`);
    return null;
  }

  const apiKeyRef = source.config.apiKeyRef;
  if (apiKeyRef === undefined) {
    await recordFailure(client, source._id, `${label}: config.apiKeyRef missing`);
    return null;
  }
  const apiKey = process.env[apiKeyRef];
  if (apiKey === undefined || apiKey.length === 0) {
    await recordFailure(client, source._id, `${label}: env var ${apiKeyRef} not set`);
    return null;
  }

  try {
    // Adapter-specific config shapes — only pass fields the adapter recognizes.
    const adapterConfig = {
      apiKey,
      scraperUuid: source.config.scraperUuid ?? "",
      count: source.config.count,
    };
    const plays: NormalizedPlay[] = await adapter.poll(adapterConfig, {
      stationSlug: source.stationSlug as StationSlug,
    });

    const result = await client.mutation(api.plays.recordPolledPlays, {
      sourceId: source._id as Parameters<typeof api.plays.recordPolledPlays>[0]["sourceId"],
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
      `[${label}] fetched=${plays.length} inserted=${result.inserted} skipped=${result.skipped}`,
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordFailure(client, source._id, `${label}: ${message}`);
    // Don't rethrow — we want other sources to continue polling.
    return null;
  }
}

async function recordFailure(
  client: ConvexHttpClient,
  sourceId: string,
  errorMessage: string,
): Promise<void> {
  try {
    await client.mutation(api.plays.recordPollFailure, {
      sourceId: sourceId as Parameters<typeof api.plays.recordPollFailure>[0]["sourceId"],
      errorMessage,
    });
  } catch (logErr) {
    logger.error(
      `Failed to record ingestionEvent for ${sourceId}: ${logErr instanceof Error ? logErr.message : String(logErr)}`,
    );
  }
}

export const pollAllSources = schedules.task({
  id: "poll-all-sources",
  // Every minute (Trigger v4 cron floor).
  cron: "* * * * *",
  queue: { concurrencyLimit: 1 }, // eng review issue #3: serialize polling
  maxDuration: 120, // generous — 4 sources × ~500ms each = ~2s typical
  run: async () => {
    const client = new ConvexHttpClient(getConvexUrl());
    const sources = (await client.query(
      api.ingestionSources.listEnabledForPolling,
      {},
    )) as SourceToPoll[];

    if (sources.length === 0) {
      logger.log("No enabled sources — dispatcher idle");
      return { total: 0, ok: 0, failed: 0, skipped: 0 };
    }

    logger.log(`Dispatching poll to ${sources.length} enabled source(s)`);

    // Promise.allSettled keeps one source's failure from blocking others.
    const outcomes = await Promise.allSettled(
      sources.map((source) => pollOneSource(client, source)),
    );

    let ok = 0;
    let failed = 0;
    let skipped = 0;
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        failed++;
      } else if (outcome.value === null) {
        skipped++;
      } else {
        ok++;
      }
    }
    logger.log(`Dispatch complete: ${ok} ok, ${failed} failed, ${skipped} skipped`);
    return { total: sources.length, ok, failed, skipped };
  },
});
