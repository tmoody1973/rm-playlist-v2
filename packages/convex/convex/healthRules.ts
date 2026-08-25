/**
 * Pure evaluation rules for the ingestion watchdog.
 *
 * No Convex imports on purpose. All the branching lives here so it can be
 * unit-tested without a deployment; `health.ts` is the thin Convex wrapper
 * that loads rows and applies the verdict.
 *
 * Why this watchdog runs on Convex and not Trigger.dev: on 2026-08-25 the
 * Trigger.dev scheduler stopped firing our every-minute crons for ~6 hours
 * (see docs/incidents/2026-08-25-playlist-ingestion-outage.md). A watchdog
 * hosted on the thing that failed cannot report that it failed.
 *
 * Why the signal is `lastSuccessAt` and not "newest play": a station can
 * legitimately go twenty minutes without a new song — an interview, a long
 * set, a live remote. `lastSuccessAt` advances on every successful poll
 * whether or not the song changed, so it separates "nothing new is playing"
 * from "we stopped looking". Only the second one is an outage.
 */

/**
 * Adapters the `poll-all-sources` dispatcher is responsible for waking.
 * ICY is a long-running listener owned by the Fly worker and never sets
 * `lastSuccessAt`, so including it would fire the alert forever.
 */
const DISPATCHER_ADAPTERS: ReadonlySet<string> = new Set(["spinitron", "sgmetadata"]);

/** Polls run every 60s. Ten minutes is ten missed polls — well past noise. */
export const INGESTION_STALE_AFTER_MS = 10 * 60 * 1000;

/** Stable key for the ingestion alert's row in `systemAlerts`. */
export const INGESTION_ALERT_KEY = "ingestion_stalled";

export interface IngestionSourceHealthInput {
  readonly sourceId: string;
  /** Human label for the email body, e.g. "88nine/sgmetadata". */
  readonly label: string;
  readonly adapter: string;
  readonly enabled: boolean;
  readonly lastSuccessAt?: number;
  readonly createdAt: number;
}

export interface StaleSource {
  readonly sourceId: string;
  readonly label: string;
  readonly staleForMs: number;
  /** True when the source has never recorded a successful poll at all. */
  readonly neverSucceeded: boolean;
}

export interface IngestionHealthVerdict {
  readonly firing: boolean;
  readonly watchedCount: number;
  readonly stale: readonly StaleSource[];
  readonly detail: string;
}

function isWatched(source: IngestionSourceHealthInput): boolean {
  return source.enabled && DISPATCHER_ADAPTERS.has(source.adapter);
}

/**
 * A source that has never polled is measured from when it was created, so a
 * freshly seeded source gets the same grace period as a working one instead
 * of alerting the moment it appears.
 */
function referencePoint(source: IngestionSourceHealthInput): number {
  return source.lastSuccessAt ?? source.createdAt;
}

function describe(stale: readonly StaleSource[], watchedCount: number): string {
  if (watchedCount === 0) {
    return "No enabled pollable ingestion sources exist — nothing is being recorded.";
  }
  if (stale.length === 0) {
    return `All ${watchedCount} pollable source(s) polled recently.`;
  }
  const lines = stale.map((s) => {
    const minutes = Math.floor(s.staleForMs / 60_000);
    return s.neverSucceeded
      ? `${s.label}: has never polled successfully (${minutes}m since it was added)`
      : `${s.label}: last successful poll ${minutes}m ago`;
  });
  return `${stale.length} of ${watchedCount} source(s) stalled — ${lines.join("; ")}`;
}

/**
 * Decide whether ingestion is currently stalled.
 *
 * Fires when any watched source has not polled within `staleAfterMs`, and
 * also when there are no watched sources at all — an org with everything
 * disabled records nothing, and silence there is the same outage wearing a
 * different hat.
 */
export function evaluateIngestionHealth(
  sources: readonly IngestionSourceHealthInput[],
  now: number,
  staleAfterMs: number = INGESTION_STALE_AFTER_MS,
): IngestionHealthVerdict {
  const watched = sources.filter(isWatched);

  const stale: StaleSource[] = watched
    .map((source) => ({
      sourceId: source.sourceId,
      label: source.label,
      staleForMs: now - referencePoint(source),
      neverSucceeded: source.lastSuccessAt === undefined,
    }))
    .filter((candidate) => candidate.staleForMs > staleAfterMs);

  return {
    firing: watched.length === 0 || stale.length > 0,
    watchedCount: watched.length,
    stale,
    detail: describe(stale, watched.length),
  };
}
