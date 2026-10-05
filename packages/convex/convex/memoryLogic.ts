import { normalizeArtistForMatch } from "./matchKey";
import { METROS } from "./showsByMetro";
// Pure listener-memory logic: no Convex imports, so it unit-tests without a deployment.
export const SCREEN_TTL_MS = 30 * 60_000;
export const MAX_SCREEN = 10;
const SOON_MS = 7 * 86_400_000;

/** The play a listener means by "number N" on the list we last showed them, while it's fresh. */
export function playAtNumber(
  screen: { shownAt: number; playIds: string[] } | undefined,
  number: number,
  now: number,
): string | null {
  if (!screen || now - screen.shownAt > SCREEN_TTL_MS) return null;
  if (!Number.isInteger(number) || number < 1) return null;
  return screen.playIds[number - 1] ?? null;
}

type FollowStatus = "following" | "unfollowed";
type FollowSource = "find" | "explicit";

/** What to write for a follow request, or null to leave the row alone. A save never overrides "stop following". */
export function nextFollow(
  existing: { status: FollowStatus; source: FollowSource } | null,
  source: FollowSource,
): { status: "following"; source: FollowSource } | null {
  if (source === "explicit") {
    const alreadyExplicitlyFollowing =
      existing?.status === "following" && existing.source === "explicit";
    return alreadyExplicitlyFollowing ? null : { status: "following", source };
  }
  return existing === null ? { status: "following", source } : null;
}

const COMBINING_ACCENT_MARKS = /[\u0300-\u036f]/g;
const NON_WORD_CHARACTERS = /[^a-z0-9]+/g;

/** Lowercased, accent-folded, "&" spelled "and", padded with spaces so whole-word matching is a substring test. */
const words = (text: string) =>
  ` ${text.normalize("NFKD").replace(COMBINING_ACCENT_MARKS, "").toLowerCase().replace(/&/g, " and ").replace(NON_WORD_CHARACTERS, " ").trim()} `;
/** Backstory search matches by meaning; keep a story only if it names the artist as a whole word. */
export function storyMentionsArtist(
  story: { title: string; hint: string },
  artistName: string,
): boolean {
  const needle = words(artistName).trim();
  return needle.length > 0 && words(`${story.title} ${story.hint}`).includes(` ${needle} `);
}

const folded = (name: string) =>
  name.normalize("NFKD").replace(COMBINING_ACCENT_MARKS, "").toLowerCase().trim();

/** Name equality for artists whose normalized key is empty (non-Latin or punctuation-only names): case, accent and edge-space insensitive. */
export const sameArtistName = (a: string, b: string): boolean => folded(a) === folded(b);

export interface DigestShow {
  venue: string;
  city: string;
  startsAtMs: number;
  imageUrl: string | null;
  ticketUrl: string | null;
}
export interface DigestStory {
  storyId: string;
  title: string;
  show: string;
  publishedAt: number;
}
export interface DigestArtist {
  artistId: string;
  name: string;
  spins: { station: string; count: number }[];
  nextShow: DigestShow | null;
  stories: DigestStory[];
}
export type DigestItem =
  | ({ kind: "show"; artist: string; artistId: string } & DigestShow)
  | {
      kind: "spins";
      artist: string;
      artistId: string;
      total: number;
      byStation: { station: string; count: number }[];
    }
  | ({ kind: "story"; artist: string; artistId: string } & DigestStory)
  | { kind: "apple"; added: number; expired: number };

export const STORY_LOOKBACK_MS = 30 * 86_400_000;

/** Stories count as new for a month before the last visit, so a recent feature isn't lost to the spin window. */
export const storyCutoff = (since: number): number => since - STORY_LOOKBACK_MS;

/** What's new, most useful first: a show this week, the most-played artists, new stories, later shows, Apple Music. */
export function rankDigest({
  artists,
  apple,
  since,
  now,
}: {
  artists: DigestArtist[];
  apple: { added: number; expired: number };
  since: number;
  now: number;
}): DigestItem[] {
  const shows = artists
    .filter((a) => a.nextShow && a.nextShow.startsAtMs > now)
    .map((a) => ({ kind: "show" as const, artist: a.name, artistId: a.artistId, ...a.nextShow! }))
    .sort((x, y) => x.startsAtMs - y.startsAtMs);
  const spins = artists
    .map((a) => ({
      kind: "spins" as const,
      artist: a.name,
      artistId: a.artistId,
      total: a.spins.reduce((n, s) => n + s.count, 0),
      byStation: a.spins,
    }))
    .filter((s) => s.total > 0)
    .sort((x, y) => y.total - x.total);
  const stories = artists
    .flatMap((a) =>
      a.stories
        .filter((s) => s.publishedAt > storyCutoff(since))
        .map((s) => ({ kind: "story" as const, artist: a.name, artistId: a.artistId, ...s })),
    )
    .sort((x, y) => y.publishedAt - x.publishedAt);
  const appleItem =
    apple.added > 0 || apple.expired > 0 ? [{ kind: "apple" as const, ...apple }] : [];
  return [
    ...shows.filter((s) => s.startsAtMs - now <= SOON_MS),
    ...spins,
    ...stories,
    ...shows.filter((s) => s.startsAtMs - now > SOON_MS),
    ...appleItem,
  ];
}

const MAX_STORIES = 3;
export interface StoredStory {
  storyId: string;
  title: string;
  show: string;
  showSlug: string;
  publishedAt: number;
}

const isStoryCard = (value: unknown): value is StoredStory & { hint: string } => {
  const card = value as Record<string, unknown> | null;
  return (
    typeof card === "object" &&
    card !== null &&
    ["storyId", "title", "show", "showSlug", "hint"].every(
      (key) => typeof card[key] === "string",
    ) &&
    typeof card.publishedAt === "number"
  );
};

/** Backstory's HTTP query response → the newest few stories that name the artist; null if the body isn't a well-formed success. */
export function storiesFromBackstory(body: unknown, artistName: string): StoredStory[] | null {
  const { status, value } = (body ?? {}) as { status?: unknown; value?: unknown };
  if (status !== "success" || !Array.isArray(value) || !value.every(isStoryCard)) return null;
  return value
    .filter((story) => storyMentionsArtist(story, artistName))
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, MAX_STORIES)
    .map(({ storyId, title, show, showSlug, publishedAt }) => ({
      storyId,
      title,
      show,
      showSlug,
      publishedAt,
    }));
}

/** Artists whose stories need refreshing: never-checked first, then oldest; skips rows checked within staleMs. */
export function pickStaleArtists<T extends string>(
  rows: { artistId: T; checkedAt: number | null }[],
  now: number,
  staleMs: number,
  limit: number,
): T[] {
  const seen = new Set<T>();
  return rows
    .filter(({ artistId, checkedAt }) => {
      if (seen.has(artistId)) return false;
      seen.add(artistId);
      return checkedAt === null || now - checkedAt >= staleMs;
    })
    .sort((a, b) => (a.checkedAt ?? 0) - (b.checkedAt ?? 0))
    .slice(0, limit)
    .map(({ artistId }) => artistId);
}

/** normalizeArtistKey yields "" for non-Latin or punctuation-only names, and every such artist shares that key, so a lookup by it would hit an arbitrary one: treat it as unknown. */
export const lookupKeyOrNull = (artistKey: string): string | null =>
  artistKey === "" ? null : artistKey;

export const RECENT_SAVE_WINDOW_MS = 30 * 60_000;

/** The story shown beside a saved song: the newest Backstory piece on the artist, if any. */
export function pickFindStory(
  watch: { stories: ReadonlyArray<{ storyId: string; title: string; show: string }> } | null,
): { storyId: string; title: string; show: string } | null {
  const first = watch?.stories[0];
  return first ? { storyId: first.storyId, title: first.title, show: first.show } : null;
}

/** True when a different Find was saved inside the window; drives the one-time Apple Music hint. */
export function hasRecentOtherSave(
  finds: ReadonlyArray<{ id: string; savedAt: number }>,
  currentFindId: string,
  now: number,
): boolean {
  return finds.some((f) => f.id !== currentFindId && f.savedAt > now - RECENT_SAVE_WINDOW_MS);
}

const HOME_METRO = METROS[0].name;

/** The show to mention for a listener: Milwaukee if any, else the soonest. */
export function pickHomeShow<T extends { metro: string; startsAtMs: number }>(
  shows: readonly T[],
): T | null {
  const home = shows.find((s) => s.metro === HOME_METRO);
  if (home) return home;
  return shows.reduce<T | null>(
    (a, s) => (a === null || s.startsAtMs < a.startsAtMs ? s : a),
    null,
  );
}

/** "Rotation artists with shows coming up": one show per artist (pickHomeShow), Milwaukee shows first, each group by date. */
export function rankArtistShows<
  T extends { artistName: string; metro: string; startsAtMs: number },
>(shows: readonly T[]): T[] {
  const byArtist = new Map<string, T[]>();
  for (const show of [...shows].sort((a, b) => a.startsAtMs - b.startsAtMs)) {
    const key = normalizeArtistForMatch(show.artistName);
    byArtist.set(key, [...(byArtist.get(key) ?? []), show]);
  }
  const isHome = (show: T) => (show.metro === HOME_METRO ? 0 : 1);
  return [...byArtist.values()]
    .map((artistShows) => pickHomeShow(artistShows)!)
    .sort((a, b) => isHome(a) - isHome(b) || a.startsAtMs - b.startsAtMs);
}

const DEFAULT_SHOW_LIMIT = 10;
const MAX_SHOW_LIMIT = 20;

export function clampShowLimit(limit: number | undefined): number {
  const requested =
    limit === undefined || Number.isNaN(limit) ? DEFAULT_SHOW_LIMIT : Math.floor(limit);
  return Math.min(MAX_SHOW_LIMIT, Math.max(1, requested));
}

export const DIGEST_DEFAULT_WINDOW_MS = 7 * 86_400_000;

/** "What's new" starts at the listener's last visit, or a week ago if they have never asked. */
export const digestSince = (lastDigestAt: number | undefined, now: number): number =>
  lastDigestAt ?? now - DIGEST_DEFAULT_WINDOW_MS;

/** Spins per station after `since`, skipping rewound plays; stations keep first-seen order. */
export function countSpinsSince(
  plays: { stationSlug: string; playedAt: number; deleted: boolean }[],
  since: number,
): { station: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const play of plays) {
    if (play.deleted || play.playedAt <= since) continue;
    counts.set(play.stationSlug, (counts.get(play.stationSlug) ?? 0) + 1);
  }
  return [...counts].map(([station, count]) => ({ station, count }));
}

const DAY_MS = 86_400_000;
export const SEARCH_DEFAULT_DAYS = 14;
export const SEARCH_MAX_DAYS = 30;

/** Oldest playedAt a search may return: `days` back from now, clamped to 1..30 (default 14). */
export function searchCutoff(days: number | undefined, now: number): number {
  const requested =
    days !== undefined && Number.isFinite(days) ? Math.floor(days) : SEARCH_DEFAULT_DAYS;
  return now - Math.min(Math.max(requested, 1), SEARCH_MAX_DAYS) * DAY_MS;
}

/** Union of two search result lists: deduped by _id, newest first, capped at `limit`. */
export function mergeSearchHits<T extends { _id: string; playedAt: number }>(
  a: T[],
  b: T[],
  limit: number,
): T[] {
  const byId = new Map([...a, ...b].map((hit) => [hit._id, hit]));
  return [...byId.values()].sort((x, y) => y.playedAt - x.playedAt).slice(0, limit);
}

const SEARCH_MAX_WORDS = 16;
const SEARCH_MAX_CHARS = 100;
const SEARCH_MAX_WORD_BYTES = 32;

/** Query text Convex search will accept: whitespace-collapsed, words over 32 bytes dropped, at most 16 words / 100 characters. "" when nothing usable. */
export function searchTerms(query: string): string {
  const usable = query
    .split(/\s+/)
    .filter((word) => word !== "" && new TextEncoder().encode(word).length <= SEARCH_MAX_WORD_BYTES)
    .slice(0, SEARCH_MAX_WORDS)
    .join(" ");
  return usable.slice(0, SEARCH_MAX_CHARS).trim();
}

/** Convex search matches ANY query word; when some play contains every word (whole-word), drop the partial matches so the top hit is the song asked for. */
export function preferFullMatches<T extends { artistRaw: string; titleRaw: string }>(
  hits: T[],
  query: string,
): T[] {
  const queryWords = words(query).trim().split(" ").filter(Boolean);
  if (queryWords.length === 0) return hits;
  const full = hits.filter((hit) => {
    const haystack = words(`${hit.artistRaw} ${hit.titleRaw}`);
    return queryWords.every((word) => haystack.includes(` ${word} `));
  });
  return full.length > 0 ? full : hits;
}
