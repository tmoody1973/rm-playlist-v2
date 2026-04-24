import { describe, expect, test } from "bun:test";
import {
  MusicBrainzError,
  lookupLabelByRecording,
  normalizeArtistForMb,
  normalizeTitleForMb,
  searchRecording,
} from "../../src/musicbrainz/client";
import { lookupMusicBrainz } from "../../src/musicbrainz";
import { createThrottle } from "../../src/throttle";
import { createMockFetch } from "../fetch-mock";
import recordingHit from "./fixtures/recording-hit.json";
import recordingLowScore from "./fixtures/recording-low-score.json";
import recordingMiss from "./fixtures/recording-miss.json";

const fastThrottle = () => createThrottle({ ratePerSec: 1000 });

describe("searchRecording", () => {
  test("normalizes a hit with score, MBIDs, names", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: recordingHit });
    const results = await searchRecording({
      artist: "D'Angelo",
      title: "She's Always in My Hair",
      throttle: fastThrottle(),
      fetch: mock.fetch,
    });
    expect(results.length).toBe(1);
    expect(results[0]?.recordingMbid).toBe("b1a9c0e8-4b2c-4d3e-8a5f-6c7d8e9f0a1b");
    expect(results[0]?.artistMbid).toBe("f89eb5ff-2d2a-4a3c-9d27-7b0e9d9bafb0");
    expect(results[0]?.score).toBe(100);
  });

  test("returns [] on zero-result search", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: recordingMiss });
    const results = await searchRecording({
      artist: "X",
      title: "Y",
      throttle: fastThrottle(),
      fetch: mock.fetch,
    });
    expect(results).toEqual([]);
  });

  test("sends polite User-Agent matching MB policy", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: recordingMiss });
    await searchRecording({ artist: "a", title: "b", throttle: fastThrottle(), fetch: mock.fetch });
    const ua = mock.calls[0]?.headers["user-agent"] ?? "";
    expect(ua).toMatch(/rm-playlist-v2/);
    expect(ua).toMatch(/@/);
  });

  test("Lucene query escapes quotes and backslashes", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: recordingMiss });
    await searchRecording({
      artist: 'The "Quoted" Band',
      title: "Back\\Slash",
      throttle: fastThrottle(),
      fetch: mock.fetch,
    });
    const url = mock.calls[0]?.url ?? "";
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('recording:"Back\\\\Slash"');
    expect(decoded).toContain('artist:"The \\"Quoted\\" Band"');
  });

  test("acquires throttle before fetching", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: recordingMiss });
    let acquired = 0;
    const countingThrottle = {
      acquire: async () => {
        acquired++;
      },
    };
    await searchRecording({ artist: "a", title: "b", throttle: countingThrottle, fetch: mock.fetch });
    expect(acquired).toBe(1);
  });

  test("retries once on 503, respecting Retry-After", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 503, headers: { "Retry-After": "1" }, body: "try later" });
    mock.enqueue({ status: 200, body: recordingMiss });
    const started = Date.now();
    const result = await searchRecording({
      artist: "a",
      title: "b",
      throttle: fastThrottle(),
      fetch: mock.fetch,
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(result).toEqual([]);
    expect(mock.calls.length).toBe(2);
  });

  test("throws typed error on non-503 failure", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 500, body: "internal error" });
    await expect(
      searchRecording({ artist: "a", title: "b", throttle: fastThrottle(), fetch: mock.fetch }),
    ).rejects.toMatchObject({ name: "MusicBrainzError", code: "upstream_5xx" });
  });
});

describe("lookupMusicBrainz adapter", () => {
  test("returns matched: true above score threshold", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: recordingHit });
    const result = await lookupMusicBrainz(
      { artist: "D'Angelo", title: "She's Always in My Hair" },
      { throttle: fastThrottle(), fetch: mock.fetch },
    );
    expect(result.matched).toBe(true);
  });

  test("returns matched: false, reason 'below_threshold' for low-score hits", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: recordingLowScore });
    const result = await lookupMusicBrainz(
      { artist: "X", title: "Y" },
      { throttle: fastThrottle(), fetch: mock.fetch },
    );
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe("below_threshold");
  });

  test("returns matched: false, reason 'no_results' on empty response", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: recordingMiss });
    const result = await lookupMusicBrainz(
      { artist: "X", title: "Y" },
      { throttle: fastThrottle(), fetch: mock.fetch },
    );
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe("no_results");
  });

  test("adapter never throws on rate_limited — returns typed miss", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 429, body: "nope" });
    const result = await lookupMusicBrainz(
      { artist: "a", title: "b" },
      { throttle: fastThrottle(), fetch: mock.fetch },
    );
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe("rate_limited");
  });

  test("respects custom minScore", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: recordingLowScore });
    const result = await lookupMusicBrainz(
      { artist: "X", title: "Y" },
      { throttle: fastThrottle(), fetch: mock.fetch, minScore: 50 },
    );
    expect(result.matched).toBe(true);
  });
});

describe("MusicBrainzError", () => {
  test("carries code, status, name", () => {
    const err = new MusicBrainzError("rate_limited", 429, "x");
    expect(err.code).toBe("rate_limited");
    expect(err.status).toBe(429);
    expect(err.name).toBe("MusicBrainzError");
  });
});

describe("lookupLabelByRecording", () => {
  test("returns the first label name from the first release with labels", async () => {
    const mock = createMockFetch();
    mock.enqueue({
      status: 200,
      body: {
        releases: [
          { "label-info": [] },
          {
            "label-info": [
              { label: { name: "Ruthless Records" } },
              { label: { name: "Priority Records" } },
            ],
          },
        ],
      },
    });
    const label = await lookupLabelByRecording({
      recordingMbid: "aaaabbbb-cccc-dddd-eeee-ffff00001111",
      throttle: fastThrottle(),
      fetch: mock.fetch,
    });
    expect(label).toBe("Ruthless Records");
    const url = mock.calls[0]?.url ?? "";
    expect(url).toContain("/release?recording=aaaabbbb-cccc-dddd-eeee-ffff00001111");
    expect(url).toContain("inc=labels");
  });

  test("returns null when no release has a label", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: { releases: [{ "label-info": [] }] } });
    const label = await lookupLabelByRecording({
      recordingMbid: "m",
      throttle: fastThrottle(),
      fetch: mock.fetch,
    });
    expect(label).toBeNull();
  });

  test("returns null when no releases at all", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: {} });
    const label = await lookupLabelByRecording({
      recordingMbid: "m",
      throttle: fastThrottle(),
      fetch: mock.fetch,
    });
    expect(label).toBeNull();
  });

  test("throws MusicBrainzError on upstream 5xx", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 502, body: "upstream" });
    await expect(
      lookupLabelByRecording({
        recordingMbid: "m",
        throttle: fastThrottle(),
        fetch: mock.fetch,
      }),
    ).rejects.toMatchObject({ name: "MusicBrainzError", code: "upstream_5xx" });
  });

  test("acquires throttle before HTTP call", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: { releases: [] } });
    let acquired = 0;
    const counting = { acquire: async () => { acquired++; } };
    await lookupLabelByRecording({
      recordingMbid: "m",
      throttle: counting,
      fetch: mock.fetch,
    });
    expect(acquired).toBe(1);
  });
});

describe("normalizeArtistForMb", () => {
  test.each([
    ["4hero, Carina Andersson", "4hero"],
    ["Buddy feat. A$AP Ferg", "Buddy"],
    ["Buddy Feat. A$AP Ferg", "Buddy"],
    ["Buddy featuring A$AP Ferg", "Buddy"],
    ["Artist A & Artist B", "Artist A"],
    ["Kendrick Lamar with SZA", "Kendrick Lamar"],
    ["D'Angelo", "D'Angelo"],
    ["", ""],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeArtistForMb(input)).toBe(expected);
  });
});

describe("normalizeTitleForMb", () => {
  test.each([
    ["Black (feat. A$AP Ferg)", "Black"],
    ["Mysterious Girl (Radio Edit)", "Mysterious Girl"],
    ["Delfonics Theme (How Could You)", "Delfonics Theme"],
    ["Song (Extended Mix)", "Song"],
    ["Song (Live)", "Song"],
    ["Song (Remastered)", "Song"],
    ["Plain Title", "Plain Title"],
    ["Title With (Subtitle) In Middle", "Title With (Subtitle) In Middle"],
    ["", ""],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeTitleForMb(input)).toBe(expected);
  });
});
