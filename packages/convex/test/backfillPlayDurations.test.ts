import { describe, expect, test } from "bun:test";
import { backfillPlayDurations } from "../convex/backfills";
import { fakeCtx, handlerOf, type Row } from "./fakeDb";

const SINCE = Date.parse("2026-06-08T05:00:00Z");
const sec = (n: number): number => n * 1000;

type Args = Record<string, unknown>;
const run = handlerOf<Args, Record<string, unknown>>(backfillPlayDurations);

function play(id: string, playedAt: number, fields: Partial<Row> = {}): Row {
  return {
    _id: id,
    stationId: "s1",
    playedAt,
    artistRaw: `Artist ${id}`,
    titleRaw: `Song ${id}`,
    enrichmentStatus: "resolved",
    ...fields,
  };
}

/** Runs the first batch, then every batch it schedules, like the Convex scheduler would. */
async function runToCompletion(fake: ReturnType<typeof fakeCtx>, args: Args) {
  const results = [await run(fake.ctx, args)];
  for (let i = 0; i < fake.scheduled.length; i += 1) {
    results.push(await run(fake.ctx, fake.scheduled[i]!.args));
  }
  return results;
}

function mixedStation() {
  return {
    stations: [{ _id: "s1", slug: "88nine", name: "88Nine" }],
    tracks: [{ _id: "timed", durationSec: 240 }, { _id: "untimed" }],
    plays: [
      play("before", SINCE - sec(10_000), {
        canonicalTrackId: "untimed",
        durationSec: 205,
        durationSource: "observed",
      }),
      play("a", SINCE + sec(0)),
      play("hasLength", SINCE + sec(200), { durationSec: 190 }),
      play("catalog", SINCE + sec(400), { canonicalTrackId: "timed" }),
      play("talkBreak", SINCE + sec(600), { canonicalTrackId: "untimed" }),
      play("stationId", SINCE + sec(1800), { enrichmentStatus: "ignored" }),
      play("glitch", SINCE + sec(1805)),
      play("rewound", SINCE + sec(1810), { deletedAt: 1 }),
      play("onAir", SINCE + sec(2000)),
    ],
  };
}

describe("backfills:backfillPlayDurations", () => {
  test("dry run counts what it would fill and writes nothing", async () => {
    const fake = fakeCtx(mixedStation());
    const result = await run(fake.ctx, { sinceMs: SINCE, dryRun: true });
    expect(result).toEqual({
      station: "88nine",
      dryRun: true,
      scanned: 8,
      missing: 3,
      observed: 1,
      estimatedFromTrack: 1,
      estimatedDefault: 1,
      finished: true,
    });
    expect(fake.patches).toEqual([]);
  });

  test("real run fills only plays the log has no length for, by the estimate rule", async () => {
    const fake = fakeCtx(mixedStation());
    await run(fake.ctx, { sinceMs: SINCE, dryRun: false });
    expect(fake.patches).toEqual([
      { id: "a", fields: { durationSec: 200, durationSource: "observed" } },
      { id: "talkBreak", fields: { durationSec: 205, durationSource: "estimated" } },
      { id: "glitch", fields: { durationSec: 210, durationSource: "estimated" } },
    ]);
  });

  test("a rerun is a no-op", async () => {
    const fake = fakeCtx(mixedStation());
    await run(fake.ctx, { sinceMs: SINCE, dryRun: false });
    const rerun = await run(fake.ctx, { sinceMs: SINCE, dryRun: false });
    expect(rerun).toMatchObject({ missing: 0 });
    expect(fake.patches).toHaveLength(3);
  });

  test("batches carry the previous play, so the play at a batch edge still gets its observed length", async () => {
    const plays = Array.from({ length: 250 }, (_, i) => play(`p${i}`, SINCE + sec(i * 200)));
    const fake = fakeCtx({ stations: [{ _id: "s1", slug: "88nine", name: "88Nine" }], plays });
    const results = await runToCompletion(fake, { sinceMs: SINCE, dryRun: false });

    expect(results.length).toBeGreaterThan(1);
    expect(results.at(-1)).toMatchObject({ scanned: 250, missing: 249, observed: 249 });
    const filled = new Set(fake.patches.map((patch) => patch.id));
    for (let i = 0; i < 249; i += 1) expect(filled.has(`p${i}`)).toBe(true);
    expect(filled.has("p249")).toBe(false);
    expect(fake.patches.every((patch) => patch.fields.durationSec === 200)).toBe(true);
  });

  test("without a station slug, every station is processed in turn; with one, only that station", async () => {
    const tables = () => ({
      stations: [
        { _id: "s2", slug: "hyfin", name: "HYFIN" },
        { _id: "s1", slug: "88nine", name: "88Nine" },
      ],
      plays: [
        play("a1", SINCE, { stationId: "s1" }),
        play("a2", SINCE + sec(200), { stationId: "s1" }),
        play("b1", SINCE, { stationId: "s2" }),
        play("b2", SINCE + sec(200), { stationId: "s2" }),
      ],
    });

    const all = fakeCtx(tables());
    const results = await runToCompletion(all, { sinceMs: SINCE, dryRun: false });
    expect(results.map((result) => result.station)).toEqual(["88nine", "hyfin"]);
    expect(all.patches.map((patch) => patch.id)).toEqual(["a1", "b1"]);

    const one = fakeCtx(tables());
    await runToCompletion(one, { sinceMs: SINCE, dryRun: false, stationSlug: "hyfin" });
    expect(one.patches.map((patch) => patch.id)).toEqual(["b1"]);
  });
});
