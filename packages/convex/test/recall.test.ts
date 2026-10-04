import { describe, expect, test } from "bun:test";
import { chooseRecallStatus, evidenceLevel, neighborSpin, rankSpins, type SpinForRecall } from "../convex/recall";

const MIN = 60_000;
const spin = (playId: string, minute: number, cueTags: string[] = [], extra: Partial<SpinForRecall> = {}): SpinForRecall =>
  ({ playId, playedAt: minute * MIN, durationSec: 240, cueTags, hidden: false, ...extra });

describe("rankSpins + chooseRecallStatus", () => {
  test("cue match wins over time closeness → ok", () => {
    const ranked = rankSpins([spin("a", 10), spin("b", 30, ["horns"])], ["horns"], 10 * MIN);
    expect(ranked[0]?.playId).toBe("b");
    expect(ranked[0]?.matchedCues).toEqual(["horns"]);
    expect(chooseRecallStatus(ranked, ["horns"], 10 * MIN)).toBe("ok");
  });
  test("two spins tie on cues → options", () => {
    const ranked = rankSpins([spin("a", 10, ["horns"]), spin("b", 20, ["horns"])], ["horns"], 15 * MIN);
    expect(chooseRecallStatus(ranked, ["horns"], 15 * MIN)).toBe("options");
  });
  test("cues asked but nobody in the window has tags → cues_unchecked, time-ranked", () => {
    const ranked = rankSpins([spin("a", 10), spin("b", 14)], ["horns"], 15 * MIN);
    expect(ranked[0]?.playId).toBe("b");
    expect(chooseRecallStatus(ranked, ["horns"], 15 * MIN)).toBe("cues_unchecked");
  });
  test("no cues, the midpoint falls inside one spin → ok", () => {
    const ranked = rankSpins([spin("a", 10), spin("b", 14)], [], 15 * MIN);
    expect(chooseRecallStatus(ranked, [], 15 * MIN)).toBe("ok");
  });
  test("no cues, midpoint in a gap → options", () => {
    const ranked = rankSpins([spin("a", 10, [], { durationSec: 60 }), spin("b", 20)], [], 15 * MIN);
    expect(chooseRecallStatus(ranked, [], 15 * MIN)).toBe("options");
  });
  test("hidden spins never rank; empty → no_spins", () => {
    const ranked = rankSpins([spin("a", 10, [], { hidden: true })], [], 10 * MIN);
    expect(ranked).toHaveLength(0);
    expect(chooseRecallStatus(ranked, [], 10 * MIN)).toBe("no_spins");
  });
});

describe("neighborSpin", () => {
  const spins = [spin("a", 1), spin("id", 5, [], { hidden: true }), spin("c", 9)];
  test("the one before skips station IDs / deleted plays", () => expect(neighborSpin(spins, "c", "before")?.playId).toBe("a"));
  test("the one after", () => expect(neighborSpin(spins, "a", "after")?.playId).toBe("c"));
  test("edge → null", () => expect(neighborSpin(spins, "a", "before")).toBeNull());
});

describe("evidenceLevel", () => {
  test("rich needs 3 track facts and high confidence", () => {
    expect(evidenceLevel({ resolved: true, matchConfidence: "high", trackScopeFactCount: 3 })).toBe("rich");
    expect(evidenceLevel({ resolved: true, matchConfidence: "low", trackScopeFactCount: 9 })).toBe("basic");
    expect(evidenceLevel({ resolved: false, trackScopeFactCount: 0 })).toBe("none");
  });
});
