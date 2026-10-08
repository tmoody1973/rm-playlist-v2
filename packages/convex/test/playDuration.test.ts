import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ESTIMATED_DURATION_SEC,
  OBSERVED_DURATION_CAP_SEC,
  durationSourceOf,
  fillDurationSec,
  gapNeedsEstimate,
  gapSec,
  medianSec,
  pairWithNext,
} from "../convex/playDuration";

const T0 = Date.parse("2026-09-22T23:43:24Z");
const sec = (n: number): number => n * 1000;
const TALK_BREAK = 20 * 60;

describe("gapSec", () => {
  test("whole seconds between the two starts as the playlist log prints them", () => {
    expect(gapSec(T0, T0 + sec(180))).toBe(180);
    expect(gapSec(T0, T0 + sec(197.4))).toBe(197);
  });

  test("both starts are floored like the log's, so sub-second starts can't overlap a row", () => {
    expect(gapSec(T0 + sec(0.1), T0 + sec(30.9))).toBe(30);
    expect(gapSec(T0 + sec(0.9), T0 + sec(30.1))).toBe(30);
  });

  test("a next play in the same second is a zero gap", () => {
    expect(gapSec(T0 + sec(0.2), T0 + sec(0.8))).toBe(0);
  });
});

describe("gapNeedsEstimate", () => {
  test("only a gap past the cap (a talk break swallowed) needs an estimate", () => {
    expect(gapNeedsEstimate(12)).toBe(false);
    expect(gapNeedsEstimate(OBSERVED_DURATION_CAP_SEC)).toBe(false);
    expect(gapNeedsEstimate(OBSERVED_DURATION_CAP_SEC + 1)).toBe(true);
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
  test("a gap in range is the length, whatever the song's other lengths say", () => {
    expect(fillDurationSec(190, [240])).toEqual({ durationSec: 190, basis: "observed" });
  });

  test("a 12 s gap (song cut off, or a glitch) is the 12 s that aired, observed", () => {
    expect(fillDurationSec(12, [240])).toEqual({ durationSec: 12, basis: "observed" });
  });

  test("a talk-break gap: the median of the song's other known lengths", () => {
    expect(fillDurationSec(TALK_BREAK, [200, 240, 230])).toEqual({
      durationSec: 230,
      basis: "track",
    });
  });

  test("a talk-break gap and no known lengths: the 210 s default", () => {
    expect(fillDurationSec(TALK_BREAK, [])).toEqual({
      durationSec: DEFAULT_ESTIMATED_DURATION_SEC,
      basis: "default",
    });
    expect(DEFAULT_ESTIMATED_DURATION_SEC).toBe(210);
  });

  test("an estimate never runs past the next play's start", () => {
    const gap = OBSERVED_DURATION_CAP_SEC + 20;
    expect(fillDurationSec(gap, [600, 620])).toEqual({ durationSec: gap, basis: "track" });
  });

  test("a next play in the same second leaves no room for any length", () => {
    expect(fillDurationSec(0, [200])).toBeNull();
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
