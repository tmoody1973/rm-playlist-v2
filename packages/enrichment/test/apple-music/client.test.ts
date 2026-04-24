import { describe, expect, test } from "bun:test";
import { AppleMusicError, searchSong } from "../../src/apple-music/client";
import { lookupAppleMusic } from "../../src/apple-music";
import { createMockFetch } from "../fetch-mock";
import searchHit from "./fixtures/search-hit.json";
import searchMiss from "./fixtures/search-miss.json";
import searchNoPreview from "./fixtures/search-no-preview.json";

describe("searchSong", () => {
  test("normalizes a hit into { songId, name, artistName, ... }", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: searchHit });
    const song = await searchSong({
      artist: "D'Angelo",
      title: "She's Always in My Hair",
      token: "jwt",
      fetch: mock.fetch,
    });
    expect(song).not.toBeNull();
    expect(song?.songId).toBe("1440831078");
    expect(song?.artistName).toBe("D'Angelo");
    expect(song?.artistAppleMusicId).toBe("80254394");
    expect(song?.albumName).toBe("Brown Sugar (Deluxe Edition)");
    expect(song?.recordLabel).toBe("Virgin Records");
    expect(song?.isrc).toBe("USVR29500142");
    expect(song?.durationSec).toBe(290);
    expect(song?.previewUrl).toContain("audio-ssl.itunes.apple.com");
    expect(song?.artworkUrl).toContain("{w}x{h}");
  });

  test("request URL asks Apple for artist relationships inline", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: searchHit });
    await searchSong({
      artist: "x",
      title: "y",
      token: "jwt",
      fetch: mock.fetch,
    });
    const decoded = decodeURIComponent(mock.calls[0]?.url ?? "");
    expect(decoded).toContain("include[songs]=artists");
  });

  test("returns null on zero-result search (not an error)", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: searchMiss });
    const song = await searchSong({ artist: "X", title: "Y", token: "jwt", fetch: mock.fetch });
    expect(song).toBeNull();
  });

  test("normalizes hit without previewUrl gracefully", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: searchNoPreview });
    const song = await searchSong({ artist: "X", title: "Y", token: "jwt", fetch: mock.fetch });
    expect(song?.songId).toBe("9999999");
    expect(song?.previewUrl).toBeUndefined();
  });

  test("sends Bearer token + product User-Agent", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: searchMiss });
    await searchSong({ artist: "X", title: "Y", token: "my-jwt-token", fetch: mock.fetch });
    const call = mock.calls[0];
    expect(call?.headers["authorization"]).toBe("Bearer my-jwt-token");
    expect(call?.headers["user-agent"]).toContain("rm-playlist-v2");
  });

  test("URL-encodes artist + title in query", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: searchMiss });
    await searchSong({ artist: "Blood, Sweat & Tears", title: "And When I Die", token: "t", fetch: mock.fetch });
    expect(mock.calls[0]?.url).toContain("Blood%2C%20Sweat%20%26%20Tears");
  });

  test.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [429, "rate_limited"],
    [503, "upstream_5xx"],
    [500, "upstream_5xx"],
    [418, "other"],
  ])("throws AppleMusicError with code for status %i", async (status, code) => {
    const mock = createMockFetch();
    mock.enqueue({ status, body: "err" });
    await expect(
      searchSong({ artist: "a", title: "b", token: "t", fetch: mock.fetch }),
    ).rejects.toMatchObject({ name: "AppleMusicError", code });
  });
});

describe("lookupAppleMusic adapter", () => {
  test("returns { matched: true, ... } on hit", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: searchHit });
    const result = await lookupAppleMusic(
      { artist: "D'Angelo", title: "She's Always in My Hair" },
      { token: "jwt", fetch: mock.fetch },
    );
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.songId).toBe("1440831078");
      expect(result.artistName).toBe("D'Angelo");
    }
  });

  test("returns { matched: false, reason: 'no_results' } on miss", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: searchMiss });
    const result = await lookupAppleMusic({ artist: "X", title: "Y" }, { token: "jwt", fetch: mock.fetch });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe("no_results");
  });

  test("adapter never throws — 429 becomes { matched: false, reason: 'rate_limited' }", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 429, body: "slow down" });
    const result = await lookupAppleMusic({ artist: "a", title: "b" }, { token: "jwt", fetch: mock.fetch });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe("rate_limited");
  });

  test("adapter never throws — 401 becomes { matched: false, reason: 'unauthorized' }", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 401, body: "bad token" });
    const result = await lookupAppleMusic({ artist: "a", title: "b" }, { token: "jwt", fetch: mock.fetch });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe("unauthorized");
  });
});

describe("AppleMusicError", () => {
  test("carries code, status, name", () => {
    const err = new AppleMusicError("rate_limited", 429, "too fast");
    expect(err.code).toBe("rate_limited");
    expect(err.status).toBe(429);
    expect(err.name).toBe("AppleMusicError");
  });
});
