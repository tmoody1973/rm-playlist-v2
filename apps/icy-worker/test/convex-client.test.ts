import { describe, expect, test } from "bun:test";
import type { ConvexGateway } from "../src/convex-client";
import { FakeGateway } from "./fake-gateway";

describe("ConvexGateway contract (fake implementation)", () => {
  test("writePlay returns { inserted: true } on new play", async () => {
    const gw: ConvexGateway = new FakeGateway();
    const result = await gw.writePlay("src_1", {
      stationSlug: "rhythmlab",
      source: "icy",
      artistRaw: "Artist",
      titleRaw: "Title",
      playedAt: 1_700_000_000_000,
      raw: {},
    });
    expect(result.inserted).toBe(true);
  });

  test("writePlay returns { inserted: false, reason: 'duplicate' } on repeat", async () => {
    const gw = new FakeGateway();
    gw.duplicatePlayedAt.add(1_700_000_000_000);
    const result = await gw.writePlay("src_1", {
      stationSlug: "rhythmlab",
      source: "icy",
      artistRaw: "Artist",
      titleRaw: "Title",
      playedAt: 1_700_000_000_000,
      raw: {},
    });
    expect(result.inserted).toBe(false);
    if (result.inserted === false) expect(result.reason).toBe("duplicate");
  });

  test("writePlay returns { inserted: false, reason: 'unknown_source' } for bad id", async () => {
    const gw = new FakeGateway();
    gw.unknownSourceIds.add("phantom");
    const result = await gw.writePlay("phantom", {
      stationSlug: "rhythmlab",
      source: "icy",
      artistRaw: "Artist",
      titleRaw: "Title",
      playedAt: 1,
      raw: {},
    });
    expect(result.inserted).toBe(false);
    if (result.inserted === false) expect(result.reason).toBe("unknown_source");
  });

  test("listIcySources returns scripted list", async () => {
    const gw = new FakeGateway();
    gw.sources = [
      { _id: "a", stationSlug: "rhythmlab", role: "primary", streamUrl: "http://x/live" },
      { _id: "b", stationSlug: "hyfin", role: "shadow", streamUrl: "http://y/live" },
    ];
    const rows = await gw.listIcySources();
    expect(rows.length).toBe(2);
    expect(rows[0]?._id).toBe("a");
  });
});
