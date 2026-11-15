import { normalizeArtistForMatch } from "./matchKey";

/**
 * "In rotation": artists a station played in the last 30 days. Built once a
 * day from the plays topSongs.refreshStation already reads, then matched
 * against upcoming events by events.computeUpcomingFromRotation.
 *
 * Replaces a 16,000-play scan that read the oldest plays first and stopped
 * ~20 days short of today, so recently played artists never matched.
 */

export interface RotationArtist {
  readonly key: string;
  readonly name: string;
  readonly playCount: number;
}

export interface StationRotationInput<StationId extends string> {
  readonly stationId: StationId;
  readonly artists: readonly RotationArtist[];
}

export interface MergedRotationEntry<StationId extends string> {
  readonly name: string;
  readonly playCount: number;
  readonly stationIds: StationId[];
}

export interface RotationPlay {
  readonly artistRaw: string;
  readonly playedAt: number;
  readonly deletedAt?: number;
  readonly enrichmentStatus?: string;
}

export interface LineupRow {
  readonly artistKey: string;
  readonly artistNameRaw: string;
  readonly role: "headliner" | "support";
}

export interface LineupMatch<StationId extends string> {
  readonly artistKey: string;
  readonly artistName: string;
  readonly role: "headliner" | "support";
  readonly playCount: number;
  readonly stationIds: StationId[];
}

function countsTowardRotation(play: RotationPlay, sinceMs: number): boolean {
  return (
    play.playedAt >= sinceMs && play.deletedAt === undefined && play.enrichmentStatus !== "ignored"
  );
}

export function buildRotation(plays: readonly RotationPlay[], sinceMs: number): RotationArtist[] {
  const byKey = new Map<string, { name: string; latestAt: number; playCount: number }>();
  for (const play of plays) {
    if (!countsTowardRotation(play, sinceMs)) continue;
    const key = normalizeArtistForMatch(play.artistRaw);
    if (key.length === 0) continue;
    const existing = byKey.get(key);
    const isNewer = existing === undefined || play.playedAt >= existing.latestAt;
    byKey.set(key, {
      name: isNewer ? play.artistRaw.trim() : existing.name,
      latestAt: isNewer ? play.playedAt : existing.latestAt,
      playCount: (existing?.playCount ?? 0) + 1,
    });
  }
  return Array.from(byKey, ([key, { name, playCount }]) => ({ key, name, playCount })).sort(
    (a, b) => b.playCount - a.playCount,
  );
}

export function mergeRotations<StationId extends string>(
  rotations: readonly StationRotationInput<StationId>[],
): Map<string, MergedRotationEntry<StationId>> {
  const merged = new Map<string, MergedRotationEntry<StationId>>();
  for (const { stationId, artists } of rotations) {
    for (const artist of artists) {
      const existing = merged.get(artist.key);
      merged.set(artist.key, {
        name: existing?.name ?? artist.name,
        playCount: (existing?.playCount ?? 0) + artist.playCount,
        stationIds: [...(existing?.stationIds ?? []), stationId],
      });
    }
  }
  return merged;
}

/**
 * The bill's best in-rotation artist (headliner first, then most played),
 * with every station that plays anyone on the bill. One match per event, so
 * a show with two rotation artists is listed once.
 */
export function matchLineup<StationId extends string>(
  lineup: readonly LineupRow[],
  rotation: ReadonlyMap<string, MergedRotationEntry<StationId>>,
): LineupMatch<StationId> | null {
  const inRotation = lineup.flatMap((row) => {
    const entry = rotation.get(row.artistKey);
    return entry === undefined ? [] : [{ row, entry }];
  });
  if (inRotation.length === 0) return null;

  const rolePriority = (role: LineupRow["role"]) => (role === "headliner" ? 0 : 1);
  const compareRank = (a: (typeof inRotation)[number], b: (typeof inRotation)[number]) =>
    rolePriority(a.row.role) - rolePriority(b.row.role) || b.entry.playCount - a.entry.playCount;
  const best = inRotation.reduce((current, candidate) =>
    compareRank(candidate, current) < 0 ? candidate : current,
  );
  const stationIds = [...new Set(inRotation.flatMap(({ entry }) => entry.stationIds))];
  return {
    artistKey: best.row.artistKey,
    artistName: best.row.artistNameRaw,
    role: best.row.role,
    playCount: best.entry.playCount,
    stationIds,
  };
}
