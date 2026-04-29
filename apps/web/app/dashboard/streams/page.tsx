import { StreamsClient } from "./StreamsClient";

/**
 * /dashboard/streams — per-station drill-down.
 *
 * Different lens than the homepage Row 1 wall-of-status (which is the
 * 4-station at-a-glance). This page focuses on ONE station at a time,
 * showing the layers behind the health dot:
 *
 *   - HEALTH:  every ingestion source (Spinitron, SGmetadata, ICY-worker)
 *              with adapter, role, enabled/paused state, lastSuccessAt.
 *              The "is the data flowing?" view for ingestion ops.
 *   - EVENTS:  recent ingestionEvents — poll heartbeats, errors,
 *              enrichment outcomes. The "what just happened?" tail.
 *   - PLAYS:   most-recent plays for the station with enrichment status.
 *              The "what's actually been spinning?" check for music
 *              directors.
 *
 * Both audiences (ingestion ops and music directors) need a different
 * lens on the same station. Same page; sections are independently
 * scrollable.
 */
export default function StreamsPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1
          style={{ fontFamily: "var(--font-display)" }}
          className="text-2xl font-semibold tracking-tight"
        >
          Streams
        </h1>
        <p className="text-sm text-text-muted">
          Drill into one stream at a time — source health, recent ingestion events, and the last 50
          plays. Switch between stations with the tabs.
        </p>
      </header>
      <StreamsClient />
    </main>
  );
}
