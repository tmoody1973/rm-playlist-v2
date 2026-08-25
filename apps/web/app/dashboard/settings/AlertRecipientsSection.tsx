"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@rm/convex/api";
import type { FunctionReturnType } from "convex/server";
import { Skeleton, eyebrowStyle, tableHeaderStyle } from "./settingsChrome";

/**
 * Who gets emailed when ingestion stalls.
 *
 * Added after the 2026-08-25 outage, where polling stopped for about six
 * hours and the only reason anyone found out was that a person happened to
 * look. See docs/incidents/2026-08-25-playlist-ingestion-outage.md.
 */

const ORG_SLUG = "radiomilwaukee";

type RecipientRow = FunctionReturnType<typeof api.notifications.listRecipientsForOrg>[number];

export function AlertRecipientsSection() {
  const recipients = useQuery(api.notifications.listRecipientsForOrg, { orgSlug: ORG_SLUG });

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <span style={eyebrowStyle}>Alerting</span>
        <h2
          className="text-lg font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
        >
          Outage email recipients
        </h2>
        <p className="max-w-3xl text-sm text-text-secondary" style={{ lineHeight: 1.55 }}>
          A watchdog runs on Convex every five minutes and checks when each ingestion source last
          polled successfully. If any enabled source goes ten minutes without a successful poll,
          everyone below gets one email. They get one more when it recovers — never a reminder in
          between, because alerts people mute are worse than no alerts.
        </p>
        <p className="max-w-3xl text-sm text-text-secondary" style={{ lineHeight: 1.55 }}>
          The watchdog deliberately runs on Convex rather than Trigger.dev, because Trigger.dev is
          what failed on 2026-08-25. Delivery needs{" "}
          <code style={{ fontFamily: "var(--font-mono)" }}>RESEND_API_KEY</code> and{" "}
          <code style={{ fontFamily: "var(--font-mono)" }}>ALERT_EMAIL_FROM</code> set on the Convex
          deployment.
        </p>
        <p className="max-w-3xl text-sm text-text-secondary" style={{ lineHeight: 1.55 }}>
          Every address gets a test email the moment it is added, and you can re-send one any time
          with <strong>Send test</strong>. An alert nobody has ever received is a guess, not a
          safety net — a typo or a spam filter stays invisible until the day it matters.
        </p>
      </header>

      <AddRecipientForm />

      {recipients === undefined ? (
        <Skeleton rows={2} />
      ) : recipients.length === 0 ? (
        <p className="rounded-md border border-border bg-bg-surface p-4 text-sm text-text-secondary">
          No recipients yet. Nobody will be told when the playlist stops recording.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border" style={tableHeaderStyle}>
                <th className="px-4 py-2 text-left font-semibold">Email</th>
                <th className="px-4 py-2 text-left font-semibold">Label</th>
                <th className="px-4 py-2 text-left font-semibold">Status</th>
                <th className="px-4 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((row) => (
                <RecipientTableRow key={row._id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AddRecipientForm() {
  const addRecipient = useMutation(api.notifications.addRecipient);
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSentTo(null);
    setSaving(true);
    try {
      await addRecipient({
        orgSlug: ORG_SLUG,
        email,
        label: label.trim().length > 0 ? label.trim() : undefined,
      });
      setSentTo(email.trim().toLowerCase());
      setEmail("");
      setLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that recipient.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-md border border-border bg-bg-surface p-4 md:flex-row md:items-end"
    >
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor="alert-email" style={eyebrowStyle}>
          Email address
        </label>
        <input
          id="alert-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ops@radiomilwaukee.org"
          className="rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary"
        />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor="alert-label" style={eyebrowStyle}>
          Label (optional)
        </label>
        <input
          id="alert-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Ops inbox"
          className="rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary"
        />
      </div>
      <button
        type="submit"
        disabled={saving}
        className="rounded-md px-3 py-2 text-xs font-semibold uppercase text-bg-base disabled:opacity-60"
        style={{
          background: "var(--accent-cta)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.04em",
        }}
      >
        {saving ? "Adding…" : "+ Add recipient"}
      </button>
      {error !== null && (
        <p role="alert" className="text-sm" style={{ color: "var(--accent-alert, #d33)" }}>
          {error}
        </p>
      )}
      {sentTo !== null && (
        <p role="status" className="text-sm text-text-secondary">
          Added. A test email is on its way to {sentTo} — check spam if it does not arrive.
        </p>
      )}
    </form>
  );
}

function RecipientTableRow({ row }: { row: RecipientRow }) {
  const setEnabled = useMutation(api.notifications.setRecipientEnabled);
  const removeRecipient = useMutation(api.notifications.removeRecipient);
  const sendTestAlert = useMutation(api.notifications.sendTestAlert);
  const [busy, setBusy] = useState(false);
  const [testState, setTestState] = useState<"idle" | "sent" | "failed">("idle");

  async function toggle(): Promise<void> {
    setBusy(true);
    try {
      await setEnabled({ recipientId: row._id, enabled: !row.enabled });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest(): Promise<void> {
    setBusy(true);
    setTestState("idle");
    try {
      await sendTestAlert({ recipientId: row._id });
      setTestState("sent");
    } catch {
      setTestState("failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    try {
      await removeRecipient({ recipientId: row._id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-2" style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}>
        {row.email}
      </td>
      <td className="px-4 py-2 text-text-secondary">{row.label ?? "—"}</td>
      <td className="px-4 py-2">
        {row.enabled ? "Receiving alerts" : "Silenced"}
        {testState === "sent" && (
          <span role="status" className="ml-2 text-text-secondary">
            · test sent
          </span>
        )}
        {testState === "failed" && (
          <span role="alert" className="ml-2" style={{ color: "var(--accent-alert, #d33)" }}>
            · test failed
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-right">
        <button
          type="button"
          onClick={sendTest}
          disabled={busy}
          className="mr-3 text-xs font-semibold uppercase underline disabled:opacity-60"
          style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}
        >
          Send test
        </button>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className="mr-3 text-xs font-semibold uppercase underline disabled:opacity-60"
          style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}
        >
          {row.enabled ? "Silence" : "Unsilence"}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="text-xs font-semibold uppercase underline disabled:opacity-60"
          style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}
        >
          Remove
        </button>
      </td>
    </tr>
  );
}
