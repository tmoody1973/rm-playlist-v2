import { describe, expect, test } from "bun:test";
import { stampPreviousPlayDuration } from "../convex/durationFill";
import { fakeCtx, type Row } from "./fakeDb";

const T0 = Date.parse("2026-09-22T23:00:00Z");
const sec = (n: number): number => n * 1000;
const TALK_BREAK_GAP = sec(20 * 60);

function play(id: string, playedAt: number, fields: Partial<Row> = {}): Row {
  return {
    _id: id,
    stationId: "s1",
    playedAt,
    artistRaw: "Artist",
    titleRaw: "Song",
    enrichmentStatus: "resolved",
    ...fields,
  };
}

async function stampAfter(plays: Row[], newPlayedAt: number, tracks: Row[] = []) {
  const fake = fakeCtx({ plays, tracks });
  await stampPreviousPlayDuration(fake.ctx as never, "s1" as never, newPlayedAt);
  return fake.patches;
}

describe("stampPreviousPlayDuration (going forward)", () => {
  test("a gap in range is stamped as the observed length (PR #52 behavior)", async () => {
    const patches = await stampAfter([play("p1", T0)], T0 + sec(200));
    expect(patches).toEqual([
      { id: "p1", fields: { durationSec: 200, durationSource: "observed" } },
    ]);
  });

  test("a talk-break gap gets the median of the track's other known lengths, flagged estimated", async () => {
    const plays = [
      play("old1", T0 - sec(9000), { canonicalTrackId: "t1", durationSec: 230 }),
      play("old2", T0 - sec(6000), {
        canonicalTrackId: "t1",
        durationSec: 250,
        durationSource: "observed",
      }),
      play("old3", T0 - sec(3000), {
        canonicalTrackId: "t1",
        durationSec: 999,
        durationSource: "estimated",
      }),
      play("p1", T0, { canonicalTrackId: "t1" }),
    ];
    const patches = await stampAfter(plays, T0 + TALK_BREAK_GAP, [{ _id: "t1" }]);
    expect(patches).toEqual([
      { id: "p1", fields: { durationSec: 240, durationSource: "estimated" } },
    ]);
  });

  test("an unresolved song falls back to plays with the same normalized artist + title", async () => {
    const plays = [
      play("same", T0 - sec(6000), {
        artistRaw: "the weeknd",
        titleRaw: "Blinding Lights (Radio Edit)",
        durationSec: 201,
        durationSource: "observed",
      }),
      play("other", T0 - sec(3000), {
        artistRaw: "The Weeknd",
        titleRaw: "Starboy",
        durationSec: 230,
      }),
      play("p1", T0, {
        artistRaw: "The Weeknd",
        titleRaw: "Blinding Lights",
        enrichmentStatus: "unresolved",
      }),
    ];
    const patches = await stampAfter(plays, T0 + TALK_BREAK_GAP);
    expect(patches).toEqual([
      { id: "p1", fields: { durationSec: 201, durationSource: "estimated" } },
    ]);
  });

  test("nothing known about the song: the 210 s default, flagged estimated", async () => {
    const patches = await stampAfter([play("p1", T0)], T0 + TALK_BREAK_GAP);
    expect(patches).toEqual([
      { id: "p1", fields: { durationSec: 210, durationSource: "estimated" } },
    ]);
  });

  test("a 12 s gap (song cut off) stores the 12 s that aired, observed, not an estimate", async () => {
    const patches = await stampAfter([play("p1", T0)], T0 + sec(12));
    expect(patches).toEqual([
      { id: "p1", fields: { durationSec: 12, durationSource: "observed" } },
    ]);
  });

  test("a late-arriving next play (outage recovery) upgrades our own estimate to the observed gap", async () => {
    const estimated = { durationSec: 210, durationSource: "estimated" };
    expect(await stampAfter([play("p1", T0, estimated)], T0 + sec(195))).toEqual([
      { id: "p1", fields: { durationSec: 195, durationSource: "observed" } },
    ]);
    expect(await stampAfter([play("p1", T0, estimated)], T0 + TALK_BREAK_GAP)).toEqual([]);
  });

  test("a recovered play landing before the old next play re-measures our observed length, so rows can't overlap", async () => {
    const observed = { durationSec: 400, durationSource: "observed" };
    expect(await stampAfter([play("p1", T0, observed)], T0 + sec(200))).toEqual([
      { id: "p1", fields: { durationSec: 200, durationSource: "observed" } },
    ]);
  });

  test("never overwrites a feed length, never estimates a station ID or a catalog-timed song", async () => {
    expect(await stampAfter([play("p1", T0, { durationSec: 180 })], T0 + sec(60))).toEqual([]);
    expect(
      await stampAfter([play("p1", T0, { enrichmentStatus: "ignored" })], T0 + TALK_BREAK_GAP),
    ).toEqual([]);
    expect(
      await stampAfter([play("p1", T0, { canonicalTrackId: "t1" })], T0 + TALK_BREAK_GAP, [
        { _id: "t1", durationSec: 240 },
      ]),
    ).toEqual([]);
  });
});
