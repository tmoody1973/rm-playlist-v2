import { describe, expect, test } from "bun:test";
import {
  MAX_SCREEN,
  SCREEN_TTL_MS,
  countSpinsSince,
  digestSince,
  mergeSearchHits,
  searchCutoff,
  lookupKeyOrNull,
  nextFollow,
  hasRecentOtherSave,
  pickFindStory,
  pickHomeShow,
  playAtNumber,
  rankDigest,
  storyCutoff,
  STORY_LOOKBACK_MS,
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
  test("an explicit follow of an existing explicit follow is a no-op", () =>
    expect(nextFollow({ status: "following", source: "explicit" }, "explicit")).toBeNull());
  test("an explicit follow upgrades a find-sourced follow", () =>
    expect(nextFollow({ status: "following", source: "find" }, "explicit")).toEqual({
      status: "following",
      source: "explicit",
    }));
  test("a save never revives a find-sourced unfollow", () =>
    expect(nextFollow({ status: "unfollowed", source: "find" }, "find")).toBeNull());
  test("an explicit follow re-follows an unfollowed row", () =>
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
  describe("story lookback", () => {
    const withStory = (publishedAt: number) =>
      rankDigest({
        since,
        now: NOW,
        artists: [
          artist("Zhané", { stories: [{ storyId: "s", title: "t", show: "x", publishedAt }] }),
        ],
        apple: { added: 0, expired: 0 },
      });
    test("a story 10 days old with since 7 days ago is included", () =>
      expect(withStory(NOW - 10 * 86_400_000)).toHaveLength(1));
    test("a story 40 days before since is not", () =>
      expect(withStory(since - 40 * 86_400_000)).toEqual([]));
    test("storyCutoff is since minus 30 days", () =>
      expect(storyCutoff(since)).toBe(since - STORY_LOOKBACK_MS));
  });
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
    test("a story published exactly at the story cutoff is excluded", () =>
      expect(
        rankDigest({
          since,
          now: NOW,
          artists: [
            artist("A", {
              stories: [{ storyId: "s", title: "t", show: "x", publishedAt: storyCutoff(since) }],
            }),
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

describe("lookupKeyOrNull", () => {
  // Keys here are what normalizeArtistKey produces: "" for non-Latin or punctuation-only names.
  test("null for an empty key (non-Latin, punctuation-only, blank names)", () => {
    expect(lookupKeyOrNull("")).toBeNull(); // "坂本龍一", "Мумий Тролль", "!!!", "   "
  });
  test("passes a normal key through", () => expect(lookupKeyOrNull("tennis")).toBe("tennis"));
});

describe("pickFindStory", () => {
  const story = { storyId: "s1", title: "T", show: "Show", showSlug: "show", publishedAt: 1 };
  test("null without a watch row or stories", () => {
    expect(pickFindStory(null)).toBeNull();
    expect(pickFindStory({ stories: [] })).toBeNull();
  });
  test("returns the first story trimmed to id, title, show", () =>
    expect(pickFindStory({ stories: [story, { ...story, storyId: "s2" }] })).toEqual({
      storyId: "s1",
      title: "T",
      show: "Show",
    }));
});

describe("hasRecentOtherSave", () => {
  const finds = [
    { id: "a", savedAt: NOW - 10 * 60_000 },
    { id: "b", savedAt: NOW - 31 * 60_000 },
  ];
  test("true when another find is inside the window", () =>
    expect(hasRecentOtherSave(finds, "b", NOW)).toBe(true));
  test("excludes the current find", () => expect(hasRecentOtherSave(finds, "a", NOW)).toBe(false));
  test("ignores finds older than the window", () =>
    expect(hasRecentOtherSave([finds[1]!], "x", NOW)).toBe(false));
  test("false with no finds", () => expect(hasRecentOtherSave([], "x", NOW)).toBe(false));
});

describe("pickHomeShow", () => {
  const chicago = { metro: "Chicago", startsAtMs: 100 };
  const milwaukee = { metro: "Milwaukee", startsAtMs: 900 };
  test("prefers Milwaukee even when later", () =>
    expect(pickHomeShow([chicago, milwaukee])).toBe(milwaukee));
  test("else the soonest", () =>
    expect(pickHomeShow([{ metro: "Detroit", startsAtMs: 500 }, chicago])).toBe(chicago));
  test("null when empty", () => expect(pickHomeShow([])).toBeNull());
});

describe("digestSince", () => {
  test("uses the last visit when there is one", () => expect(digestSince(123, NOW)).toBe(123));
  test("defaults to the last 7 days", () =>
    expect(digestSince(undefined, NOW)).toBe(NOW - 7 * 86_400_000));
  test("keeps a last visit of 0", () => expect(digestSince(0, NOW)).toBe(0));
});

describe("countSpinsSince", () => {
  const play = (stationSlug: string, playedAt: number, deleted = false) => ({
    stationSlug,
    playedAt,
    deleted,
  });
  test("counts per station in first-seen order", () =>
    expect(countSpinsSince([play("hyfin", 5), play("88nine", 6), play("hyfin", 7)], 1)).toEqual([
      { station: "hyfin", count: 2 },
      { station: "88nine", count: 1 },
    ]));
  test("excludes deleted plays and plays at or before since", () =>
    expect(
      countSpinsSince([play("hyfin", 10), play("hyfin", 9, true), play("hyfin", 20)], 10),
    ).toEqual([{ station: "hyfin", count: 1 }]));
  test("empty when nothing is new", () => expect(countSpinsSince([], 1)).toEqual([]));
});

describe("mergeSearchHits", () => {
  const hit = (_id: string, playedAt: number) => ({ _id, playedAt });
  test("dedupes by _id, newest first", () =>
    expect(mergeSearchHits([hit("a", 1), hit("b", 3)], [hit("b", 3), hit("c", 2)], 10)).toEqual([
      hit("b", 3),
      hit("c", 2),
      hit("a", 1),
    ]));
  test("caps at the limit, keeping the newest", () =>
    expect(mergeSearchHits([hit("a", 1), hit("b", 2)], [hit("c", 3)], 2)).toEqual([
      hit("c", 3),
      hit("b", 2),
    ]));
  test("empty inputs give empty", () => expect(mergeSearchHits([], [], 5)).toEqual([]));
});

describe("searchCutoff", () => {
  const DAY = 86_400_000;
  test("defaults to 14 days", () => expect(searchCutoff(undefined, NOW)).toBe(NOW - 14 * DAY));
  test("clamps to 1..30 days", () => {
    expect(searchCutoff(0, NOW)).toBe(NOW - DAY);
    expect(searchCutoff(-5, NOW)).toBe(NOW - DAY);
    expect(searchCutoff(90, NOW)).toBe(NOW - 30 * DAY);
  });
  test("keeps a valid window and rounds fractions down", () => {
    expect(searchCutoff(7, NOW)).toBe(NOW - 7 * DAY);
    expect(searchCutoff(2.9, NOW)).toBe(NOW - 2 * DAY);
  });
  test("non-finite falls back to the default", () =>
    expect(searchCutoff(Number.NaN, NOW)).toBe(NOW - 14 * DAY));
});
