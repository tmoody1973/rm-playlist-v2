import { describe, expect, test } from "bun:test";
import { appleOutcome } from "../convex/appleOutcome";

describe("appleOutcome", () => {
  test("202 and 200 mean added", () => {
    expect(appleOutcome(202)).toEqual({ status: "added", retry: false });
    expect(appleOutcome(200)).toEqual({ status: "added", retry: false });
  });
  test("401/403 mean the listener's token is expired or revoked", () => {
    expect(appleOutcome(401)).toMatchObject({ status: "expired", retry: false });
    expect(appleOutcome(403)).toMatchObject({ status: "expired", retry: false });
  });
  test("5xx, 429 and network failures retry", () => {
    expect(appleOutcome(503)).toMatchObject({ status: "failed", retry: true });
    expect(appleOutcome(429)).toMatchObject({ status: "failed", retry: true });
    expect(appleOutcome("network")).toMatchObject({ status: "failed", retry: true });
  });
  test("other 4xx fail without retry, with a reason", () => {
    expect(appleOutcome(404)).toEqual({
      status: "failed",
      retry: false,
      reason: "Apple Music returned 404",
    });
  });
});
