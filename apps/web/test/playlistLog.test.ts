import { describe, expect, test } from "bun:test";
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
