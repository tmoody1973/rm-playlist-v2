import { describe, expect, test } from "bun:test";
import { tracksMissingSoundExchangeFields } from "../convex/enrichment";
import { fakeCtx, handlerOf, type Row } from "./fakeDb";

const list = handlerOf<Record<string, unknown>, Array<Record<string, unknown>>>(
  tracksMissingSoundExchangeFields,
);

function resolvedPlay(id: string, trackId: string, fields: Partial<Row> = {}): Row {
  return {
    _id: id,
    stationId: "s1",
    playedAt: Date.now() - 60_000,
    enrichmentStatus: "resolved",
    canonicalTrackId: trackId,
    ...fields,
  };
}

describe("enrichment:tracksMissingSoundExchangeFields", () => {
  test("a track whose plays export with an estimated length is listed as such, so staff can correct it", async () => {
    const { ctx } = fakeCtx({
      stations: [{ _id: "s1", name: "88Nine" }],
      artists: [{ _id: "ar1", displayName: "Artist" }],
      tracks: [
        { _id: "guessed", artistId: "ar1", displayTitle: "Guessed", recordLabel: "L", isrc: "I" },
        { _id: "observed", artistId: "ar1", displayTitle: "Observed", recordLabel: "L", isrc: "I" },
      ],
      plays: [
        resolvedPlay("p1", "guessed", { durationSec: 210, durationSource: "estimated" }),
        resolvedPlay("p2", "observed", { durationSec: 200, durationSource: "observed" }),
      ],
    });
    const groups = await list(ctx, {});
    const byTitle = Object.fromEntries(groups.map((group) => [group.displayTitle, group]));
    expect(byTitle.Guessed).toMatchObject({ missingFields: ["duration"], durationEstimated: true });
    expect(byTitle.Observed).toMatchObject({
      missingFields: ["duration"],
      durationEstimated: false,
    });
  });
});
