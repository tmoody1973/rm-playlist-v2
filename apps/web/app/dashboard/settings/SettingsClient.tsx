"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@rm/convex/api";
import type { FunctionReturnType } from "convex/server";

type StationSlug = "hyfin" | "88nine" | "414music" | "rhythmlab";

const STATIONS: ReadonlyArray<{ slug: StationSlug; label: string }> = [
  { slug: "88nine", label: "88Nine" },
  { slug: "hyfin", label: "HYFIN" },
  { slug: "rhythmlab", label: "Rhythm Lab" },
  { slug: "414music", label: "414 Music" },
];

const ORG_SLUG = "radiomilwaukee";

export function SettingsClient() {
  return (
    <div className="flex flex-col gap-8">
      <OrgInfoSection />
      <OperatorsSection />
      <IngestionSourcesSection />
      <StationRegionsSection />
      <EnvReferenceSection />
    </div>
  );
}

// ---------------------------------------------------------------- //
// Org info
// ---------------------------------------------------------------- //

function OrgInfoSection() {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader eyebrow="Identity" title="Organization" />
      <div className="rounded-md border border-border bg-bg-surface p-4">
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <Field label="Name" value="Radio Milwaukee" />
          <Field label="Slug" value={ORG_SLUG} mono />
          <Field label="Mode" value="Single-tenant (shakedown)" />
          <Field
            label="Streams"
            value={`${STATIONS.length} (${STATIONS.map((s) => s.label).join(", ")})`}
          />
        </dl>
      </div>
    </section>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          color: "var(--text-primary)",
          fontFamily: mono === true ? "var(--font-mono)" : undefined,
          fontSize: mono === true ? "13px" : "14px",
        }}
      >
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------- //
// Operators
// ---------------------------------------------------------------- //

function OperatorsSection() {
  const users = useQuery(api.users.listForOrg, { orgSlug: ORG_SLUG });

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        eyebrow="Access"
        title="Operators"
        body="Dashboard access is allowlisted to @radiomilwaukee.org email addresses (apps/web/app/dashboard/layout.tsx). Anyone outside that domain who signs in lands on /access-denied."
      />
      {users === undefined ? (
        <Skeleton rows={3} />
      ) : users.length === 0 ? (
        <p className="text-sm text-text-muted">
          No operators yet — sign in to create the first record.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border" style={tableHeaderStyle}>
                <th className="px-4 py-2 text-left font-semibold">Email</th>
                <th className="px-4 py-2 text-left font-semibold">Name</th>
                <th className="px-4 py-2 text-left font-semibold">Role</th>
                <th className="px-4 py-2 text-left font-semibold">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u._id} className="border-b border-border last:border-0">
                  <td
                    className="px-4 py-3"
                    style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}
                  >
                    {u.email}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{u.fullName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <RoleBadge role={u.role} />
                  </td>
                  <td
                    className="px-4 py-3 text-text-muted"
                    style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}
                  >
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RoleBadge({ role }: { role: "operator" | "admin" }) {
  const isAdmin = role === "admin";
  return (
    <span
      className="rounded px-2 py-0.5 text-xs"
      style={{
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        background: isAdmin ? "var(--accent-cta)" : "var(--bg-elevated)",
        color: isAdmin ? "var(--bg-base)" : "var(--text-muted)",
      }}
    >
      {role}
    </span>
  );
}

// ---------------------------------------------------------------- //
// Ingestion sources (pause / resume)
// ---------------------------------------------------------------- //

function IngestionSourcesSection() {
  const sources = useQuery(api.ingestionSources.statusForDashboard, {});
  const setEnabled = useMutation(api.ingestionSources.setEnabled);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onToggle = async (sourceId: string, nextEnabled: boolean) => {
    setBusyId(sourceId);
    setError(null);
    try {
      await setEnabled({
        sourceId: sourceId as Parameters<typeof setEnabled>[0]["sourceId"],
        enabled: nextEnabled,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        eyebrow="Ingestion"
        title="Sources"
        body="Each row is one adapter feeding one station. Pausing a source stops its polls and gets it out of the Needs Attention queue — useful when an upstream API is rate-limiting or down. Re-enable any time."
      />
      {error !== null && (
        <p className="rounded-md border border-status-error/50 bg-status-error/10 px-3 py-2 text-sm text-status-error">
          {error}
        </p>
      )}
      {sources === undefined ? (
        <Skeleton rows={4} />
      ) : sources.length === 0 ? (
        <p className="text-sm text-text-muted">No ingestion sources configured.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border" style={tableHeaderStyle}>
                <th className="px-4 py-2 text-left font-semibold">Station</th>
                <th className="px-4 py-2 text-left font-semibold">Adapter</th>
                <th className="px-4 py-2 text-left font-semibold">Role</th>
                <th className="px-4 py-2 text-left font-semibold">Status</th>
                <th className="px-4 py-2 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s._id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{s.station}</td>
                  <td
                    className="px-4 py-3 text-text-secondary"
                    style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}
                  >
                    {s.adapter}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{s.role}</td>
                  <td className="px-4 py-3">
                    <EnabledBadge enabled={s.enabled} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={busyId === s._id}
                      onClick={() => onToggle(s._id, !s.enabled)}
                      className="rounded-md border border-border px-3 py-1 text-xs font-semibold uppercase transition-colors hover:border-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                      style={{
                        fontFamily: "var(--font-mono)",
                        letterSpacing: "0.04em",
                        color: s.enabled ? "var(--status-warn)" : "var(--status-ok)",
                      }}
                    >
                      {busyId === s._id ? "…" : s.enabled ? "Pause" : "Resume"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
      <span
        aria-hidden="true"
        className="inline-block rounded-full"
        style={{
          width: "8px",
          height: "8px",
          background: enabled ? "var(--status-ok)" : "var(--text-muted)",
        }}
      />
      {enabled ? "active" : "paused"}
    </span>
  );
}

// ---------------------------------------------------------------- //
// Station regions (CRUD)
// ---------------------------------------------------------------- //

type RegionRow = FunctionReturnType<typeof api.stationRegions.listAllForOrg>[number];

function StationRegionsSection() {
  const regions = useQuery(api.stationRegions.listAllForOrg, { orgSlug: ORG_SLUG });
  const [creating, setCreating] = useState(false);

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <span style={eyebrowStyle}>Polling geo</span>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2
            className="text-lg font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
          >
            Station regions
          </h2>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-md px-3 py-1 text-xs font-semibold uppercase text-bg-base"
            style={{
              background: "var(--accent-cta)",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.04em",
            }}
          >
            + Add region
          </button>
        </div>
        <p className="max-w-3xl text-sm text-text-secondary" style={{ lineHeight: 1.55 }}>
          Lat/long anchors the Ticketmaster cron uses to find local events. When this list is empty,
          the cron falls back to defaults: Milwaukee 50mi, Madison 35mi, Chicago 40mi. Adding even
          one row takes over from the defaults entirely — re-add the ones you want.
        </p>
      </header>

      {regions === undefined ? (
        <Skeleton rows={3} />
      ) : regions.length === 0 ? (
        <p className="rounded-md border border-border bg-bg-surface p-4 text-sm text-text-muted">
          No custom regions configured. Cron is using defaults: Milwaukee 50mi · Madison 35mi ·
          Chicago 40mi.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border" style={tableHeaderStyle}>
                <th className="px-4 py-2 text-left font-semibold">Label</th>
                <th className="px-4 py-2 text-left font-semibold">Station</th>
                <th className="px-4 py-2 text-left font-semibold">Kind</th>
                <th className="px-4 py-2 text-left font-semibold">Config</th>
                <th className="px-4 py-2 text-left font-semibold">Status</th>
                <th className="px-4 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((r) => (
                <RegionRow key={r._id} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <RegionEditorDrawer onClose={() => setCreating(false)} />}
    </section>
  );
}

function RegionRow({ row }: { row: RegionRow }) {
  const update = useMutation(api.stationRegions.update);
  const remove = useMutation(api.stationRegions.remove);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const onToggleEnabled = async () => {
    setBusy(true);
    try {
      await update({ regionId: row._id, enabled: !row.enabled });
    } finally {
      setBusy(false);
    }
  };
  const onDelete = async () => {
    if (!confirm(`Delete region "${row.label ?? row.kind}"?`)) return;
    setBusy(true);
    try {
      await remove({ regionId: row._id });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <tr className="border-b border-border last:border-0">
        <td className="px-4 py-3 font-medium">{row.label ?? "—"}</td>
        <td className="px-4 py-3 text-text-secondary">{row.stationName ?? "?"}</td>
        <td
          className="px-4 py-3 text-text-secondary"
          style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}
        >
          {row.kind}
        </td>
        <td
          className="px-4 py-3 text-text-secondary"
          style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}
        >
          {formatConfig(row.kind, row.config)}
        </td>
        <td className="px-4 py-3">
          <EnabledBadge enabled={row.enabled} />
        </td>
        <td className="px-4 py-3 text-right">
          <div className="inline-flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onToggleEnabled}
              className="rounded-md border border-border px-2 py-1 text-xs uppercase hover:border-text-primary disabled:opacity-50"
              style={{
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.04em",
                color: row.enabled ? "var(--status-warn)" : "var(--status-ok)",
              }}
            >
              {row.enabled ? "Disable" : "Enable"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-border px-2 py-1 text-xs uppercase hover:border-text-primary"
              style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}
            >
              Edit
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="rounded-md border border-border px-2 py-1 text-xs uppercase text-status-error hover:border-status-error disabled:opacity-50"
              style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}
            >
              Delete
            </button>
          </div>
        </td>
      </tr>
      {editing && <RegionEditorDrawer onClose={() => setEditing(false)} existing={row} />}
    </>
  );
}

function formatConfig(kind: RegionRow["kind"], config: unknown): string {
  if (typeof config !== "object" || config === null) return "—";
  const c = config as Record<string, unknown>;
  if (kind === "radius") {
    const lat = typeof c.lat === "number" ? c.lat.toFixed(4) : "?";
    const long = typeof c.long === "number" ? c.long.toFixed(4) : "?";
    const r = typeof c.radiusMiles === "number" ? `${c.radiusMiles}mi` : "?";
    return `${lat}, ${long} · ${r}`;
  }
  if (kind === "dma") return typeof c.dmaId === "number" ? `dmaId ${c.dmaId}` : "—";
  if (kind === "country") return typeof c.cc === "string" ? c.cc : "—";
  if (kind === "venue_list") {
    const ids = Array.isArray(c.venueIds) ? c.venueIds.length : 0;
    return `${ids} venue${ids === 1 ? "" : "s"}`;
  }
  return JSON.stringify(c);
}

// ---------------------------------------------------------------- //
// Region editor drawer
// ---------------------------------------------------------------- //

function RegionEditorDrawer({ onClose, existing }: { onClose: () => void; existing?: RegionRow }) {
  const create = useMutation(api.stationRegions.create);
  const update = useMutation(api.stationRegions.update);

  const [stationSlug, setStationSlug] = useState<StationSlug>(
    (existing?.stationSlug as StationSlug | null) ?? "88nine",
  );
  const [label, setLabel] = useState(existing?.label ?? "");
  const existingConfig = (existing?.config ?? {}) as {
    lat?: number;
    long?: number;
    radiusMiles?: number;
  };
  const [lat, setLat] = useState(existingConfig.lat?.toString() ?? "");
  const [long, setLong] = useState(existingConfig.long?.toString() ?? "");
  const [radius, setRadius] = useState(existingConfig.radiusMiles?.toString() ?? "");
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const latNum = Number.parseFloat(lat);
    const longNum = Number.parseFloat(long);
    const radiusNum = Number.parseFloat(radius);
    if (Number.isNaN(latNum) || Number.isNaN(longNum) || Number.isNaN(radiusNum)) {
      setError("Lat, long, and radius must all be valid numbers.");
      return;
    }
    if (radiusNum <= 0 || radiusNum > 200) {
      setError("Radius must be between 1 and 200 miles.");
      return;
    }
    const config = { lat: latNum, long: longNum, radiusMiles: radiusNum };
    setSubmitting(true);
    try {
      if (existing !== undefined) {
        await update({
          regionId: existing._id,
          config,
          label: label.trim() || undefined,
          enabled,
        });
      } else {
        await create({
          orgSlug: ORG_SLUG,
          stationSlug,
          kind: "radius",
          config,
          label: label.trim() || undefined,
          enabled,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={existing !== undefined ? "Edit region" : "Add region"}
      className="fixed inset-0 z-50 flex justify-end"
      onClick={onClose}
    >
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0, 0, 0, 0.5)" }}
        aria-hidden="true"
      />
      <aside
        className="relative flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-border bg-bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <h2
            className="text-xl font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
          >
            {existing !== undefined ? "Edit region" : "Add region"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border border-border px-2 py-1 text-sm text-text-muted hover:border-text-primary hover:text-text-primary"
          >
            ✕
          </button>
        </header>

        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          {existing === undefined && (
            <FormField label="Station" required>
              <select
                value={stationSlug}
                onChange={(e) => setStationSlug(e.currentTarget.value as StationSlug)}
                className={inputClass}
              >
                {STATIONS.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.label}
                  </option>
                ))}
              </select>
            </FormField>
          )}

          <FormField label="Label" hint="optional, human-readable name">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.currentTarget.value)}
              placeholder="e.g. Milwaukee Metro"
              className={inputClass}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Latitude" required>
              <input
                type="text"
                value={lat}
                onChange={(e) => setLat(e.currentTarget.value)}
                required
                placeholder="43.0389"
                className={inputClass}
                inputMode="decimal"
              />
            </FormField>
            <FormField label="Longitude" required>
              <input
                type="text"
                value={long}
                onChange={(e) => setLong(e.currentTarget.value)}
                required
                placeholder="-87.9065"
                className={inputClass}
                inputMode="decimal"
              />
            </FormField>
          </div>

          <FormField label="Radius (miles)" required>
            <input
              type="number"
              value={radius}
              onChange={(e) => setRadius(e.currentTarget.value)}
              required
              min={1}
              max={200}
              placeholder="50"
              className={inputClass}
            />
          </FormField>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.currentTarget.checked)}
              className="h-3.5 w-3.5 cursor-pointer"
            />
            <span>Enabled (cron will poll this region)</span>
          </label>

          {error !== null && (
            <p className="rounded-md border border-status-error/50 bg-status-error/10 px-3 py-2 text-sm text-status-error">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md px-4 py-2 text-sm font-semibold uppercase disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: "var(--accent-cta)",
                color: "var(--bg-base)",
                letterSpacing: "0.04em",
                fontFamily: "var(--font-mono)",
              }}
            >
              {submitting ? "Saving…" : existing !== undefined ? "Save changes" : "Add region"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm uppercase text-text-muted hover:border-text-primary hover:text-text-primary"
              style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}
            >
              Cancel
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- //
// Env reference (informational checklist)
// ---------------------------------------------------------------- //

const ENV_REFERENCE: ReadonlyArray<{
  name: string;
  target: "Vercel" | "Trigger.dev" | "Convex";
  purpose: string;
  required: boolean;
}> = [
  {
    name: "NEXT_PUBLIC_CONVEX_URL",
    target: "Vercel",
    purpose: "Browser + edge OG route Convex client URL.",
    required: true,
  },
  {
    name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    target: "Vercel",
    purpose: "Clerk auth — browser-side publishable key.",
    required: true,
  },
  {
    name: "CLERK_SECRET_KEY",
    target: "Vercel",
    purpose: "Clerk auth — server-side secret key.",
    required: true,
  },
  {
    name: "TICKETMASTER_CONSUMER_KEY",
    target: "Trigger.dev",
    purpose: "Discovery API key for poll-ticketmaster cron.",
    required: true,
  },
  {
    name: "AXS_ACCESS_TOKEN",
    target: "Trigger.dev",
    purpose: "AXS Events API token for the future poll-axs cron (Step 6).",
    required: false,
  },
  {
    name: "APPLE_MUSIC_PRIVATE_KEY / APPLE_MUSIC_KEY_ID / APPLE_MUSIC_TEAM_ID",
    target: "Convex",
    purpose: "Apple Music JWT signing for enrichment + preview resolution.",
    required: true,
  },
  {
    name: "HYFIN_SPINITRON_KEY / 88NINE_SGMETADATA_KEY / etc.",
    target: "Trigger.dev",
    purpose:
      "Per-station ingestion-source API keys; referenced via ingestionSources.config.apiKeyRef.",
    required: true,
  },
];

function EnvReferenceSection() {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        eyebrow="Secrets"
        title="Env var reference"
        body="Checklist of secrets the platform expects, and which deployment target each one lives on. Status checking is deferred — these live across three different deploy targets and there's no single place to query 'is X set on Y' yet."
      />
      <div className="overflow-x-auto rounded-md border border-border bg-bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border" style={tableHeaderStyle}>
              <th className="px-4 py-2 text-left font-semibold">Variable</th>
              <th className="px-4 py-2 text-left font-semibold">Target</th>
              <th className="px-4 py-2 text-left font-semibold">Required</th>
              <th className="px-4 py-2 text-left font-semibold">Purpose</th>
            </tr>
          </thead>
          <tbody>
            {ENV_REFERENCE.map((env) => (
              <tr key={env.name} className="border-b border-border last:border-0">
                <td
                  className="px-4 py-3"
                  style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}
                >
                  {env.name}
                </td>
                <td className="px-4 py-3">
                  <TargetBadge target={env.target} />
                </td>
                <td className="px-4 py-3">
                  {env.required ? (
                    <span style={{ color: "var(--status-error)", fontWeight: 600 }}>required</span>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>optional</span>
                  )}
                </td>
                <td className="px-4 py-3 text-text-secondary">{env.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TargetBadge({ target }: { target: "Vercel" | "Trigger.dev" | "Convex" }) {
  return (
    <span
      className="rounded px-2 py-0.5 text-xs"
      style={{
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        background: "var(--bg-elevated)",
        color: "var(--text-muted)",
      }}
    >
      {target}
    </span>
  );
}

// ---------------------------------------------------------------- //
// Shared bits
// ---------------------------------------------------------------- //

const inputClass =
  "rounded-md border border-border bg-bg-base px-3 py-2 text-sm focus:border-accent-cta focus:outline-none";

const eyebrowStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  fontWeight: 600,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

const tableHeaderStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

function SectionHeader({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <header className="flex flex-col gap-1">
      <span style={eyebrowStyle}>{eyebrow}</span>
      <h2
        className="text-lg font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
      >
        {title}
      </h2>
      {body !== undefined && (
        <p className="max-w-3xl text-sm text-text-secondary" style={{ lineHeight: 1.55 }}>
          {body}
        </p>
      )}
    </header>
  );
}

function FormField({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span style={eyebrowStyle}>
        {label}
        {required === true && (
          <span style={{ color: "var(--accent-cta)", marginLeft: "4px" }}>*</span>
        )}
        {hint !== undefined && (
          <span style={{ marginLeft: "8px", textTransform: "none", letterSpacing: 0 }}>
            ({hint})
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-12 animate-pulse rounded-md bg-bg-surface"
          style={{ opacity: 0.6 }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
