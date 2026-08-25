import { afterEach, describe, expect, test } from "bun:test";
import { spinitronAdapter } from "../src/adapters/spinitron";

/**
 * The history window is what makes Spinitron a backup rather than just a
 * second live source: SGmetadata forgets after ~17 minutes, Spinitron does
 * not. These tests pin the request shape, including the `count`-not-`limit`
 * quirk that the published OpenAPI spec gets wrong.
 */

const realFetch = globalThis.fetch;
const CONTEXT = { stationSlug: "88nine" as const };

function captureUrl(): { urls: string[] } {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(typeof input === "string" ? input : input.toString());
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  }) as typeof fetch;
  return { urls };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("spinitron poll URL", () => {
  test("defaults to the 20 most recent spins and sends no window", async () => {
    const captured = captureUrl();
    await spinitronAdapter.poll?.({ apiKey: "k" }, CONTEXT);
    expect(captured.urls[0]).toBe("https://spinitron.com/api/spins?count=20");
  });

  test("uses count, not the spec's limit — limit is ignored by the live API", async () => {
    const captured = captureUrl();
    await spinitronAdapter.poll?.({ apiKey: "k", count: 200 }, CONTEXT);
    expect(captured.urls[0]).toContain("count=200");
    expect(captured.urls[0]).not.toContain("limit=");
  });

  test("sends start and end when a history window is requested", async () => {
    const captured = captureUrl();
    await spinitronAdapter.poll?.(
      { apiKey: "k", count: 200, start: "2026-08-25 05:18:00", end: "2026-08-25 11:10:00" },
      CONTEXT,
    );
    const url = captured.urls[0] ?? "";
    expect(url).toContain("start=2026-08-25+05%3A18%3A00");
    expect(url).toContain("end=2026-08-25+11%3A10%3A00");
  });

  test("pages through a window", async () => {
    const captured = captureUrl();
    await spinitronAdapter.poll?.({ apiKey: "k", start: "2026-08-25 05:18:00", page: 3 }, CONTEXT);
    expect(captured.urls[0]).toContain("page=3");
  });

  test("omits page when it is not asked for", async () => {
    const captured = captureUrl();
    await spinitronAdapter.poll?.({ apiKey: "k" }, CONTEXT);
    expect(captured.urls[0]).not.toContain("page=");
  });
});
