import { describe, expect, test } from "bun:test";
import { DEFAULT_BACKOFF, nextDelayMs, sleep } from "../src/backoff";

describe("nextDelayMs", () => {
  test("attempt 0 returns a value within [0, baseMs)", () => {
    const delay = nextDelayMs(0, { baseMs: 1000, maxMs: 60000, random: () => 0.5 });
    expect(delay).toBe(500);
  });

  test("attempt grows exponentially up to maxMs ceiling", () => {
    const cfg = { baseMs: 1000, maxMs: 60000, random: () => 1 - 1e-9 };
    expect(nextDelayMs(0, cfg)).toBeLessThan(1000);
    expect(nextDelayMs(1, cfg)).toBeLessThan(2000);
    expect(nextDelayMs(2, cfg)).toBeLessThan(4000);
    expect(nextDelayMs(10, cfg)).toBeLessThan(60000);
    expect(nextDelayMs(100, cfg)).toBeLessThan(60000);
  });

  test("caps at maxMs even for huge attempt numbers", () => {
    const cfg = { baseMs: 1000, maxMs: 5000, random: () => 1 - 1e-9 };
    expect(nextDelayMs(50, cfg)).toBeLessThan(5000);
  });

  test("returns 0 when random() is 0", () => {
    const cfg = { baseMs: 1000, maxMs: 60000, random: () => 0 };
    expect(nextDelayMs(5, cfg)).toBe(0);
  });

  test("uses default config when none provided", () => {
    const delay = nextDelayMs(0);
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThan(DEFAULT_BACKOFF.maxMs);
  });
});

describe("sleep", () => {
  test("resolves after the timeout", async () => {
    const start = Date.now();
    await sleep(25);
    expect(Date.now() - start).toBeGreaterThanOrEqual(20);
  });

  test("rejects with AbortError when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(100, controller.signal)).rejects.toThrow("aborted");
  });

  test("rejects with AbortError when aborted mid-sleep", async () => {
    const controller = new AbortController();
    const promise = sleep(500, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(promise).rejects.toThrow("aborted");
  });
});
