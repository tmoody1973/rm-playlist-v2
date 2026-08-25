import { v } from "convex/values";
import { internalAction, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

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
      return { recipientId: existing._id, action: "reenabled" as const };
    }

    const recipientId = await ctx.db.insert("alertRecipients", {
      orgId: org._id,
      email: normalized,
      label,
      enabled: true,
      createdAt: Date.now(),
    });
    return { recipientId, action: "created" as const };
  },
});

export const setRecipientEnabled = mutation({
  args: { recipientId: v.id("alertRecipients"), enabled: v.boolean() },
  handler: async (ctx, { recipientId, enabled }) => {
    await ctx.db.patch(recipientId, { enabled });
  },
});

export const removeRecipient = mutation({
  args: { recipientId: v.id("alertRecipients") },
  handler: async (ctx, { recipientId }) => {
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
  },
  handler: async (ctx, { orgId, subject, body }): Promise<SendOutcome> => {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.ALERT_EMAIL_FROM;

    if (apiKey === undefined || apiKey.length === 0 || from === undefined || from.length === 0) {
      const reason =
        "RESEND_API_KEY and/or ALERT_EMAIL_FROM are not set on this Convex deployment — alert not delivered";
      console.error(`[alerts] ${reason}. Subject was: ${subject}`);
      return { status: "skipped", attempted: 0, failed: [], reason };
    }

    const recipients: string[] = await ctx.runQuery(internal.notifications.enabledRecipientEmails, {
      orgId,
    });

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
