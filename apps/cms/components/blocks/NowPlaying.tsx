"use client";

import { api } from "@rm/convex/api";
import { useQuery } from "convex/react";
import type { CmsStationSlug } from "@/lib/stations";

/**
 * Realtime now-playing card. Subscribes via Convex `useQuery`, so it updates
 * the moment a new play lands — the one block the design keeps realtime.
 * `undefined` = loading, `null` = nothing currently playing.
 */
export function NowPlaying({ stationSlug }: { stationSlug: CmsStationSlug }) {
  const play = useQuery(api.plays.currentByStation, { stationSlug });

  return (
    <section className="px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] opacity-60">
          Now playing
        </p>
        <div
          className="flex items-center gap-4 p-4"
          style={{ background: "var(--rm-color-card)", borderRadius: "var(--rm-radius)" }}
        >
          {play === undefined ? (
            <span className="text-sm opacity-60">Loading…</span>
          ) : play === null ? (
            <span className="text-sm opacity-60">Nothing playing right now.</span>
          ) : (
            <>
              {play.artworkUrl !== null && (
                // Arbitrary external artwork URLs — plain <img>.
                <img
                  src={play.artworkUrl}
                  alt=""
                  className="h-16 w-16 flex-shrink-0 object-cover"
                  style={{ borderRadius: "calc(var(--rm-radius) - 4px)" }}
                />
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold">{play.title}</p>
                <p className="truncate text-sm opacity-70">{play.artist}</p>
                {play.album !== null && <p className="truncate text-xs opacity-50">{play.album}</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
