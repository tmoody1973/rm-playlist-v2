import { describe, expect, test } from "bun:test";
import { enrichCreditsBatch } from "./enrich-credits";

const row = (id: string) => ({ trackId: id, artist: "A", title: id, album: null, isrc: null, recordingMbid: null, hasAppleMatch: false });

function fakeClient(rows: ReturnType<typeof row>[]) {
  const writes: unknown[] = [];
  return {
    writes,
    query: async () => rows,
    mutation: async (_ref: unknown, args: unknown) => { writes.push(args); return null; },
  };
}

describe("enrichCreditsBatch", () => {
  test("writes one result per track and counts statuses", async () => {
    const client = fakeClient([row("t1"), row("t2")]);
    const summary = await enrichCreditsBatch({
      client: client as never,
      deadlineMs: Number.POSITIVE_INFINITY,
      now: () => 0,
      collect: async (track) => ({ creditsStatus: track.trackId === "t1" ? "found" : "none", facts: [], cueTags: [], matchConfidence: "low", problems: [] }),
    });
    expect(summary).toEqual({ attempted: 2, found: 1, none: 1, errored: 0, crashed: 0 });
    expect(client.writes).toHaveLength(2);
  });

  test("stops at the deadline", async () => {
    const client = fakeClient([row("t1"), row("t2")]);
    let clock = 0;
    const summary = await enrichCreditsBatch({
      client: client as never, deadlineMs: 5, now: () => clock,
      collect: async () => { clock += 10; return { creditsStatus: "none", facts: [], cueTags: [], matchConfidence: "low", problems: [] }; },
    });
    expect(summary.attempted).toBe(1);
  });

  test("a crash on one track doesn't stop the batch", async () => {
    const client = fakeClient([row("t1"), row("t2")]);
    const summary = await enrichCreditsBatch({
      client: client as never, deadlineMs: Number.POSITIVE_INFINITY, now: () => 0,
      collect: async (track) => { if (track.trackId === "t1") throw new Error("boom"); return { creditsStatus: "found", facts: [], cueTags: [], matchConfidence: "high", problems: [] }; },
    });
    expect(summary).toMatchObject({ attempted: 2, crashed: 1, found: 1 });
  });
});
