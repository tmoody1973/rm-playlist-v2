import { createConvexGateway } from "./convex-client";
import { logger } from "./logger";
import { runSupervisor } from "./supervisor";

const CONVEX_URL = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
const REFRESH_SEC_RAW = process.env.SOURCE_REFRESH_SEC;

if (!CONVEX_URL) {
  logger.error("ingestion.lifecycle", {
    phase: "boot_failed",
    reason: "CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) not set",
  });
  process.exit(1);
}

const parsedRefresh = REFRESH_SEC_RAW != null ? Number.parseInt(REFRESH_SEC_RAW, 10) : NaN;
const refreshMs = Number.isFinite(parsedRefresh) && parsedRefresh > 0 ? parsedRefresh * 1000 : undefined;

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info("ingestion.lifecycle", { phase: "signal", signal });
    controller.abort();
  });
}

runSupervisor({
  gateway: createConvexGateway({ url: CONVEX_URL }),
  signal: controller.signal,
  refreshMs,
}).catch((err: unknown) => {
  logger.error("ingestion.lifecycle", {
    phase: "crashed",
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
