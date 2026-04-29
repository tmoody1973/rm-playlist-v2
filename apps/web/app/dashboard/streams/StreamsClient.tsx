"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@rm/convex/api";

type StationSlug = "hyfin" | "88nine" | "414music" | "rhythmlab";

const STATIONS: ReadonlyArray<{ slug: StationSlug; label: string }> = [
  { slug: "88nine", label: "88Nine" },
  { slug: "hyfin", label: "HYFIN" },
  { slug: "rhythmlab", label: "Rhythm Lab" },
  { slug: "414music", label: "414 Music" },
];

export function StreamsClient() {
  const [active, setActive] = useState<StationSlug>("88nine");

  return (
    <div className="flex flex-col gap-6">
      <StationTabs active={active} onSelect={setActive} />
      <SourceHealthSection slug={active} />
      <EventsSection slug={active} />
      <PlaysSection slug={active} />
    </div>
  );
}

function StationTabs({
  active,
  onSelect,
}: {
  active: StationSlug;
  onSelect: (slug: StationSlug) => void;
}) {
  return (
    <div className="flex gap-0 border-b border-border" role="tablist" aria-label="Select station">
      {STATIONS.map((s) => {
        const isActive = active === s.slug;
        return (
          <button
            key={s.slug}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(s.slug)}
            className="px-4 py-2 text-sm font-medium transition-colors"
            style={{
              borderBottom: isActive ? "2px solid var(--text-primary)" : "2px solid transparent",
              color: isActive ? "var(--text-primary)" : "var(--text-muted)",
              marginBottom: "-1px",
            }}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- //
// Source health
// ---------------------------------------------------------------- //

function SourceHealthSection({ slug }: { slug: StationSlug }) {
  const allStatus = useQuery(api.ingestionSources.statusForDashboard, {});
  const sources = allStatus?.filter((s) => s.stationSlug === slug) ?? null;

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        eyebrow="Health"
        title="Ingestion sources"
        body="Every adapter feeding this station. lastSuccessAt is when the source last successfully wrote a play. A primary source down for >5 minutes flips the homepage health dot to error."
      />
      {sources === null ? (
        <SourcesSkeleton />
      ) : sources.length === 0 ? (
        <p className="text-sm text-text-muted">No ingestion sources configured for this station.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="border-b border-border"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                <th className="px-4 py-2 text-left font-semibold">Adapter</th>
                <th className="px-4 py-2 text-left font-semibold">Role</th>
                <th className="px-4 py-2 text-left font-semibold">Enabled</th>
                <th className="px-4 py-2 text-left font-semibold">Last success</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((src) => (
                <tr key={src._id} className="border-b border-border last:border-0">
                  <td
                    className="px-4 py-3 font-medium"
                    style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}
                  >
                    {src.adapter}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    <RoleBadge role={src.role} />
                  </td>
                  <td className="px-4 py-3">
                    <EnabledBadge enabled={src.enabled} />
                  </td>
                  <td
                    className="px-4 py-3 text-text-secondary"
                    style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}
                  >
                    {src.lastSuccessAt !== undefined ? formatRelative(src.lastSuccessAt) : "—"}
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

function RoleBadge({ role }: { role: string }) {
  const isPrimary = role === "primary";
  return (
    <span
      className="rounded px-2 py-0.5 text-xs"
      style={{
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        background: isPrimary ? "var(--accent-cta)" : "var(--bg-elevated)",
        color: isPrimary ? "var(--bg-base)" : "var(--text-muted)",
      }}
    >
      {role}
    </span>
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

function SourcesSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 2 }).map((_, i) => (
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

// ---------------------------------------------------------------- //
// Events log
// ---------------------------------------------------------------- //

function EventsSection({ slug }: { slug: StationSlug }) {
  const [excludeHealthy, setExcludeHealthy] = useState(false);
  const events = useQuery(api.ingestionEvents.recentByStation, {
    stationSlug: slug,
    limit: 30,
    excludeHealthy,
  });

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          Activity
        </span>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2
            className="text-lg font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
          >
            Recent ingestion events
          </h2>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={excludeHealthy}
              onChange={(e) => setExcludeHealthy(e.currentTarget.checked)}
              className="h-3.5 w-3.5 cursor-pointer"
            />
            <span
              className="uppercase tracking-wider text-text-muted"
              style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}
            >
              Problems only
            </span>
          </label>
        </div>
        <p className="max-w-3xl text-sm text-text-secondary" style={{ lineHeight: 1.55 }}>
          Last 30 events. Poll heartbeats (poll_ok) confirm the adapter is alive even when no new
          plays land; errors and enrichment failures show what to triage.
        </p>
      </header>

      {events === undefined ? (
        <EventsSkeleton />
      ) : events.length === 0 ? (
        <p className="text-sm text-text-muted">
          No events match. {excludeHealthy ? "All recent events are healthy heartbeats." : ""}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {events.map((ev) => (
            <li
              key={ev._id}
              className="flex flex-wrap items-baseline gap-3 rounded-md border border-border bg-bg-surface p-3"
            >
              <KindBadge kind={ev.kind} />
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  color: "var(--text-muted)",
                }}
              >
                {formatRelative(ev.createdAt)}
              </span>
              <span style={{ fontSize: "13px", color: "var(--text-primary)", flex: 1 }}>
                {ev.message}
              </span>
              {ev.inserted !== undefined && ev.inserted > 0 && (
                <span
                  className="rounded px-1.5 py-0.5 text-xs"
                  style={{
                    fontFamily: "var(--font-mono)",
                    background: "var(--bg-elevated)",
                    color: "var(--text-muted)",
                  }}
                >
                  +{ev.inserted}
                </span>
              )}
              {ev.artistRaw !== undefined && ev.titleRaw !== undefined && (
                <span
                  style={{ fontSize: "12px", color: "var(--text-secondary)", flexBasis: "100%" }}
                >
                  {ev.artistRaw} — {ev.titleRaw}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function KindBadge({ kind }: { kind: string }) {
  const isOk = kind === "poll_ok" || kind === "enrichment_ok";
  const isError = kind.includes("error");
  return (
    <span
      className="rounded px-1.5 py-0.5 text-xs"
      style={{
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        background: isOk
          ? "var(--bg-elevated)"
          : isError
            ? "rgba(248, 113, 113, 0.15)"
            : "var(--bg-elevated)",
        color: isOk
          ? "var(--text-muted)"
          : isError
            ? "var(--status-error)"
            : "var(--text-secondary)",
      }}
    >
      {kind}
    </span>
  );
}

function EventsSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-10 animate-pulse rounded-md bg-bg-surface"
          style={{ opacity: 0.6 }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- //
// Recent plays
// ---------------------------------------------------------------- //

function PlaysSection({ slug }: { slug: StationSlug }) {
  const plays = useQuery(api.plays.recentByStation, {
    stationSlug: slug,
    limit: 50,
  });

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        eyebrow="On air"
        title="Last 50 plays"
        body="The most-recent plays as they appear in your public widget. Click a row to drill into a track or check enrichment status."
      />
      {plays === undefined ? (
        <PlaysSkeleton />
      ) : plays.length === 0 ? (
        <p className="text-sm text-text-muted">No plays yet for this station.</p>
      ) : (
        <ul className="flex flex-col gap-1" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {plays.map((p) => (
            <li
              key={p._id}
              className="flex items-center gap-3 rounded-md border border-border bg-bg-surface p-3"
            >
              <PlayArt artworkUrl={p.artworkUrl} />
              <div className="flex flex-1 flex-col gap-0.5" style={{ minWidth: 0 }}>
                <span
                  className="truncate text-sm font-medium"
                  style={{ color: "var(--text-primary)" }}
                >
                  {p.title}
                </span>
                <span className="truncate text-xs" style={{ color: "var(--text-secondary)" }}>
                  {p.artist}
                  {p.album !== null ? ` · ${p.album}` : ""}
                </span>
              </div>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  color: "var(--text-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {formatRelative(p.playedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PlayArt({ artworkUrl }: { artworkUrl: string | null }) {
  const style: React.CSSProperties = {
    width: "40px",
    height: "40px",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    flexShrink: 0,
    objectFit: "cover",
    display: "block",
  };
  if (artworkUrl === null) {
    return <div style={style} aria-hidden="true" />;
  }
  const px = String(80);
  const materialized = artworkUrl.replace(/\{w\}|%7Bw%7D/g, px).replace(/\{h\}|%7Bh%7D/g, px);
  return <img src={materialized} alt="" style={style} loading="lazy" decoding="async" />;
}

function PlaysSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-14 animate-pulse rounded-md bg-bg-surface"
          style={{ opacity: 0.6 }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- //
// Helpers
// ---------------------------------------------------------------- //

function SectionHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <header className="flex flex-col gap-1">
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {eyebrow}
      </span>
      <h2
        className="text-lg font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
      >
        {title}
      </h2>
      <p className="max-w-3xl text-sm text-text-secondary" style={{ lineHeight: 1.55 }}>
        {body}
      </p>
    </header>
  );
}

function formatRelative(epochMs: number): string {
  const ageSec = Math.floor((Date.now() - epochMs) / 1000);
  if (ageSec < 10) return "just now";
  if (ageSec < 60) return `${ageSec}s ago`;
  const ageMin = Math.floor(ageSec / 60);
  if (ageMin < 60) return `${ageMin}m ago`;
  const ageHr = Math.floor(ageMin / 60);
  if (ageHr < 24) return `${ageHr}h ago`;
  const ageDay = Math.floor(ageHr / 24);
  return `${ageDay}d ago`;
}
