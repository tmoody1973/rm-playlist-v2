/**
 * Fixture-based contract tests for every adapter.
 *
 * Each fixture file in `fixtures/<adapter>/*.json` has the shape:
 *   {
 *     "_description": "optional prose",
 *     "_input": <raw input passed to parse()>,
 *     "_expected": { "playCount": N, "plays"?: [partial match, ...] }
 *   }
 *
 * This test discovers all fixtures, runs each through the right adapter, and
 * asserts the parsed output matches `_expected`.
 *
 * This closes the "≥10 fixtures per adapter" part of TODO-12 (per-layer test
 * coverage floors). The property test in parse-never-throws.property.test.ts
 * closes the "never throws" half of TODO-3.
 */

import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AdapterKind, NormalizedPlay, StationSlug } from "@rm/types";
import { getAdapter } from "../src";

interface Fixture {
  _description?: string;
  _input: unknown;
  _expected: {
    playCount: number;
    plays?: Array<Partial<NormalizedPlay>>;
  };
}

const FIXTURE_ROOT = join(import.meta.dir, "fixtures");
const TEST_CONTEXT: { stationSlug: StationSlug } = { stationSlug: "hyfin" };

function loadFixtures(adapter: AdapterKind): Array<{ name: string; fixture: Fixture }> {
  const dir = join(FIXTURE_ROOT, adapter);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  return files.map((file) => {
    const raw = readFileSync(join(dir, file), "utf8");
    const fixture = JSON.parse(raw) as Fixture;
    if (fixture._input === undefined) {
      throw new Error(`${adapter}/${file} is missing _input`);
    }
    if (fixture._expected === undefined) {
      throw new Error(`${adapter}/${file} is missing _expected`);
    }
    return { name: file, fixture };
  });
}

const ADAPTERS: AdapterKind[] = ["spinitron", "sgmetadata", "icy"];

describe("each adapter parses its fixtures correctly", () => {
  for (const kind of ADAPTERS) {
    describe(kind, () => {
      const fixtures = loadFixtures(kind);

      test(`has at least 10 fixtures (TODO-12 Layer 1 floor)`, () => {
        expect(fixtures.length).toBeGreaterThanOrEqual(10);
      });

      for (const { name, fixture } of fixtures) {
        test(name, () => {
          const adapter = getAdapter(kind);
          const plays = adapter.parse(fixture._input, TEST_CONTEXT);

          // All plays must have the right shape
          for (const play of plays) {
            expect(play.source).toBe(kind);
            expect(play.stationSlug).toBe(TEST_CONTEXT.stationSlug);
            expect(play.artistRaw.length).toBeGreaterThan(0);
            expect(play.titleRaw.length).toBeGreaterThan(0);
            expect(Number.isFinite(play.playedAt)).toBe(true);
          }

          // Count must match
          expect(plays.length).toBe(fixture._expected.playCount);

          // Partial-match specific plays if the fixture declares them
          if (fixture._expected.plays) {
            for (let i = 0; i < fixture._expected.plays.length; i++) {
              const expectedPlay = fixture._expected.plays[i];
              const actualPlay = plays[i];
              expect(actualPlay).toBeDefined();
              for (const [key, expectedValue] of Object.entries(expectedPlay ?? {})) {
                expect(actualPlay?.[key as keyof NormalizedPlay]).toBe(
                  expectedValue as NormalizedPlay[keyof NormalizedPlay],
                );
              }
            }
          }
        });
      }
    });
  }
});
