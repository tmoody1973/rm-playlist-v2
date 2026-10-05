/**
 * Pure logic for host profiles and show art (hostProfiles.refresh writes the
 * cache, alexa:stationSchedule and alexa:hostProfile read it).
 *
 * Where the data lives (checked live 2026-10-05):
 * - CDS has one `biography` document per s921 person (49 of them). Stories link
 *   it in `collections` with rel `byline`, so `collectionIds=<bioId>` lists a
 *   host's pieces. Biographies carry no images and no web page.
 * - Photos and show art exist only on radiomilwaukee.org (/people/<slug>,
 *   /show/<slug>) as signed brightspotcdn dims4 renditions, so we pick one the
 *   page already uses rather than building a crop URL.
 * - Show pages are not in CDS (their series documents 404) and Cadence's
 *   program `link` is empty for every 88Nine program.
 */

export interface Biography {
  id: string;
  title: string;
}

export interface BiographyMatch extends Biography {
  method: "exact" | "fuzzy";
}

export interface BylinedStory {
  cdsId: string;
  title: string;
  url: string;
  publishedAt: number;
}

/** radiomilwaukee.org /show/<slug> pages that exist (Tarik's list, 2026-10-05). */
export const SHOW_SLUGS = [
  "whats-all-this",
  "ladies-first",
  "la-alternativa",
  "audio-taste-test",
  "rhythm-lab",
  "in-the-mix",
  "lets-hear-it",
  "kids-disco",
] as const;

/** Width/height bounds for a "square-ish" rendition: 4:3 landscape through 3:4 portrait. */
const MIN_ASPECT = 0.74;
const MAX_ASPECT = 1.34;
const MAX_FUZZY_EDITS = 1;

// --- names -----------------------------------------------------------------

export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function personSlug(name: string): string {
  return normalizeName(name).replace(/ /g, "-");
}

/**
 * Exact on normalized names, else "fuzzy": same surname, same number of
 * words, every other word at most one edit off (Cadence "Mallory" vs the
 * site's "Mallorey"). Fails closed: a lone first name never matches.
 */
export function nameMatch(a: string, b: string): "exact" | "fuzzy" | null {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (left.length === 0) return null;
  if (left === right) return "exact";
  const leftWords = left.split(" ");
  const rightWords = right.split(" ");
  if (leftWords.length < 2 || leftWords.length !== rightWords.length) return null;
  if (leftWords.at(-1) !== rightWords.at(-1)) return null;
  const close = leftWords.every((w, i) => editDistance(w, rightWords[i]!) <= MAX_FUZZY_EDITS);
  return close ? "fuzzy" : null;
}

export function matchBiography(host: string, bios: readonly Biography[]): BiographyMatch | null {
  const exact = bios.find((b) => nameMatch(host, b.title) === "exact");
  if (exact) return { ...exact, method: "exact" };
  const fuzzy = bios.filter((b) => nameMatch(host, b.title) === "fuzzy");
  // Two near-misses means we can't tell who was meant.
  return fuzzy.length === 1 ? { ...fuzzy[0]!, method: "fuzzy" } : null;
}

/** A stored host by spoken or written name: exact first, then a single fuzzy hit. */
export function findHost<T extends { name: string }>(hosts: readonly T[], name: string): T | null {
  const exact = hosts.find((h) => nameMatch(name, h.name) === "exact");
  if (exact) return exact;
  const fuzzy = hosts.filter((h) => nameMatch(name, h.name) === "fuzzy");
  return fuzzy.length === 1 ? fuzzy[0]! : null;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length]!;
}

// --- shows -----------------------------------------------------------------

/** "Rhythm Lab Radio" → "rhythm-lab"; dayparts and syndicated shows → null. */
export function showSlugFor(programName: string): string | null {
  const slug = personSlug(programName);
  return SHOW_SLUGS.find((s) => slug === s || slug.startsWith(`${s}-`)) ?? null;
}

// --- query-side shapes -----------------------------------------------------

interface StoredProfile {
  name: string;
  imageUrl: string | null;
  profileUrl: string | null;
  latest: readonly BylinedStory[];
}

export interface PublicProfile {
  name: string;
  imageUrl: string | null;
  profileUrl: string | null;
  latest: Array<{ title: string; url: string; publishedAt: number }>;
}

/** Every named host, in order; a host the cache doesn't know yet still appears, with nulls. */
export function publicProfiles(
  hostNames: readonly string[],
  stored: readonly StoredProfile[],
): PublicProfile[] {
  return hostNames.map((name) => {
    const profile = findHost(stored, name);
    return {
      name,
      imageUrl: profile?.imageUrl ?? null,
      profileUrl: profile?.profileUrl ?? null,
      latest: (profile?.latest ?? []).map(({ title, url, publishedAt }) => ({
        title,
        url,
        publishedAt,
      })),
    };
  });
}

export function showArt(
  programName: string,
  shows: ReadonlyArray<{ slug: string; url: string; imageUrl: string | null }>,
): { imageUrl: string | null; link: string | null } {
  const slug = showSlugFor(programName);
  const show = slug === null ? undefined : shows.find((s) => s.slug === slug);
  return { imageUrl: show?.imageUrl ?? null, link: show?.url ?? null };
}

// --- CDS documents ---------------------------------------------------------

interface CdsDocument {
  id?: unknown;
  title?: unknown;
  publishDateTime?: unknown;
  webPages?: Array<{ href?: unknown; rels?: unknown }>;
}

function resources(response: unknown): CdsDocument[] {
  const list = (response as { resources?: unknown } | null)?.resources;
  return Array.isArray(list) ? (list as CdsDocument[]) : [];
}

/** A `profileIds=biography` query's documents; the query already filters the type. */
export function parseBiographies(response: unknown): Biography[] {
  return resources(response).flatMap((doc) => {
    const id = text(doc.id);
    const title = text(doc.title);
    return id && title ? [{ id, title: decodeEntities(title) }] : [];
  });
}

/** Stories from a `collectionIds=<bioId>` query, in CDS order (newest first). */
export function parseBylinedStories(response: unknown, limit: number): BylinedStory[] {
  return resources(response)
    .flatMap((doc) => {
      const cdsId = text(doc.id);
      const title = text(doc.title);
      const url = canonicalUrl(doc);
      const publishedAt = Date.parse(text(doc.publishDateTime) ?? "");
      if (!cdsId || !title || !url || Number.isNaN(publishedAt)) return [];
      return [{ cdsId, title: decodeEntities(title), url, publishedAt }];
    })
    .slice(0, limit);
}

function canonicalUrl(doc: CdsDocument): string | undefined {
  const pages = doc.webPages ?? [];
  const canonical = pages.find((p) => Array.isArray(p.rels) && p.rels.includes("canonical"));
  return text((canonical ?? pages[0])?.href);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== "#") return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
    const hex = code[1] === "x" || code[1] === "X";
    const point = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
  });
}

// --- page images -----------------------------------------------------------

const RENDITION = /https:\/\/npr\.brightspotcdn\.com\/dims4\/[^"'\s<>]+/g;
const OG_IMAGE = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i;

/**
 * The page's own image (og:image) in its largest square-ish, non-webp
 * rendition: a 300x400 portrait on /people pages, 560x560 art on /show pages.
 * Falls back to og:image itself (1200x630) when the page has no such crop.
 */
export function pageImageUrl(html: string): string | null {
  const og = OG_IMAGE.exec(html)?.[1];
  if (!og) return null;
  const ogUrl = decodeEntities(og);
  const source = sourceOf(ogUrl);
  const candidates = [...new Set(html.match(RENDITION) ?? [])]
    .map(decodeEntities)
    .filter((url) => source !== null && sourceOf(url) === source && !url.includes("/format/webp/"))
    .map((url) => ({ url, size: resizeOf(url) }))
    .filter(({ size }) => size !== null && isSquareish(size))
    .sort((a, b) => b.size!.width - a.size!.width);
  return candidates[0]?.url ?? ogUrl;
}

function sourceOf(url: string): string | null {
  return /[?&]url=([^&]+)/.exec(url)?.[1] ?? null;
}

function resizeOf(url: string): { width: number; height: number } | null {
  const m = /\/resize\/(\d+)x(\d+)/.exec(url);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

function isSquareish({ width, height }: { width: number; height: number }): boolean {
  const aspect = width / height;
  return aspect >= MIN_ASPECT && aspect <= MAX_ASPECT;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
