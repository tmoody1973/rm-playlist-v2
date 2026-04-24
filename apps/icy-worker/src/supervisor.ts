import type { NormalizedPlay } from "@rm/types";
import { sleep } from "./backoff";
import type { ConvexGateway, IcySource } from "./convex-client";
import { logger } from "./logger";
import type { SsrfChecker } from "./worker";
import { runWorker } from "./worker";

/**
 * Multi-source supervisor for the ICY worker.
 *
 * Polls the Convex source list every `refreshMs` (default 60s). On each tick:
 *   - source in list but not tracked      → spawn a worker
 *   - tracked but no longer in list       → abort that worker
 *   - tracked but streamUrl changed       → abort + spawn
 *   - tracked and unchanged               → leave alone
 *
 * Each worker runs in its own fire-and-forget Promise so one source's crash
 * doesn't sibling-kill. The outer signal aborts everything and waits for
 * the last tick to settle.
 */

const DEFAULT_REFRESH_MS = 60_000;

export interface SupervisorConfig {
  readonly gateway: ConvexGateway;
  readonly signal: AbortSignal;
  /** How often to refresh the source list. Default 60s. */
  readonly refreshMs?: number;
  /** Inject to override SSRF (for tests). Passed through to runWorker. */
  readonly ssrfCheck?: SsrfChecker;
  /** Inject to stub fetch (for tests). Passed through to runWorker. */
  readonly fetch?: typeof globalThis.fetch;
}

interface ActiveSource {
  readonly source: IcySource;
  readonly controller: AbortController;
  readonly promise: Promise<void>;
}

export async function runSupervisor(config: SupervisorConfig): Promise<void> {
  const refreshMs = config.refreshMs ?? DEFAULT_REFRESH_MS;
  const active = new Map<string, ActiveSource>();

  logger.info("ingestion.lifecycle", { phase: "supervisor_start", refreshMs });

  while (!config.signal.aborted) {
    await tick(config, active);
    try {
      await sleep(refreshMs, config.signal);
    } catch {
      break;
    }
  }

  await shutdown(active);
  logger.info("ingestion.lifecycle", { phase: "supervisor_stop" });
}

async function tick(
  config: SupervisorConfig,
  active: Map<string, ActiveSource>,
): Promise<void> {
  let sources: IcySource[];
  try {
    sources = await config.gateway.listIcySources();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("ingestion.error", { phase: "supervisor_tick", code: "list_failed", message });
    return;
  }

  const incoming = new Map<string, IcySource>(sources.map((s) => [s._id, s]));

  for (const [sourceId, entry] of active) {
    const next = incoming.get(sourceId);
    if (next === undefined || next.streamUrl !== entry.source.streamUrl) {
      entry.controller.abort();
      active.delete(sourceId);
    }
  }

  for (const [sourceId, source] of incoming) {
    if (active.has(sourceId)) continue;
    active.set(sourceId, spawn(source, config, active));
  }

  logger.info("ingestion.lifecycle", {
    phase: "supervisor_tick",
    active: active.size,
    incoming: incoming.size,
  });
}

function spawn(
  source: IcySource,
  config: SupervisorConfig,
  active: Map<string, ActiveSource>,
): ActiveSource {
  const controller = new AbortController();
  const composite = AbortSignal.any([controller.signal, config.signal]);
  const onPlay = buildOnPlay(source, controller, config, active);

  const promise = runWorker({
    stationSlug: source.stationSlug,
    streamUrl: source.streamUrl,
    signal: composite,
    ssrfCheck: config.ssrfCheck,
    fetch: config.fetch,
    onPlay,
  }).catch((err: unknown) => {
    logger.warn("ingestion.error", {
      station: source.stationSlug,
      code: "worker_crashed",
      message: err instanceof Error ? err.message : String(err),
    });
  });

  return { source, controller, promise };
}

function buildOnPlay(
  source: IcySource,
  controller: AbortController,
  config: SupervisorConfig,
  active: Map<string, ActiveSource>,
): (play: NormalizedPlay) => Promise<void> {
  return async (play) => {
    try {
      const result = await config.gateway.writePlay(source._id, play);
      if (result.inserted === false && result.reason === "unknown_source") {
        logger.error("ingestion.lifecycle", {
          phase: "supervisor_abort_source",
          sourceId: source._id,
          station: source.stationSlug,
          reason: result.error,
        });
        controller.abort();
        // Identity check: only remove if the current entry is still OURS.
        // A respawn between write-start and write-fail could have replaced us.
        const current = active.get(source._id);
        if (current?.controller === controller) active.delete(source._id);
      }
    } catch (err) {
      logger.warn("ingestion.error", {
        station: source.stationSlug,
        code: "write_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

async function shutdown(active: Map<string, ActiveSource>): Promise<void> {
  for (const entry of active.values()) entry.controller.abort();
  await Promise.allSettled(Array.from(active.values(), (e) => e.promise));
  active.clear();
}
