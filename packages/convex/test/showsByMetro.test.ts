import { describe, expect, test } from "bun:test";
import { nearestMetro, pickShowsByMetro } from "../convex/showsByMetro";

describe("nearestMetro", () => {
  test("suburbs go to their metro", () => {
    expect(nearestMetro(42.0451, -87.6877, "Evanston")).toBe("Chicago");
    expect(nearestMetro(43.0117, -88.2315, "Waukesha")).toBe("Milwaukee");
    expect(nearestMetro(43.0731, -89.4012, "Madison")).toBe("Madison");
  });
  test("no coordinates → city name", () => expect(nearestMetro(undefined, undefined, "Kohler")).toBe("Kohler"));
});

describe("pickShowsByMetro", () => {
  const show = (city: string, day: number, lat: number, lng: number) => ({ city, startsAt: day * 86_400_000, latitude: lat, longitude: lng });
  test("Chicago next week and Milwaukee next month → both, date order, one per metro", () => {
    const picked = pickShowsByMetro([
      show("Chicago", 7, 41.88, -87.63),
      show("Evanston", 9, 42.05, -87.69),
      show("Milwaukee", 30, 43.04, -87.91),
    ]);
    expect(picked.map((p) => [p.city, p.metro])).toEqual([["Chicago", "Chicago"], ["Milwaukee", "Milwaukee"]]);
  });
  test("caps at max", () => {
    const many = [show("Chicago", 1, 41.88, -87.63), show("Milwaukee", 2, 43.04, -87.91), show("Madison", 3, 43.07, -89.4), show("Kohler", 4, 43.74, -87.78)];
    expect(pickShowsByMetro(many, 3)).toHaveLength(3);
  });
});
