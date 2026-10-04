import { describe, expect, test } from "bun:test";
import {
  MAX_SCREEN,
  SCREEN_TTL_MS,
  nextFollow,
  playAtNumber,
  rankDigest,
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
});
