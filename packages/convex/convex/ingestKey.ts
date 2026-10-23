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
 * Rollout, see docs/decisions/012-worker-server-key.md: while the workers are
 * being given the key, a call without one is logged and allowed. Once the logs
 * show no unkeyed calls for a day, `serverKey` becomes required.
 */
export const ingestKeyArg = v.optional(v.string());

export function checkIngestKey(serverKey: string | undefined, caller: string): void {
  if (serverKey === undefined) {
    // ponytail: stage-1 grace period; stage 3 replaces this branch with a throw.
    console.warn(`[ingest-key] unkeyed call to ${caller}`);
    return;
  }
  assertServerKey(serverKey, process.env.INGEST_SERVER_KEY);
}
