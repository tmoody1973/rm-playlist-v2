import { describe, expect, test } from "bun:test";
import {
  buildCadenceSong,
  localDateKey,
  localIso,
  pickEpisode,
  type CadenceEpisode,
  type CadencePlayInput,
} from "../convex/cadenceSong";

// 2026-09-22T19:30:00Z == 14:30 CDT
const PLAYED_AT = Date.parse("2026-09-22T19:30:00Z");
const TZ = "America/Chicago";

function play(overrides: Partial<CadencePlayInput> = {}): CadencePlayInput {
  return {
    artistRaw: "khruangbin",
    titleRaw: "may ninth",
    playedAt: PLAYED_AT,
    durationSec: undefined,
    artist: { displayName: "Khruangbin" },
    track: {
      displayTitle: "May Ninth",
      albumDisplayName: "A LA SALA",
      recordLabel: "Dead Oceans",
      durationSec: 213,
      artworkUrl: "https://example.test/art.jpg",
    },
    ...overrides,
  };
}

describe("buildCadenceSong", () => {
  test("maps an enriched play to Cadence's Song shape with duration in ms", () => {
    const result = buildCadenceSong(play(), TZ);
    expect(result).toEqual({
      ok: true,
      song: {
        title: "May Ninth",
        artist: ["Khruangbin"],
        start: "2026-09-22T14:30:00-05:00",
        duration: 213_000,
        album: "A LA SALA",
        label: "Dead Oceans",
        artworkUrl: "https://example.test/art.jpg",
      },
    });
  });

  test("falls back to raw title/artist and play duration when no track was matched", () => {
    const result = buildCadenceSong(
      play({ track: undefined, artist: undefined, durationSec: 200 }),
      TZ,
    );
    expect(result).toEqual({
      ok: true,
      song: {
        title: "may ninth",
        artist: ["khruangbin"],
        start: "2026-09-22T14:30:00-05:00",
        duration: 200_000,
      },
    });
  });

  test("fills Apple's {w}x{h} artwork placeholder so Cadence gets a real image URL", () => {
    const templated = "https://is1-ssl.mzstatic.com/image/thumb/abc/%7Bw%7Dx%7Bh%7Dbb.jpg";
    const result = buildCadenceSong(
      play({ track: { displayTitle: "x", durationSec: 10, artworkUrl: templated } }),
      TZ,
    );
    expect(result.ok && result.song.artworkUrl).toBe(
      "https://is1-ssl.mzstatic.com/image/thumb/abc/600x600bb.jpg",
    );
    const literal = "https://example.test/{w}x{h}bb.jpg";
    const result2 = buildCadenceSong(
      play({ track: { displayTitle: "x", durationSec: 10, artworkUrl: literal } }),
      TZ,
    );
    expect(result2.ok && result2.song.artworkUrl).toBe("https://example.test/600x600bb.jpg");
  });

  test("omits album/label/artwork keys entirely when blank", () => {
    const result = buildCadenceSong(
      play({
        track: { displayTitle: "May Ninth", durationSec: 213, recordLabel: "" },
      }),
      TZ,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("album" in result.song).toBe(false);
    expect("label" in result.song).toBe(false);
    expect("artworkUrl" in result.song).toBe(false);
  });

  test("refuses a play with no usable duration — Cadence rejects add-now without one", () => {
    const result = buildCadenceSong(
      play({ durationSec: undefined, track: { displayTitle: "x", durationSec: 0 } }),
      TZ,
    );
    expect(result).toEqual({ ok: false, reason: "no duration" });
  });

  test("refuses a playedAt that can't be rendered as a date", () => {
    expect(buildCadenceSong(play({ playedAt: Number.NaN }), TZ)).toEqual({
      ok: false,
      reason: "invalid playedAt",
    });
    expect(buildCadenceSong(play({ playedAt: 8.64e15 + 1 }), TZ)).toEqual({
      ok: false,
      reason: "invalid playedAt",
    });
  });
});

describe("pickEpisode", () => {
  const episodes: CadenceEpisode[] = [
    {
      episodeId: "morning",
      programName: "88Nine Morning Show",
      startUtc: "2026-09-22T11:00:00Z",
      endUtc: "2026-09-22T15:00:00Z",
    },
    {
      episodeId: "afternoon",
      programName: "88Nine Afternoon Drive",
      startUtc: "2026-09-22T19:00:00Z",
      endUtc: "2026-09-22T23:00:00Z",
    },
  ];

  test("returns the episode whose window contains the play", () => {
    expect(pickEpisode(episodes, PLAYED_AT)?.episodeId).toBe("afternoon");
  });

  test("start is inclusive, end is exclusive", () => {
    expect(pickEpisode(episodes, Date.parse("2026-09-22T19:00:00Z"))?.episodeId).toBe("afternoon");
    expect(pickEpisode(episodes, Date.parse("2026-09-22T15:00:00Z"))).toBeNull();
  });

  test("returns null when nothing is scheduled at that moment", () => {
    expect(pickEpisode(episodes, Date.parse("2026-09-22T16:00:00Z"))).toBeNull();
    expect(pickEpisode([], PLAYED_AT)).toBeNull();
  });
});

describe("localIso", () => {
  test("renders wall-clock time with the zone's offset, CDT and CST", () => {
    expect(localIso(Date.parse("2026-09-22T23:16:04Z"), TZ)).toBe("2026-09-22T18:16:04-05:00");
    expect(localIso(Date.parse("2026-01-15T03:05:09Z"), TZ)).toBe("2026-01-14T21:05:09-06:00");
    expect(localIso(Date.parse("2026-09-22T23:16:04Z"), "UTC")).toBe("2026-09-22T23:16:04+00:00");
  });
});

describe("localDateKey", () => {
  test("renders the channel-local calendar date, not UTC", () => {
    // 2026-09-23T03:30:00Z is still 22:30 on Sep 22 in Chicago (CDT, UTC-5).
    expect(localDateKey(Date.parse("2026-09-23T03:30:00Z"), "America/Chicago")).toBe("2026-09-22");
    expect(localDateKey(Date.parse("2026-09-23T05:30:00Z"), "America/Chicago")).toBe("2026-09-23");
  });
});
