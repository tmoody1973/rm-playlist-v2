import { describe, expect, test } from "bun:test";
import { type RankablePlay, rankTopPlays } from "../convex/topSongsLogic";

function play(overrides: Partial<RankablePlay> & { _id: string; playedAt: number }): RankablePlay {
  return { artistRaw: "Artist", titleRaw: "Song", ...overrides };
}

describe("rankTopPlays", () => {
  test("groups by canonical track and sorts by spin count, highest first", () => {
    const plays = [
      play({ _id: "a1", playedAt: 10, canonicalTrackId: "trackA" }),
      play({ _id: "b1", playedAt: 11, canonicalTrackId: "trackB" }),
      play({ _id: "b2", playedAt: 12, canonicalTrackId: "trackB" }),
    ];
    const ranked = rankTopPlays(plays, 0, 20);
    expect(ranked.map((r) => [r.play._id, r.playCount])).toEqual([
      ["b2", 2],
      ["a1", 1],
    ]);
  });

  test("unmatched plays group by trimmed, lowercased artist + title", () => {
    const plays = [
      play({ _id: "x1", playedAt: 1, artistRaw: " Little Simz ", titleRaw: "Gorilla" }),
      play({ _id: "x2", playedAt: 2, artistRaw: "little simz", titleRaw: "GORILLA " }),
    ];
    const [top] = rankTopPlays(plays, 0, 20);
    expect(top?.playCount).toBe(2);
    expect(top?.play._id).toBe("x2");
  });

  test("keeps the newest play as the representative regardless of input order", () => {
    const plays = [
      play({ _id: "new", playedAt: 50, canonicalTrackId: "t" }),
      play({ _id: "old", playedAt: 5, canonicalTrackId: "t" }),
    ];
    expect(rankTopPlays(plays, 0, 20)[0]?.play._id).toBe("new");
  });

  test("skips deleted plays, ignored plays, and plays before the window", () => {
    const plays = [
      play({ _id: "deleted", playedAt: 100, deletedAt: 101 }),
      play({ _id: "ignored", playedAt: 100, enrichmentStatus: "ignored" }),
      play({ _id: "tooOld", playedAt: 9, titleRaw: "Other" }),
      play({ _id: "kept", playedAt: 10, titleRaw: "Other" }),
    ];
    const ranked = rankTopPlays(plays, 10, 20);
    expect(ranked.map((r) => r.play._id)).toEqual(["kept"]);
  });

  test("returns at most `take` songs", () => {
    const plays = Array.from({ length: 30 }, (_, index) =>
      play({ _id: `p${index}`, playedAt: index, canonicalTrackId: `t${index}` }),
    );
    expect(rankTopPlays(plays, 0, 5)).toHaveLength(5);
  });
});
