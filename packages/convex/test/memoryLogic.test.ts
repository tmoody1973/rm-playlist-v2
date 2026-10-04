import { describe, expect, test } from "bun:test";
import {
  MAX_SCREEN,
  SCREEN_TTL_MS,
  isUsableArtistName,
  nextFollow,
  playAtNumber,
  rankDigest,
  pickStaleArtists,
  storiesFromBackstory,
  storyMentionsArtist,
} from "../convex/memoryLogic";

const NOW = Date.UTC(2026, 9, 10, 18);

describe("playAtNumber", () => {
  const screen = { shownAt: NOW - 60_000, playIds: ["p1", "p2", "p3"] };
  test("returns the play at a spoken number", () =>
    expect(playAtNumber(screen, 3, NOW)).toBe("p3"));
  test("null past the end, below 1, or not a whole number", () => {
    expect(playAtNumber(screen, 4, NOW)).toBeNull();
    expect(playAtNumber(screen, 0, NOW)).toBeNull();
    expect(playAtNumber(screen, 1.5, NOW)).toBeNull();
  });
  test("null when the screen is older than 30 minutes or missing", () => {
    expect(playAtNumber({ ...screen, shownAt: NOW - SCREEN_TTL_MS - 1 }, 1, NOW)).toBeNull();
    expect(playAtNumber(undefined, 1, NOW)).toBeNull();
  });
  test("MAX_SCREEN is 10", () => expect(MAX_SCREEN).toBe(10));
});

describe("nextFollow", () => {
  test("a save follows an artist with no row", () =>
    expect(nextFollow(null, "find")).toEqual({ status: "following", source: "find" }));
  test("a save never overrides an explicit unfollow", () =>
    expect(nextFollow({ status: "unfollowed", source: "explicit" }, "find")).toBeNull());
  test("a save leaves an existing follow alone", () =>
    expect(nextFollow({ status: "following", source: "explicit" }, "find")).toBeNull());
  test("an explicit follow always follows", () =>
    expect(nextFollow({ status: "unfollowed", source: "explicit" }, "explicit")).toEqual({
      status: "following",
      source: "explicit",
    }));
});

describe("storyMentionsArtist", () => {
  test("keeps a story naming the artist, case and punctuation insensitive", () =>
    expect(
      storyMentionsArtist({ title: "Thao's Studio Milwaukee session", hint: "" }, "Thao"),
    ).toBe(true));
  test("drops a story that only matched by meaning", () =>
    expect(
      storyMentionsArtist({ title: "Indie rock in Riverwest", hint: "guitars and horns" }, "Thao"),
    ).toBe(false));
  test("needs a whole-word match, so 'Nas' does not match 'Nashville'", () =>
    expect(storyMentionsArtist({ title: "Nashville sounds", hint: "" }, "Nas")).toBe(false));
});

describe("storyMentionsArtist normalization", () => {
  const story = (title: string) => ({ title, hint: "" });
  test("folds accents on the story side", () =>
    expect(storyMentionsArtist(story("Zhane at 30"), "Zhané")).toBe(true));
  test("folds accents on the artist side", () =>
    expect(storyMentionsArtist(story("Zhané at 30"), "Zhane")).toBe(true));
  test("an accented letter is not a word break", () =>
    expect(storyMentionsArtist(story("Zhan wins"), "Zhané")).toBe(false));
  test("treats & and 'and' alike", () =>
    expect(
      storyMentionsArtist(
        story("Thao and The Get Down Stay Down"),
        "Thao & The Get Down Stay Down",
      ),
    ).toBe(true));
  test("a name with no Latin letters never matches and never throws", () =>
    expect(storyMentionsArtist(story("坂本龍一 live"), "坂本龍一")).toBe(false));
});

describe("rankDigest", () => {
  const since = NOW - 7 * 86_400_000;
  const artist = (name: string, over: object = {}) => ({
    artistId: name,
    name,
    spins: [],
    nextShow: null,
    stories: [],
    ...over,
  });
  test("orders: shows within 7 days, then most-played artists, then new stories, then later shows, then Apple Music", () => {
    const items = rankDigest({
      since,
      now: NOW,
      artists: [
        artist("Thao", {
          spins: [{ station: "88nine", count: 2 }],
          nextShow: { venue: "Turner Hall", city: "Milwaukee", startsAtMs: NOW + 2 * 86_400_000 },
        }),
        artist("Nas", {
          spins: [
            { station: "hyfin", count: 3 },
            { station: "88nine", count: 1 },
          ],
          nextShow: { venue: "Riviera", city: "Chicago", startsAtMs: NOW + 20 * 86_400_000 },
        }),
        artist("Zhané", {
          stories: [
            {
              storyId: "s1",
              title: "Zhané at 30",
              show: "Ladies First",
              publishedAt: NOW - 86_400_000,
            },
          ],
        }),
      ],
      apple: { added: 3, expired: 0 },
    });
    expect(items.map((i) => `${i.kind}:${"artist" in i ? i.artist : ""}`)).toEqual([
      "show:Thao",
      "spins:Nas",
      "spins:Thao",
      "story:Zhané",
      "show:Nas",
      "apple:",
    ]);
    expect(items[1]).toMatchObject({ kind: "spins", artist: "Nas", total: 4 });
  });
  test("an empty digest is an empty list (the tool falls back to station picks)", () =>
    expect(
      rankDigest({ since, now: NOW, artists: [artist("Quiet")], apple: { added: 0, expired: 0 } }),
    ).toEqual([]));
  test("an expired Apple Music link is always reported", () =>
    expect(rankDigest({ since, now: NOW, artists: [], apple: { added: 0, expired: 1 } })).toEqual([
      { kind: "apple", added: 0, expired: 1 },
    ]));
  describe("boundaries", () => {
    const show = (offsetMs: number) => ({ venue: "V", city: "C", startsAtMs: NOW + offsetMs });
    test("a show starting exactly now is excluded", () =>
      expect(
        rankDigest({
          since,
          now: NOW,
          artists: [artist("A", { nextShow: show(0) })],
          apple: { added: 0, expired: 0 },
        }),
      ).toEqual([]));
    test("a show exactly 7 days out counts as soon, ahead of spins", () => {
      const items = rankDigest({
        since,
        now: NOW,
        artists: [
          artist("A", { nextShow: show(7 * 86_400_000) }),
          artist("B", { spins: [{ station: "88nine", count: 1 }] }),
        ],
        apple: { added: 0, expired: 0 },
      });
      expect(items.map((i) => i.kind)).toEqual(["show", "spins"]);
    });
    test("a story published exactly at since is excluded", () =>
      expect(
        rankDigest({
          since,
          now: NOW,
          artists: [
            artist("A", { stories: [{ storyId: "s", title: "t", show: "x", publishedAt: since }] }),
          ],
          apple: { added: 0, expired: 0 },
        }),
      ).toEqual([]));
    test("an artist with zero spins yields no spins item", () => {
      const items = rankDigest({
        since,
        now: NOW,
        artists: [artist("Quiet"), artist("Loud", { spins: [{ station: "hyfin", count: 2 }] })],
        apple: { added: 0, expired: 0 },
      });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ kind: "spins", artist: "Loud" });
    });
  });
});

describe("storiesFromBackstory", () => {
  const card = (storyId: string, title: string, publishedAt: number, hint = "") => ({
    storyId,
    title,
    show: "Show",
    showSlug: "show",
    publishedAt,
    hint,
  });

  test("keeps only stories naming the artist, drops hint", () => {
    const body = {
      status: "success",
      value: [card("a", "Tobe Nwigwe tour", 1), card("b", "Unrelated", 2)],
    };
    expect(storiesFromBackstory(body, "Tobe Nwigwe")).toEqual([
      { storyId: "a", title: "Tobe Nwigwe tour", show: "Show", showSlug: "show", publishedAt: 1 },
    ]);
  });
  test("newest three when more than three match", () => {
    const value = [1, 2, 3, 4].map((n) => card(`s${n}`, "Mdou Moctar live", n));
    const result = storiesFromBackstory({ status: "success", value }, "Mdou Moctar");
    expect(result?.map((s) => s.storyId)).toEqual(["s4", "s3", "s2"]);
  });
  test("null for an error body", () =>
    expect(storiesFromBackstory({ status: "error", errorMessage: "x" }, "A")).toBeNull());
  test("null for malformed values", () => {
    expect(storiesFromBackstory({ status: "success", value: "nope" }, "A")).toBeNull();
    expect(storiesFromBackstory({ status: "success", value: [{ title: 1 }] }, "A")).toBeNull();
    expect(storiesFromBackstory(null, "A")).toBeNull();
  });
});

describe("pickStaleArtists", () => {
  const HOUR = 3_600_000;
  const STALE = 20 * HOUR;
  const ago = (hours: number) => NOW - hours * HOUR;

  test("a row checked 23h59m ago is stale; 19h ago is not", () => {
    const rows = [
      { artistId: "late", checkedAt: NOW - (23 * HOUR + 59 * 60_000) },
      { artistId: "fresh", checkedAt: ago(19) },
    ];
    expect(pickStaleArtists(rows, NOW, STALE, 10)).toEqual(["late"]);
  });
  test("never-checked first, then oldest", () => {
    const rows = [
      { artistId: "old", checkedAt: ago(30) },
      { artistId: "older", checkedAt: ago(50) },
      { artistId: "never", checkedAt: null },
    ];
    expect(pickStaleArtists(rows, NOW, STALE, 10)).toEqual(["never", "older", "old"]);
  });
  test("dedupes and honors the limit", () => {
    const rows = [
      { artistId: "a", checkedAt: null },
      { artistId: "a", checkedAt: null },
      { artistId: "b", checkedAt: null },
      { artistId: "c", checkedAt: null },
    ];
    expect(pickStaleArtists(rows, NOW, STALE, 2)).toEqual(["a", "b"]);
  });
});

describe("isUsableArtistName", () => {
  test("rejects missing, empty and whitespace-only names", () => {
    expect(isUsableArtistName(undefined)).toBe(false);
    expect(isUsableArtistName("")).toBe(false);
    expect(isUsableArtistName("   ")).toBe(false);
    expect(isUsableArtistName("Tennis")).toBe(true);
  });
});
