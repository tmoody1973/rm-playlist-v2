import { describe, expect, test } from "bun:test";
import {
  INGESTION_STALE_AFTER_MS,
  evaluateIngestionHealth,
  type IngestionSourceHealthInput,
} from "../convex/healthRules";

const NOW = 1_787_672_857_241;
const MINUTE = 60_000;

function source(overrides: Partial<IngestionSourceHealthInput> = {}): IngestionSourceHealthInput {
  return {
    sourceId: "src1",
    label: "88nine/sgmetadata",
    stationSlug: "88nine",
    adapter: "sgmetadata",
    enabled: true,
    lastSuccessAt: NOW - MINUTE,
    createdAt: NOW - 30 * 24 * 60 * MINUTE,
    ...overrides,
  };
}

describe("evaluateIngestionHealth", () => {
  test("stays quiet when every watched source polled recently", () => {
    const verdict = evaluateIngestionHealth([source(), source({ sourceId: "src2" })], NOW);
    expect(verdict.firing).toBe(false);
    expect(verdict.stale).toHaveLength(0);
    expect(verdict.watchedCount).toBe(2);
  });

  test("fires when a source has not polled past the threshold", () => {
    const verdict = evaluateIngestionHealth([source({ lastSuccessAt: NOW - 11 * MINUTE })], NOW);
    expect(verdict.firing).toBe(true);
    expect(verdict.stale).toHaveLength(1);
    expect(verdict.stale[0]?.staleForMs).toBe(11 * MINUTE);
    expect(verdict.detail).toContain("11m ago");
  });

  test("does not fire exactly at the threshold — only past it", () => {
    const verdict = evaluateIngestionHealth(
      [source({ lastSuccessAt: NOW - INGESTION_STALE_AFTER_MS })],
      NOW,
    );
    expect(verdict.firing).toBe(false);
  });

  test("reproduces the 2026-08-25 outage: a 43 minute gap fires", () => {
    const verdict = evaluateIngestionHealth([source({ lastSuccessAt: NOW - 43 * MINUTE })], NOW);
    expect(verdict.firing).toBe(true);
    expect(verdict.detail).toContain("43m ago");
  });

  test("ignores ICY sources — the Fly worker never sets lastSuccessAt", () => {
    const verdict = evaluateIngestionHealth(
      [
        source(),
        source({
          sourceId: "icy1",
          stationSlug: "rhythmlab",
          adapter: "icy",
          lastSuccessAt: undefined,
          createdAt: NOW - 90 * MINUTE,
        }),
        source({ sourceId: "sg2", stationSlug: "rhythmlab" }),
      ],
      NOW,
    );
    expect(verdict.watchedCount).toBe(2);
    expect(verdict.firing).toBe(false);
  });

  test("an ICY-only station counts as uncovered — we cannot verify it polls", () => {
    const verdict = evaluateIngestionHealth(
      [source(), source({ sourceId: "icy1", stationSlug: "rhythmlab", adapter: "icy" })],
      NOW,
    );
    expect(verdict.uncovered).toEqual(["rhythmlab"]);
    expect(verdict.firing).toBe(true);
  });

  test("ignores a disabled source while its station still has a live one", () => {
    const verdict = evaluateIngestionHealth(
      [source(), source({ sourceId: "src2", enabled: false, lastSuccessAt: NOW - 99 * MINUTE })],
      NOW,
    );
    expect(verdict.firing).toBe(false);
    expect(verdict.watchedCount).toBe(1);
    expect(verdict.uncovered).toEqual([]);
  });

  test("reproduces switching HYFIN off: a station with nothing enabled fires", () => {
    const verdict = evaluateIngestionHealth(
      [
        source({ sourceId: "a", stationSlug: "88nine" }),
        source({ sourceId: "b", stationSlug: "rhythmlab" }),
        source({ sourceId: "c", stationSlug: "414music" }),
        source({ sourceId: "d", stationSlug: "hyfin", enabled: false }),
      ],
      NOW,
    );
    expect(verdict.firing).toBe(true);
    expect(verdict.uncovered).toEqual(["hyfin"]);
    expect(verdict.detail).toContain("recording nothing: hyfin");
  });

  test("a switched-off station is reported even while every live source is healthy", () => {
    const verdict = evaluateIngestionHealth(
      [source({ sourceId: "a" }), source({ sourceId: "d", stationSlug: "hyfin", enabled: false })],
      NOW,
    );
    expect(verdict.stale).toHaveLength(0);
    expect(verdict.firing).toBe(true);
    expect(verdict.detail).toContain("The other 1 source(s) polled recently");
  });

  test("fires when no pollable source is enabled at all", () => {
    const verdict = evaluateIngestionHealth([source({ enabled: false })], NOW);
    expect(verdict.firing).toBe(true);
    expect(verdict.detail).toContain("No enabled pollable ingestion sources exist anywhere");
  });

  test("a brand new source that has never polled gets its grace period", () => {
    const fresh = source({ lastSuccessAt: undefined, createdAt: NOW - 2 * MINUTE });
    expect(evaluateIngestionHealth([fresh], NOW).firing).toBe(false);
  });

  test("a source that has never polled eventually fires, flagged as never-succeeded", () => {
    const stuck = source({ lastSuccessAt: undefined, createdAt: NOW - 25 * MINUTE });
    const verdict = evaluateIngestionHealth([stuck], NOW);
    expect(verdict.firing).toBe(true);
    expect(verdict.stale[0]?.neverSucceeded).toBe(true);
    expect(verdict.detail).toContain("never polled successfully");
  });

  test("names every stalled source so the email is actionable", () => {
    const verdict = evaluateIngestionHealth(
      [
        source({ sourceId: "a", label: "88nine/sgmetadata", lastSuccessAt: NOW - 20 * MINUTE }),
        source({ sourceId: "b", label: "hyfin/sgmetadata", lastSuccessAt: NOW - 20 * MINUTE }),
        source({ sourceId: "c", label: "414music/sgmetadata" }),
      ],
      NOW,
    );
    expect(verdict.stale.map((s) => s.label)).toEqual(["88nine/sgmetadata", "hyfin/sgmetadata"]);
    expect(verdict.detail).toContain("2 of 3");
    expect(verdict.uncovered).toEqual([]);
  });
});
