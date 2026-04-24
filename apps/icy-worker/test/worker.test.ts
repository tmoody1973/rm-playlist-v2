import { describe, expect, test } from "bun:test";
import type { NormalizedPlay } from "@rm/types";
import { runWorker } from "../src/worker";
import { startMockIcyServer } from "./mock-icy-server";

const allowAll = () => ({ allowed: true as const });

describe("runWorker — end-to-end", () => {
  test("pipes metadata through icyAdapter and emits NormalizedPlay", async () => {
    const server = await startMockIcyServer({
      metaint: 32,
      metadataBlocks: ["StreamTitle='Kendrick Lamar - HUMBLE.';"],
    });
    try {
      const plays: NormalizedPlay[] = [];
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 400);
      await runWorker({
        stationSlug: "rhythmlab",
        streamUrl: server.url,
        signal: controller.signal,
        ssrfCheck: allowAll,
        onPlay: (p) => plays.push(p),
      }).catch(() => {});
      expect(plays.length).toBeGreaterThan(0);
      expect(plays[0]?.artistRaw).toBe("Kendrick Lamar");
      expect(plays[0]?.titleRaw).toBe("HUMBLE.");
      expect(plays[0]?.source).toBe("icy");
      expect(plays[0]?.stationSlug).toBe("rhythmlab");
    } finally {
      await server.stop();
    }
  });

  test("SSRF-rejected URL throws before any HTTP call", async () => {
    await expect(
      runWorker({
        stationSlug: "rhythmlab",
        streamUrl: "http://169.254.169.254/latest/meta-data/",
      }),
    ).rejects.toThrow(/SSRF/);
  });

  test("abandons after consecutive 4xx responses hit the ceiling", async () => {
    const server = await startMockIcyServer({
      metaint: 16,
      metadataBlocks: [],
      status: 404,
    });
    try {
      await expect(
        runWorker({
          stationSlug: "rhythmlab",
          streamUrl: server.url,
          fourXxRetryCeiling: 2,
          ssrfCheck: allowAll,
        }),
      ).rejects.toMatchObject({ code: "http_4xx" });
    } finally {
      await server.stop();
    }
  });
});
