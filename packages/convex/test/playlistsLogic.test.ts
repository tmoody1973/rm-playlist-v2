import { describe, expect, test } from "bun:test";
import {
  MAX_PLAYLISTS_PER_LISTENER,
  MAX_PLAYLIST_ITEMS,
  MAX_PLAYLIST_NAME_LENGTH,
  clampPlaylistItemsLimit,
  cleanPlaylistName,
  ownedBy,
} from "../convex/playlistsLogic";

describe("playlist caps", () => {
  test("20 playlists per listener, 100 songs each, 60-character names", () => {
    expect(MAX_PLAYLISTS_PER_LISTENER).toBe(20);
    expect(MAX_PLAYLIST_ITEMS).toBe(100);
    expect(MAX_PLAYLIST_NAME_LENGTH).toBe(60);
  });
});

describe("cleanPlaylistName", () => {
  test("trims surrounding whitespace", () => {
    expect(cleanPlaylistName("  Sunday Morning \n")).toBe("Sunday Morning");
  });
  test("null for blank or whitespace-only names", () => {
    expect(cleanPlaylistName("")).toBeNull();
    expect(cleanPlaylistName("   \t ")).toBeNull();
  });
  test("accepts exactly 60 characters, rejects 61 instead of truncating", () => {
    expect(cleanPlaylistName("a".repeat(60))).toBe("a".repeat(60));
    expect(cleanPlaylistName("a".repeat(61))).toBeNull();
  });
  test("counts an emoji as one character", () => {
    const name = `${"a".repeat(59)}🎧`;
    expect(cleanPlaylistName(name)).toBe(name);
  });
});

describe("clampPlaylistItemsLimit", () => {
  test("defaults to the whole playlist and clamps to 1..100", () => {
    expect(clampPlaylistItemsLimit(undefined)).toBe(100);
    expect(clampPlaylistItemsLimit(Number.NaN)).toBe(100);
    expect(clampPlaylistItemsLimit(0)).toBe(1);
    expect(clampPlaylistItemsLimit(-5)).toBe(1);
    expect(clampPlaylistItemsLimit(7.9)).toBe(7);
    expect(clampPlaylistItemsLimit(500)).toBe(100);
  });
});

describe("ownedBy", () => {
  const playlist = { listenerId: "user_a", name: "Late Night" };
  test("returns the playlist to its owner", () => {
    expect(ownedBy(playlist, "user_a")).toBe(playlist);
  });
  test("another listener's playlist reads exactly like a missing one", () => {
    expect(ownedBy(playlist, "user_b")).toBeNull();
    expect(ownedBy(null, "user_a")).toBeNull();
  });
});
