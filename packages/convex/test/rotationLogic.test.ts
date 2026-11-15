import { describe, expect, test } from "bun:test";
import { buildRotation, matchLineup, mergeRotations } from "../convex/rotationLogic";

const SINCE = 1_000;

function play(artistRaw: string, playedAt = 2_000, extra: Record<string, unknown> = {}) {
  return { artistRaw, playedAt, ...extra };
}

describe("buildRotation", () => {
  test("counts plays per normalized artist, most played first", () => {
    const rotation = buildRotation(
      [play("Brandi Carlile"), play("The National"), play("brandi carlile"), play("National")],
      SINCE,
    );
    expect(rotation).toEqual([
      { key: "brandicarlile", name: "brandi carlile", playCount: 2 },
      { key: "national", name: "National", playCount: 2 },
    ]);
  });

  test("skips deleted, ignored, too-old, and nameless plays", () => {
    const rotation = buildRotation(
      [
        play("Deleted", 2_000, { deletedAt: 3_000 }),
        play("Ignored", 2_000, { enrichmentStatus: "ignored" }),
        play("Too Old", 999),
        play("   "),
        play("Kept"),
      ],
      SINCE,
    );
    expect(rotation.map((artist) => artist.key)).toEqual(["kept"]);
  });

  test("keeps the most recent spelling as the display name", () => {
    const rotation = buildRotation([play("Jim James", 2_000), play("JIM JAMES", 5_000)], SINCE);
    expect(rotation[0]?.name).toBe("JIM JAMES");
  });
});

describe("mergeRotations", () => {
  test("adds play counts across stations and remembers which stations played the artist", () => {
    const merged = mergeRotations([
      { stationId: "s88", artists: [{ key: "jorjasmith", name: "Jorja Smith", playCount: 3 }] },
      { stationId: "hyfin", artists: [{ key: "jorjasmith", name: "Jorja Smith", playCount: 5 }] },
    ]);
    expect(merged.get("jorjasmith")).toEqual({
      name: "Jorja Smith",
      playCount: 8,
      stationIds: ["s88", "hyfin"],
    });
  });
});

describe("matchLineup", () => {
  const rotation = mergeRotations([
    {
      stationId: "s88",
      artists: [
        { key: "opener", name: "Opener", playCount: 50 },
        { key: "headliner", name: "Headliner", playCount: 2 },
      ],
    },
    { stationId: "hyfin", artists: [{ key: "opener", name: "Opener", playCount: 1 }] },
  ]);

  test("null when nobody on the bill is in rotation", () => {
    expect(
      matchLineup(
        [{ artistKey: "stranger", artistNameRaw: "Stranger", role: "headliner" }],
        rotation,
      ),
    ).toBeNull();
  });

  test("prefers a headliner in rotation over a more-played opener", () => {
    const match = matchLineup(
      [
        { artistKey: "opener", artistNameRaw: "Opener", role: "support" },
        { artistKey: "headliner", artistNameRaw: "Headliner", role: "headliner" },
      ],
      rotation,
    );
    expect(match?.artistName).toBe("Headliner");
    expect(match?.role).toBe("headliner");
  });

  test("lists the show for every station that plays anyone on the bill", () => {
    const match = matchLineup(
      [
        { artistKey: "opener", artistNameRaw: "Opener", role: "support" },
        { artistKey: "headliner", artistNameRaw: "Headliner", role: "headliner" },
      ],
      rotation,
    );
    expect(match?.stationIds.sort()).toEqual(["hyfin", "s88"]);
  });

  test("among support acts, picks the most played", () => {
    const match = matchLineup(
      [
        { artistKey: "headliner", artistNameRaw: "Headliner", role: "support" },
        { artistKey: "opener", artistNameRaw: "Opener", role: "support" },
      ],
      rotation,
    );
    expect(match?.artistName).toBe("Opener");
  });
});
