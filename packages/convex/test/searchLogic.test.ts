import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SEARCH_LOOKBACK_DAYS,
  isSearchHit,
  normalizeNeedle,
  searchWindow,
} from "../convex/searchLogic";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe("searchWindow", () => {
  test("defaults to the last 14 days", () => {
    expect(DEFAULT_SEARCH_LOOKBACK_DAYS).toBe(14);
    expect(searchWindow(NOW)).toEqual({ startMs: NOW - 14 * DAY_MS, endMs: NOW });
  });

  test("a listener's date range replaces the default", () => {
    const afterMs = NOW - 90 * DAY_MS;
    const beforeMs = NOW - 60 * DAY_MS;
    expect(searchWindow(NOW, afterMs, beforeMs)).toEqual({ startMs: afterMs, endMs: beforeMs });
  });

  test("only a start date: search from it up to now", () => {
    const afterMs = NOW - 40 * DAY_MS;
    expect(searchWindow(NOW, afterMs)).toEqual({ startMs: afterMs, endMs: NOW });
  });

  test("only an end date: the 14 days before it", () => {
    const beforeMs = NOW - 30 * DAY_MS;
    expect(searchWindow(NOW, undefined, beforeMs)).toEqual({
      startMs: beforeMs - 14 * DAY_MS,
      endMs: beforeMs,
    });
  });

  test("an end date in the future is clamped to now", () => {
    expect(searchWindow(NOW, undefined, NOW + DAY_MS).endMs).toBe(NOW);
  });
});

describe("normalizeNeedle", () => {
  test("trims and lowercases; blank means no text search", () => {
    expect(normalizeNeedle("  Little SIMZ ")).toBe("little simz");
    expect(normalizeNeedle("   ")).toBe("");
    expect(normalizeNeedle(undefined)).toBe("");
  });
});

describe("isSearchHit", () => {
  const window = { startMs: NOW - 14 * DAY_MS, endMs: NOW };
  const play = { artistRaw: "Little Simz", titleRaw: "Gorilla", playedAt: NOW - DAY_MS };

  test("matches artist or title, case-insensitively", () => {
    expect(isSearchHit(play, "simz", window)).toBe(true);
    expect(isSearchHit(play, "gorilla", window)).toBe(true);
    expect(isSearchHit(play, "drake", window)).toBe(false);
  });

  test("skips plays outside the window", () => {
    expect(isSearchHit({ ...play, playedAt: NOW - 15 * DAY_MS }, "simz", window)).toBe(false);
  });

  test("skips deleted and ignored plays", () => {
    expect(isSearchHit({ ...play, deletedAt: NOW }, "simz", window)).toBe(false);
    expect(isSearchHit({ ...play, enrichmentStatus: "ignored" }, "simz", window)).toBe(false);
  });
});
