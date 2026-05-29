/** Stations with public microsites. 414music has none (design doc 005). */
export const CMS_STATIONS = ["hyfin", "88nine", "rhythmlab"] as const;
export type CmsStationSlug = (typeof CMS_STATIONS)[number];

export function isCmsStation(slug: string): slug is CmsStationSlug {
  return (CMS_STATIONS as readonly string[]).includes(slug);
}

/**
 * Single-tenant org slug. The repo is single-tenant during shakedown
 * (decision 001); events queries are org-keyed, not station-keyed.
 */
export const RM_ORG_SLUG = "radiomilwaukee";
