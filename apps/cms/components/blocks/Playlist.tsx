import { api } from "@rm/convex/api";
import { fetchQuery } from "convex/nextjs";
import { formatClock } from "@/lib/format";
import type { CmsStationSlug } from "@/lib/stations";

/**
 * Recent plays for the station. Server-rendered (one-shot fetchQuery) — the
 * design keeps the playlist cacheable/SEO-friendly rather than realtime.
 */
export async function Playlist({
  stationSlug,
  limit,
}: {
  stationSlug: CmsStationSlug;
  limit?: number;
}) {
  const plays = await fetchQuery(api.plays.recentByStation, {
    stationSlug,
    limit: limit ?? 8,
  });

  if (plays.length === 0) return null;

  return (
    <section className="px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] opacity-60">
          Recently played
        </p>
        <ul className="flex flex-col">
          {plays.map((play) => (
            <li
              key={play._id}
              className="flex items-center gap-3 border-b py-2.5 last:border-b-0"
              style={{ borderColor: "color-mix(in srgb, var(--rm-color-text) 12%, transparent)" }}
            >
              {play.artworkUrl !== null && (
                // Arbitrary external artwork URLs — plain <img>.
                <img
                  src={play.artworkUrl}
                  alt=""
                  className="h-10 w-10 flex-shrink-0 object-cover"
                  style={{ borderRadius: "calc(var(--rm-radius) - 6px)" }}
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{play.title}</p>
                <p className="truncate text-xs opacity-70">{play.artist}</p>
              </div>
              <span className="flex-shrink-0 text-xs opacity-50">{formatClock(play.playedAt)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
