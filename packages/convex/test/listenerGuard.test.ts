import { describe, expect, test } from "bun:test";
import { assertListenerId, assertServerKey } from "../convex/listenerGuard";

describe("assertServerKey", () => {
  test("accepts the exact key", () => {
    expect(() => assertServerKey("s3cret-key", "s3cret-key")).not.toThrow();
  });
  test("rejects a wrong key, a prefix, and an empty key", () => {
    expect(() => assertServerKey("s3cret-kez", "s3cret-key")).toThrow("Unauthorized");
    expect(() => assertServerKey("s3cret", "s3cret-key")).toThrow("Unauthorized");
    expect(() => assertServerKey("", "s3cret-key")).toThrow("Unauthorized");
  });
  test("rejects everything when the server key env is unset", () => {
    expect(() => assertServerKey("anything", undefined)).toThrow("Unauthorized");
    expect(() => assertServerKey("", "")).toThrow("Unauthorized");
  });
});

describe("assertListenerId", () => {
  test("accepts a non-blank listener id", () => {
    expect(() => assertListenerId("amzn1.ask.account.abc")).not.toThrow();
  });
  test("rejects empty and whitespace-only ids", () => {
    expect(() => assertListenerId("")).toThrow("InvalidListener");
    expect(() => assertListenerId("   \t\n")).toThrow("InvalidListener");
  });
});
