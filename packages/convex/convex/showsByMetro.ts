export const METROS = [
  { name: "Milwaukee", lat: 43.0389, lng: -87.9065 },
  { name: "Madison", lat: 43.0731, lng: -89.4012 },
  { name: "Chicago", lat: 41.8781, lng: -87.6298 },
] as const;

export const MAX_SHOWS = 3;

/** ponytail: squared-degree distance, not haversine — fine for picking among three metros ~80+ miles apart. */
export function nearestMetro(lat: number | undefined, lng: number | undefined, city: string): string {
  if (lat === undefined || lng === undefined) return city;
  const squaredDistance = (metro: (typeof METROS)[number]) => (metro.lat - lat) ** 2 + (metro.lng - lng) ** 2;
  return [...METROS].sort((a, b) => squaredDistance(a) - squaredDistance(b))[0]!.name;
}

/** Soonest show per metro, keeping date order. Input must already be sorted by startsAt ascending. */
export function pickShowsByMetro<T extends { startsAt: number; latitude?: number; longitude?: number; city: string }>(
  sortedByDate: readonly T[],
  max: number = MAX_SHOWS,
): Array<T & { metro: string }> {
  const seen = new Set<string>();
  const picked: Array<T & { metro: string }> = [];
  for (const show of sortedByDate) {
    const metro = nearestMetro(show.latitude, show.longitude, show.city);
    if (seen.has(metro)) continue;
    seen.add(metro);
    picked.push({ ...show, metro });
    if (picked.length >= max) break;
  }
  return picked;
}
