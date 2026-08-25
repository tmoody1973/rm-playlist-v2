import { type MutationCtx, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  INGESTION_ALERT_KEY,
  INGESTION_STALE_AFTER_MS,
  evaluateIngestionHealth,
  type IngestionHealthVerdict,
  type IngestionSourceHealthInput,
} from "./healthRules";

/**
 * Ingestion watchdog. Runs every five minutes from `crons.ts`.
 *
 * Deliberately a mutation rather than an action: reading the sources,
 * deciding, and recording the new alert state all happen in one Convex
 * transaction, so two overlapping ticks cannot both decide "this is new"
 * and send duplicate emails. The email itself is scheduled out to an
 * action, which is the only part that needs the network.
 *
 * The decision logic lives in `healthRules.ts` so it can be unit tested
 * without a deployment. See that file for why the signal is `lastSuccessAt`
 * and why this does not run on Trigger.dev.
 */

/** Subject lines, kept together so the pair reads consistently in an inbox. */
const FIRING_SUBJECT = "[Playlist] Ingestion has stopped recording songs";
const RESOLVED_SUBJECT = "[Playlist] Ingestion is recording again";

async function stationSlugFor(ctx: MutationCtx, source: Doc<"ingestionSources">): Promise<string> {
  const station = await ctx.db.get(source.stationId);
  return station?.slug ?? "unknown-station";
}

function firingBody(verdict: IngestionHealthVerdict, since: number): string {
  const staleLines = verdict.stale
    .map((s) => {
      const minutes = Math.floor(s.staleForMs / 60_000);
      return s.neverSucceeded
        ? `  - ${s.label}: has NEVER polled successfully (added ${minutes}m ago)`
        : `  - ${s.label}: last successful poll was ${minutes}m ago`;
    })
    .join("\n");

  return [
    "The playlist has stopped recording songs.",
    "",
    verdict.detail,
    "",
    verdict.uncovered.length > 0
      ? `Switched off entirely (recording nothing): ${verdict.uncovered.join(", ")}`
      : "",
    staleLines.length > 0 ? `Stalled sources:\n${staleLines}` : "",
    "",
    `Detected at: ${new Date(since).toISOString()}`,
    "",
    "Songs still going out over the air are NOT being written down. StreamGuys",
    "only keeps about 17 minutes of history, so anything missed during the",
    "outage is lost unless the station also logs to Spinitron.",
    "",
    "Where to look first:",
    "  1. Settings -> Ingestion sources: is every station still switched on?",
    "  2. Trigger.dev runs for `poll-all-sources` — are runs happening every minute?",
    "  3. Trigger.dev billing — a plan over its limit throttles the scheduler.",
    "  4. The dashboard's Needs Attention panel for poll errors.",
    "",
    "You will get one more email when this clears. No reminders in between.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function resolvedBody(verdict: IngestionHealthVerdict, outageMs: number): string {
  const minutes = Math.floor(outageMs / 60_000);
  return [
    "The playlist is recording songs again.",
    "",
    `The outage lasted about ${minutes} minute(s).`,
    verdict.detail,
    "",
    "Songs played during the outage were not recorded and will be missing from",
    "the playlist and from royalty reporting for that window.",
  ].join("\n");
}

/**
 * Evaluate one org and email on the healthy↔stalled edges only.
 *
 * Returns a summary so a manual `convex run` gives the operator something
 * readable rather than silence.
 */
async function checkOrg(
  ctx: MutationCtx,
  org: Doc<"organizations">,
): Promise<{ org: string; firing: boolean; changed: boolean; detail: string }> {
  const sources = await ctx.db
    .query("ingestionSources")
    .withIndex("by_org", (q) => q.eq("orgId", org._id))
    .collect();

  const inputs: IngestionSourceHealthInput[] = await Promise.all(
    sources.map(async (source) => {
      const stationSlug = await stationSlugFor(ctx, source);
      return {
        sourceId: source._id,
        label: `${stationSlug}/${source.adapter}`,
        stationSlug,
        adapter: source.adapter,
        enabled: source.enabled,
        lastSuccessAt: source.lastSuccessAt,
        createdAt: source.createdAt,
      };
    }),
  );

  const now = Date.now();
  const verdict = evaluateIngestionHealth(inputs, now, INGESTION_STALE_AFTER_MS);

  const existing = await ctx.db
    .query("systemAlerts")
    .withIndex("by_org_key", (q) => q.eq("orgId", org._id).eq("key", INGESTION_ALERT_KEY))
    .first();

  const wasFiring = existing?.firing ?? false;
  const changed = wasFiring !== verdict.firing;

  if (existing === null) {
    await ctx.db.insert("systemAlerts", {
      orgId: org._id,
      key: INGESTION_ALERT_KEY,
      firing: verdict.firing,
      since: now,
      detail: verdict.detail,
      updatedAt: now,
    });
  } else {
    await ctx.db.patch(existing._id, {
      firing: verdict.firing,
      since: changed ? now : existing.since,
      detail: verdict.detail,
      updatedAt: now,
    });
  }

  // First-ever evaluation of a healthy system is not an event worth an email.
  const isFirstEverHealthy = existing === null && !verdict.firing;

  if (changed || (existing === null && verdict.firing)) {
    if (!isFirstEverHealthy) {
      const subject = verdict.firing ? FIRING_SUBJECT : RESOLVED_SUBJECT;
      const body = verdict.firing
        ? firingBody(verdict, now)
        : resolvedBody(verdict, now - (existing?.since ?? now));
      await ctx.scheduler.runAfter(0, internal.notifications.sendAlertEmail, {
        orgId: org._id,
        subject,
        body,
      });
    }
  }

  return { org: org.slug, firing: verdict.firing, changed, detail: verdict.detail };
}

export const checkIngestionHealth = internalMutation({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("organizations").collect();
    const results = [];
    for (const org of orgs) {
      results.push(await checkOrg(ctx, org));
    }
    return { checkedOrgs: results.length, results };
  },
});
