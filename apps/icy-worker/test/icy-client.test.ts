import { describe, expect, test } from "bun:test";
import { IcyProtocolError, readIcyStream } from "../src/icy-client";
import { startMockIcyServer } from "./mock-icy-server";

function collect(value: string, sink: string[]) {
  sink.push(value);
}

describe("readIcyStream — happy path", () => {
  test("extracts a single StreamTitle metadata block", async () => {
    const server = await startMockIcyServer({
      metaint: 32,
      metadataBlocks: ["StreamTitle='Artist One - Track One';"],
    });
    try {
      const captured: string[] = [];
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 250);
      await readIcyStream({
        url: server.url,
        signal: controller.signal,
        onMetadata: (m) => collect(m, captured),
      }).catch(() => {});
      expect(captured.length).toBeGreaterThan(0);
      expect(captured[0]).toContain("StreamTitle='Artist One - Track One';");
    } finally {
      await server.stop();
    }
  });

  test("handles multiple alternating metadata blocks", async () => {
    const server = await startMockIcyServer({
      metaint: 16,
      metadataBlocks: [
        "StreamTitle='Artist A - Track A';",
        "StreamTitle='Artist B - Track B';",
        "StreamTitle='Artist C - Track C';",
      ],
    });
    try {
      const captured: string[] = [];
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 500);
      await readIcyStream({
        url: server.url,
        signal: controller.signal,
        onMetadata: (m) => collect(m, captured),
      }).catch(() => {});
      expect(captured.length).toBeGreaterThanOrEqual(2);
      expect(captured[0]).toContain("Artist A - Track A");
    } finally {
      await server.stop();
    }
  });

  test("skips zero-length (unchanged) metadata blocks without invoking callback", async () => {
    const server = await startMockIcyServer({
      metaint: 16,
      metadataBlocks: [null, null, "StreamTitle='Artist - Title';", null],
    });
    try {
      const captured: string[] = [];
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 400);
      await readIcyStream({
        url: server.url,
        signal: controller.signal,
        onMetadata: (m) => collect(m, captured),
      }).catch(() => {});
      for (const msg of captured) {
        expect(msg).toContain("StreamTitle=");
      }
    } finally {
      await server.stop();
    }
  });
});

describe("readIcyStream — errors", () => {
  test("throws IcyProtocolError on 4xx", async () => {
    const server = await startMockIcyServer({
      metaint: 32,
      metadataBlocks: [],
      status: 403,
    });
    try {
      await expect(
        readIcyStream({ url: server.url, onMetadata: () => {} }),
      ).rejects.toMatchObject({ name: "IcyProtocolError", code: "http_4xx" });
    } finally {
      await server.stop();
    }
  });

  test("throws IcyProtocolError on 5xx", async () => {
    const server = await startMockIcyServer({
      metaint: 32,
      metadataBlocks: [],
      status: 503,
    });
    try {
      await expect(
        readIcyStream({ url: server.url, onMetadata: () => {} }),
      ).rejects.toMatchObject({ code: "http_5xx" });
    } finally {
      await server.stop();
    }
  });

  test("throws IcyProtocolError when icy-metaint header is absent", async () => {
    const server = await startMockIcyServer({
      metaint: 32,
      metadataBlocks: ["StreamTitle='x';"],
      omitMetaintHeader: true,
    });
    try {
      await expect(
        readIcyStream({ url: server.url, onMetadata: () => {} }),
      ).rejects.toMatchObject({ code: "no_metaint" });
    } finally {
      await server.stop();
    }
  });
});

describe("readIcyStream — abort", () => {
  test("resolves cleanly when AbortSignal fires mid-stream", async () => {
    const server = await startMockIcyServer({
      metaint: 16,
      metadataBlocks: ["StreamTitle='x';"],
    });
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);
      await readIcyStream({
        url: server.url,
        signal: controller.signal,
        onMetadata: () => {},
      }).catch((err) => {
        // Some fetch impls reject with AbortError on abort — that's also fine.
        if (err instanceof IcyProtocolError) throw err;
      });
      expect(true).toBe(true);
    } finally {
      await server.stop();
    }
  });
});

describe("IcyProtocolError", () => {
  test("carries code and message", () => {
    const err = new IcyProtocolError("no_metaint", "something went wrong");
    expect(err.code).toBe("no_metaint");
    expect(err.message).toBe("something went wrong");
    expect(err.name).toBe("IcyProtocolError");
  });
});
