"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@rm/convex/api";
import type { Id } from "@rm/convex/values";

/**
 * Row 2 right panel — "Needs Attention" per DESIGN.md 002 section C.
 *
 * Two sub-sections stacked vertically inside one panel:
 *
 *   1. Enrichment failures — grouped by (station × reason × song).
 *      Actions: Retry, Edit (manual resolve), Ignore.
 *   2. Missing SoundExchange metadata — resolved tracks that still
 *      lack recordLabel / ISRC / durationSec.
 *      Actions: Edit (inline patch fields), Re-enrich.
 *
 * One-at-a-time expansion state: clicking Edit on any row closes any
 * other open editor so the panel stays visually calm.
 */
export function NeedsAttention() {
  const groups = useQuery(api.ingestionEvents.enrichmentProblemsGrouped, { limitGroups: 8 });
  const incomplete = useQuery(api.enrichment.tracksMissingSoundExchangeFields, { limit: 8 });

  const retry = useMutation(api.enrichment.retryUnresolvedGroup);
  const ignore = useMutation(api.enrichment.ignoreUnresolvedGroup);
  const reEnrich = useMutation(api.enrichment.reEnrichTrack);
  const overrideIdentity = useMutation(api.enrichment.overrideUnresolvedIdentity);
  const patchMetadata = useMutation(api.enrichment.patchTrackMetadata);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [openEditKey, setOpenEditKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (
    key: string,
    fn: () => Promise<unknown>,
  ): Promise<void> => {
    setBusyKey(key);
    setError(null);
    try {
      await fn();
      setOpenEditKey(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const totalCount = (groups?.length ?? 0) + (incomplete?.length ?? 0);

  return (
    <section
      role="region"
      aria-label="Items needing attention"
      className="flex flex-col gap-3 rounded-md border border-border bg-bg-surface p-5"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">Needs Attention</h3>
        {totalCount > 0 && (
          <span
            className="rounded-full bg-status-error/20 px-2 py-0.5 text-xs font-medium text-status-error"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {totalCount}
          </span>
        )}
      </header>

      {error !== null && (
        <p className="rounded-sm border border-status-error/50 bg-status-error/10 px-2 py-1 text-xs text-status-error">
          {error}
        </p>
      )}

      {groups === undefined && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-sm bg-bg-elevated" />
          ))}
        </div>
      )}

      {groups !== undefined &&
        groups.length === 0 &&
        incomplete !== undefined &&
        incomplete.length === 0 && (
          <p className="text-sm text-text-muted">
            Everything is clean.{" "}
            <span
              className="text-xs text-text-muted/70"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Last 24h.
            </span>
          </p>
        )}

      {groups !== undefined && groups.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
            Enrichment failures
          </h4>
          <ul role="list" className="flex flex-col gap-1.5">
            {groups.map((g) => {
              const key = `fail|${g.stationId}|${g.reason}|${g.artistRaw ?? ""}|${g.titleRaw ?? ""}`;
              const busy = busyKey === key;
              const canAct = g.artistRaw !== undefined && g.titleRaw !== undefined;
              const isEditing = openEditKey === key;
              return (
                <li
                  key={key}
                  className="flex flex-col gap-1.5 rounded-sm px-2 py-1.5 text-xs transition-colors duration-[var(--dur-micro)] hover:bg-bg-elevated"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <SeverityDot reason={g.reason} />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-text-primary">{displaySong(g)}</p>
                        <p className="flex gap-2 text-text-muted">
                          <span>{g.station}</span>
                          <span aria-hidden>·</span>
                          <span>{friendlyReason(g.reason)}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="flex items-center gap-1.5">
                        {g.count > 1 && (
                          <span
                            className="rounded-sm bg-bg-elevated px-1.5 text-xs text-text-muted"
                            style={{ fontFamily: "var(--font-mono)" }}
                            aria-label={`seen ${g.count} times`}
                          >
                            {g.count}×
                          </span>
                        )}
                        <time
                          dateTime={new Date(g.lastSeenAt).toISOString()}
                          className="text-text-muted"
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          {formatRelative(g.lastSeenAt)}
                        </time>
                      </div>
                      {canAct && (
                        <div className="flex gap-1">
                          <SmallButton
                            disabled={busy}
                            onClick={() =>
                              run(key, () =>
                                retry({
                                  stationId: g.stationId as Id<"stations">,
                                  artistRaw: g.artistRaw ?? "",
                                  titleRaw: g.titleRaw ?? "",
                                }),
                              )
                            }
                          >
                            Retry
                          </SmallButton>
                          <SmallButton
                            disabled={busy}
                            onClick={() => {
                              setError(null);
                              setOpenEditKey(isEditing ? null : key);
                            }}
                            active={isEditing}
                          >
                            Edit
                          </SmallButton>
                          <SmallButton
                            disabled={busy}
                            onClick={() =>
                              run(key, () =>
                                ignore({
                                  stationId: g.stationId as Id<"stations">,
                                  artistRaw: g.artistRaw ?? "",
                                  titleRaw: g.titleRaw ?? "",
                                }),
                              )
                            }
                            variant="danger"
                            title="Mark as station ID / spot / promo — hides future occurrences"
                          >
                            Ignore
                          </SmallButton>
                        </div>
                      )}
                    </div>
                  </div>
                  {isEditing && canAct && (
                    <OverrideForm
                      currentArtist={g.artistRaw ?? ""}
                      currentTitle={g.titleRaw ?? ""}
                      busy={busy}
                      onSubmit={(next) =>
                        run(key, () =>
                          overrideIdentity({
                            stationId: g.stationId as Id<"stations">,
                            fromArtistRaw: g.artistRaw ?? "",
                            fromTitleRaw: g.titleRaw ?? "",
                            toArtistRaw: next.artist,
                            toTitleRaw: next.title,
                          }),
                        )
                      }
                      onCancel={() => setOpenEditKey(null)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {incomplete !== undefined && incomplete.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
            Missing SoundExchange metadata
          </h4>
          <ul role="list" className="flex flex-col gap-1.5">
            {incomplete.map((t) => {
              const key = `inc|${t.trackId}`;
              const busy = busyKey === key;
              const isEditing = openEditKey === key;
              return (
                <li
                  key={key}
                  className="flex flex-col gap-1.5 rounded-sm px-2 py-1.5 text-xs transition-colors duration-[var(--dur-micro)] hover:bg-bg-elevated"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <span
                        aria-hidden
                        className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-status-info"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-text-primary">
                          {t.artistDisplayName} — {t.displayTitle}
                        </p>
                        <p className="flex gap-2 text-text-muted">
                          <span>{t.stationNames.join(", ")}</span>
                          <span aria-hidden>·</span>
                          <span>missing: {t.missingFields.join(", ")}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="flex items-center gap-1.5">
                        {t.playCount > 1 && (
                          <span
                            className="rounded-sm bg-bg-elevated px-1.5 text-xs text-text-muted"
                            style={{ fontFamily: "var(--font-mono)" }}
                            aria-label={`played ${t.playCount} times`}
                          >
                            {t.playCount}×
                          </span>
                        )}
                        <time
                          dateTime={new Date(t.lastPlayedAt).toISOString()}
                          className="text-text-muted"
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          {formatRelative(t.lastPlayedAt)}
                        </time>
                      </div>
                      <div className="flex gap-1">
                        <SmallButton
                          disabled={busy}
                          onClick={() => {
                            setError(null);
                            setOpenEditKey(isEditing ? null : key);
                          }}
                          active={isEditing}
                        >
                          Edit
                        </SmallButton>
                        <SmallButton
                          disabled={busy}
                          onClick={() =>
                            run(key, () =>
                              reEnrich({ trackId: t.trackId as Id<"tracks"> }),
                            )
                          }
                          title="Flip all plays of this track back to pending so enrichment re-runs with current sources"
                        >
                          Re-enrich
                        </SmallButton>
                      </div>
                    </div>
                  </div>
                  {isEditing && (
                    <MetadataForm
                      missing={t.missingFields}
                      artistDisplayName={t.artistDisplayName}
                      busy={busy}
                      onSubmit={(fields) =>
                        run(key, () =>
                          patchMetadata({
                            trackId: t.trackId as Id<"tracks">,
                            ...fields,
                          }),
                        )
                      }
                      onCancel={() => setOpenEditKey(null)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function OverrideForm(props: {
  readonly currentArtist: string;
  readonly currentTitle: string;
  readonly busy: boolean;
  readonly onSubmit: (next: { artist: string; title: string }) => void;
  readonly onCancel: () => void;
}) {
  const [artist, setArtist] = useState(props.currentArtist);
  const [title, setTitle] = useState(props.currentTitle);
  const unchanged = artist.trim() === props.currentArtist && title.trim() === props.currentTitle;
  const empty = artist.trim().length === 0 || title.trim().length === 0;
  return (
    <form
      className="flex flex-col gap-1.5 border-t border-border pt-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit({ artist: artist.trim(), title: title.trim() });
      }}
    >
      <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-text-muted">
        Artist
        <input
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          className="rounded-sm border border-border bg-bg-elevated px-2 py-1 text-xs text-text-primary focus:border-text-primary focus:outline-none"
          disabled={props.busy}
        />
      </label>
      <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-text-muted">
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-sm border border-border bg-bg-elevated px-2 py-1 text-xs text-text-primary focus:border-text-primary focus:outline-none"
          disabled={props.busy}
        />
      </label>
      <div className="flex justify-end gap-1">
        <SmallButton type="button" onClick={props.onCancel} disabled={props.busy}>
          Cancel
        </SmallButton>
        <SmallButton type="submit" disabled={props.busy || unchanged || empty} active>
          Save & retry
        </SmallButton>
      </div>
    </form>
  );
}

function MetadataForm(props: {
  readonly missing: readonly string[];
  readonly artistDisplayName: string;
  readonly busy: boolean;
  readonly onSubmit: (fields: {
    recordLabel?: string;
    isrc?: string;
    durationSec?: number;
  }) => void;
  readonly onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [isrc, setIsrc] = useState("");
  const [durationSec, setDurationSec] = useState("");
  const missingLabel = props.missing.includes("label");
  const missingIsrc = props.missing.includes("ISRC");
  const missingDuration = props.missing.includes("duration");
  const anyInput =
    (missingLabel && label.trim().length > 0) ||
    (missingIsrc && isrc.trim().length > 0) ||
    (missingDuration && durationSec.trim().length > 0);

  return (
    <form
      className="flex flex-col gap-1.5 border-t border-border pt-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const fields: { recordLabel?: string; isrc?: string; durationSec?: number } = {};
        if (missingLabel && label.trim().length > 0) fields.recordLabel = label.trim();
        if (missingIsrc && isrc.trim().length > 0) fields.isrc = isrc.trim();
        if (missingDuration && durationSec.trim().length > 0) {
          const parsed = Number.parseInt(durationSec.trim(), 10);
          if (Number.isFinite(parsed) && parsed > 0) fields.durationSec = parsed;
        }
        props.onSubmit(fields);
      }}
    >
      {missingLabel && (
        <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-text-muted">
          <span className="flex items-center justify-between">
            <span>Record label</span>
            <button
              type="button"
              disabled={props.busy}
              onClick={() => setLabel(props.artistDisplayName)}
              title="Fill with artist name — for local / self-released acts (common on 414 Music)"
              className="text-[10px] normal-case text-text-muted underline decoration-dotted underline-offset-2 hover:text-text-primary disabled:opacity-50"
            >
              Use artist name (self-released)
            </button>
          </span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Rough Trade"
            className="rounded-sm border border-border bg-bg-elevated px-2 py-1 text-xs text-text-primary focus:border-text-primary focus:outline-none"
            disabled={props.busy}
          />
        </label>
      )}
      {missingIsrc && (
        <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-text-muted">
          ISRC
          <input
            value={isrc}
            onChange={(e) => setIsrc(e.target.value)}
            placeholder="USXXX0000000"
            className="rounded-sm border border-border bg-bg-elevated px-2 py-1 text-xs uppercase text-text-primary focus:border-text-primary focus:outline-none"
            disabled={props.busy}
          />
        </label>
      )}
      {missingDuration && (
        <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-text-muted">
          Duration (seconds)
          <input
            value={durationSec}
            onChange={(e) => setDurationSec(e.target.value)}
            inputMode="numeric"
            placeholder="e.g. 240"
            className="rounded-sm border border-border bg-bg-elevated px-2 py-1 text-xs text-text-primary focus:border-text-primary focus:outline-none"
            disabled={props.busy}
          />
        </label>
      )}
      <div className="flex justify-end gap-1">
        <SmallButton type="button" onClick={props.onCancel} disabled={props.busy}>
          Cancel
        </SmallButton>
        <SmallButton type="submit" disabled={props.busy || !anyInput} active>
          Save
        </SmallButton>
      </div>
    </form>
  );
}

function SmallButton(props: {
  readonly children: React.ReactNode;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly type?: "button" | "submit";
  readonly title?: string;
  readonly active?: boolean;
  readonly variant?: "default" | "danger";
}) {
  const variant = props.variant ?? "default";
  const baseColor =
    variant === "danger"
      ? "hover:border-status-error hover:text-status-error"
      : "hover:border-text-primary hover:text-text-primary";
  const activeClass = props.active ? "border-text-primary text-text-primary" : "";
  return (
    <button
      type={props.type ?? "button"}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title}
      className={`rounded-sm border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted transition-colors ${baseColor} ${activeClass} disabled:opacity-50`}
    >
      {props.children}
    </button>
  );
}

interface GroupRow {
  readonly artistRaw?: string;
  readonly titleRaw?: string;
  readonly reason: string;
  readonly station: string;
  readonly count: number;
  readonly lastSeenAt: number;
  readonly stationId: string;
}

function displaySong(g: GroupRow): string {
  if (!g.artistRaw && !g.titleRaw) return "Unknown (no artist/title captured)";
  const artist = g.artistRaw?.trim() ?? "";
  const title = g.titleRaw?.trim() ?? "";
  if (artist && title) return `${artist} — ${title}`;
  if (title) return title;
  if (artist) return artist;
  return "Unknown";
}

function friendlyReason(reason: string): string {
  switch (reason) {
    case "mb_miss":
      return "on Apple Music, not MusicBrainz";
    case "no_match":
      return "not found on either source";
    case "other":
      return "upstream error";
    default:
      return reason;
  }
}

function SeverityDot({ reason }: { reason: string }) {
  const severity: Severity = reason === "mb_miss" ? "warn" : "error";
  const bgClass: Record<Severity, string> = {
    error: "bg-status-error",
    warn: "bg-status-warn",
    info: "bg-status-info",
  };
  return (
    <span
      aria-hidden
      className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${bgClass[severity]}`}
    />
  );
}

type Severity = "error" | "warn" | "info";

function formatRelative(epochMs: number): string {
  const ageSec = Math.floor((Date.now() - epochMs) / 1000);
  if (ageSec < 10) return "just now";
  if (ageSec < 60) return `${ageSec}s`;
  const ageMin = Math.floor(ageSec / 60);
  if (ageMin < 60) return `${ageMin}m`;
  const ageHr = Math.floor(ageMin / 60);
  if (ageHr < 24) return `${ageHr}h`;
  return `${Math.floor(ageHr / 24)}d`;
}
