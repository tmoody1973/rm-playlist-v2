/**
 * Tests for the enrich-pending-plays orchestrator. Exercises the 4-way
 * decision tree (both-hit / mb-only / am-only / neither) + token-
 * refresh fallback + per-play error isolation without needing the
 * Trigger.dev runtime.
 */

import { describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { enrichBatch, type PendingPlay } from "../../../src/trigger/enrich-pending-plays";
import { createThrottle } from "../src/throttle";
import { createMockFetch } from "./fetch-mock";
import appleHit from "./apple-music/fixtures/search-hit.json";
import appleMiss from "./apple-music/fixtures/search-miss.json";
import mbHit from "./musicbrainz/fixtures/recording-hit.json";
import mbMiss from "./musicbrainz/fixtures/recording-miss.json";
import discogsHit from "./discogs/fixtures/search-hit.json";

/**
 * In-memory fake of ConvexHttpClient. Records each mutation/query call
 * for assertion + returns scripted results for query calls.
 */
class FakeConvexClient {
  public calls: Array<{ kind: "query" | "mutation"; name: string; args: unknown }> = [];
  public queryResults: Map<string, unknown[]> = new Map();
  public mutationReturns: Map<string, unknown[]> = new Map();
  public mutationThrows: Map<string, Error[]> = new Map();

  async query(ref: { name?: string } | unknown, args: unknown): Promise<unknown> {
    const name = nameOf(ref);
    this.calls.push({ kind: "query", name, args });
    const queue = this.queryResults.get(name);
    if (!queue || queue.length === 0) return null;
    return queue.shift() ?? null;
  }

  async mutation(ref: { name?: string } | unknown, args: unknown): Promise<unknown> {
    const name = nameOf(ref);
    this.calls.push({ kind: "mutation", name, args });
    const throwQueue = this.mutationThrows.get(name);
    if (throwQueue && throwQueue.length > 0) {
      throw throwQueue.shift();
    }
    const queue = this.mutationReturns.get(name);
    if (!queue || queue.length === 0) return `${name}:default-id`;
    return queue.shift();
  }

  scriptQuery(name: string, ...results: unknown[]): void {
    this.queryResults.set(name, [...results]);
  }

  scriptMutation(name: string, ...returns: unknown[]): void {
    this.mutationReturns.set(name, [...returns]);
  }

  scriptMutationThrow(name: string, err: Error): void {
    const existing = this.mutationThrows.get(name) ?? [];
    existing.push(err);
    this.mutationThrows.set(name, existing);
  }

  mutationCalls(name: string): Array<Record<string, unknown>> {
    return this.calls
      .filter((c) => c.kind === "mutation" && c.name === name)
      .map((c) => c.args as Record<string, unknown>);
  }
}

function nameOf(ref: unknown): string {
  try {
    return getFunctionName(ref as never);
  } catch {
    return String(ref);
  }
}

function play(id: string, artist = "D'Angelo", title = "She's Always in My Hair"): PendingPlay {
  return { _id: id, artistRaw: artist, titleRaw: title };
}

// The ConvexHttpClient interface the orchestrator requires isn't the
// full library type — cast through `unknown` so the FakeConvexClient
// structural match passes without drag.
function fake(c: FakeConvexClient): unknown {
  return c;
}

const fastThrottle = () => createThrottle({ ratePerSec: 1000 });

describe("enrichBatch — happy paths", () => {
  test("MB hit + AM hit → upsertArtistByMbid + upsertTrack + markPlayEnriched", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: appleHit });
    mock.enqueue({ status: 200, body: mbHit });
    const client = new FakeConvexClient();
    client.scriptMutation("enrichment:upsertArtistByMbid", "artist_123");
    client.scriptMutation("enrichment:upsertTrack", "track_456");

    const summary = await enrichBatch({
      client: fake(client) as never,
      pending: [play("p1")],
      appleMusicToken: "jwt",
      throttle: fastThrottle(),
      fetch: mock.fetch,
    });

    expect(summary.resolved).toBe(1);
    expect(summary.partial).toBe(0);
    expect(summary.unresolved).toBe(0);

    const markedCalls = client.mutationCalls("enrichment:markPlayEnriched");
    expect(markedCalls.length).toBe(1);
    expect(markedCalls[0]?.canonicalArtistId).toBe("artist_123");
    expect(markedCalls[0]?.canonicalTrackId).toBe("track_456");

    const trackCalls = client.mutationCalls("enrichment:upsertTrack");
    expect(trackCalls.length).toBe(1);
    expect(trackCalls[0]?.recordLabel).toBe("Virgin Records");
    expect(trackCalls[0]?.isrc).toBe("USVR29500142");
    expect(trackCalls[0]?.durationSec).toBe(290);
    expect(trackCalls[0]?.albumDisplayName).toBe("Brown Sugar (Deluxe Edition)");
  });

  test("falls back to Discogs label when Apple returns no recordLabel", async () => {
    const mock = createMockFetch();
    // AM response without recordLabel — simulate Apple's common null case
    const appleNoLabel = structuredClone(appleHit);
    // @ts-expect-error Known fixture shape
    delete appleNoLabel.results.songs.data[0].attributes.recordLabel;
    mock.enqueue({ status: 200, body: appleNoLabel });
    mock.enqueue({ status: 200, body: mbHit });
    mock.enqueue({ status: 200, body: discogsHit });

    const client = new FakeConvexClient();
    client.scriptMutation("enrichment:upsertArtistByMbid", "artist_d");
    client.scriptMutation("enrichment:upsertTrack", "track_d");

    const summary = await enrichBatch({
      client: fake(client) as never,
      pending: [play("p_disc")],
      appleMusicToken: "jwt",
      throttle: fastThrottle(),
      discogsThrottle: fastThrottle(),
      fetch: mock.fetch,
    });

    expect(summary.resolved).toBe(1);
    const trackCalls = client.mutationCalls("enrichment:upsertTrack");
    expect(trackCalls[0]?.recordLabel).toBe("EMI");
  });

  test("does not call Discogs when Apple already supplied recordLabel", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: appleHit });
    mock.enqueue({ status: 200, body: mbHit });
    // Intentionally no Discogs response queued — calling it would throw "mock exhausted"
    const client = new FakeConvexClient();
    client.scriptMutation("enrichment:upsertArtistByMbid", "artist_a");
    client.scriptMutation("enrichment:upsertTrack", "track_a");

    const summary = await enrichBatch({
      client: fake(client) as never,
      pending: [play("p_nodiscogs")],
      appleMusicToken: "jwt",
      throttle: fastThrottle(),
      discogsThrottle: fastThrottle(),
      fetch: mock.fetch,
    });

    expect(summary.resolved).toBe(1);
    const discogsCalls = mock.calls.filter((c) => c.url.includes("discogs.com"));
    expect(discogsCalls.length).toBe(0);
  });

  test("MB hit, AM miss → upsertArtistByMbid + markPlayEnriched WITHOUT canonicalTrackId", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: appleMiss });
    mock.enqueue({ status: 200, body: mbHit });
    const client = new FakeConvexClient();
    client.scriptMutation("enrichment:upsertArtistByMbid", "artist_mb_only");

    const summary = await enrichBatch({
      client: fake(client) as never,
      pending: [play("p2")],
      appleMusicToken: "jwt",
      throttle: fastThrottle(),
      fetch: mock.fetch,
    });

    expect(summary.partial).toBe(1);
    expect(summary.resolved).toBe(0);

    const markedCalls = client.mutationCalls("enrichment:markPlayEnriched");
    expect(markedCalls.length).toBe(1);
    expect(markedCalls[0]?.canonicalArtistId).toBe("artist_mb_only");
    expect(markedCalls[0]?.canonicalTrackId).toBeUndefined();

    const trackCalls = client.mutationCalls("enrichment:upsertTrack");
    expect(trackCalls.length).toBe(0);
  });
});

describe("enrichBatch — miss paths", () => {
  test("MB miss, AM hit → markPlayUnresolved with reason mb_miss", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: appleHit });
    mock.enqueue({ status: 200, body: mbMiss });
    const client = new FakeConvexClient();

    const summary = await enrichBatch({
      client: fake(client) as never,
      pending: [play("p3")],
      appleMusicToken: "jwt",
      throttle: fastThrottle(),
      fetch: mock.fetch,
    });

    expect(summary.unresolved).toBe(1);
    const calls = client.mutationCalls("enrichment:markPlayUnresolved");
    expect(calls.length).toBe(1);
    expect(calls[0]?.reason).toBe("mb_miss");
  });

  test("Both miss → markPlayUnresolved with reason no_match", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: appleMiss });
    mock.enqueue({ status: 200, body: mbMiss });
    const client = new FakeConvexClient();

    const summary = await enrichBatch({
      client: fake(client) as never,
      pending: [play("p4")],
      appleMusicToken: "jwt",
      throttle: fastThrottle(),
      fetch: mock.fetch,
    });

    expect(summary.unresolved).toBe(1);
    const calls = client.mutationCalls("enrichment:markPlayUnresolved");
    expect(calls.length).toBe(1);
    expect(calls[0]?.reason).toBe("no_match");
  });
});

describe("enrichBatch — token refresh", () => {
  test("null token → onTokenRefreshNeeded fires, batch skipped", async () => {
    const client = new FakeConvexClient();
    let refreshed = 0;
    const summary = await enrichBatch({
      client: fake(client) as never,
      pending: [play("p5"), play("p6")],
      appleMusicToken: null,
      throttle: fastThrottle(),
      onTokenRefreshNeeded: () => {
        refreshed += 1;
      },
    });
    expect(refreshed).toBe(1);
    expect(summary.skipped).toBe(true);
    expect(summary.reason).toBe("token_refresh");
    expect(summary.total).toBe(2);
    expect(client.calls.length).toBe(0);
  });

  test("empty pending list with token → no-op, no writes", async () => {
    const client = new FakeConvexClient();
    const summary = await enrichBatch({
      client: fake(client) as never,
      pending: [],
      appleMusicToken: "jwt",
      throttle: fastThrottle(),
    });
    expect(summary.total).toBe(0);
    expect(summary.skipped).toBeUndefined();
    expect(client.calls.length).toBe(0);
  });
});

describe("enrichBatch — transient Apple errors (defer, don't mark unresolved)", () => {
  test("Apple 401 → deferred, batch aborts, onTokenRefreshNeeded fires", async () => {
    const mock = createMockFetch();
    // Play 1: Apple 401, MB miss → deferred, abort batch
    mock.enqueue({ status: 401, body: { errors: [{ status: 401 }] } });
    mock.enqueue({ status: 200, body: mbMiss });
    // Play 2 is in the batch but should never hit the network because
    // the Apple 401 aborts the loop.
    const client = new FakeConvexClient();
    let refreshed = 0;

    const summary = await enrichBatch({
      client: fake(client) as never,
      pending: [play("p_401_1"), play("p_401_2")],
      appleMusicToken: "jwt",
      throttle: fastThrottle(),
      fetch: mock.fetch,
      onTokenRefreshNeeded: () => {
        refreshed += 1;
      },
    });

    expect(refreshed).toBe(1);
    expect(summary.deferred).toBe(2);
    expect(summary.unresolved).toBe(0);
    expect(summary.reason).toBe("token_expired_mid_batch");

    // Critical: do NOT write markPlayUnresolved for transient errors.
    expect(client.mutationCalls("enrichment:markPlayUnresolved").length).toBe(0);
    // Play 2 must not have triggered any network call (batch aborted).
    const apple2Calls = mock.calls.filter((c) => c.url.includes("api.music.apple.com"));
    expect(apple2Calls.length).toBe(1);
  });

  test("Apple 429 + MB miss → deferred (no markUnresolved), but batch continues", async () => {
    const mock = createMockFetch();
    // Play 1: Apple 429 rate_limited + MB miss → defer (no abort, no refresh)
    mock.enqueue({ status: 429, body: { errors: [{ status: 429 }] } });
    mock.enqueue({ status: 200, body: mbMiss });
    // Play 2: both succeed
    mock.enqueue({ status: 200, body: appleHit });
    mock.enqueue({ status: 200, body: mbHit });
    const client = new FakeConvexClient();
    client.scriptMutation("enrichment:upsertArtistByMbid", "artist_ok");
    client.scriptMutation("enrichment:upsertTrack", "track_ok");
    let refreshed = 0;

    const summary = await enrichBatch({
      client: fake(client) as never,
      pending: [play("p_429"), play("p_ok")],
      appleMusicToken: "jwt",
      throttle: fastThrottle(),
      fetch: mock.fetch,
      onTokenRefreshNeeded: () => {
        refreshed += 1;
      },
    });

    expect(refreshed).toBe(0);
    expect(summary.deferred).toBe(1);
    expect(summary.resolved).toBe(1);
    expect(summary.unresolved).toBe(0);
    expect(client.mutationCalls("enrichment:markPlayUnresolved").length).toBe(0);
  });
});

describe("enrichBatch — error isolation", () => {
  test("per-play upsert failure does not abort batch", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: appleHit });
    mock.enqueue({ status: 200, body: mbHit });
    mock.enqueue({ status: 200, body: appleHit });
    mock.enqueue({ status: 200, body: mbHit });
    const client = new FakeConvexClient();
    client.scriptMutationThrow(
      "enrichment:upsertArtistByMbid",
      new Error("transient convex outage"),
    );
    client.scriptMutation("enrichment:upsertArtistByMbid", "artist_ok");
    client.scriptMutation("enrichment:upsertTrack", "track_ok");
    const logs: string[] = [];

    const summary = await enrichBatch({
      client: fake(client) as never,
      pending: [play("p_err"), play("p_ok")],
      appleMusicToken: "jwt",
      throttle: fastThrottle(),
      fetch: mock.fetch,
      log: (msg) => logs.push(msg),
    });

    expect(summary.errored).toBe(1);
    expect(summary.resolved).toBe(1);
    expect(logs.some((l) => l.includes("p_err"))).toBe(true);
  });
});
