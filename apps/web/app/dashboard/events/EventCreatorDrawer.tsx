"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@rm/convex/api";

/**
 * Custom-event creator drawer for the operator dashboard.
 *
 * Used when a DJ wants to add a show that didn't come from any feed —
 * Pabst show on a small label, etix-only event, hyperlocal happening,
 * one-off the cron didn't catch. Calls events.upsertBatch with
 * source="custom" — the cross-source dedup logic from Step 2 means
 * this row will properly defer to AXS or beat Ticketmaster if they
 * later list the same show.
 *
 * Minimal form by intent: title, venue, city, region, start datetime,
 * optional ticket URL / genre / image / doors. Multi-artist support
 * (free-text input + role dropdown). No autocomplete in v1 — operator
 * types names freely. Iterate to V1-parity (autocomplete + rotation
 * feedback) once we see what shapes of events DJs actually create.
 */

type ArtistRow = {
  artistNameRaw: string;
  role: "headliner" | "support";
};

interface EventCreatorDrawerProps {
  readonly onClose: () => void;
}

const MILWAUKEE_TIMEZONE = "America/Chicago";

export function EventCreatorDrawer({ onClose }: EventCreatorDrawerProps) {
  const orgId = useQuery(api.events.getOrgIdBySlug, { slug: "radiomilwaukee" });
  const upsertBatch = useMutation(api.events.upsertBatch);

  const [title, setTitle] = useState("");
  const [venueName, setVenueName] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("WI");
  const [country, setCountry] = useState("US");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("19:00");
  const [ticketUrl, setTicketUrl] = useState("");
  const [genre, setGenre] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [artists, setArtists] = useState<ArtistRow[]>([{ artistNameRaw: "", role: "headliner" }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape; lock body scroll while open. Mirrors EventDrawer
  // pattern from EventsClient.tsx.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const onArtistChange = (index: number, patch: Partial<ArtistRow>) => {
    setArtists((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };
  const onAddArtist = () => {
    setArtists((prev) => [...prev, { artistNameRaw: "", role: "support" }]);
  };
  const onRemoveArtist = (index: number) => {
    setArtists((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (orgId === undefined) return;
    if (orgId === null) {
      setError("Could not resolve organization. Refresh and try again.");
      return;
    }

    const trimmedArtists = artists
      .map((a) => ({ artistNameRaw: a.artistNameRaw.trim(), role: a.role }))
      .filter((a) => a.artistNameRaw.length > 0);
    if (trimmedArtists.length === 0) {
      setError("At least one artist with a name is required.");
      return;
    }

    const startsAt = milwaukeeLocalToEpoch(startDate, startTime);
    if (startsAt === null) {
      setError("Pick a valid start date and time.");
      return;
    }
    if (startsAt <= Date.now()) {
      setError("Start time must be in the future.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await upsertBatch({
        orgId,
        source: "custom",
        events: [
          {
            externalId: undefined,
            title: title.trim() || undefined,
            venueName: venueName.trim(),
            city: city.trim(),
            region: region.trim(),
            country: country.trim() || undefined,
            startsAt,
            ticketUrl: ticketUrl.trim() || undefined,
            genre: genre.trim() || undefined,
            imageUrl: imageUrl.trim() || undefined,
            artists: trimmedArtists,
          },
        ],
      });
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
      aria-label="Add custom event"
      className="fixed inset-0 z-50 flex justify-end"
      onClick={onClose}
    >
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0, 0, 0, 0.5)" }}
        aria-hidden="true"
      />
      <aside
        className="relative flex h-full w-full max-w-lg flex-col gap-4 overflow-y-auto border-l border-border bg-bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2
              className="text-xl font-semibold tracking-tight"
              style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
            >
              Add custom event
            </h2>
            <p className="text-xs text-text-muted">
              For shows your feeds didn&apos;t catch — etix-only, small-venue, hyperlocal.
            </p>
          </div>
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
          <Field
            label="Show title"
            hint="e.g. Big Thief at the Pabst (optional — falls back to first headliner)"
          >
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" required>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.currentTarget.value)}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Start time" required>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.currentTarget.value)}
                required
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Venue" required>
            <input
              type="text"
              value={venueName}
              onChange={(e) => setVenueName(e.currentTarget.value)}
              required
              placeholder="The Pabst Theater"
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="City" required>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.currentTarget.value)}
                required
                placeholder="Milwaukee"
                className={inputClass}
              />
            </Field>
            <Field label="State">
              <input
                type="text"
                value={region}
                onChange={(e) => setRegion(e.currentTarget.value.toUpperCase())}
                maxLength={2}
                placeholder="WI"
                className={inputClass}
              />
            </Field>
            <Field label="Country">
              <input
                type="text"
                value={country}
                onChange={(e) => setCountry(e.currentTarget.value.toUpperCase())}
                maxLength={2}
                placeholder="US"
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Tickets URL" hint="optional">
            <input
              type="url"
              value={ticketUrl}
              onChange={(e) => setTicketUrl(e.currentTarget.value)}
              placeholder="https://…"
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Genre" hint="optional">
              <input
                type="text"
                value={genre}
                onChange={(e) => setGenre(e.currentTarget.value)}
                placeholder="Indie / Folk / Jazz"
                className={inputClass}
              />
            </Field>
            <Field label="Image URL" hint="optional">
              <input
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.currentTarget.value)}
                placeholder="https://…"
                className={inputClass}
              />
            </Field>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              Artists
            </legend>
            {artists.map((artist, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={artist.artistNameRaw}
                  onChange={(e) => onArtistChange(i, { artistNameRaw: e.currentTarget.value })}
                  placeholder={i === 0 ? "Headliner name" : "Support name"}
                  className={`${inputClass} flex-1`}
                  required={i === 0}
                />
                <select
                  value={artist.role}
                  onChange={(e) =>
                    onArtistChange(i, { role: e.currentTarget.value as ArtistRow["role"] })
                  }
                  className="rounded-md border border-border bg-bg-base px-2 py-2 text-sm"
                  style={{ color: "var(--text-primary)" }}
                >
                  <option value="headliner">Headliner</option>
                  <option value="support">Support</option>
                </select>
                <button
                  type="button"
                  onClick={() => onRemoveArtist(i)}
                  disabled={artists.length === 1}
                  aria-label={`Remove artist ${i + 1}`}
                  className="rounded-md border border-border px-2 py-1 text-sm text-text-muted hover:border-text-primary hover:text-text-primary disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={onAddArtist}
              className="self-start rounded-md border border-dashed border-border px-3 py-1.5 text-xs uppercase text-text-muted hover:border-text-primary hover:text-text-primary"
              style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}
            >
              + Add artist
            </button>
          </fieldset>

          {error !== null && (
            <p className="rounded-md border border-status-error/50 bg-status-error/10 px-3 py-2 text-sm text-status-error">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting || orgId === undefined}
              className="rounded-md px-4 py-2 text-sm font-semibold uppercase disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: "var(--accent-cta)",
                color: "var(--bg-base)",
                letterSpacing: "0.04em",
                fontFamily: "var(--font-mono)",
              }}
            >
              {submitting ? "Saving…" : "Save event"}
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
          <p className="text-xs text-text-muted">
            Times are saved in {MILWAUKEE_TIMEZONE} timezone.
          </p>
        </form>
      </aside>
    </div>
  );
}

const inputClass =
  "rounded-md border border-border bg-bg-base px-3 py-2 text-sm focus:border-accent-cta focus:outline-none";

function Field({
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
      <span
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

/**
 * Convert a YYYY-MM-DD date and HH:mm time to epoch-ms in Milwaukee
 * local time (America/Chicago). Mirrors the timezone-aware date math
 * from ReportsPanel so a DJ entering "2026-05-15 7:00pm" gets a
 * Milwaukee-local 7pm, not UTC midnight + offset confusion.
 */
function milwaukeeLocalToEpoch(ymd: string, hm: string): number | null {
  if (ymd.length === 0 || hm.length === 0) return null;
  const utc = Date.parse(`${ymd}T${hm}:00.000Z`);
  if (Number.isNaN(utc)) return null;
  const offsetMin = chicagoOffsetMinutes(utc);
  if (offsetMin === null) return null;
  return utc - offsetMin * 60 * 1000;
}

const OFFSET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: MILWAUKEE_TIMEZONE,
  timeZoneName: "shortOffset",
});

function chicagoOffsetMinutes(atEpochMs: number): number | null {
  const parts = OFFSET_FMT.formatToParts(new Date(atEpochMs));
  const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const match = raw.match(/^GMT(?:([+-]\d{1,2})(?::(\d{2}))?)?$/);
  if (match === null) return null;
  if (match[1] === undefined) return 0;
  const hours = Number.parseInt(match[1], 10);
  const minutes = match[2] === undefined ? 0 : Number.parseInt(match[2], 10);
  const sign = hours < 0 ? -1 : 1;
  return hours * 60 + sign * minutes;
}
