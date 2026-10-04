import { describe, expect, test } from "bun:test";
import { clampConnectionLimit, dedupeByKey, mergePlaysAscending } from "../convex/recall";

describe("mergePlaysAscending", () => {
  test("merges, de-duplicates by _id and sorts ascending", () => {
    const a = [
      { _id: "b", playedAt: 20 },
      { _id: "a", playedAt: 10 },
    ];
    const b = [
      { _id: "b", playedAt: 20 },
      { _id: "c", playedAt: 30 },
    ];
    expect(mergePlaysAscending(a, b).map((p) => p._id)).toEqual(["a", "b", "c"]);
  });
});

describe("dedupeByKey", () => {
  test("keeps the first item per key", () => {
    const items = [
      { k: "x", n: 1 },
      { k: "y", n: 2 },
      { k: "x", n: 3 },
    ];
    expect(dedupeByKey(items, (i) => i.k)).toEqual([
      { k: "x", n: 1 },
      { k: "y", n: 2 },
    ]);
  });
});

describe("clampConnectionLimit", () => {
  test("defaults, floors and clamps to 1..10", () => {
    expect(clampConnectionLimit(undefined)).toBe(5);
    expect(clampConnectionLimit(Number.NaN)).toBe(5);
    expect(clampConnectionLimit(0)).toBe(1);
    expect(clampConnectionLimit(-4)).toBe(1);
    expect(clampConnectionLimit(3.9)).toBe(3);
    expect(clampConnectionLimit(500)).toBe(10);
  });
});
