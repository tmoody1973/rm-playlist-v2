#!/usr/bin/env bun
/**
 * Times alexa:searchPlays against a live deployment, the way a listener's
 * fresh question hits it. Read-only (a public query).
 *
 * Convex caches identical query calls, so each run pads the query with
 * trailing spaces: a new cache key, the same search once searchTerms trims
 * it. Prints median and p95 per case; save the table before and after a
 * search change.
 *
 * Target: p95 < 500 ms for the title+artist cases ("Makeda Les Nubians",
 * "TKO Le Tigre") and for "Nas" and "love".
 *
 * Usage (URL from CONVEX_URL or NEXT_PUBLIC_CONVEX_URL; never printed):
 *   bun --env-file=.env.local scripts/time-search.ts
 *   RUNS=7 bun --env-file=.env.local scripts/time-search.ts
 */
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

interface SearchCase {
  readonly query: string;
  readonly station?: string;
}

const CASES: readonly SearchCase[] = [
  { query: "zzqxv" },
  { query: "TKO" },
  { query: "TKO Le Tigre" },
  { query: "Le Tigre" },
  { query: "Makeda Les Nubians", station: "hyfin" },
  { query: "Makeda Les Nubians" },
  { query: "Makeda" },
  { query: "Nas" },
  { query: "love" },
  { query: "the" },
];

const DEFAULT_RUNS = 5;
const searchPlays = makeFunctionReference<"query">("alexa:searchPlays");

function convexUrl(): string {
  const url = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("CONVEX_URL or NEXT_PUBLIC_CONVEX_URL must be set");
  return url;
}

/** Nearest-rank percentile of an ascending list. */
function percentile(sortedMs: readonly number[], fraction: number): number {
  const rank = Math.ceil(fraction * sortedMs.length) - 1;
  return sortedMs[Math.min(Math.max(rank, 0), sortedMs.length - 1)] ?? 0;
}

async function timeCase(client: ConvexHttpClient, searchCase: SearchCase, runs: number) {
  const timesMs: number[] = [];
  let hits: number | string = 0;
  for (let run = 0; run < runs; run++) {
    const args = { ...searchCase, query: searchCase.query + " ".repeat(run + 1) };
    const startedAt = performance.now();
    try {
      hits = ((await client.query(searchPlays, args)) as unknown[]).length;
    } catch (error) {
      hits = `ERR ${(error as Error).message.slice(0, 40)}`;
    }
    timesMs.push(Math.round(performance.now() - startedAt));
  }
  const sorted = [...timesMs].sort((a, b) => a - b);
  return { hits, timesMs, median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
}

async function main() {
  const runs = Number(process.env.RUNS ?? DEFAULT_RUNS);
  const client = new ConvexHttpClient(convexUrl());
  console.log("| Query (args) | Hits | Runs (ms) | Median | p95 |");
  console.log("|---|---|---|---|---|");
  for (const searchCase of CASES) {
    const { hits, timesMs, median, p95 } = await timeCase(client, searchCase, runs);
    const label = searchCase.station
      ? `\`${searchCase.query}\` station=${searchCase.station}`
      : `\`${searchCase.query}\``;
    console.log(`| ${label} | ${hits} | ${timesMs.join(",")} | **${median}** | ${p95} |`);
  }
}

await main();
