import { v } from "convex/values";
import { assertServerKey } from "./listenerGuard";

/**
 * Proof that a write came from our own workers (Trigger.dev tasks, the Fly
 * icy-worker), not from anyone who read the Convex URL out of the widget.
 *
 * A separate key from RADIO_COMMONS_SERVER_KEY on purpose: that one lives in
 * the listener apps, and a leak there must not let someone forge plays, which
 * are the station's royalty record.
 *
 * Rollout, see docs/decisions/012-worker-server-key.md. The validator stays
 * optional so a missing key is refused by our check, not by Convex's argument
 * validator (whose error would echo the args), and so staff can still call
 * events.upsertBatch from the dashboard without one.
 */
export const ingestKeyArg = v.optional(v.string());

export function checkIngestKey(serverKey: string | undefined, caller: string): void {
  if (serverKey === undefined) {
    console.warn(`[ingest-key] refused unkeyed call to ${caller}`);
    throw new Error("Unauthorized");
  }
  assertServerKey(serverKey, process.env.INGEST_SERVER_KEY);
}
