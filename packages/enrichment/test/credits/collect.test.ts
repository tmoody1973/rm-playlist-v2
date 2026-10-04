import { describe, expect, test } from "bun:test";
import { collectTrackCredits } from "../../src/credits/collect";
import { createThrottle } from "../../src/throttle";
import { createMockFetch, type MockFetch, type MockFetchFn, type MockResponseInit } from "../fetch-mock";
import release from "./fixtures/discogs-release.json";
import geniusSearch from "./fixtures/genius-search.json";
import geniusSong from "./fixtures/genius-song.json";
import isrcHit from "./fixtures/mb-isrc.json";
import relations from "./fixtures/mb-relations.json";

type Host = "musicbrainz.org" | "api.discogs.com" | "api.genius.com";

// The three sources run in parallel, so one shared FIFO queue would race. One queue per host instead.
function routeByUrl(): { fetch: MockFetchFn; enqueue(host: Host, init: MockResponseInit): void; calls: MockFetch["calls"] } {
  const mocks: Record<Host, MockFetch> = {
    "musicbrainz.org": createMockFetch(),
    "api.discogs.com": createMockFetch(),
    "api.genius.com": createMockFetch(),
  };
  const calls: MockFetch["calls"] = [];
  const fetch: MockFetchFn = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const host = (Object.keys(mocks) as Host[]).find((candidate) => new URL(url).hostname.endsWith(candidate));
    if (!host) throw new Error(`unrouted url: ${url}`);
    calls.push({ url, headers: {} });
    return mocks[host].fetch(input, init);
  };
  return { fetch, calls, enqueue: (host, init) => mocks[host].enqueue(init) };
}

const fast = () => createThrottle({ ratePerSec: 1000 });
const track = { trackId: "t1", artist: "Ezra Collective", title: "Victory Dance", album: "You Can't Steal My Joy", isrc: "GBBKS2000152", recordingMbid: null, hasAppleMatch: true };
const deps = (fetch: MockFetchFn, geniusToken?: string) =>
  ({ mbThrottle: fast(), discogsThrottle: fast(), geniusThrottle: fast(), discogsAuth: { token: "d" }, geniusToken, fetch, now: () => 1000 });

describe("collectTrackCredits", () => {
  test("ISRC path, all three sources, merged facts and tags", async () => {
    const route = routeByUrl();
    route.enqueue("musicbrainz.org", { status: 200, body: isrcHit });
    route.enqueue("musicbrainz.org", { status: 200, body: relations });
    route.enqueue("api.discogs.com", { status: 200, body: { results: [{ id: 13579, type: "release", title: "x", label: [] }] } });
    route.enqueue("api.discogs.com", { status: 200, body: release });
    route.enqueue("api.genius.com", { status: 200, body: geniusSearch });
    route.enqueue("api.genius.com", { status: 200, body: geniusSong });
    const result = await collectTrackCredits(track, deps(route.fetch, "g"));
    expect(result.creditsStatus).toBe("found");
    expect(result.recordingMbid).toBe("rec-studio");
    expect(result.matchConfidence).toBe("high");
    expect(result.releaseYear).toBe(2019);
    expect(result.cueTags).toContain("horns");
    expect(result.cueTags).toContain("afrobeat");
    const producer = result.facts.find((fact) => fact.value === "Producer Person");
    expect(producer?.sources.map((s) => s.source).sort()).toEqual(["genius", "musicbrainz"]);
  });

  test("no Genius token → Genius skipped, not failed", async () => {
    const route = routeByUrl();
    route.enqueue("musicbrainz.org", { status: 200, body: isrcHit });
    route.enqueue("musicbrainz.org", { status: 200, body: relations });
    route.enqueue("api.discogs.com", { status: 200, body: { results: [] } });
    const result = await collectTrackCredits(track, deps(route.fetch));
    expect(result.creditsStatus).toBe("found");
    expect(route.calls.some((call) => call.url.includes("genius"))).toBe(false);
  });

  test("MusicBrainz 503 twice → error status (keeps old facts upstream)", async () => {
    const route = routeByUrl();
    route.enqueue("musicbrainz.org", { status: 503, headers: { "Retry-After": "0" } });
    route.enqueue("musicbrainz.org", { status: 503, headers: { "Retry-After": "0" } });
    route.enqueue("api.discogs.com", { status: 200, body: { results: [] } });
    const result = await collectTrackCredits(track, deps(route.fetch));
    expect(result.creditsStatus).toBe("error");
  });

  test("nothing anywhere → none", async () => {
    const route = routeByUrl();
    route.enqueue("musicbrainz.org", { status: 404, body: {} });
    route.enqueue("musicbrainz.org", { status: 200, body: { recordings: [] } });
    route.enqueue("api.discogs.com", { status: 200, body: { results: [] } });
    const result = await collectTrackCredits(track, deps(route.fetch));
    expect(result.creditsStatus).toBe("none");
    expect(result.matchConfidence).toBe("low");
  });

  test("Discogs 401 and Genius 403 are transient → error", async () => {
    const route = routeByUrl();
    route.enqueue("musicbrainz.org", { status: 200, body: isrcHit });
    route.enqueue("musicbrainz.org", { status: 200, body: relations });
    route.enqueue("api.discogs.com", { status: 401, body: { message: "unauthorized" } });
    route.enqueue("api.genius.com", { status: 403, body: { error: "forbidden" } });
    const result = await collectTrackCredits(track, deps(route.fetch, "g"));
    expect(result.creditsStatus).toBe("error");
    expect(result.problems).toEqual([]);
  });

  test("a network failure (fetch throws) is transient → error", async () => {
    const route = routeByUrl();
    route.enqueue("musicbrainz.org", { status: 200, body: isrcHit });
    route.enqueue("musicbrainz.org", { status: 200, body: relations });
    route.enqueue("api.discogs.com", { status: 200, body: { results: [] } });
    const fetch: MockFetchFn = (input, init) =>
      String(input instanceof Request ? input.url : input).includes("genius") ? Promise.reject(new TypeError("fetch failed")) : route.fetch(input, init);
    const result = await collectTrackCredits(track, deps(fetch, "g"));
    expect(result.creditsStatus).toBe("error");
  });

  test("a parser exception is a recorded problem, not transient; status comes from the other sources", async () => {
    const route = routeByUrl();
    route.enqueue("musicbrainz.org", { status: 200, body: isrcHit });
    route.enqueue("musicbrainz.org", { status: 200, body: { ...relations, relations: {} } });
    route.enqueue("api.discogs.com", { status: 200, body: { results: [{ id: 13579, type: "release", title: "x", label: [] }] } });
    route.enqueue("api.discogs.com", { status: 200, body: release });
    const result = await collectTrackCredits(track, deps(route.fetch));
    expect(result.creditsStatus).toBe("found");
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toStartWith("musicbrainz:");
  });

  test("an aborted signal (per-track timeout) is transient → error", async () => {
    const route = routeByUrl();
    const result = await collectTrackCredits(track, { ...deps(route.fetch, "g"), signal: AbortSignal.abort() });
    expect(result.creditsStatus).toBe("error");
    expect(route.calls).toHaveLength(0);
  });
});

