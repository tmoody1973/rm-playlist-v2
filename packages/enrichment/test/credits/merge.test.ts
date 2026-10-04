import { describe, expect, test } from "bun:test";
import { instrumentFamily } from "../../src/credits/instrumentFamily";
import { deriveCueTags, deriveMatchConfidence, mergeFacts } from "../../src/credits/merge";
import type { CreditFact } from "../../src/credits/types";

const mb = { source: "musicbrainz" as const, sourceUrl: "https://musicbrainz.org/recording/r1", sourceRef: "r1", fetchedAt: 1 };
const dg = { source: "discogs" as const, sourceUrl: "https://www.discogs.com/release/9", sourceRef: "9", fetchedAt: 1 };

const drummer = (sources: CreditFact["sources"], role: string, personKey?: string): CreditFact => ({
  group: "performer", role, value: "Femi Koleoso", personKey, scope: "track", sources,
});

describe("instrumentFamily", () => {
  test("maps brass and reeds to horns", () => {
    expect(instrumentFamily("trumpet")).toBe("horns");
    expect(instrumentFamily("Saxophone [Tenor]")).toBe("horns");
    expect(instrumentFamily("tenor saxophone")).toBe("horns");
  });
  test("maps keys, strings, drums", () => {
    expect(instrumentFamily("Rhodes")).toBe("keys");
    expect(instrumentFamily("cello")).toBe("strings");
    expect(instrumentFamily("drums (drum set)")).toBe("drums");
  });
  test("unknown role → null", () => {
    expect(instrumentFamily("Photography By")).toBeNull();
  });
  test("resolves prefix collisions correctly", () => {
    expect(instrumentFamily("harpsichord")).toBe("keys");
    expect(instrumentFamily("bassoon")).toBe("horns");
    expect(instrumentFamily("oboe")).toBe("horns");
    expect(instrumentFamily("drum machine")).toBe("electronic");
    expect(instrumentFamily("bass guitar")).toBe("bass");
    expect(instrumentFamily("double bass")).toBe("strings");
    expect(instrumentFamily("harp")).toBe("strings");
  });
  test("organ and dj match only as whole words", () => {
    expect(instrumentFamily("Organized By")).toBeNull();
    expect(instrumentFamily("Djembe")).toBe("percussion");
    expect(instrumentFamily("DJ")).toBe("electronic");
    expect(instrumentFamily("organ")).toBe("keys");
  });
});

describe("mergeFacts", () => {
  test("same person + same instrument family from two sources → one fact, two sources", () => {
    const merged = mergeFacts([drummer([mb], "drums", "mb:a1"), drummer([dg], "Drums", "discogs:7")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sources.map((s) => s.source)).toEqual(["musicbrainz", "discogs"]);
    expect(merged[0]?.personKey).toBe("mb:a1");
  });
  test("different roles stay separate", () => {
    const producer: CreditFact = { ...drummer([mb], "producer", "mb:a1"), group: "producer" };
    expect(mergeFacts([drummer([mb], "drums", "mb:a1"), producer])).toHaveLength(2);
  });
  test("does not mutate inputs", () => {
    const input = [drummer([mb], "drums"), drummer([dg], "drums")];
    mergeFacts(input);
    expect(input[0]?.sources).toHaveLength(1);
  });
  test("the same source twice (tracklist + release level) is kept once", () => {
    const merged = mergeFacts([drummer([dg], "drums"), drummer([dg], "Drums")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sources).toEqual([dg]);
  });
  test("unicode names stay distinct (non-Latin writers with same role)", () => {
    const ryoji: CreditFact = { group: "writer", role: "composer", value: "坂本龍一", scope: "track", sources: [mb] };
    const hisaishi: CreditFact = { group: "writer", role: "composer", value: "久石譲", scope: "track", sources: [dg] };
    const merged = mergeFacts([ryoji, hisaishi]);
    expect(merged).toHaveLength(2);
    expect(merged.map((f) => f.value)).toContain("坂本龍一");
    expect(merged.map((f) => f.value)).toContain("久石譲");
  });
});

describe("deriveCueTags", () => {
  test("track-scope instrument families, decade, styles; album scope ignored", () => {
    const facts: CreditFact[] = [
      { group: "performer", role: "trumpet", value: "A", scope: "track", sources: [mb] },
      { group: "performer", role: "cello", value: "B", scope: "album", sources: [dg] },
      { group: "performer", role: "lead vocals", value: "C", scope: "track", sources: [mb] },
    ];
    expect(deriveCueTags({ facts, releaseYear: 2019, styles: ["Afrobeat", "Jazz-Funk"] })).toEqual([
      "horns", "2010s", "afrobeat", "jazz-funk",
    ]);
  });
});

describe("deriveMatchConfidence", () => {
  test("ISRC is high; search needs an Apple match; nothing is low", () => {
    expect(deriveMatchConfidence("isrc", false)).toBe("high");
    expect(deriveMatchConfidence("search", true)).toBe("high");
    expect(deriveMatchConfidence("search", false)).toBe("low");
    expect(deriveMatchConfidence(null, true)).toBe("low");
  });
});
