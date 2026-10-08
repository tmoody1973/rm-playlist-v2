import { describe, expect, test } from "bun:test";
import { soundExchangePlaylist, soundExchangePlaylistSummary } from "../convex/reports";
import { fakeCtx, handlerOf, type Row } from "./fakeDb";

const START = Date.parse("2026-07-01T05:00:00Z");
const END = Date.parse("2026-08-01T05:00:00Z");

type Args = Record<string, unknown>;
const summary = handlerOf<Args, Record<string, unknown>>(soundExchangePlaylistSummary);
const playlist = handlerOf<Args, { rows: Array<{ durationSec: number | null }> }>(
  soundExchangePlaylist,
);

function resolvedPlay(id: string, minute: number, fields: Partial<Row> = {}): Row {
  return {
    _id: id,
    stationId: "s1",
    playedAt: START + minute * 60_000,
    artistRaw: "Artist",
    titleRaw: "Song",
    enrichmentStatus: "resolved",
    canonicalTrackId: "untimed",
    ...fields,
  };
}

function month(playCount: number) {
  return {
    stations: [{ _id: "s1", slug: "88nine", name: "88Nine" }],
    artists: [{ _id: "ar1", displayName: "Artist" }],
    tracks: [
      { _id: "timed", artistId: "ar1", displayTitle: "Song", durationSec: 240 },
      { _id: "untimed", artistId: "ar1", displayTitle: "Song" },
    ],
    plays: Array.from({ length: playCount }, (_, i) => resolvedPlay(`p${i}`, i * 4)),
  };
}

describe("reports:soundExchangePlaylistSummary", () => {
  test("estimated lengths count as present for export but are reported separately", async () => {
    const tables = month(0);
    tables.plays = [
      resolvedPlay("catalog", 0, { canonicalTrackId: "timed" }),
      resolvedPlay("observed", 4, { durationSec: 200, durationSource: "observed" }),
      resolvedPlay("estimated", 8, { durationSec: 210, durationSource: "estimated" }),
      resolvedPlay("blank", 12),
    ];
    const result = await summary(fakeCtx(tables).ctx, {
      stationSlug: "88nine",
      startMs: START,
      endMs: END,
      cursor: null,
    });
    expect(result).toMatchObject({ resolvedPlays: 4, missingDuration: 1, estimatedDuration: 1 });
  });

  test("a full month is read in small pages, even when the caller sends no cursor", async () => {
    const fake = fakeCtx(month(9_500));
    let cursor: string | null | undefined = undefined;
    let resolvedPlays = 0;
    let calls = 0;
    do {
      const page = await summary(fake.ctx, {
        stationSlug: "88nine",
        startMs: START,
        endMs: END,
        cursor,
      });
      resolvedPlays += page.resolvedPlays as number;
      cursor = page.isDone ? null : (page.continueCursor as string);
      calls += 1;
    } while (cursor !== null);

    expect(resolvedPlays).toBe(9_500);
    expect(calls).toBeGreaterThan(1);
    expect(Math.max(...fake.pageSizes)).toBeLessThanOrEqual(1_000);
  });
});

describe("reports:soundExchangePlaylist", () => {
  test("rows carry the catalog length first, else the play's own (observed or estimated)", async () => {
    const tables = month(0);
    tables.plays = [
      resolvedPlay("catalog", 0, { canonicalTrackId: "timed", durationSec: 199 }),
      resolvedPlay("estimated", 4, { durationSec: 210, durationSource: "estimated" }),
      resolvedPlay("blank", 8),
    ];
    const result = await playlist(fakeCtx(tables).ctx, {
      stationSlug: "88nine",
      startMs: START,
      endMs: END,
      cursor: null,
    });
    expect(result.rows.map((row) => row.durationSec)).toEqual([240, 210, null]);
  });
});
