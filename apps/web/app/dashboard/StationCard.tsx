"use client";

import { useQuery } from "convex/react";
import { api } from "@rm/convex/api";

type StationSlug = "hyfin" | "88nine" | "414music" | "rhythmlab";

interface StationCardProps {
  slug: StationSlug;
  name: string;
}

/**
 * One of four station cards on the dashboard wall-of-status.
 * Subscribes to the most-recent play via `plays.currentByStation` and to
 * the source status (for the health dot + "last poll" line) via
 * `ingestionSources.statusForDashboard` (filtered client-side).
 *
 * Per DESIGN.md section A (Mode A — Operator dashboard, dark, ops-dense).
 */
export function StationCard({ slug, name }: StationCardProps) {
  const current = useQuery(api.plays.currentByStation, { stationSlug: slug });
  const allStatus = useQuery(api.ingestionSources.statusForDashboard, {});
  const coverage = useQuery(api.enrichment.stationCoverage, { stationSlug: slug });
  const sources = allStatus?.filter((s) => s.stationSlug === slug) ?? [];
  const primary = sources.find((s) => s.role === "primary" && s.enabled);

  const healthState = deriveHealth(primary?.lastSuccessAt);
  const isLocalStation = slug === "414music";

  return (
    <article className="flex flex-col gap-3 rounded-md border border-border bg-bg-surface p-4 transition-colors duration-[var(--dur-short)] hover:border-[color-mix(in_oklab,var(--border)_50%,var(--text-muted))]">
      <header className="flex items-center justify-between">
        <h2
          style={{ fontFamily: "var(--font-display)" }}
          className="text-base font-semibold tracking-tight"
        >
          {name}
        </h2>
        <HealthDot state={healthState} />
      </header>

      {/* Now playing row */}
      <div className="min-h-[3.5rem]">
        {current === undefined ? (
          <SkeletonRow />
        ) : current === null ? (
          <p className="text-sm text-text-muted">No plays yet.</p>
        ) : (
          <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
            <AlbumArt
              src={current.artworkUrl}
              alt={`${current.title} — ${current.artist}`}
              size={56}
            />
            <div className="flex flex-col gap-0.5" style={{ minWidth: 0, flex: 1 }}>
              <p className="truncate text-sm font-medium text-text-primary">{current.title}</p>
              <p className="truncate text-xs text-text-secondary">{current.artist}</p>
            </div>
          </div>
        )}
      </div>

      {/* Footer: source badge + time-played */}
      <footer className="flex items-center justify-between text-xs text-text-muted">
        <span className="rounded-sm px-1.5 py-0.5" style={{ fontFamily: "var(--font-mono)" }}>
          {primary?.adapter ?? "—"}
        </span>
        <span style={{ fontFamily: "var(--font-mono)" }}>
          {current?.playedAt
            ? formatRelative(current.playedAt)
            : primary?.lastSuccessAt
              ? `poll ${formatRelative(primary.lastSuccessAt)}`
              : "—"}
        </span>
      </footer>

      {/* Coverage row — SoundExchange metadata completeness over last 7d. */}
      <CoverageRow coverage={coverage} isLocalStation={isLocalStation} />
    </article>
  );
}

function CoverageRow({
  coverage,
  isLocalStation,
}: {
  coverage: StationCoverage | null | undefined;
  isLocalStation: boolean;
}) {
  if (coverage === undefined) {
    return <div className="h-4 w-full animate-pulse rounded-sm bg-bg-elevated/60" />;
  }
  if (coverage === null || coverage.resolvedPlays === 0) {
    return (
      <p
        className="text-[10px] text-text-muted"
        style={{ fontFamily: "var(--font-mono)" }}
        title="No resolved plays in the last 24h — nothing to measure yet."
      >
        coverage —
      </p>
    );
  }
  const label = pct(coverage.labelCoverage);
  const isrc = pct(coverage.isrcCoverage);
  const duration = pct(coverage.durationCoverage);
  const resolved = pct(coverage.resolvedRatio);
  return (
    <div
      className="flex items-center justify-between gap-2 text-[10px] text-text-muted"
      style={{ fontFamily: "var(--font-mono)" }}
      title={
        isLocalStation
          ? "414 Music runs local self-released catalogs; low label coverage is expected. " +
            `Resolved: ${resolved}. Window: last 24h (${coverage.resolvedPlays} plays).`
          : `Resolved: ${resolved}. Window: last 24h (${coverage.resolvedPlays} plays).`
      }
    >
      <span className={isLocalStation ? "text-text-muted/80" : ""}>
        L {label} · I {isrc} · D {duration}
      </span>
      {isLocalStation && (
        <span className="rounded-sm bg-bg-elevated px-1 text-[9px] uppercase tracking-wide text-text-muted/80">
          local
        </span>
      )}
    </div>
  );
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

interface StationCoverage {
  readonly totalPlays: number;
  readonly resolvedPlays: number;
  readonly resolvedRatio: number;
  readonly labelCoverage: number;
  readonly isrcCoverage: number;
  readonly durationCoverage: number;
  readonly windowMs: number;
}

// ---------- helpers ----------

type HealthState = "ok" | "stale" | "down" | "idle";

/** Derive the health-dot state from the primary source's lastSuccessAt. */
function deriveHealth(lastSuccessAt: number | undefined): HealthState {
  if (lastSuccessAt === undefined) return "idle";
  const ageMs = Date.now() - lastSuccessAt;
  if (ageMs < 2 * 60 * 1000) return "ok"; // ≤ 2 minutes
  if (ageMs < 5 * 60 * 1000) return "stale"; // ≤ 5 minutes
  return "down";
}

function HealthDot({ state }: { state: HealthState }) {
  const label: Record<HealthState, string> = {
    ok: "Ingestion healthy",
    stale: "Ingestion slow",
    down: "Ingestion down",
    idle: "No ingestion yet",
  };
  const colorClass: Record<HealthState, string> = {
    ok: "bg-status-ok",
    stale: "bg-status-warn",
    down: "bg-status-error",
    idle: "bg-text-muted",
  };
  return (
    <span
      role="status"
      aria-label={label[state]}
      title={label[state]}
      className={`inline-block h-2 w-2 rounded-full ${colorClass[state]}`}
    />
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3">
      <div
        className="animate-pulse rounded-sm bg-bg-elevated"
        style={{ width: "56px", height: "56px", flexShrink: 0 }}
        aria-hidden="true"
      />
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="h-4 w-3/4 animate-pulse rounded-sm bg-bg-elevated" />
        <div className="h-3 w-1/2 animate-pulse rounded-sm bg-bg-elevated" />
      </div>
    </div>
  );
}

/**
 * Square album art with graceful-absence fallback. 56px matches the
 * now-playing-strip widget — design system consistency. When the track
 * has no resolved artwork (414 Music local catalog, brand-new track
 * pre-enrichment) we render a sized neutral tile so the row never
 * reflows when art arrives.
 *
 * Apple Music CDN returns artwork as a template URL with {w}/{h}
 * placeholders that callers substitute at render time. Other sources
 * (Spotify, MusicBrainz, station defaultArtworkUrl) return fully
 * materialized URLs where the regex is a no-op.
 *
 * Mirrors apps/embed/src/components/AlbumArt.tsx — kept inline here
 * because the dashboard is React (Next.js) and the widget is Preact;
 * one component file per stack stays simpler than a shared package.
 */
function AlbumArt({ src, alt, size }: { src: string | null; alt: string; size: number }) {
  const style: React.CSSProperties = {
    width: `${size}px`,
    height: `${size}px`,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    flexShrink: 0,
    objectFit: "cover",
    display: "block",
  };
  if (src === null) {
    return <div style={style} role="img" aria-label={alt} />;
  }
  const pixelSize = String(size * 2);
  const materialized = src
    .replace(/\{w\}|%7Bw%7D/g, pixelSize)
    .replace(/\{h\}|%7Bh%7D/g, pixelSize);
  return <img src={materialized} alt={alt} style={style} loading="lazy" decoding="async" />;
}

/** Short relative-time formatter. e.g. "just now", "2m ago", "45m ago". */
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
