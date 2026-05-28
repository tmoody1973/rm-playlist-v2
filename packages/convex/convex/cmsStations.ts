/**
 * Stations with public CMS microsites (apps/cms). 414music is intentionally
 * excluded — it has no public CMS pages (design doc 005). Shared by the CMS
 * server functions (pages.ts, themes.ts) so the allowlist + type guard live in
 * one place and can't drift between read and write paths.
 */
export const CMS_STATION_SLUGS = ["hyfin", "88nine", "rhythmlab"] as const;
export type CmsStationSlug = (typeof CMS_STATION_SLUGS)[number];

export function isCmsStation(slug: string): slug is CmsStationSlug {
  return (CMS_STATION_SLUGS as readonly string[]).includes(slug);
}
