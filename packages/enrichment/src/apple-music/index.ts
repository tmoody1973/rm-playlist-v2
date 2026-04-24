import type { AppleMusicResult, FetchLike, PlayIdentity } from "../types";
import { AppleMusicError, searchSong } from "./client";

export interface LookupAppleMusicDeps {
  readonly token: string;
  readonly storefront?: string;
  readonly fetch?: FetchLike;
}

export async function lookupAppleMusic(
  play: PlayIdentity,
  deps: LookupAppleMusicDeps,
): Promise<AppleMusicResult> {
  try {
    const song = await searchSong({
      artist: play.artist,
      title: play.title,
      token: deps.token,
      storefront: deps.storefront,
      fetch: deps.fetch,
    });
    if (song == null) {
      return { matched: false, reason: "no_results" };
    }
    return {
      matched: true,
      songId: song.songId,
      artistAppleMusicId: song.artistAppleMusicId,
      artistName: song.artistName,
      title: song.name,
      albumName: song.albumName,
      previewUrl: song.previewUrl,
      artworkUrl: song.artworkUrl,
    };
  } catch (err) {
    if (err instanceof AppleMusicError) {
      return { matched: false, reason: err.code };
    }
    return { matched: false, reason: "other" };
  }
}

export { AppleMusicError, searchSong } from "./client";
export type { NormalizedSong, SearchSongInput } from "./client";
