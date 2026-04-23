/**
 * CEO-plan accepted scope: "CI gate requiring ≥10 recorded fixtures per
 * adapter." TODO-12 Layer 1 floor says the same.
 *
 * This test asserts the on-disk fixture count. It lives alongside the
 * adapter contract tests so a PR that deletes fixtures without adding
 * equivalent ones fails CI.
 */

import { describe, test, expect } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_ROOT = join(import.meta.dir, "fixtures");
const MINIMUM_FIXTURES_PER_ADAPTER = 10;
const ADAPTERS = ["spinitron", "sgmetadata", "icy"] as const;

describe("adapter fixture count (TODO-12 Layer 1 floor)", () => {
  for (const adapter of ADAPTERS) {
    test(`${adapter} has at least ${MINIMUM_FIXTURES_PER_ADAPTER} fixtures on disk`, () => {
      const files = readdirSync(join(FIXTURE_ROOT, adapter)).filter((f) => f.endsWith(".json"));
      expect(files.length).toBeGreaterThanOrEqual(MINIMUM_FIXTURES_PER_ADAPTER);
    });
  }
});
