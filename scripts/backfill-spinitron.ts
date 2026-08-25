/**
 * One-time recovery: refill a gap in `plays` from Spinitron's permanent log.
 *
 * Why this can exist at all: SGmetadata answers "what is playing right now"
 * and keeps about seventeen minutes of history, so a polling outage is a
 * permanent hole. Spinitron is a logbook - the spins stay there - so a gap
 * can be asked for after the fact. That is the whole difference between an
 * outage being a delay and being a loss.
 *
 * Written for the 2026-08-25 outage (05:18-11:10 CDT). See
 * docs/incidents/2026-08-25-playlist-ingestion-outage.md.
 *
 * Dry run (default - prints what it would write, touches nothing):
 *   bun scripts/backfill-spinitron.ts --start "2026-08-25 05:18:00" --end "2026-08-25 11:10:00"
 *
 * Apply:
 *   bun scripts/backfill-spinitron.ts --start ... --end ... --apply
 *
 * Optional: --stations 88nine,hyfin  (default: all three Spinitron stations)
 */

import { ConvexHttpClient } from "convex/browser";
import { spinitronAdapter } from "../packages/ingestion/src";
import type { NormalizedPlay, StationSlug } from "../packages/types/src";
import { api } from "../packages/convex/convex/_generated/api.js";

/** Spinitron caps a page at 200; anything larger is silently clamped. */
const PAGE_SIZE = 200;

/** Stop paging rather than loop forever if the API keeps returning full pages. */
const MAX_PAGES = 25;

/**
 * A Spinitron spin and an SGmetadata poll of the same song disagree on the
 * clock: SG timestamps when the scraper noticed, Spinitron when the DJ logged
 * it. The Convex mutation dedups at +/-5s, which is tuned for two live sources
 * and far too tight here, so this script does its own wider pre-check.
 */
const DUPLICATE_WINDOW_MS = 150_000;

interface StationTarget {
  readonly slug: StationSlug;
  readonly apiKeyEnvVar: string;
  /** `ingestionSources` row that backfilled plays are attributed to. */
  readonly sourceId: string;
}

const TARGETS: readonly StationTarget[] = [
  {
    slug: "hyfin",
    apiKeyEnvVar: "SPINITRON_HYFIN_API_KEY",
    sourceId: "jh7cvfa443bxy2vwr3g7xpfveh85c6ek",
  },
  {
    slug: "88nine",
    apiKeyEnvVar: "SPINITRON_88NINE_API_KEY",
    sourceId: "jh752ntq6w07c3y9qdw6mw8bq58d4pmz",
  },
  {
    slug: "rhythmlab",
    apiKeyEnvVar: "SPINITRON_RHYTHMLAB_API_KEY",
    sourceId: "jh7fczt2f05fj9ppjw075faswh8d4dez",
  },
];

interface Args {
  readonly start: string;
  readonly end: string;
  readonly apply: boolean;
  readonly stations: readonly StationSlug[];
}

function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const start = get("--start");
  const end = get("--end");
  if (start === undefined || end === undefined) {
    throw new Error('Both --start and --end are required, e.g. --start "2026-08-25 05:18:00"');
  }
  const only = get("--stations");
  const stations =
    only === undefined
      ? TARGETS.map((t) => t.slug)
      : only.split(",").map((s) => s.trim() as StationSlug);
  return { start, end, apply: argv.includes("--apply"), stations };
}

function convexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (url === undefined || url.length === 0) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL or CONVEX_URL must be set");
  }
  return url;
}

/** Normalize for comparison so "The Cure " and "the cure" are one artist. */
function fingerprint(artist: string, title: string): string {
  return `${artist.trim().toLowerCase()} ${title.trim().toLowerCase()}`;
}

/** Walk every page of a Spinitron window until it runs dry. */
async function fetchWindow(
  apiKey: string,
  slug: StationSlug,
  start: string,
  end: string,
): Promise<NormalizedPlay[]> {
  const poll = spinitronAdapter.poll;
  if (poll === undefined) throw new Error("spinitron adapter has no poll()");

  const all: NormalizedPlay[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await poll({ apiKey, count: PAGE_SIZE, start, end, page }, { stationSlug: slug });
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * Drop spins we already have. The comparison window is widened on both sides
 * so a play recorded just outside the requested range still counts as a match.
 */
async function dropAlreadyRecorded(
  client: ConvexHttpClient,
  slug: StationSlug,
  candidates: readonly NormalizedPlay[],
): Promise<{ fresh: NormalizedPlay[]; duplicates: number }> {
  if (candidates.length === 0) return { fresh: [], duplicates: 0 };

  const times = candidates.map((c) => c.playedAt);
  const existing = await client.query(api.plays.searchByStation, {
    stationSlug: slug,
    afterMs: Math.min(...times) - DUPLICATE_WINDOW_MS,
    beforeMs: Math.max(...times) + DUPLICATE_WINDOW_MS,
    limit: 500,
  });

  const known = existing.map((p) => ({
    key: fingerprint(p.artist, p.title),
    playedAt: p.playedAt,
  }));

  const fresh = candidates.filter((c) => {
    const key = fingerprint(c.artistRaw, c.titleRaw);
    return !known.some(
      (k) => k.key === key && Math.abs(k.playedAt - c.playedAt) <= DUPLICATE_WINDOW_MS,
    );
  });

  return { fresh, duplicates: candidates.length - fresh.length };
}

async function backfillStation(
  client: ConvexHttpClient,
  target: StationTarget,
  args: Args,
): Promise<{ found: number; duplicates: number; written: number }> {
  const apiKey = process.env[target.apiKeyEnvVar];
  if (apiKey === undefined || apiKey.length === 0) {
    console.error(`[${target.slug}] ${target.apiKeyEnvVar} is not set - skipping`);
    return { found: 0, duplicates: 0, written: 0 };
  }

  const spins = await fetchWindow(apiKey, target.slug, args.start, args.end);
  const { fresh, duplicates } = await dropAlreadyRecorded(client, target.slug, spins);

  console.log(
    `[${target.slug}] Spinitron returned ${spins.length}, ${duplicates} already recorded, ${fresh.length} to write`,
  );
  for (const play of fresh.slice(0, 3)) {
    const when = new Date(play.playedAt).toLocaleTimeString();
    console.log(`    e.g. ${when}  ${play.artistRaw} - ${play.titleRaw}`);
  }

  if (!args.apply || fresh.length === 0) return { found: spins.length, duplicates, written: 0 };

  const result = await client.mutation(api.plays.recordPolledPlays, {
    sourceId: target.sourceId as Parameters<typeof api.plays.recordPolledPlays>[0]["sourceId"],
    plays: fresh.map((p) => ({
      artistRaw: p.artistRaw,
      titleRaw: p.titleRaw,
      albumRaw: p.albumRaw,
      labelRaw: p.labelRaw,
      durationSec: p.durationSec,
      playedAt: p.playedAt,
      raw: p.raw,
    })),
  });
  console.log(`[${target.slug}] wrote ${result.inserted}, mutation skipped ${result.skipped}`);
  return { found: spins.length, duplicates, written: result.inserted };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = new ConvexHttpClient(convexUrl());

  console.log(
    `${args.apply ? "APPLY" : "DRY RUN"} - window ${args.start} to ${args.end}, stations: ${args.stations.join(", ")}`,
  );

  let written = 0;
  for (const target of TARGETS) {
    if (!args.stations.includes(target.slug)) continue;
    const outcome = await backfillStation(client, target, args);
    written += outcome.written;
  }

  console.log(args.apply ? `Recovered ${written} plays.` : "Dry run - nothing written.");
  if (!args.apply) console.log("Re-run with --apply to write.");
}

await main();
