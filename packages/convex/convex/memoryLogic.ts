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
  if (source === "explicit") return { status: "following", source };
  return existing === null ? { status: "following", source } : null;
}

const words = (text: string) =>
  ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, " ")
    .trim()} `;

/** Backstory search matches by meaning; keep a story only if it names the artist as a whole word. */
export function storyMentionsArtist(
  story: { title: string; hint: string },
  artistName: string,
): boolean {
  const needle = words(artistName).trim();
  return needle.length > 0 && words(`${story.title} ${story.hint}`).includes(` ${needle} `);
}

export interface DigestShow {
  venue: string;
  city: string;
  startsAtMs: number;
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
  | ({ kind: "show"; artist: string } & DigestShow)
  | {
      kind: "spins";
      artist: string;
      total: number;
      byStation: { station: string; count: number }[];
    }
  | ({ kind: "story"; artist: string } & DigestStory)
  | { kind: "apple"; added: number; expired: number };

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
    .map((a) => ({ kind: "show" as const, artist: a.name, ...a.nextShow! }))
    .sort((x, y) => x.startsAtMs - y.startsAtMs);
  const spins = artists
    .map((a) => ({
      kind: "spins" as const,
      artist: a.name,
      total: a.spins.reduce((n, s) => n + s.count, 0),
      byStation: a.spins,
    }))
    .filter((s) => s.total > 0)
    .sort((x, y) => y.total - x.total);
  const stories = artists
    .flatMap((a) =>
      a.stories
        .filter((s) => s.publishedAt > since)
        .map((s) => ({ kind: "story" as const, artist: a.name, ...s })),
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
