import { api } from "@rm/convex/api";
import { fetchQuery } from "convex/nextjs";
import { formatDateTime } from "@/lib/format";
import { RM_ORG_SLUG } from "@/lib/stations";

/**
 * Upcoming events for Radio Milwaukee. Events are org-scoped in @rm/convex
 * (no stationId), so this shows the org-wide calendar; optional `region`
 * narrows by city. Server-rendered.
 */
export async function UpcomingEvents({ limit, region }: { limit?: number; region?: string }) {
  const events = await fetchQuery(api.events.allUpcomingEvents, {
    orgSlug: RM_ORG_SLUG,
    limit: limit ?? 6,
    region,
  });

  if (events.length === 0) return null;

  return (
    <section className="px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] opacity-60">
          Upcoming events
        </p>
        <ul className="flex flex-col gap-3">
          {events.map((event) => {
            const headline = event.headliners[0] ?? event.title ?? "Live event";
            const row = (
              <div
                className="flex flex-col gap-1 p-4"
                style={{ background: "var(--rm-color-card)", borderRadius: "var(--rm-radius)" }}
              >
                <p className="font-semibold">{headline}</p>
                <p className="text-sm opacity-70">
                  {formatDateTime(event.startsAtMs, event.dateOnly)} · {event.venueName},{" "}
                  {event.city}
                </p>
              </div>
            );
            return (
              <li key={event.eventId}>
                {event.ticketUrl !== null ? (
                  <a href={event.ticketUrl} target="_blank" rel="noreferrer">
                    {row}
                  </a>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
