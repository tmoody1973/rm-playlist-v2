import { api } from "@rm/convex/api";
import { fetchQuery } from "convex/nextjs";
import { formatDateTime } from "@/lib/format";
import { RM_ORG_SLUG } from "@/lib/stations";

/**
 * "Artists we play, coming to town" — rotation × upcoming events. Org-scoped
 * in @rm/convex. Server-rendered. The station's signature differentiator.
 */
export async function Touring({ limit }: { limit?: number }) {
  const touring = await fetchQuery(api.events.upcomingFromRotation, {
    orgSlug: RM_ORG_SLUG,
    limit: limit ?? 6,
  });

  if (touring.length === 0) return null;

  return (
    <section className="px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] opacity-60">
          Artists we play, coming to town
        </p>
        <ul className="flex flex-col gap-3">
          {touring.map((match) => {
            const row = (
              <div
                className="flex flex-col gap-1 p-4"
                style={{ background: "var(--rm-color-card)", borderRadius: "var(--rm-radius)" }}
              >
                <p className="font-semibold">{match.artistName}</p>
                <p className="text-sm opacity-70">
                  {formatDateTime(match.startsAtMs, match.dateOnly)} · {match.venueName},{" "}
                  {match.city}
                </p>
              </div>
            );
            return (
              <li key={`${match.eventId}-${match.artistKey}`}>
                {match.ticketUrl !== null ? (
                  <a href={match.ticketUrl} target="_blank" rel="noreferrer">
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
