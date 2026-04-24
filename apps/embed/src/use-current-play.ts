import { useEffect, useState } from "preact/hooks";
import { api } from "@rm/convex/api";
import type { PublicPlay, StationSlug } from "./types";
import { getConvexClient } from "./convex-client";

/**
 * Subscribe to `plays.currentByStation` for a single station. Returns a
 * three-state value that mirrors Convex's own semantics:
 *   `undefined` — loading (no response yet)
 *   `null`      — subscribed successfully, station has no resolved plays
 *   PublicPlay  — the current track
 *
 * Variants branch on the three states to render skeleton / empty / full.
 */
export function useCurrentPlay(station: StationSlug): PublicPlay | null | undefined {
  const [play, setPlay] = useState<PublicPlay | null | undefined>(undefined);

  useEffect(() => {
    const client = getConvexClient();
    const unsubscribe = client.onUpdate(
      api.plays.currentByStation,
      { stationSlug: station },
      (next) => {
        setPlay(next as PublicPlay | null);
      },
    );
    return () => {
      unsubscribe();
    };
  }, [station]);

  return play;
}

/**
 * Subscribe to `plays.recentByStation` for a single station. Returns
 * `undefined` while loading, then a (possibly empty) array thereafter.
 */
export function useRecentPlays(station: StationSlug, limit: number): PublicPlay[] | undefined {
  const [plays, setPlays] = useState<PublicPlay[] | undefined>(undefined);

  useEffect(() => {
    const client = getConvexClient();
    const unsubscribe = client.onUpdate(
      api.plays.recentByStation,
      { stationSlug: station, limit },
      (next) => {
        setPlays(next as PublicPlay[]);
      },
    );
    return () => {
      unsubscribe();
    };
  }, [station, limit]);

  return plays;
}
