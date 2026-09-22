/**
 * Pure rollup of Cadence push events for the Streams page. No Convex
 * imports so `bun test` covers it directly.
 */

export interface PushEventInput {
  kind: string;
  message: string;
  createdAt: number;
  context?: unknown;
}

export interface PushSummary {
  okLast24h: number;
  errorLast24h: number;
  lastOk: { at: number; title: string; programName: string; dryRun: boolean } | null;
  lastError: { at: number; message: string } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface PushContext {
  dryRun?: boolean;
  programName?: string;
  song?: { title?: string };
}

export function summarizePushEvents(events: readonly PushEventInput[], now: number): PushSummary {
  const cutoff = now - DAY_MS;
  let okLast24h = 0;
  let errorLast24h = 0;
  let lastOk: PushSummary["lastOk"] = null;
  let lastError: PushSummary["lastError"] = null;

  for (const ev of events) {
    if (ev.kind === "cadence_push_ok") {
      if (ev.createdAt >= cutoff) okLast24h += 1;
      if (lastOk === null || ev.createdAt > lastOk.at) lastOk = okEntry(ev);
    } else if (ev.kind === "cadence_push_error") {
      if (ev.createdAt >= cutoff) errorLast24h += 1;
      if (lastError === null || ev.createdAt > lastError.at) {
        lastError = { at: ev.createdAt, message: ev.message };
      }
    }
  }
  return { okLast24h, errorLast24h, lastOk, lastError };
}

function okEntry(ev: PushEventInput): NonNullable<PushSummary["lastOk"]> {
  const c = (ev.context ?? {}) as PushContext;
  return {
    at: ev.createdAt,
    title: c.song?.title ?? ev.message,
    programName: c.programName ?? "",
    dryRun: c.dryRun === true,
  };
}
