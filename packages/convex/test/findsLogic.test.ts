import { describe, expect, test } from "bun:test";
import { clampFindsLimit, dedupeKeyFor } from "../convex/findsLogic";

describe("dedupeKeyFor", () => {
  test("uses the track when known, so two spins of one song are one find", () => {
    expect(dedupeKeyFor("play1", "trackA")).toBe("track:trackA");
    expect(dedupeKeyFor("play2", "trackA")).toBe("track:trackA");
  });
  test("falls back to the play for unidentified songs", () => {
    expect(dedupeKeyFor("play9", undefined)).toBe("play:play9");
  });
});

describe("clampFindsLimit", () => {
  test("defaults to 5 and clamps to 1..10", () => {
    expect(clampFindsLimit(undefined)).toBe(5);
    expect(clampFindsLimit(Number.NaN)).toBe(5);
    expect(clampFindsLimit(0)).toBe(1);
    expect(clampFindsLimit(3.9)).toBe(3);
    expect(clampFindsLimit(99)).toBe(10);
  });
});
