import { describe, expect, test } from "bun:test";
import { reEnrichTrack } from "../convex/enrichment";

type Patch = { id: string; fields: Record<string, unknown> };

function fakeCtx(resolvedPlayIds: string[]) {
  const patches: Patch[] = [];
  const chain = {
    withIndex: () => chain,
    filter: () => chain,
    take: async () => resolvedPlayIds.map((_id) => ({ _id })),
  };
  const db = {
    query: () => chain,
    patch: async (id: string, fields: Record<string, unknown>) => {
      patches.push({ id, fields });
    },
  };
  return { ctx: { db }, patches };
}

const handler = (
  reEnrichTrack as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<{ flipped: number }>;
  }
)._handler;

describe("reEnrichTrack", () => {
  test("flips resolved plays to pending and resets the track's credits so the credits phase retries it", async () => {
    const { ctx, patches } = fakeCtx(["p1", "p2"]);
    const result = await handler(ctx, { trackId: "t1" });
    expect(result).toEqual({ flipped: 2 });
    expect(patches).toContainEqual({ id: "p1", fields: { enrichmentStatus: "pending" } });
    expect(patches).toContainEqual({
      id: "t1",
      fields: { creditsStatus: undefined, creditsFetchedAt: undefined },
    });
  });
});
