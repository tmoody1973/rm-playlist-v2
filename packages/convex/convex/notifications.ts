import { v } from "convex/values";
import {
  type ActionCtx,
  type MutationCtx,
  internalAction,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Auth } from "convex/server";
import type { Id } from "./_generated/dataModel";

/**
 * Operational email alerts.
 *
 * Two halves:
 *   - CRUD for `alertRecipients`, driven by the operator settings page.
 *   - `sendAlertEmail`, an internal action that posts to Resend.
 *
 * Resend is called with plain `fetch` rather than an SDK — one POST to one
 * endpoint does not justify a dependency in the Convex runtime.
 *
 * Requires two Convex environment variables:
 *   RESEND_API_KEY    — from https://resend.com/api-keys
 *   ALERT_EMAIL_FROM  — a verified sender, e.g. "Playlist <alerts@radiomilwaukee.org>"
 * Set them with `bunx convex env set NAME value`. When either is missing the
 * action logs loudly and returns `skipped` instead of throwing, so a missing
 * key degrades the alert rather than breaking the cron that raised it.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Rough sanity check at the trust boundary; Resend does the real validation. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Anything that can cause an outbound email is gated on a signed-in identity.
 *
 * Most mutations in this codebase are still open (see the TODO in plays.ts),
 * but "add an arbitrary address and make our verified domain email it" is a
 * spam relay, not just an unauthenticated write. The gate goes here now rather
 * than waiting for the project-wide auth pass.
 */
async function requireSignedIn(ctx: { auth: Auth }): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new Error("Not signed in");
  }
}

// ---------------------------------------------------------------- //
// Recipients — read
// ---------------------------------------------------------------- //

/** All recipients for an org, enabled first, for the settings table. */
export const listRecipientsForOrg = query({
  args: { orgSlug: v.string() },
  handler: async (ctx, { orgSlug }) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", orgSlug))
      .first();
    if (org === null) return [];

    const rows = await ctx.db
      .query("alertRecipients")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();

    return rows
      .map((r) => ({
        _id: r._id,
        email: r.email,
        label: r.label,
        enabled: r.enabled,
        createdAt: r.createdAt,
      }))
      .sort((a, b) => a.email.localeCompare(b.email));
  },
});

/** Enabled recipient addresses for an org. Internal — used by the sender. */
export const enabledRecipientEmails = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db
      .query("alertRecipients")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows.filter((r) => r.enabled).map((r) => r.email);
  },
});

/** A single recipient, used when sending a test to one address. */
export const recipientById = internalQuery({
  args: { recipientId: v.id("alertRecipients") },
  handler: async (ctx, { recipientId }) => {
    const row = await ctx.db.get(recipientId);
    return row === null ? null : { email: row.email, orgId: row.orgId };
  },
});

// ---------------------------------------------------------------- //
// Test sends
// ---------------------------------------------------------------- //

const TEST_SUBJECT = "[Playlist] Test alert — you are on the outage list";

const TEST_BODY = [
  "This is a test. Nothing is wrong.",
  "",
  "You were just added to the playlist outage list, so this message proves two",
  "things: the address works, and our alerts are not landing in your spam folder.",
  "",
  "If a real outage happens you will get one email when the playlist stops",
  "recording songs, and one more when it starts again. Never a reminder in",
  "between.",
  "",
  "If this landed in spam, mark it as not spam now — otherwise the one that",
  "matters will land there too.",
  "",
  "To stop these, remove yourself in the playlist dashboard under",
  "Settings -> Outage email recipients.",
].join("\n");

/**
 * Send a test to one address as soon as it is added.
 *
 * An alert nobody has ever received is a guess, not a safety net — the failure
 * modes (unverified domain, typo, spam filter) are all silent until the day it
 * matters. Proving delivery at add-time costs one email.
 */
async function scheduleTestEmail(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  recipientId: Id<"alertRecipients">,
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.notifications.sendAlertEmail, {
    orgId,
    subject: TEST_SUBJECT,
    body: TEST_BODY,
    onlyRecipientId: recipientId,
  });
}

/**
 * Re-send the test to one existing recipient. Useful long after setup — a
 * bounced address or a changed sending domain is otherwise invisible until
 * a real outage.
 */
export const sendTestAlert = mutation({
  args: { recipientId: v.id("alertRecipients") },
  handler: async (ctx, { recipientId }) => {
    await requireSignedIn(ctx);
    const row = await ctx.db.get(recipientId);
    if (row === null) throw new Error("That recipient no longer exists.");
    await scheduleTestEmail(ctx, row.orgId, recipientId);
    return { sentTo: row.email };
  },
});

// ---------------------------------------------------------------- //
// Recipients — write
// ---------------------------------------------------------------- //

export const addRecipient = mutation({
  args: {
    orgSlug: v.string(),
    email: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, { orgSlug, email, label }) => {
    await requireSignedIn(ctx);
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      throw new Error(`Not a valid email address: ${email}`);
    }

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", orgSlug))
      .first();
    if (org === null) throw new Error(`Unknown organization: ${orgSlug}`);

    const existing = await ctx.db
      .query("alertRecipients")
      .withIndex("by_org_email", (q) => q.eq("orgId", org._id).eq("email", normalized))
      .first();
    if (existing !== null) {
      await ctx.db.patch(existing._id, { enabled: true, label });
      await scheduleTestEmail(ctx, org._id, existing._id);
      return { recipientId: existing._id, action: "reenabled" as const };
    }

    const recipientId = await ctx.db.insert("alertRecipients", {
      orgId: org._id,
      email: normalized,
      label,
      enabled: true,
      createdAt: Date.now(),
    });
    await scheduleTestEmail(ctx, org._id, recipientId);
    return { recipientId, action: "created" as const };
  },
});

export const setRecipientEnabled = mutation({
  args: { recipientId: v.id("alertRecipients"), enabled: v.boolean() },
  handler: async (ctx, { recipientId, enabled }) => {
    await requireSignedIn(ctx);
    await ctx.db.patch(recipientId, { enabled });
  },
});

export const removeRecipient = mutation({
  args: { recipientId: v.id("alertRecipients") },
  handler: async (ctx, { recipientId }) => {
    await requireSignedIn(ctx);
    await ctx.db.delete(recipientId);
  },
});

// ---------------------------------------------------------------- //
// Sending
// ---------------------------------------------------------------- //

interface SendOutcome {
  readonly status: "sent" | "skipped" | "partial";
  readonly attempted: number;
  readonly failed: readonly string[];
  readonly reason?: string;
}

async function postToResend(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "<no body>");
    throw new Error(`Resend returned ${res.status}: ${detail}`);
  }
}

/**
 * Which addresses this send goes to.
 *
 * A targeted send (the test email) skips the enabled filter on purpose — you
 * test a silenced address precisely to find out whether it still works. The
 * org check stops a recipient id from one org addressing another's send.
 */
async function resolveRecipients(
  ctx: { runQuery: ActionCtx["runQuery"] },
  orgId: Id<"organizations">,
  onlyRecipientId: Id<"alertRecipients"> | undefined,
): Promise<string[]> {
  if (onlyRecipientId === undefined) {
    return await ctx.runQuery(internal.notifications.enabledRecipientEmails, { orgId });
  }
  const row = await ctx.runQuery(internal.notifications.recipientById, {
    recipientId: onlyRecipientId,
  });
  if (row === null || row.orgId !== orgId) return [];
  return [row.email];
}

/**
 * Email every enabled recipient for an org.
 *
 * One request per recipient rather than one request with everyone in `to`:
 * it keeps addresses private from each other, and one bad address fails
 * alone instead of taking the whole alert with it.
 */
export const sendAlertEmail = internalAction({
  args: {
    orgId: v.id("organizations"),
    subject: v.string(),
    body: v.string(),
    /** When set, send to just this one recipient instead of the whole list. */
    onlyRecipientId: v.optional(v.id("alertRecipients")),
  },
  handler: async (ctx, { orgId, subject, body, onlyRecipientId }): Promise<SendOutcome> => {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.ALERT_EMAIL_FROM;

    if (apiKey === undefined || apiKey.length === 0 || from === undefined || from.length === 0) {
      const reason =
        "RESEND_API_KEY and/or ALERT_EMAIL_FROM are not set on this Convex deployment — alert not delivered";
      console.error(`[alerts] ${reason}. Subject was: ${subject}`);
      return { status: "skipped", attempted: 0, failed: [], reason };
    }

    const recipients: string[] = await resolveRecipients(ctx, orgId, onlyRecipientId);

    if (recipients.length === 0) {
      const reason = "No enabled alert recipients configured — alert not delivered";
      console.error(`[alerts] ${reason}. Subject was: ${subject}`);
      return { status: "skipped", attempted: 0, failed: [], reason };
    }

    const failed: string[] = [];
    for (const to of recipients) {
      try {
        await postToResend(apiKey, from, to, subject, body);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[alerts] failed to email ${to}: ${message}`);
        failed.push(to);
      }
    }

    return {
      status: failed.length === 0 ? "sent" : "partial",
      attempted: recipients.length,
      failed,
    };
  },
});
