import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Convex-hosted scheduled jobs.
 *
 * Only the watchdog lives here. Ingestion and enrichment run on Trigger.dev
 * (`src/trigger/`), and that is exactly why the watchdog does not: on
 * 2026-08-25 the Trigger.dev scheduler stopped firing for about six hours
 * and nothing noticed, because the only thing that could have noticed was
 * also on Trigger.dev. See
 * docs/incidents/2026-08-25-playlist-ingestion-outage.md.
 *
 * Five minutes is a deliberate choice: the stale threshold is ten minutes,
 * so worst-case detection latency is fifteen, and a check this cheap costs
 * nothing meaningful to run 288 times a day.
 */
const crons = cronJobs();

crons.interval("ingestion health check", { minutes: 5 }, internal.health.checkIngestionHealth, {});

export default crons;
