import { describe, expect, test } from "bun:test";
import {
  CONCERTS_HORIZON_DAYS,
  concertsWithinHorizon,
  followDuplicates,
  stillUpcoming,
  withEventDetails,
  withStationContext,
} from "../convex/concertsLogic";

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

describe("site helpers", () => {
  test("withStationContext adds the show's metro and play count", () => {
    expect(withStationContext({ eventId: "e" }, { metro: "Chicago", playCount: 4 })).toEqual({
      eventId: "e",
      metro: "Chicago",
      playCount: 4,
    });
  });

  test("followDuplicates returns the canonical event", async () => {
    const rows: Record<string, { _id: string; duplicateOf?: string }> = {
      a: { _id: "a", duplicateOf: "b" },
      b: { _id: "b" },
    };
    expect((await followDuplicates(rows.a!, async (id) => rows[id] ?? null))?._id).toBe("b");
  });

  test("followDuplicates stops at a missing canonical and at a loop", async () => {
    const missing = { _id: "a", duplicateOf: "gone" };
    expect(await followDuplicates(missing, async () => null)).toBeNull();
    const loop: Record<string, { _id: string; duplicateOf?: string }> = {
      a: { _id: "a", duplicateOf: "b" },
      b: { _id: "b", duplicateOf: "a" },
    };
    expect(await followDuplicates(loop.a!, async (id) => loop[id] ?? null)).toBeNull();
  });

  test("withEventDetails adds status (null when unset) and region", () => {
    expect(withEventDetails({ eventId: "e" }, { status: "cancelled", region: "IL" })).toEqual({
      eventId: "e",
      status: "cancelled",
      region: "IL",
    });
    expect(withEventDetails({ eventId: "e" }, { region: "WI" })).toEqual({
      eventId: "e",
      status: null,
      region: "WI",
    });
  });
});

describe("stillUpcoming", () => {
  const dec4 = Date.parse("2026-12-04T00:00:00Z"); // a date-only Dec 4 show is stored as Dec 4 00:00 UTC

  test("a date-only show stays upcoming until the end of its date in Central time", () => {
    expect(
      stillUpcoming({ startsAt: dec4, dateOnly: true }, Date.parse("2026-12-04T03:00:00Z")),
    ).toBe(true); // 9 pm Dec 3 Central
    expect(
      stillUpcoming({ startsAt: dec4, dateOnly: true }, Date.parse("2026-12-05T02:00:00Z")),
    ).toBe(true); // 8 pm Dec 4 Central, showtime
    expect(
      stillUpcoming({ startsAt: dec4, dateOnly: true }, Date.parse("2026-12-05T05:59:00Z")),
    ).toBe(true); // 11:59 pm Dec 4 Central
    expect(
      stillUpcoming({ startsAt: dec4, dateOnly: true }, Date.parse("2026-12-05T06:00:01Z")),
    ).toBe(false); // Dec 5
  });

  test("a timed show is upcoming until it starts, as before", () => {
    expect(stillUpcoming({ startsAt: dec4 }, dec4 - 1)).toBe(true);
    expect(stillUpcoming({ startsAt: dec4, dateOnly: false }, dec4)).toBe(false);
  });
});
