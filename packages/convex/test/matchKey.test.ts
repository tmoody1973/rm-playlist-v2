import { describe, expect, test } from "bun:test";
import { matchKey } from "../convex/matchKey";
import { normalizeEventArtistKey } from "../convex/events";
import cases from "./fixtures/match-keys.json";

describe("matchKey (shared with Backstory — keep fixtures identical in both repos)", () => {
  for (const testCase of cases) {
    test(`${testCase.artist} — ${testCase.title}`, () => {
      expect(matchKey(testCase.artist, testCase.title)).toBe(testCase.expected);
    });
  }
});

describe("normalizeEventArtistKey keeps its behavior after the move", () => {
  test("strips articles, accents, punctuation", () => {
    expect(normalizeEventArtistKey("The Beatles")).toBe("beatles");
    expect(normalizeEventArtistKey("Sigur Rós")).toBe("sigurros");
    expect(normalizeEventArtistKey("A Tribe Called Quest")).toBe("tribecalledquest");
  });
});
