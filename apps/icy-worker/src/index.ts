import type { StationSlug } from "@rm/types";
import { logger } from "./logger";
import { runWorker } from "./worker";

const STREAM_URL = process.env.ICY_STREAM_URL;
const STATION_SLUG = (process.env.ICY_STATION_SLUG ?? "rhythmlab") as StationSlug;

if (!STREAM_URL) {
  logger.error("ingestion.lifecycle", {
    phase: "boot_failed",
    reason: "ICY_STREAM_URL not set",
  });
  process.exit(1);
}

const controller = new AbortController();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info("ingestion.lifecycle", { phase: "signal", signal });
    controller.abort();
  });
}

runWorker({
  stationSlug: STATION_SLUG,
  streamUrl: STREAM_URL,
  signal: controller.signal,
}).catch((err: unknown) => {
  logger.error("ingestion.lifecycle", {
    phase: "crashed",
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
