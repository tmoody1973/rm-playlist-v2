import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ESTIMATED_DURATION_SEC,
  OBSERVED_DURATION_CAP_SEC,
  OBSERVED_DURATION_MIN_SEC,
  durationSourceOf,
  fillDurationSec,
  medianSec,
  observedDurationSec,
  pairWithNext,
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

describe("medianSec", () => {
  test("odd count is the middle value", () => {
    expect(medianSec([240, 180, 200])).toBe(200);
  });

  test("even count is the mean of the middle two, rounded to whole seconds", () => {
    expect(medianSec([180, 241])).toBe(211);
  });

  test("zero, negative and non-finite lengths are not lengths", () => {
    expect(medianSec([0, -5, Number.NaN, 200])).toBe(200);
  });

  test("nothing known is null", () => {
    expect(medianSec([])).toBeNull();
  });
});

describe("fillDurationSec (the estimate rule)", () => {
  test("an observed gap wins over the song's other lengths", () => {
    expect(fillDurationSec(197, [240])).toEqual({ durationSec: 197, basis: "observed" });
  });

  test("no observed gap: the median of the song's other known lengths", () => {
    expect(fillDurationSec(null, [200, 240, 230])).toEqual({ durationSec: 230, basis: "track" });
  });

  test("no observed gap and no known lengths: the 210 s default", () => {
    expect(fillDurationSec(null, [])).toEqual({
      durationSec: DEFAULT_ESTIMATED_DURATION_SEC,
      basis: "default",
    });
    expect(DEFAULT_ESTIMATED_DURATION_SEC).toBe(210);
  });

  test("only an observed gap is stored as observed; the rest are flagged estimated", () => {
    expect(durationSourceOf("observed")).toBe("observed");
    expect(durationSourceOf("track")).toBe("estimated");
    expect(durationSourceOf("default")).toBe("estimated");
  });
});

describe("pairWithNext", () => {
  const plays = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, playedAt: T0 + sec(i * 200) }));
  const ids = (pairs: Array<{ play: { id: string }; nextPlayedAt: number }>) =>
    pairs.map((pair) => `${pair.play.id}->${pair.nextPlayedAt}`);

  test("each play pairs with the next play's start; the last one waits as the carry", () => {
    const { pairs, carry } = pairWithNext(null, plays.slice(0, 3));
    expect(ids(pairs)).toEqual([`a->${T0 + sec(200)}`, `b->${T0 + sec(400)}`]);
    expect(carry?.id).toBe("c");
  });

  test("batches chained through the carry pair exactly like one pass (batch edges included)", () => {
    const whole = pairWithNext(null, plays);
    const first = pairWithNext(null, plays.slice(0, 2));
    const second = pairWithNext(first.carry, plays.slice(2, 4));
    const third = pairWithNext(second.carry, plays.slice(4));
    expect(ids([...first.pairs, ...second.pairs, ...third.pairs])).toEqual(ids(whole.pairs));
    expect(third.carry?.id).toBe("e");
  });

  test("an empty batch keeps the carry", () => {
    const carry = plays[0]!;
    expect(pairWithNext(carry, [])).toEqual({ pairs: [], carry });
  });
});
