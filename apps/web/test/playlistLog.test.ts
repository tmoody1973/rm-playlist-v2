import { describe, expect, test } from "bun:test";
import { fillDurationSec, gapSec, pairWithNext } from "@rm/convex/playDuration";
import {
  collectPages,
  formatDuration,
  formatPlaylistTimestamp,
  toPlaylistTxt,
  type PlaylistRow,
} from "../app/dashboard/playlistLog";

const row = (playedAtIso: string, durationSec: number | null, title = "Song"): PlaylistRow => ({
  playedAt: Date.parse(playedAtIso),
  channelName: "88Nine",
  featuredArtist: "Artist",
  soundRecordingTitle: title,
  albumTitle: "Album",
  marketingLabel: "Label",
  isrc: "",
  durationSec,
});

/** Wall-clock seconds between two `MM/dd/yyyy HH:mm:ss` strings (no zone, as NPR reads them). */
function wallClockSeconds(start: string, end: string): number {
  const toUtc = (stamp: string) => {
    const [date, time] = stamp.split(" ");
    const [month, day, year] = date!.split("/");
    return Date.parse(`${year}-${month}-${day}T${time}Z`);
  };
  return (toUtc(end) - toUtc(start)) / 1000;
}

describe("formatPlaylistTimestamp", () => {
  test("MM/dd/yyyy HH:mm:ss in Milwaukee local time, zero-padded, 24-hour, no offset", () => {
    expect(formatPlaylistTimestamp(Date.parse("2026-09-05T14:05:09Z"))).toBe("09/05/2026 09:05:09");
    expect(formatPlaylistTimestamp(Date.parse("2026-01-02T06:00:00Z"))).toBe("01/02/2026 00:00:00");
    expect(formatPlaylistTimestamp(Date.parse("2026-01-02T04:07:08Z"))).toBe("01/01/2026 22:07:08");
  });
});

describe("formatDuration", () => {
  test("m:ss, leading zero hours omitted, minutes past 59 kept as total minutes", () => {
    expect(formatDuration(278)).toBe("4:38");
    expect(formatDuration(61)).toBe("1:01");
    expect(formatDuration(45)).toBe("0:45");
    expect(formatDuration(3723)).toBe("62:03");
  });
});

describe("toPlaylistTxt", () => {
  const rows = [
    row("2026-09-15T14:05:09Z", 278, "Four Thirty-Eight"),
    row("2026-01-01T05:59:30Z", 61, "Over Midnight"),
    row("2026-09-15T14:20:00.700Z", 238.6, "Fractional"),
    row("2026-09-15T14:30:00Z", null, "Unknown Length"),
  ];
  const lines = toPlaylistTxt(rows).split("\n");

  test("NPR headers, tab-delimited, one row per play in order", () => {
    expect(lines[0]).toBe("Start Time\tEnd Time\tDuration\tTitle\tArtist\tAlbum\tLabel");
    expect(lines).toHaveLength(rows.length + 1);
  });

  test("End Time = Start Time + Duration exactly, including across midnight", () => {
    expect(lines[1]).toBe(
      "09/15/2026 09:05:09\t09/15/2026 09:09:47\t4:38\tFour Thirty-Eight\tArtist\tAlbum\tLabel",
    );
    expect(lines[2]).toBe(
      "12/31/2025 23:59:30\t01/01/2026 00:00:31\t1:01\tOver Midnight\tArtist\tAlbum\tLabel",
    );
  });

  test("lengths are whole seconds so the math still checks with sub-second starts and lengths", () => {
    expect(lines[3]).toBe(
      "09/15/2026 09:20:00\t09/15/2026 09:23:59\t3:59\tFractional\tArtist\tAlbum\tLabel",
    );
    for (const line of lines.slice(1, 4)) {
      const [start, end, duration] = line.split("\t");
      const [minutes, seconds] = duration!.split(":").map(Number);
      expect(wallClockSeconds(start!, end!)).toBe(minutes! * 60 + seconds!);
    }
  });

  test("a play with no length leaves End Time and Duration blank", () => {
    expect(lines[4]).toBe("09/15/2026 09:30:00\t\t\tUnknown Length\tArtist\tAlbum\tLabel");
  });

  test("tabs and newlines inside a field can't break the row", () => {
    const [, line] = toPlaylistTxt([row("2026-09-15T14:05:09Z", 200, "A\tB\nC")]).split("\n");
    expect(line!.split("\t")).toHaveLength(7);
    expect(line).toContain("\tA B C\t");
  });
});

describe("collectPages", () => {
  test("follows continueCursor until isDone and keeps page order", async () => {
    const pages = [
      { items: [1, 2], isDone: false, continueCursor: "c1" },
      { items: [3], isDone: false, continueCursor: "c2" },
      { items: [4], isDone: true, continueCursor: "c3" },
    ];
    const cursorsSeen: Array<string | null> = [];
    const collected = await collectPages(async (cursor) => {
      cursorsSeen.push(cursor);
      return pages[cursorsSeen.length - 1]!;
    });
    expect(cursorsSeen).toEqual([null, "c1", "c2"]);
    expect(collected.map((page) => page.items)).toEqual([[1, 2], [3], [4]]);
  });
});

describe("estimate rule + export: rows never overlap", () => {
  const BASE = Date.parse("2026-09-10T15:00:00Z");
  const GAP_KINDS_MS: Array<[number, number]> = [
    [0, 900], // next play in the same second
    [1_000, 29_999], // cut off / glitch
    [30_000, 480_000], // a song, measured
    [480_001, 2_400_000], // talk break swallowed
  ];

  /** Deterministic PRNG (mulberry32) so a failure reproduces. */
  function random(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
  }

  function mixedSequence(
    next: () => number,
    length: number,
    { withCatalogLengths = false } = {},
  ): PlaylistRow[] {
    const between = (low: number, high: number) => low + Math.floor(next() * (high - low + 1));
    const starts = [BASE + between(0, 999)];
    for (let i = 1; i < length; i += 1) {
      const [low, high] = GAP_KINDS_MS[between(0, GAP_KINDS_MS.length - 1)]!;
      starts.push(starts[i - 1]! + between(low, high));
    }
    const plays = starts.map((playedAt) => ({ playedAt }));
    const { pairs } = pairWithNext(null, plays);
    const filled = pairs.map(({ play, nextPlayedAt }) => {
      const songLengths = Array.from({ length: between(0, 3) }, () => between(60, 900));
      return fillDurationSec(gapSec(play.playedAt, nextPlayedAt), songLengths)?.durationSec ?? null;
    });
    // A catalog length wins over our own in the export, and it can be any
    // version of the song (album cut, live take), so model it as unrelated.
    const catalogLength = () => (withCatalogLengths && next() < 0.5 ? between(60, 1_300) : null);
    return starts.map((playedAt, i) => ({
      ...row("2026-01-01T00:00:00Z", null),
      playedAt,
      durationSec: catalogLength() ?? filled[i] ?? null,
    }));
  }

  test.each([
    ["our own lengths", false],
    ["catalog lengths too", true],
  ])(
    "with %s, no End Time runs past the next row's Start Time, and End − Start = Duration",
    (_, withCatalogLengths) => {
      const next = random(20261008);
      const violations: string[] = [];
      for (let sequence = 0; sequence < 40; sequence += 1) {
        const rows = mixedSequence(next, 25, { withCatalogLengths });
        const lines = toPlaylistTxt(rows).split("\n").slice(1);
        lines.forEach((line, i) => {
          const [start, end, duration] = line.split("\t");
          if (end === "") return;
          const [minutes, seconds] = duration!.split(":").map(Number);
          if (wallClockSeconds(start!, end!) !== minutes! * 60 + seconds!) {
            violations.push(`math: ${line}`);
          }
          const following = lines[i + 1];
          // Next play in the same second: the row keeps a 1 s length rather than none.
          const sameSecondFloor = duration === "0:01";
          if (
            following !== undefined &&
            !sameSecondFloor &&
            wallClockSeconds(end!, following.split("\t")[0]!) < 0
          ) {
            violations.push(`overlap: ${line} | ${following}`);
          }
        });
      }
      expect(violations).toEqual([]);
    },
    20_000,
  );

  test("a catalog length longer than what aired ends at the next row's start", () => {
    // Real case, 88Nine 08/08/2026: catalog has the 11:52 album version; the next song started 3:56 later.
    const lines = toPlaylistTxt([
      row("2026-08-08T15:05:29Z", 712, "Got to Give It Up"),
      row("2026-08-08T15:09:25Z", 200, "Next Song"),
    ]).split("\n");
    expect(lines[1]!.split("\t").slice(0, 3)).toEqual([
      "08/08/2026 10:05:29",
      "08/08/2026 10:09:25",
      "3:56",
    ]);
    expect(lines[2]!.split("\t")[2]).toBe("3:20");
  });

  test("a row whose next play starts in the same second keeps a 1 s length, not a blank", () => {
    const [, line] = toPlaylistTxt([
      row("2026-08-08T15:05:29.100Z", 240),
      row("2026-08-08T15:05:29.800Z", 200),
    ]).split("\n");
    expect(line!.split("\t").slice(0, 3)).toEqual([
      "08/08/2026 10:05:29",
      "08/08/2026 10:05:30",
      "0:01",
    ]);
  });

  test("a song cut off after 12 s exports as 0:12, ending exactly when the next one starts", () => {
    const start = Date.parse("2026-09-15T14:05:09.300Z");
    const length = fillDurationSec(gapSec(start, start + 12_400), [240]);
    expect(length).toEqual({ durationSec: 12, basis: "observed" });
    const [, line] = toPlaylistTxt([row("2026-09-15T14:05:09.300Z", length!.durationSec)]).split(
      "\n",
    );
    expect(line!.split("\t").slice(0, 3)).toEqual([
      "09/15/2026 09:05:09",
      "09/15/2026 09:05:21",
      "0:12",
    ]);
  });
});
