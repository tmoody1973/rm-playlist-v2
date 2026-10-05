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

// 6 a.m. Milwaukee (CDT): refresh Backstory stories for followed artists.
crons.daily(
  "artist stories refresh",
  { hourUTC: 11, minuteUTC: 0 },
  internal.artistWatch.refreshStale,
  {},
);

// Alexa answers "any 88Nine artists playing soon?" from this cache; the live query takes 7-11 s.
crons.interval(
  "station artist shows refresh",
  { hours: 3 },
  internal.events.refreshStationArtistShows,
  {},
);

// alexa:searchPlays measured 757-1004 ms on the first call after idle vs ~55 ms warm; after a quiet
// night that blew Radio Commons' 2,000 ms client timeout (two live eval failures, 05:40).
// Touching the search indexes every 4 minutes keeps them warm.
// ponytail: if it stays slow despite warming, raise the client timeout or cache hot queries.
crons.interval("alexa search warm", { minutes: 4 }, internal.alexa.warmSearchCron, {});

export default crons;
