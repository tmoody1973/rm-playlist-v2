import { fetchQuery } from "convex/nextjs";
import { api } from "@rm/convex/api";
import { StationCard } from "./StationCard";
import { NeedsAttention } from "./NeedsAttention";
import { ReportsPanel } from "./ReportsPanel";
import { UpcomingFromRotation } from "./UpcomingFromRotation";

/**
 * Milestone 5 — dashboard wall-of-status (the CEO-plan Week 1-2 deliverable).
 *
 * Row 1: 4 station cards with live now-playing via Convex subscription.
 * Row 2: Reports — full width. Batch operation (export CSV); benefits
 *        from horizontal room for the date pickers + explainer.
 * Row 3: Needs Attention + Upcoming from Rotation — 50/50 split. Both
 *        are interrupt-driven action panels (operator decides which
 *        rows to act on); pairing them visually says "these are the
 *        things you might do something about."
 *
 * Station list is fetched server-side so the grid paints with real slugs
 * on first render; each card subscribes client-side for live updates.
 * Shell (sidebar + top bar) wraps this via dashboard/layout.tsx.
 */
export default async function DashboardPage() {
  const stations = await fetchQuery(api.stations.list, {});

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      {/* Row 1 — Live station wall (PRIMARY) */}
      <section aria-label="Live station wall" className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {stations.map((station) => (
            <StationCard key={station._id} slug={station.slug} name={station.name} />
          ))}
        </div>
      </section>

      {/* Row 2 — Reports export (SECONDARY) */}
      <section aria-label="Reports">
        <ReportsPanel />
      </section>

      {/* Row 3 — Action panels (TERTIARY) */}
      <section aria-label="Operator actions" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <NeedsAttention />
        <UpcomingFromRotation />
      </section>
    </main>
  );
}
