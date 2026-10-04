import type { ConvexHttpClient } from "convex/browser";
import type { TrackCreditsResult, TrackForCredits } from "../../packages/enrichment/src/credits/types";
import { api } from "../../packages/convex/convex/_generated/api.js";
import type { Id } from "../../packages/convex/convex/_generated/dataModel";

/** Tracks fetched per credits phase; the deadline usually ends the loop first. */
export const CREDITS_BATCH = 30;

export interface CreditsSummary { attempted: number; found: number; none: number; errored: number; crashed: number }

export interface CreditsBatchDeps {
  readonly client: Pick<ConvexHttpClient, "query" | "mutation">;
  readonly deadlineMs: number;
  readonly now?: () => number;
  readonly collect: (track: TrackForCredits) => Promise<TrackCreditsResult>;
  readonly log?: (msg: string) => void;
}

async function writeResult(client: CreditsBatchDeps["client"], trackId: string, result: TrackCreditsResult) {
  await client.mutation(api.credits.writeTrackCredits, {
    trackId: trackId as Id<"tracks">,
    creditsStatus: result.creditsStatus,
    facts: result.facts.map((fact) => ({ ...fact, sources: [...fact.sources] })),
    cueTags: result.cueTags,
    recordingMbid: result.recordingMbid,
    releaseYear: result.releaseYear,
    matchConfidence: result.matchConfidence,
  });
}

/** Time-boxed credits loop; runs after the plays batch inside the same job so MB's 1 req/s throttle is shared. */
export async function enrichCreditsBatch(deps: CreditsBatchDeps): Promise<CreditsSummary> {
  const now = deps.now ?? Date.now;
  const summary: CreditsSummary = { attempted: 0, found: 0, none: 0, errored: 0, crashed: 0 };
  const tracks = (await deps.client.query(api.credits.tracksNeedingCredits, { limit: CREDITS_BATCH })) as TrackForCredits[];
  for (const track of tracks) {
    if (now() >= deps.deadlineMs) break;
    summary.attempted += 1;
    try {
      const result = await deps.collect(track);
      await writeResult(deps.client, track.trackId, result);
      summary[result.creditsStatus === "error" ? "errored" : result.creditsStatus] += 1;
      for (const problem of result.problems) deps.log?.(`[credits ${track.trackId}] ${problem}`);
    } catch (err) {
      summary.crashed += 1;
      deps.log?.(`[credits ${track.trackId}] crashed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary;
}
