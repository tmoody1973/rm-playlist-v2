import { ReportsClient } from "./ReportsClient";

/**
 * /dashboard/reports — operator reports hub.
 *
 * Three sections (more to come as music directors ask):
 *   1. NPR / SoundExchange playlist log — the monthly music-rights export
 *      (reuses the homepage ReportsPanel since the form's already solid).
 *   2. Station coverage — per-station completeness snapshot for the last
 *      24h (label / ISRC / duration / overall resolved). Useful before
 *      a music-rights export to know which stations need triage first.
 *   3. Top songs export — chart download per station × window (7d / 30d).
 *      The data the public Top 20 widget tabs surface, in CSV form for
 *      sharing with on-air staff or building a feature pitch.
 *
 * Server-component shell; the actual interactive sections are a single
 * client component using useQuery for live data and shared CSV/download
 * helpers.
 */
export default function ReportsPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1
          style={{ fontFamily: "var(--font-display)" }}
          className="text-2xl font-semibold tracking-tight"
        >
          Reports
        </h1>
        <p className="text-sm text-text-muted">
          Music-rights playlist log, station-coverage snapshot, and chart exports. Times in
          Milwaukee local; resolved plays only — triage Needs Attention first if you want fuller
          rows.
        </p>
      </header>
      <ReportsClient />
    </main>
  );
}
