import { describe, expect, test } from "bun:test";
import { enrichPlay } from "../src/index";
import { createThrottle } from "../src/throttle";
import { createMockFetch } from "./fetch-mock";
import appleHit from "./apple-music/fixtures/search-hit.json";
import appleMiss from "./apple-music/fixtures/search-miss.json";
import mbHit from "./musicbrainz/fixtures/recording-hit.json";
import mbMiss from "./musicbrainz/fixtures/recording-miss.json";

const fastThrottle = () => createThrottle({ ratePerSec: 1000 });

describe("enrichPlay", () => {
  test("runs both lookups in parallel and returns composed result", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: appleHit });
    mock.enqueue({ status: 200, body: mbHit });
    const result = await enrichPlay(
      { artist: "D'Angelo", title: "She's Always in My Hair" },
      { appleMusicToken: "jwt", musicBrainzThrottle: fastThrottle(), fetch: mock.fetch },
    );
    expect(result.appleMusic.matched).toBe(true);
    expect(result.musicBrainz.matched).toBe(true);
  });

  test("one adapter's failure doesn't prevent the other succeeding", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 429, body: "slow" });
    mock.enqueue({ status: 200, body: mbHit });
    const result = await enrichPlay(
      { artist: "D'Angelo", title: "She's Always in My Hair" },
      { appleMusicToken: "jwt", musicBrainzThrottle: fastThrottle(), fetch: mock.fetch },
    );
    expect(result.appleMusic.matched).toBe(false);
    expect(result.musicBrainz.matched).toBe(true);
  });

  test("both lookups miss cleanly when no match anywhere", async () => {
    const mock = createMockFetch();
    mock.enqueue({ status: 200, body: appleMiss });
    mock.enqueue({ status: 200, body: mbMiss });
    const result = await enrichPlay(
      { artist: "Obscure", title: "Unknown" },
      { appleMusicToken: "jwt", musicBrainzThrottle: fastThrottle(), fetch: mock.fetch },
    );
    expect(result.appleMusic.matched).toBe(false);
    expect(result.musicBrainz.matched).toBe(false);
  });
});
