import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Convex-hosted scheduled jobs.
 *
 * The ingestion watchdog plus a few cache refreshes that Alexa reads
 * (artist stories, station artist shows, the Cadence station schedule).
 * Ingestion and enrichment run on Trigger.dev (`src/trigger/`), and that is
 * exactly why the watchdog does not: on
 * 2026-08-25 the Trigger.dev scheduler stopped firing for about six hours
 * and nothing noticed, because the only thing that could have noticed was
 * also on Trigger.dev. See
 * docs/incidents/2026-08-25-playlist-ingestion-outage.md.
 *
 * The watchdog's five minutes is a deliberate choice: the stale threshold is ten minutes,
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

// Alexa answers "what's on 88Nine / when is Rhythm Lab" from this Cadence schedule cache.
crons.interval(
  "station schedule refresh",
  { minutes: 15 },
  internal.cadence.refreshStationSchedule,
  {},
);

// Alexa names the host's photo, profile and latest pieces from this cache (CDS + radiomilwaukee.org).
crons.interval("host profiles refresh", { minutes: 30 }, internal.hostProfiles.refresh, {});

export default crons;
