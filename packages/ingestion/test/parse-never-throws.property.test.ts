/**
 * Property test: every adapter's `parse()` NEVER throws.
 *
 * Closes TODO-3 (docs/design/004-unresolved-decisions.md).
 *
 * Throws fuzzed arbitrary input at each adapter — strings, numbers, arrays,
 * objects, nested junk, Buffers, null, undefined. Asserts:
 *   1. parse() never throws
 *   2. parse() always returns an array
 *   3. every play in the array satisfies the NormalizedPlay shape
 *
 * This is the central architectural invariant of the adapter contract. If any
 * fuzz input causes a throw, the adapter is broken — fix the adapter, not this
 * test.
 */

import { describe, test, expect } from "bun:test";
import fc from "fast-check";
import type { AdapterKind, StationSlug } from "@rm/types";
import { getAdapter } from "../src";

const ADAPTERS: AdapterKind[] = ["spinitron", "sgmetadata", "icy"];
const STATION_SLUGS: StationSlug[] = ["hyfin", "88nine", "414music", "rhythmlab"];

// Arbitrary generator producing wildly varied junk input.
// Covers primitives, arrays, nested objects, and plausible-looking-but-broken
// versions of each adapter's real shapes.
const arbitraryInput = fc.anything({
  maxDepth: 3,
  withBigInt: true,
  withDate: true,
  withMap: true,
  withSet: true,
  withNullPrototype: true,
  withObjectString: true,
  withTypedArray: true,
  withSparseArray: true,
  withBoxedValues: true,
});

// Also specifically target shapes that LOOK like the adapters' expected inputs
// but have subtly broken fields — these are the cases most likely to cause
// a throw in code that assumes "if the envelope parses, the contents are safe".
const spinitronLike = fc.record({
  items: fc.array(
    fc.record(
      {
        id: fc.oneof(fc.integer(), fc.string(), fc.constant(null), fc.constant(undefined)),
        song: fc.oneof(fc.string(), fc.constant(null), fc.constant(undefined)),
        artist: fc.oneof(fc.string(), fc.constant(null), fc.constant(undefined)),
        release: fc.oneof(fc.string(), fc.constant(null)),
        label: fc.oneof(fc.string(), fc.constant(null)),
        start: fc.oneof(fc.string(), fc.constant(null), fc.constant(undefined)),
        duration: fc.oneof(fc.integer(), fc.float(), fc.constant(null), fc.constant(undefined)),
      },
      { requiredKeys: [] },
    ),
    { maxLength: 30 },
  ),
});

const sgmetadataLike = fc.oneof(
  fc.record(
    {
      StreamTitle: fc.oneof(fc.string(), fc.constant(null), fc.constant(undefined)),
      StreamUrl: fc.oneof(fc.string(), fc.constant(null)),
      date: fc.oneof(fc.string(), fc.constant(null)),
      timestamp: fc.oneof(fc.integer(), fc.float(), fc.constant(null)),
    },
    { requiredKeys: [] },
  ),
  fc.array(
    fc.record(
      {
        StreamTitle: fc.oneof(fc.string(), fc.constant(null)),
        timestamp: fc.oneof(fc.integer(), fc.constant(null)),
      },
      { requiredKeys: [] },
    ),
    { maxLength: 20 },
  ),
);

const icyLike = fc.oneof(
  fc.string(),
  fc.constantFrom(
    "StreamTitle='';",
    "StreamTitle='Artist - Title';",
    "StreamTitle='no separator';",
    "StreamUrl='http://example.com';",
    "garbage",
  ),
  fc.record(
    {
      streamTitle: fc.oneof(fc.string(), fc.constant(null), fc.constant(undefined)),
      rawMetadataString: fc.oneof(fc.string(), fc.constant(null), fc.constant(undefined)),
      receivedAt: fc.oneof(fc.integer(), fc.float(), fc.constant(null), fc.constant(undefined)),
    },
    { requiredKeys: [] },
  ),
);

function arbitraryForKind(kind: AdapterKind) {
  switch (kind) {
    case "spinitron":
      return fc.oneof(arbitraryInput, spinitronLike);
    case "sgmetadata":
      return fc.oneof(arbitraryInput, sgmetadataLike);
    case "icy":
      return fc.oneof(arbitraryInput, icyLike);
  }
}

const stationSlugArb = fc.constantFrom(...STATION_SLUGS);

describe("adapter.parse() never throws (TODO-3 property test)", () => {
  for (const kind of ADAPTERS) {
    test(`${kind}.parse — 1000 random inputs, no throws, output is always valid`, () => {
      const adapter = getAdapter(kind);
      fc.assert(
        fc.property(arbitraryForKind(kind), stationSlugArb, (raw, stationSlug) => {
          const plays = adapter.parse(raw, { stationSlug });

          // Output contract
          if (!Array.isArray(plays)) return false;
          for (const play of plays) {
            if (typeof play !== "object" || play === null) return false;
            if (play.source !== kind) return false;
            if (play.stationSlug !== stationSlug) return false;
            if (typeof play.artistRaw !== "string" || play.artistRaw.length === 0) return false;
            if (typeof play.titleRaw !== "string" || play.titleRaw.length === 0) return false;
            if (typeof play.playedAt !== "number" || !Number.isFinite(play.playedAt)) return false;
          }
          return true;
        }),
        { numRuns: 1000, verbose: false },
      );
      // The fact that fc.assert returned without throwing is the pass condition.
      expect(true).toBe(true);
    });
  }
});
