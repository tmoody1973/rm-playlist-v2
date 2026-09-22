import { describe, expect, test } from "bun:test";
import { summarizePushEvents, type PushEventInput } from "../convex/cadenceSummary";

const NOW = Date.parse("2026-09-22T23:40:00Z");
const HOUR = 60 * 60 * 1000;

function ok(agoMs: number, title: string, programName: string, dryRun = false): PushEventInput {
  return {
    kind: "cadence_push_ok",
    message: `${dryRun ? "dry-run: " : ""}${title}`,
    createdAt: NOW - agoMs,
    context: { dryRun, programName, song: { title } },
  };
}

describe("summarizePushEvents", () => {
  test("counts only the last 24h but reports the latest ok/error regardless of order", () => {
    const events: PushEventInput[] = [
      ok(2 * HOUR, "Older", "88Nine Afternoon Drive"),
      { kind: "cadence_push_error", message: "boom", createdAt: NOW - 30 * HOUR },
      ok(1 * HOUR, "Yip Yip Yow", "88Nine Nighttime"),
      ok(26 * HOUR, "Ancient", "88Nine Morning Show"),
      { kind: "poll_ok", message: "ignored", createdAt: NOW },
    ];
    expect(summarizePushEvents(events, NOW)).toEqual({
      okLast24h: 2,
      errorLast24h: 0,
      lastOk: {
        at: NOW - HOUR,
        title: "Yip Yip Yow",
        programName: "88Nine Nighttime",
        dryRun: false,
      },
      lastError: { at: NOW - 30 * HOUR, message: "boom" },
    });
  });

  test("flags a dry-run push and tolerates missing context", () => {
    const events: PushEventInput[] = [
      ok(HOUR, "Supernova", "88Nine Nighttime", true),
      { kind: "cadence_push_ok", message: "bare", createdAt: NOW - 2 * HOUR },
    ];
    const s = summarizePushEvents(events, NOW);
    expect(s.lastOk?.dryRun).toBe(true);
    expect(s.okLast24h).toBe(2);
  });

  test("empty input yields zeros and nulls", () => {
    expect(summarizePushEvents([], NOW)).toEqual({
      okLast24h: 0,
      errorLast24h: 0,
      lastOk: null,
      lastError: null,
    });
  });
});
