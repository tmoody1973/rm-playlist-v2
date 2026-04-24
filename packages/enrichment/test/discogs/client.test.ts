import { describe, expect, test } from "bun:test";
import { DiscogsError, searchRelease } from "../../src/discogs/client";
import { lookupDiscogs } from "../../src/discogs";
import { createThrottle } from "../../src/throttle";
import { createMockFetch } from "../fetch-mock";
import searchHit from "./fixtures/search-hit.json";
import searchMiss from "./fixtures/search-miss.json";

const fastThrottle = () => createThrottle({ ratePerSec: 1000 });

describe("searchRelease", () => {
  test("normalizes releases with labels, year, country", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: searchHit });
    const results = await searchRelease({
      artist: "D'Angelo",
      album: "Brown Sugar",
      throttle: fastThrottle(),
      fetch: mock.fetch,
    });
    expect(results.length).toBe(2);
    expect(results[0]?.discogsReleaseId).toBe(1234567);
    expect(results[0]?.labels).toEqual(["EMI", "Virgin Records"]);
    expect(results[0]?.year).toBe("1995");
    expect(results[0]?.country).toBe("US");
  });

  test("dedupes label arrays (Discogs often returns repeats)", async () => {
    const mock = createMockFetch();
    mock.enqueue({
      status: 200,
      body: {
        results: [
          {
            id: 1,
            type: "release",
            title: "x",
            label: ["EMI", "EMI", "EMI Records Ltd.", "EMI Records Ltd."],
          },
        ],
      },
    });
    const r = await searchRelease({ artist: "x", album: "y", throttle: fastThrottle(), fetch: mock.fetch });
    expect(r[0]?.labels).toEqual(["EMI", "EMI Records Ltd."]);
  });

  test("filters out non-release rows (artists, masters)", async () => {
    const mock = createMockFetch();
    mock.enqueue({
      status: 200,
      body: {
        results: [
          { id: 1, type: "artist", title: "D'Angelo" },
          { id: 2, type: "master", title: "Brown Sugar", label: ["Virgin"] },
          { id: 3, type: "release", title: "Brown Sugar", label: ["EMI"] },
        ],
      },
    });
    const r = await searchRelease({ artist: "x", album: "y", throttle: fastThrottle(), fetch: mock.fetch });
    expect(r.length).toBe(1);
    expect(r[0]?.discogsReleaseId).toBe(3);
  });

  test("sends User-Agent + Accept JSON headers", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: searchMiss });
    await searchRelease({ artist: "x", album: "y", throttle: fastThrottle(), fetch: mock.fetch });
    const call = mock.calls[0];
    expect(call?.headers["user-agent"]).toContain("rm-playlist-v2");
    expect(call?.headers["accept"]).toBe("application/json");
  });

  test("URL carries artist + release_title + type=release", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: searchMiss });
    await searchRelease({
      artist: "D'Angelo",
      album: "Brown Sugar",
      throttle: fastThrottle(),
      fetch: mock.fetch,
    });
    // URLSearchParams encodes spaces as `+`, not `%20`
    const decoded = decodeURIComponent(mock.calls[0]?.url ?? "");
    expect(decoded).toContain("type=release");
    expect(decoded).toContain("artist=D'Angelo");
    expect(decoded).toContain("release_title=Brown+Sugar");
  });

  test("appends token query param when provided", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: searchMiss });
    await searchRelease({
      artist: "x",
      album: "y",
      throttle: fastThrottle(),
      fetch: mock.fetch,
      token: "SECRET_TOKEN_123",
    });
    expect(mock.calls[0]?.url).toContain("token=SECRET_TOKEN_123");
  });

  test("acquires throttle before HTTP call", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: searchMiss });
    let acquired = 0;
    const counting = { acquire: async () => { acquired++; } };
    await searchRelease({ artist: "x", album: "y", throttle: counting, fetch: mock.fetch });
    expect(acquired).toBe(1);
  });

  test.each([
    [429, "rate_limited"],
    [500, "upstream_5xx"],
    [502, "upstream_5xx"],
    [400, "other"],
  ])("classifies status %i as %s", async (status, code) => {
    const mock = createMockFetch();
    mock.enqueue({ status, body: "err" });
    await expect(
      searchRelease({ artist: "x", album: "y", throttle: fastThrottle(), fetch: mock.fetch }),
    ).rejects.toMatchObject({ name: "DiscogsError", code });
  });
});

describe("lookupDiscogs", () => {
  test("returns { matched: true, label } on hit", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: searchHit });
    const r = await lookupDiscogs(
      { artist: "D'Angelo", album: "Brown Sugar" },
      { throttle: fastThrottle(), fetch: mock.fetch },
    );
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(r.label).toBe("EMI");
      expect(r.labels).toEqual(["EMI", "Virgin Records"]);
      expect(r.releaseId).toBe(1234567);
    }
  });

  test("empty album hint short-circuits", async () => {
    const mock = createMockFetch();
    const r = await lookupDiscogs(
      { artist: "x", album: "   " },
      { throttle: fastThrottle(), fetch: mock.fetch },
    );
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.reason).toBe("no_album_hint");
    expect(mock.calls.length).toBe(0);
  });

  test("zero-result search → no_results", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: searchMiss });
    const r = await lookupDiscogs(
      { artist: "obscure", album: "unknown" },
      { throttle: fastThrottle(), fetch: mock.fetch },
    );
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.reason).toBe("no_results");
  });

  test("adapter never throws — 429 becomes matched:false", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 429, body: "slow" });
    const r = await lookupDiscogs(
      { artist: "x", album: "y" },
      { throttle: fastThrottle(), fetch: mock.fetch },
    );
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.reason).toBe("rate_limited");
  });

  test("release with empty label array → no_results", async () => {
    const mock = createMockFetch();
    mock.enqueue({
      status: 200,
      body: { results: [{ id: 42, type: "release", title: "x", label: [] }] },
    });
    const r = await lookupDiscogs(
      { artist: "x", album: "y" },
      { throttle: fastThrottle(), fetch: mock.fetch },
    );
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.reason).toBe("no_results");
  });
});

describe("DiscogsError", () => {
  test("carries code, status, name", () => {
    const err = new DiscogsError("rate_limited", 429, "x");
    expect(err.code).toBe("rate_limited");
    expect(err.status).toBe(429);
    expect(err.name).toBe("DiscogsError");
  });
});
