import { describe, expect, test } from "bun:test";
import { parseDiscogsRelease } from "../../src/credits/parseDiscogs";
import release from "./fixtures/discogs-release.json";

describe("parseDiscogsRelease", () => {
  const { facts, styles, year } = parseDiscogsRelease(release as never, "Victory Dance", 1000);
  const byValue = (name: string) => facts.filter((fact) => fact.value === name);

  test("tracklist extraartists are track scope, multi-role split, brackets stripped", () => {
    expect(byValue("James Mollison").map((f) => [f.role, f.scope])).toEqual([["Saxophone", "track"], ["Flute", "track"]]);
  });
  test("release-level credit naming our position is track scope", () => {
    expect(byValue("Ife Ogunjobi")[0]).toMatchObject({ role: "Trumpet", scope: "track", personKey: "discogs:222" });
  });
  test("release-level credit with no tracks is album scope", () => {
    expect(byValue("Femi Koleoso")[0]?.scope).toBe("album");
  });
  test("release-level credit naming only other positions is dropped", () => {
    expect(byValue("Other Player")).toHaveLength(0);
  });
  test("release-level credit with a track range is album scope", () => {
    expect(byValue("Range Player")[0]?.scope).toBe("album");
  });
  test("engineers kept, non-musical roles dropped", () => {
    expect(byValue("Studio Person")[0]?.group).toBe("engineer");
    expect(byValue("Art Person")).toHaveLength(0);
  });
  test("styles, year, and source url", () => {
    expect(styles).toEqual(["Afrobeat", "Jazz-Funk"]);
    expect(year).toBe(2019);
    expect(facts[0]?.sources[0]?.sourceUrl).toBe("https://www.discogs.com/release/13579");
  });
});

test("our track not in the tracklist → no release-level facts, no styles (likely the wrong release)", () => {
  const result = parseDiscogsRelease(release as never, "A Song Not On This Release", 1000);
  expect(result.facts).toEqual([]);
  expect(result.styles).toEqual([]);
});
