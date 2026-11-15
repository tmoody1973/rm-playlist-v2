import { describe, expect, test } from "bun:test";
import { CONCERTS_HORIZON_DAYS, concertsWithinHorizon } from "../convex/concertsLogic";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function show(id: string, startsAtMs: number, dateOnly = false) {
  return { eventId: id, startsAtMs, dateOnly };
}

describe("concertsWithinHorizon", () => {
  test("the Concerts tab looks 60 days ahead, like V1", () => {
    expect(CONCERTS_HORIZON_DAYS).toBe(60);
  });

  test("keeps shows from now through 60 days out, drops later ones", () => {
    const shows = [
      show("soon", NOW + DAY_MS),
      show("edge", NOW + 60 * DAY_MS),
      show("far", NOW + 61 * DAY_MS),
    ];
    expect(concertsWithinHorizon(shows, NOW).map((s) => s.eventId)).toEqual(["soon", "edge"]);
  });

  test("drops shows that already started", () => {
    expect(concertsWithinHorizon([show("past", NOW - HOUR_MS)], NOW)).toEqual([]);
  });

  test("a date-only show stays listed for the rest of its day", () => {
    const placeholderMidnight = NOW - 3 * HOUR_MS;
    expect(concertsWithinHorizon([show("today", placeholderMidnight, true)], NOW)).toHaveLength(1);
    expect(concertsWithinHorizon([show("yesterday", NOW - 25 * HOUR_MS, true)], NOW)).toEqual([]);
  });

  test("sorts soonest first", () => {
    const shows = [show("later", NOW + 5 * DAY_MS), show("sooner", NOW + 2 * DAY_MS)];
    expect(concertsWithinHorizon(shows, NOW).map((s) => s.eventId)).toEqual(["sooner", "later"]);
  });
});
