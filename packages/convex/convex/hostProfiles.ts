import type { Infer } from "convex/values";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import {
  matchBiography,
  pageImageUrl,
  parseBiographies,
  parseBylinedStories,
  personSlug,
  showSlugFor,
  type Biography,
} from "./hostProfilesLogic";
import { hostProfileValidator, showPageValidator } from "./schema";

/**
 * Cache of 88Nine host profiles (CDS biography, photo, latest bylined pieces)
 * and show art, for alexa:stationSchedule and alexa:hostProfile.
 *
 * Hosts come from the cached Cadence schedule (cadence.refreshStationSchedule).
 * Config: NPR_CDS_TOKEN in the Convex env store.
 *
 * Never wipes on failure: a failed CDS or page fetch keeps that host's or
 * show's previous values.
 */

type HostProfile = Infer<typeof hostProfileValidator>;
type ShowPage = Infer<typeof showPageValidator>;

const PROFILE_STATIONS = ["88nine"] as const;
const CDS_BASE_URL = "https://content.api.npr.org";
const STATION_OWNER = "https://organization.api.npr.org/v4/services/s921";
const SITE_URL = "https://radiomilwaukee.org";
const LATEST_LIMIT = 5;
/** s921 has 49 biographies today; two pages leaves room to grow. */
const BIOGRAPHY_PAGE_SIZE = 50;
const BIOGRAPHY_PAGES = 2;
/** Photos and show art barely change; re-read the pages about once a day. */
const PAGES_MAX_AGE_MS = 20 * 60 * 60 * 1000;

export const current = internalQuery({
  args: { station: v.string() },
  handler: async (ctx, { station }) => {
    const schedule = await ctx.db
      .query("stationSchedule")
      .withIndex("by_station", (q) => q.eq("station", station))
      .first();
    const profiles = await ctx.db
      .query("hostProfiles")
      .withIndex("by_station", (q) => q.eq("station", station))
      .first();
    return { programs: schedule?.programs ?? [], profiles };
  },
});

export const store = internalMutation({
  args: {
    station: v.string(),
    hosts: v.array(hostProfileValidator),
    shows: v.array(showPageValidator),
    refreshedAt: v.number(),
    pagesRefreshedAt: v.number(),
  },
  handler: async (ctx, row) => {
    const existing = await ctx.db
      .query("hostProfiles")
      .withIndex("by_station", (q) => q.eq("station", row.station))
      .first();
    if (existing === null) await ctx.db.insert("hostProfiles", row);
    else await ctx.db.patch(existing._id, row);
  },
});

/** Cron (30 min): latest pieces every run, profile pages and show art when a day old. */
export const refresh = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    for (const station of PROFILE_STATIONS) {
      const { programs, profiles } = await ctx.runQuery(internal.hostProfiles.current, {
        station,
      });
      const hostNames = [...new Set(programs.flatMap((p) => p.hosts))];
      if (hostNames.length === 0) {
        console.warn(`hostProfiles: no cached schedule hosts for ${station}, skipping`);
        continue;
      }
      const now = Date.now();
      const bios = await logFailure("biography list", fetchBiographies());
      // Profile slugs follow the biography's spelling, so skip pages when the list failed.
      const pagesDue =
        bios !== null && (profiles === null || now - profiles.pagesRefreshedAt > PAGES_MAX_AGE_MS);
      const previousHosts = new Map((profiles?.hosts ?? []).map((h) => [h.name, h]));
      const hosts: HostProfile[] = [];
      for (const name of hostNames) {
        hosts.push(await refreshHost(name, bios, previousHosts.get(name), pagesDue));
      }
      const programNames = programs.map((p) => p.name);
      const shows = pagesDue
        ? await refreshShows(programNames, profiles?.shows ?? [])
        : (profiles?.shows ?? []);
      await ctx.runMutation(internal.hostProfiles.store, {
        station,
        hosts,
        shows,
        refreshedAt: now,
        pagesRefreshedAt: pagesDue ? now : (profiles?.pagesRefreshedAt ?? 0),
      });
    }
    return null;
  },
});

async function refreshHost(
  name: string,
  bios: Biography[] | null,
  previous: HostProfile | undefined,
  pagesDue: boolean,
): Promise<HostProfile> {
  const match = bios === null ? null : matchBiography(name, bios);
  const cdsId = bios === null ? (previous?.cdsId ?? null) : (match?.id ?? null);
  const matchMethod = bios === null ? (previous?.matchMethod ?? null) : (match?.method ?? null);
  const latest =
    cdsId === null
      ? []
      : ((await logFailure(`latest for ${name}`, fetchLatest(cdsId))) ?? previous?.latest ?? []);
  const page = pagesDue
    ? await logFailure(`profile page for ${name}`, fetchProfilePage(name, match?.title))
    : null;
  return {
    name,
    cdsId,
    matchMethod,
    imageUrl: page ? page.imageUrl : (previous?.imageUrl ?? null),
    profileUrl: page ? page.url : (previous?.profileUrl ?? null),
    latest,
  };
}

async function refreshShows(
  programNames: string[],
  previous: readonly ShowPage[],
): Promise<ShowPage[]> {
  const slugs = [...new Set(programNames.map(showSlugFor).filter((s) => s !== null))];
  const shows: ShowPage[] = [];
  for (const slug of slugs) {
    const page = await logFailure(`show page ${slug}`, fetchPage(`${SITE_URL}/show/${slug}`));
    const kept = page === null ? previous.find((s) => s.slug === slug) : undefined;
    if (page?.url) shows.push({ slug, url: page.url, imageUrl: page.imageUrl });
    else if (kept) shows.push(kept);
  }
  return shows;
}

// --- CDS ---------------------------------------------------------------------

async function fetchBiographies(): Promise<Biography[]> {
  const bios: Biography[] = [];
  for (let page = 0; page < BIOGRAPHY_PAGES; page++) {
    const batch = parseBiographies(
      await cdsGet({
        profileIds: "biography",
        ownerHrefs: STATION_OWNER,
        limit: String(BIOGRAPHY_PAGE_SIZE),
        offset: String(page * BIOGRAPHY_PAGE_SIZE),
      }),
    );
    bios.push(...batch);
    if (batch.length < BIOGRAPHY_PAGE_SIZE) break;
  }
  if (bios.length === 0) throw new Error("CDS returned no s921 biographies");
  return bios;
}

/** The byline filter from plans/hosts-content-plan.md: stories list their biography in `collections`. */
async function fetchLatest(biographyId: string) {
  const response = await cdsGet({
    collectionIds: biographyId,
    ownerHrefs: STATION_OWNER,
    profileIds: "story",
    sort: "publishDateTime:desc",
    limit: String(LATEST_LIMIT),
  });
  return parseBylinedStories(response, LATEST_LIMIT);
}

async function cdsGet(params: Record<string, string>): Promise<unknown> {
  const token = process.env.NPR_CDS_TOKEN;
  if (!token) throw new Error("NPR_CDS_TOKEN is not set on this Convex deployment");
  const path = `/v1/documents?${new URLSearchParams(params)}`;
  const res = await fetch(`${CDS_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`CDS GET ${path} -> ${res.status}`);
  return res.json();
}

// --- radiomilwaukee.org pages ------------------------------------------------

/** The biography's spelling first ("Mallorey"), then Cadence's. A 404 on both means no page. */
async function fetchProfilePage(name: string, biographyTitle: string | undefined) {
  const slugs = [...new Set([biographyTitle, name].filter((n) => n !== undefined).map(personSlug))];
  for (const slug of slugs) {
    const page = await fetchPage(`${SITE_URL}/people/${slug}`);
    if (page.url) return page;
  }
  return { url: null, imageUrl: null };
}

/** `url: null` when the page does not exist; any other failure throws so the caller keeps the cache. */
async function fetchPage(url: string): Promise<{ url: string | null; imageUrl: string | null }> {
  const res = await fetch(url);
  if (res.status === 404) return { url: null, imageUrl: null };
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return { url, imageUrl: pageImageUrl(await res.text()) };
}

async function logFailure<T>(what: string, work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`hostProfiles: ${what} failed, keeping cache: ${message}`);
    return null;
  }
}
