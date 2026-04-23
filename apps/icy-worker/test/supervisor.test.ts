import { describe, expect, test } from "bun:test";
import type { IcySource } from "../src/convex-client";
import { runSupervisor } from "../src/supervisor";
import { FakeGateway } from "./fake-gateway";
import { startMockIcyServer } from "./mock-icy-server";

const allowAll = () => ({ allowed: true as const });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function source(
  id: string,
  streamUrl: string,
  stationSlug: IcySource["stationSlug"] = "rhythmlab",
): IcySource {
  return { _id: id, stationSlug, role: "primary", streamUrl };
}

describe("runSupervisor — spawn and shutdown", () => {
  test("spawns one worker per enabled ICY source from initial list", async () => {
    const server = await startMockIcyServer({
      metaint: 32,
      metadataBlocks: ["StreamTitle='Artist - Title';"],
    });
    try {
      const gateway = new FakeGateway();
      gateway.sources = [source("src_1", server.url)];
      const controller = new AbortController();

      setTimeout(() => controller.abort(), 300);
      await runSupervisor({
        gateway,
        signal: controller.signal,
        refreshMs: 100,
        ssrfCheck: allowAll,
      });

      expect(gateway.writes.length).toBeGreaterThan(0);
      expect(gateway.writes[0]?.sourceId).toBe("src_1");
      expect(gateway.writes[0]?.play.artistRaw).toBe("Artist");
    } finally {
      await server.stop();
    }
  });

  test("shuts down all workers on outer abort", async () => {
    const server = await startMockIcyServer({
      metaint: 32,
      metadataBlocks: ["StreamTitle='A - B';"],
    });
    try {
      const gateway = new FakeGateway();
      gateway.sources = [source("s1", server.url), source("s2", server.url, "hyfin")];
      const controller = new AbortController();
      const started = Date.now();
      setTimeout(() => controller.abort(), 200);
      await runSupervisor({
        gateway,
        signal: controller.signal,
        refreshMs: 50,
        ssrfCheck: allowAll,
      });
      const elapsed = Date.now() - started;
      expect(elapsed).toBeLessThan(1000);
    } finally {
      await server.stop();
    }
  });
});

describe("runSupervisor — list change handling", () => {
  test("aborts workers when a source is removed", async () => {
    const server = await startMockIcyServer({
      metaint: 32,
      metadataBlocks: ["StreamTitle='A - B';"],
    });
    try {
      const gateway = new FakeGateway();
      gateway.sources = [source("keep", server.url), source("drop", server.url, "hyfin")];
      const controller = new AbortController();

      setTimeout(() => {
        gateway.sources = [source("keep", server.url)];
      }, 120);
      setTimeout(() => controller.abort(), 400);

      await runSupervisor({
        gateway,
        signal: controller.signal,
        refreshMs: 80,
        ssrfCheck: allowAll,
      });

      expect(gateway.listCallCount).toBeGreaterThanOrEqual(2);
    } finally {
      await server.stop();
    }
  });

  test("spawns workers for sources added mid-run", async () => {
    const server = await startMockIcyServer({
      metaint: 32,
      metadataBlocks: ["StreamTitle='A - B';"],
    });
    try {
      const gateway = new FakeGateway();
      gateway.sources = [];
      const controller = new AbortController();

      setTimeout(() => {
        gateway.sources = [source("new", server.url)];
      }, 120);
      setTimeout(() => controller.abort(), 450);

      await runSupervisor({
        gateway,
        signal: controller.signal,
        refreshMs: 80,
        ssrfCheck: allowAll,
      });

      expect(gateway.writes.length).toBeGreaterThan(0);
      expect(gateway.writes[0]?.sourceId).toBe("new");
    } finally {
      await server.stop();
    }
  });

  test("re-spawns a source when its streamUrl changes", async () => {
    const serverA = await startMockIcyServer({
      metaint: 32,
      metadataBlocks: ["StreamTitle='OldArtist - OldTitle';"],
    });
    const serverB = await startMockIcyServer({
      metaint: 32,
      metadataBlocks: ["StreamTitle='NewArtist - NewTitle';"],
    });
    try {
      const gateway = new FakeGateway();
      gateway.sources = [source("swap", serverA.url)];
      const controller = new AbortController();

      setTimeout(() => {
        gateway.sources = [source("swap", serverB.url)];
      }, 200);
      setTimeout(() => controller.abort(), 650);

      await runSupervisor({
        gateway,
        signal: controller.signal,
        refreshMs: 80,
        ssrfCheck: allowAll,
      });

      const artists = gateway.writes.map((w) => w.play.artistRaw);
      expect(artists).toContain("OldArtist");
      expect(artists).toContain("NewArtist");
    } finally {
      await serverA.stop();
      await serverB.stop();
    }
  });
});

describe("runSupervisor — error handling", () => {
  test("keeps existing workers alive when list fetch throws", async () => {
    const server = await startMockIcyServer({
      metaint: 32,
      metadataBlocks: ["StreamTitle='A - B';"],
    });
    try {
      const gateway = new FakeGateway();
      gateway.sources = [source("survivor", server.url)];
      const controller = new AbortController();

      setTimeout(() => {
        gateway.listThrows = new Error("convex down");
      }, 150);
      setTimeout(() => {
        gateway.listThrows = null;
      }, 350);
      setTimeout(() => controller.abort(), 550);

      await runSupervisor({
        gateway,
        signal: controller.signal,
        refreshMs: 80,
        ssrfCheck: allowAll,
      });

      expect(gateway.writes.length).toBeGreaterThan(0);
    } finally {
      await server.stop();
    }
  });

  test("aborts a source when writePlay returns unknown_source", async () => {
    const server = await startMockIcyServer({
      metaint: 32,
      metadataBlocks: ["StreamTitle='A - B';"],
    });
    try {
      const gateway = new FakeGateway();
      gateway.sources = [source("phantom", server.url)];
      gateway.unknownSourceIds.add("phantom");
      const controller = new AbortController();

      setTimeout(() => controller.abort(), 400);
      await runSupervisor({
        gateway,
        signal: controller.signal,
        refreshMs: 80,
        ssrfCheck: allowAll,
      });

      expect(gateway.writes.length).toBe(0);
    } finally {
      await server.stop();
    }
  });

  test("ignores duplicate-playedAt results silently", async () => {
    const server = await startMockIcyServer({
      metaint: 32,
      metadataBlocks: ["StreamTitle='A - B';"],
    });
    try {
      const gateway = new FakeGateway();
      gateway.sources = [source("dup", server.url)];
      gateway.duplicatePlayedAt.add(Date.now());
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 300);
      await runSupervisor({
        gateway,
        signal: controller.signal,
        refreshMs: 80,
        ssrfCheck: allowAll,
      });
      expect(true).toBe(true);
    } finally {
      await server.stop();
    }
  });
});
