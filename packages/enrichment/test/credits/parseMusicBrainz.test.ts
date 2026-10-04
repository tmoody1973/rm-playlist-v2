import { describe, expect, test } from "bun:test";
import { parseMusicBrainzRelations } from "../../src/credits/parseMusicBrainz";
import { fetchRecordingRelations, lookupRecordingByIsrc } from "../../src/musicbrainz/client";
import { createThrottle } from "../../src/throttle";
import { createMockFetch } from "../fetch-mock";
import isrcHit from "./fixtures/mb-isrc.json";
import relations from "./fixtures/mb-relations.json";

const fastThrottle = () => createThrottle({ ratePerSec: 1000 });

describe("lookupRecordingByIsrc", () => {
  test("prefers the recording whose title matches", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: isrcHit });
    const mbid = await lookupRecordingByIsrc({ isrc: "GBBKS2000152", title: "Victory Dance", throttle: fastThrottle(), fetch: mock.fetch });
    expect(mbid).toBe("rec-studio");
    expect(mock.calls[0]?.url).toContain("/isrc/GBBKS2000152");
  });
  test("404 → null", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 404, body: { error: "Not Found" } });
    expect(await lookupRecordingByIsrc({ isrc: "X", title: "Y", throttle: fastThrottle(), fetch: mock.fetch })).toBeNull();
  });
});

describe("fetchRecordingRelations", () => {
  test("requests relations, work-level relations and releases", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: relations });
    await fetchRecordingRelations({ recordingMbid: "rec-studio", throttle: fastThrottle(), fetch: mock.fetch });
    expect(mock.calls[0]?.url).toContain("inc=artist-rels+recording-rels+work-rels+work-level-rels");
  });
});

describe("parseMusicBrainzRelations", () => {
  const { facts, releaseYear } = parseMusicBrainzRelations(relations as never, 1000);
  const find = (role: string) => facts.find((fact) => fact.role === role);

  test("release year from first-release-date", () => expect(releaseYear).toBe(2019));
  test("instrument credits are track-scope performers with mb person keys", () => {
    expect(find("trumpet")).toMatchObject({ group: "performer", value: "Ife Ogunjobi", personKey: "mb:art-dylan", scope: "track" });
  });
  test("vocals, producer, mix map to groups", () => {
    expect(find("lead vocals")?.group).toBe("performer");
    expect(find("producer")?.group).toBe("producer");
    expect(find("mix")?.group).toBe("engineer");
  });
  test("samples both directions", () => {
    expect(find("samples")?.linkedRecording).toEqual({ title: "Old Groove", artist: "Old Band", mbid: "rec-old" });
    expect(find("sampled_by")?.linkedRecording?.mbid).toBe("rec-new");
  });
  test("cover performance → cover_of + composer as writer", () => {
    expect(find("cover_of")?.linkedRecording?.title).toBe("Original Song");
    expect(find("composer")).toMatchObject({ group: "writer", value: "Writer Person" });
  });
  test("unknown relation types are dropped; every fact has a source", () => {
    expect(facts.some((fact) => fact.value === "Photo Person")).toBe(false);
    for (const fact of facts) expect(fact.sources[0]?.sourceUrl).toBe("https://musicbrainz.org/recording/rec-studio");
  });
});
