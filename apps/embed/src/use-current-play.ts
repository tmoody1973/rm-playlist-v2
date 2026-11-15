import { useEffect, useState } from "preact/hooks";
import { api } from "@rm/convex/api";
import type { LiveEventSummary, PublicPlay, PublicTopSong, StationSlug } from "./types";
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
 *
 * When `autoUpdate` is `false`, takes a one-shot snapshot via the same
 * subscription mechanism — Convex still pushes the first frame, we just
 * unsubscribe immediately so subsequent inserts don't move the list.
 */
export function useRecentPlays(
  station: StationSlug,
  limit: number,
  autoUpdate = true,
): PublicPlay[] | undefined {
  const [plays, setPlays] = useState<PublicPlay[] | undefined>(undefined);

  useEffect(() => {
    const client = getConvexClient();
    const unsubscribe = client.onUpdate(
      api.plays.recentByStation,
      { stationSlug: station, limit },
      (next) => {
        setPlays(next as PublicPlay[]);
        if (!autoUpdate) unsubscribe();
      },
    );
    return () => {
      unsubscribe();
    };
  }, [station, limit, autoUpdate]);

  return plays;
}

export interface SearchPlaysArgs {
  readonly station: StationSlug;
  readonly q: string;
  readonly afterMs: number | undefined;
  readonly beforeMs: number | undefined;
  readonly limit: number;
  readonly autoUpdate?: boolean;
  /** False while no filter is active: no request at all, so the hidden search view costs nothing. */
  readonly enabled?: boolean;
}

/**
 * Subscribe to `plays.searchByStation` with active filters (search term
 * and/or date range). Same three-state semantics as `useRecentPlays`.
 *
 * The hook re-subscribes whenever any filter argument changes, so callers
 * should debounce search-input keystrokes upstream to avoid spamming the
 * Convex backend on every character.
 */
export function useSearchPlays(args: SearchPlaysArgs): PublicPlay[] | undefined {
  const { station, q, afterMs, beforeMs, limit, autoUpdate = true, enabled = true } = args;
  const [plays, setPlays] = useState<PublicPlay[] | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      setPlays(undefined);
      return;
    }
    const client = getConvexClient();
    const trimmed = q.trim();
    const unsubscribe = client.onUpdate(
      api.plays.searchByStation,
      {
        stationSlug: station,
        q: trimmed.length > 0 ? trimmed : undefined,
        afterMs,
        beforeMs,
        limit,
      },
      (next) => {
        setPlays(next as PublicPlay[]);
        if (!autoUpdate) unsubscribe();
      },
    );
    return () => {
      unsubscribe();
    };
  }, [station, q, afterMs, beforeMs, limit, autoUpdate, enabled]);

  return plays;
}

/**
 * Subscribe to `plays.topSongsByStation` for the Top 20 tabs. Rankings
 * refresh daily on the server (convex/topSongs.ts); the subscription
 * picks up each refresh without polling. `windowDays` is locked to 7 or 30 to match the index range
 * the query expects.
 */
export function useTopSongs(
  station: StationSlug,
  windowDays: 7 | 30,
  limit = 20,
): PublicTopSong[] | undefined {
  const [songs, setSongs] = useState<PublicTopSong[] | undefined>(undefined);

  useEffect(() => {
    const client = getConvexClient();
    const unsubscribe = client.onUpdate(
      api.plays.topSongsByStation,
      { stationSlug: station, windowDays, limit },
      (next) => {
        setSongs(next as PublicTopSong[]);
      },
    );
    return () => {
      unsubscribe();
    };
  }, [station, windowDays, limit]);

  return songs;
}

/**
 * Subscribe to `concerts.upcomingByStation` for the Concerts tab. The server
 * answer changes only when the 3-hourly concert cache or an event changes,
 * so a live subscription stays cheap. The 60-day trim happens in ConcertsList.
 */
export function useUpcomingConcerts(station: StationSlug): LiveEventSummary[] | undefined {
  const [concerts, setConcerts] = useState<LiveEventSummary[] | undefined>(undefined);

  useEffect(() => {
    const client = getConvexClient();
    const unsubscribe = client.onUpdate(
      api.concerts.upcomingByStation,
      { stationSlug: station },
      (next) => {
        setConcerts(next as LiveEventSummary[]);
      },
    );
    return () => {
      unsubscribe();
    };
  }, [station]);

  return concerts;
}
