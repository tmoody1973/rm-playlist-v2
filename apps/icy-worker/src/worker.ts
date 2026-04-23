import { icyAdapter } from "@rm/ingestion/adapters/icy";
import type { NormalizedPlay, StationSlug } from "@rm/types";
import { DEFAULT_BACKOFF, nextDelayMs, sleep } from "./backoff";
import { IcyProtocolError, readIcyStream } from "./icy-client";
import { logger } from "./logger";
import { isAllowedIcyUrl, type SsrfCheckResult } from "./ssrf";

export type SsrfChecker = (url: string) => SsrfCheckResult;

export interface WorkerConfig {
  readonly stationSlug: StationSlug;
  readonly streamUrl: string;
  /** Max consecutive 4xx responses before abandoning. 5xx/network errors retry forever. */
  readonly fourXxRetryCeiling?: number;
  readonly signal?: AbortSignal;
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Override the SSRF allowlist. Production leaves this undefined (uses
   * `isAllowedIcyUrl`). Tests inject a permissive checker to reach a mock
   * server on 127.0.0.1.
   */
  readonly ssrfCheck?: SsrfChecker;
  /** Test hook: emit each parsed play to this sink in addition to the logger. */
  readonly onPlay?: (play: NormalizedPlay) => void;
}

const DEFAULT_4XX_CEILING = 3;

interface LoopState {
  attempt: number;
  fourXxRun: number;
}

export async function runWorker(config: WorkerConfig): Promise<void> {
  assertSsrfAllowed(config);

  logger.info("ingestion.lifecycle", {
    station: config.stationSlug,
    phase: "start",
    url: redactCredentials(config.streamUrl),
  });

  const state: LoopState = { attempt: 0, fourXxRun: 0 };
  const ceiling = config.fourXxRetryCeiling ?? DEFAULT_4XX_CEILING;

  while (!config.signal?.aborted) {
    const result = await attemptOnce(config, state, ceiling);
    if (result === "stop") break;
  }

  logger.info("ingestion.lifecycle", {
    station: config.stationSlug,
    phase: "stop",
  });
}

function assertSsrfAllowed(config: WorkerConfig): void {
  const ssrfChecker: SsrfChecker = config.ssrfCheck ?? isAllowedIcyUrl;
  const result = ssrfChecker(config.streamUrl);
  if (result.allowed) return;
  logger.error("ingestion.lifecycle", {
    station: config.stationSlug,
    phase: "ssrf_rejected",
    reason: result.reason,
  });
  throw new Error(`stream URL rejected by SSRF allowlist: ${result.reason}`);
}

async function attemptOnce(
  config: WorkerConfig,
  state: LoopState,
  ceiling: number,
): Promise<"continue" | "stop"> {
  try {
    await readIcyStream({
      url: config.streamUrl,
      signal: config.signal,
      fetch: config.fetch,
      onMetadata: (raw) => handleMetadata(raw, config),
    });
    logger.warn("ingestion.lifecycle", {
      station: config.stationSlug,
      phase: "upstream_closed",
    });
    state.attempt = 0;
    state.fourXxRun = 0;
    return "continue";
  } catch (err) {
    if (config.signal?.aborted) return "stop";
    const classification = classifyError(err);
    logger.warn("ingestion.error", {
      station: config.stationSlug,
      code: classification.code,
      message: classification.message,
    });
    if (classification.code === "http_4xx") {
      state.fourXxRun += 1;
      if (state.fourXxRun >= ceiling) {
        logger.error("ingestion.lifecycle", {
          station: config.stationSlug,
          phase: "abandoned_4xx",
          consecutive: state.fourXxRun,
        });
        throw err;
      }
    } else {
      state.fourXxRun = 0;
    }
    const delay = nextDelayMs(state.attempt, DEFAULT_BACKOFF);
    state.attempt += 1;
    try {
      await sleep(delay, config.signal);
      return "continue";
    } catch {
      return "stop";
    }
  }
}

function handleMetadata(raw: string, config: WorkerConfig): void {
  const plays = icyAdapter.parse(raw, { stationSlug: config.stationSlug });
  for (const play of plays) {
    logger.info("ingestion.play", {
      station: play.stationSlug,
      source: play.source,
      artist: play.artistRaw,
      title: play.titleRaw,
      playedAt: play.playedAt,
    });
    config.onPlay?.(play);
  }
}

interface ErrorClassification {
  code: string;
  message: string;
}

function classifyError(err: unknown): ErrorClassification {
  if (err instanceof IcyProtocolError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof Error) {
    return { code: "network", message: err.message };
  }
  return { code: "unknown", message: String(err) };
}

function redactCredentials(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = "***";
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return "<invalid-url>";
  }
}
