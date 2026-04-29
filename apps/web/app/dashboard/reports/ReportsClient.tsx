"use client";

import { useState } from "react";
import { useConvex, useQuery } from "convex/react";
import { api } from "@rm/convex/api";
import { ReportsPanel } from "../ReportsPanel";

type StationSlug = "hyfin" | "88nine" | "414music" | "rhythmlab";

const STATIONS: ReadonlyArray<{ slug: StationSlug; label: string }> = [
  { slug: "88nine", label: "88Nine" },
  { slug: "hyfin", label: "HYFIN" },
  { slug: "rhythmlab", label: "Rhythm Lab" },
  { slug: "414music", label: "414 Music" },
];

/**
 * Operator reports hub. Three sections; each one is independently
 * useful and exports a CSV the music director can paste into a deck
 * or hand to on-air talent.
 */
export function ReportsClient() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionHeader
          eyebrow="Music-rights"
          title="NPR / SoundExchange playlist log"
          body="Tab-delimited monthly export NPR's music-rights system requires. Resolved plays only — pending and ignored rows are excluded. Triage Needs Attention before submitting."
        />
        <ReportsPanel />
      </section>

      <CoverageSection />

      <TopSongsSection />
    </div>
  );
}

// ---------------------------------------------------------------- //
// Coverage section — per-station completeness snapshot
// ---------------------------------------------------------------- //

function CoverageSection() {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        eyebrow="Station health"
        title="Coverage snapshot"
        body="Last 24 hours per station. Resolved % is plays that completed enrichment; L / I / D are SoundExchange completeness for label, ISRC, and duration. Low coverage = more triage in Needs Attention."
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {STATIONS.map((s) => (
          <CoverageCard key={s.slug} slug={s.slug} label={s.label} />
        ))}
      </div>
    </section>
  );
}

function CoverageCard({ slug, label }: { slug: StationSlug; label: string }) {
  const coverage = useQuery(api.enrichment.stationCoverage, { stationSlug: slug });
  const isLocal = slug === "414music";

  return (
    <article className="flex flex-col gap-2 rounded-md border border-border bg-bg-surface p-4">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">{label}</h3>
        {isLocal && (
          <span
            className="rounded-sm bg-bg-elevated px-1 text-[9px] uppercase tracking-wide text-text-muted/80"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            local
          </span>
        )}
      </header>
      {coverage === undefined ? (
        <div className="h-4 w-full animate-pulse rounded-sm bg-bg-elevated/60" />
      ) : coverage === null || coverage.resolvedPlays === 0 ? (
        <p className="text-xs text-text-muted" style={{ fontFamily: "var(--font-mono)" }}>
          No resolved plays in the last 24h.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <div
            className="text-2xl font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {Math.round(coverage.resolvedRatio * 100)}%
            <span className="text-xs font-normal text-text-muted ml-2">resolved</span>
          </div>
          <p
            className="text-xs text-text-muted"
            style={{ fontFamily: "var(--font-mono)" }}
            title={`Window: last 24h (${coverage.resolvedPlays} plays).`}
          >
            L {Math.round(coverage.labelCoverage * 100)}% · I{" "}
            {Math.round(coverage.isrcCoverage * 100)}% · D{" "}
            {Math.round(coverage.durationCoverage * 100)}%
          </p>
          <p className="text-[10px] text-text-muted" style={{ fontFamily: "var(--font-mono)" }}>
            {coverage.resolvedPlays} of {coverage.totalPlays} plays · 24h
          </p>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------- //
// Top songs export — per station × window
// ---------------------------------------------------------------- //

const WINDOWS = [7, 30] as const;
type WindowDays = (typeof WINDOWS)[number];

function TopSongsSection() {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        eyebrow="Charts"
        title="Top songs export"
        body="The Top 20 by spin count for the chosen station and window. CSV columns: Rank, Artist, Title, Album, Spins. Useful for newsletters and the weekly highlight email."
      />
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
              <th className="px-4 py-2 text-left font-semibold">Station</th>
              {WINDOWS.map((w) => (
                <th key={w} className="px-4 py-2 text-left font-semibold">
                  Last {w} days
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STATIONS.map((s) => (
              <tr key={s.slug} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-semibold">{s.label}</td>
                {WINDOWS.map((w) => (
                  <td key={w} className="px-4 py-3">
                    <TopSongsButton slug={s.slug} stationLabel={s.label} windowDays={w} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TopSongsButton({
  slug,
  stationLabel,
  windowDays,
}: {
  slug: StationSlug;
  stationLabel: string;
  windowDays: WindowDays;
}) {
  const convex = useConvex();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      const songs = await convex.query(api.plays.topSongsByStation, {
        stationSlug: slug,
        windowDays,
        limit: 20,
      });
      if (songs.length === 0) {
        setError("No spins in window.");
        setTimeout(() => setError(null), 2500);
        return;
      }
      const csv = topSongsToCsv(songs);
      const today = new Date().toISOString().slice(0, 10);
      downloadCsv(csv, `top-songs-${slug}-${windowDays}d-${today}.csv`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onDownload}
        disabled={downloading}
        className="rounded-md border border-border bg-bg-elevated px-3 py-1 text-xs font-semibold uppercase text-text-primary transition-colors hover:border-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        style={{ letterSpacing: "0.04em", fontFamily: "var(--font-mono)" }}
        aria-label={`Download top 20 for ${stationLabel} last ${windowDays} days`}
      >
        {downloading ? "…" : "Download CSV"}
      </button>
      {error !== null && (
        <span className="text-xs text-status-error" style={{ fontFamily: "var(--font-mono)" }}>
          {error}
        </span>
      )}
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

interface TopSong {
  artist: string;
  title: string;
  album: string | null;
  playCount: number;
}

function topSongsToCsv(songs: readonly TopSong[]): string {
  const header = ["Rank", "Artist", "Title", "Album", "Spins"];
  const body = songs.map((s, i) => [
    String(i + 1),
    s.artist,
    s.title,
    s.album ?? "",
    String(s.playCount),
  ]);
  return [header, ...body].map((row) => row.map(csvEscape).join(",")).join("\n");
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
