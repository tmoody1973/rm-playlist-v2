import { fetchQuery } from "convex/nextjs";
import { api } from "@rm/convex/api";
import { StationCard } from "./StationCard";
import { NeedsAttention } from "./NeedsAttention";
import { ReportsPanel, UpcomingFromRotation } from "./Placeholders";

/**
 * Milestone 5 — dashboard wall-of-status (the CEO-plan Week 1-2 deliverable).
 *
 * Row 1: 4 station cards with live now-playing via Convex subscription.
 * Row 2: Reports (placeholder, Week 3-4) + Needs Attention (live).
 * Row 3: Upcoming from rotation (placeholder, Week 5).
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

      {/* Row 2 — Reports + Needs Attention (SECONDARY) */}
      <section aria-label="Reports and attention" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReportsPanel />
        <NeedsAttention />
      </section>

      {/* Row 3 — Upcoming from rotation (TERTIARY) */}
      <section aria-label="Upcoming from rotation" className="flex-1">
        <UpcomingFromRotation />
      </section>
    </main>
  );
}
