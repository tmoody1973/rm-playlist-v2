import { describe, expect, test } from "bun:test";
import { searchGeniusSong } from "../../src/genius/client";
import { parseGeniusSong } from "../../src/credits/parseGenius";
import { createThrottle } from "../../src/throttle";
import { createMockFetch } from "../fetch-mock";
import search from "./fixtures/genius-search.json";
import song from "./fixtures/genius-song.json";

const fastThrottle = () => createThrottle({ ratePerSec: 1000 });

describe("searchGeniusSong", () => {
  test("accepts only an exact artist+title match, sends bearer token", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: search });
    const id = await searchGeniusSong({
      artist: "Ezra Collective",
      title: "Victory Dance",
      token: "t",
      throttle: fastThrottle(),
      fetch: mock.fetch,
    });
    expect(id).toBe(901);
    expect(mock.calls[0]?.headers.authorization).toBe("Bearer t");
  });
  test("a similar but different song is rejected", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: search });
    const id = await searchGeniusSong({
      artist: "Ezra Collective",
      title: "Victory Lap",
      token: "t",
      throttle: fastThrottle(),
      fetch: mock.fetch,
    });
    expect(id).toBeNull();
  });
});

describe("parseGeniusSong", () => {
  const facts = parseGeniusSong(song.response.song as never, 1000);

  test("producers, writers, mapped relationships; unmapped relationship dropped", () => {
    expect(facts.map((f) => `${f.group}:${f.role}:${f.value}`)).toEqual([
      "producer:producer:Producer Person",
      "writer:writer:Writer Person",
      "connection:samples:Old Band – Old Groove",
      "connection:covered_by:Cover Band – Victory Dance",
    ]);
  });
  test("no lyric-bearing field reaches any fact", () => {
    expect(JSON.stringify(facts)).not.toContain("LYRIC LINE");
  });
  test("source is the genius song page", () => {
    expect(facts[0]?.sources[0]).toMatchObject({
      source: "genius",
      sourceUrl: "https://genius.com/Ezra-collective-victory-dance",
      sourceRef: "901",
    });
  });
});

test("relationship without songs → no throw, no facts from it", () => {
  const bare = {
    id: 1,
    url: "https://genius.com/x",
    song_relationships: [{ relationship_type: "samples" }],
  };
  expect(parseGeniusSong(bare as never, 1000)).toEqual([]);
});
