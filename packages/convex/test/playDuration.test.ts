import { describe, expect, test } from "bun:test";
import {
  OBSERVED_DURATION_CAP_SEC,
  OBSERVED_DURATION_MIN_SEC,
  observedDurationSec,
} from "../convex/playDuration";

const T0 = Date.parse("2026-09-22T23:43:24Z");
const sec = (n: number): number => n * 1000;

describe("observedDurationSec", () => {
  test("gap to the next start is the song's on-air length, rounded to seconds", () => {
    expect(observedDurationSec(T0, T0 + sec(180))).toBe(180);
    expect(observedDurationSec(T0, T0 + sec(197.4))).toBe(197);
  });

  test("a gap shorter than a real song (re-poll glitch) is unknown", () => {
    expect(observedDurationSec(T0, T0 + sec(OBSERVED_DURATION_MIN_SEC - 1))).toBeNull();
    expect(observedDurationSec(T0, T0 + sec(OBSERVED_DURATION_MIN_SEC))).toBe(
      OBSERVED_DURATION_MIN_SEC,
    );
  });

  test("a gap longer than the cap (talk break swallowed) is unknown, not overstated", () => {
    expect(observedDurationSec(T0, T0 + sec(OBSERVED_DURATION_CAP_SEC + 1))).toBeNull();
    expect(observedDurationSec(T0, T0 + sec(OBSERVED_DURATION_CAP_SEC))).toBe(
      OBSERVED_DURATION_CAP_SEC,
    );
  });

  test("a next play that started earlier (out-of-order backfill) is unknown", () => {
    expect(observedDurationSec(T0, T0 - sec(60))).toBeNull();
  });
});
