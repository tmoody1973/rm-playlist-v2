import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { dedupeKeyFor } from "./findsLogic";
import { assertListenerId, assertServerKey } from "./listenerGuard";
import {
  MAX_PLAYLISTS_PER_LISTENER,
  MAX_PLAYLIST_ITEMS,
  clampPlaylistItemsLimit,
  cleanPlaylistName,
  ownedBy,
} from "./playlistsLogic";

// Items are capped at MAX_PLAYLIST_ITEMS, so remove finishes in one batch; the loop guards a drifted counter.
const DELETE_BATCH_SIZE = MAX_PLAYLIST_ITEMS;

const guard = (serverKey: string) =>
  assertServerKey(serverKey, process.env.RADIO_COMMONS_SERVER_KEY);

/** Ids arrive as strings from Radio Commons; a bad, missing or someone else's id all read as null. */
async function ownedPlaylist(
  ctx: QueryCtx | MutationCtx,
  listenerId: string,
  rawPlaylistId: string,
): Promise<Doc<"listenerPlaylists"> | null> {
  const playlistId = ctx.db.normalizeId("listenerPlaylists", rawPlaylistId);
  return playlistId === null ? null : ownedBy(await ctx.db.get(playlistId), listenerId);
}

// ponytail: mirrors songFor in finds.ts, copied so this PR leaves finds.ts untouched; export that one after Oct 23.
async function songFor(ctx: MutationCtx, play: Doc<"plays">) {
  const track = play.canonicalTrackId ? await ctx.db.get(play.canonicalTrackId) : null;
  const artist = track
    ? ((await ctx.db.get(track.artistId))?.displayName ?? play.artistRaw)
    : play.artistRaw;
  const station = await ctx.db.get(play.stationId);
  return {
    track,
    artist,
    title: track?.displayTitle ?? play.titleRaw,
    stationSlug: station?.slug ?? "unknown",
  };
}

async function livePlay(ctx: MutationCtx, rawPlayId: string): Promise<Doc<"plays"> | null> {
  const playId = ctx.db.normalizeId("plays", rawPlayId);
  const play = playId === null ? null : await ctx.db.get(playId);
  return play === null || play.deletedAt !== undefined ? null : play;
}

// Returned statuses, not thrown errors: Convex prod strips error messages, so callers couldn't tell cases apart.
type NotFound = { status: "not_found" };

type CreateResult =
  | { status: "ok"; playlistId: Id<"listenerPlaylists">; name: string }
  | { status: "bad_name" }
  | { status: "limit" };

export const create = mutation({
  args: { serverKey: v.string(), listenerId: v.string(), name: v.string() },
  handler: async (ctx, { serverKey, listenerId, name: rawName }): Promise<CreateResult> => {
    guard(serverKey);
    assertListenerId(listenerId);
    const name = cleanPlaylistName(rawName);
    if (name === null) return { status: "bad_name" };
    const existing = await ctx.db
      .query("listenerPlaylists")
      .withIndex("by_listener", (q) => q.eq("listenerId", listenerId))
      .take(MAX_PLAYLISTS_PER_LISTENER);
    if (existing.length >= MAX_PLAYLISTS_PER_LISTENER) return { status: "limit" };
    const now = Date.now();
    const playlistId = await ctx.db.insert("listenerPlaylists", {
      listenerId,
      name,
      createdAt: now,
      updatedAt: now,
      itemCount: 0,
    });
    return { status: "ok", playlistId, name };
  },
});

type AddSongResult =
  | NotFound
  | { status: "full" }
  | {
      status: "ok";
      alreadyIn: boolean;
      playlistName: string;
      artist: string;
      title: string;
      itemCount: number;
    };

export const addSong = mutation({
  // playId is a string, not v.id: a made-up id from the model must answer "which song?", not fail.
  args: {
    serverKey: v.string(),
    listenerId: v.string(),
    playlistId: v.string(),
    playId: v.string(),
  },
  handler: async (ctx, args): Promise<AddSongResult> => {
    guard(args.serverKey);
    assertListenerId(args.listenerId);
    const playlist = await ownedPlaylist(ctx, args.listenerId, args.playlistId);
    if (playlist === null) return { status: "not_found" };
    const play = await livePlay(ctx, args.playId);
    if (play === null) return { status: "not_found" };
    const { track, artist, title, stationSlug } = await songFor(ctx, play);
    const dedupeKey = dedupeKeyFor(play._id, track?._id);
    const existing = await ctx.db
      .query("listenerPlaylistItems")
      .withIndex("by_playlist_dedupe", (q) =>
        q.eq("playlistId", playlist._id).eq("dedupeKey", dedupeKey),
      )
      .first();
    const song = { playlistName: playlist.name, artist, title };
    if (existing !== null)
      return { status: "ok", alreadyIn: true, ...song, itemCount: playlist.itemCount };
    if (playlist.itemCount >= MAX_PLAYLIST_ITEMS) return { status: "full" };
    const now = Date.now();
    await ctx.db.insert("listenerPlaylistItems", {
      playlistId: playlist._id,
      listenerId: args.listenerId,
      playId: play._id,
      trackId: track?._id,
      dedupeKey,
      artist,
      title,
      stationSlug,
      addedAt: now,
    });
    const itemCount = playlist.itemCount + 1;
    await ctx.db.patch(playlist._id, { itemCount, updatedAt: now });
    return { status: "ok", alreadyIn: false, ...song, itemCount };
  },
});

export const removeSong = mutation({
  args: {
    serverKey: v.string(),
    listenerId: v.string(),
    playlistId: v.string(),
    itemId: v.string(),
  },
  handler: async (ctx, args): Promise<NotFound | { status: "ok" }> => {
    guard(args.serverKey);
    assertListenerId(args.listenerId);
    const playlist = await ownedPlaylist(ctx, args.listenerId, args.playlistId);
    const itemId = ctx.db.normalizeId("listenerPlaylistItems", args.itemId);
    const item = playlist === null || itemId === null ? null : await ctx.db.get(itemId);
    if (playlist === null || item === null || item.playlistId !== playlist._id)
      return { status: "not_found" };
    await ctx.db.delete(item._id);
    await ctx.db.patch(playlist._id, {
      itemCount: Math.max(0, playlist.itemCount - 1),
      updatedAt: Date.now(),
    });
    return { status: "ok" };
  },
});

export const list = query({
  args: { serverKey: v.string(), listenerId: v.string() },
  handler: async (ctx, { serverKey, listenerId }) => {
    guard(serverKey);
    assertListenerId(listenerId);
    const playlists = await ctx.db
      .query("listenerPlaylists")
      .withIndex("by_listener", (q) => q.eq("listenerId", listenerId))
      .order("desc")
      .take(MAX_PLAYLISTS_PER_LISTENER);
    return playlists.map((playlist) => ({
      playlistId: playlist._id,
      name: playlist.name,
      itemCount: playlist.itemCount,
      updatedAt: playlist.updatedAt,
    }));
  },
});

async function itemView(ctx: QueryCtx, item: Doc<"listenerPlaylistItems">) {
  const track = item.trackId ? await ctx.db.get(item.trackId) : null;
  return {
    itemId: item._id,
    playId: item.playId,
    trackId: item.trackId ?? null,
    artist: item.artist,
    title: item.title,
    stationSlug: item.stationSlug,
    addedAt: item.addedAt,
    artworkUrl: track?.artworkUrl ?? null,
    previewUrl: track?.previewUrl ?? null,
  };
}

type PlaylistItemView = Awaited<ReturnType<typeof itemView>>;

type GetResult =
  | NotFound
  | {
      status: "ok";
      playlistId: Id<"listenerPlaylists">;
      name: string;
      items: PlaylistItemView[];
    };

export const get = query({
  args: {
    serverKey: v.string(),
    listenerId: v.string(),
    playlistId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<GetResult> => {
    guard(args.serverKey);
    assertListenerId(args.listenerId);
    const playlist = await ownedPlaylist(ctx, args.listenerId, args.playlistId);
    if (playlist === null) return { status: "not_found" };
    const items = await ctx.db
      .query("listenerPlaylistItems")
      .withIndex("by_playlist", (q) => q.eq("playlistId", playlist._id))
      .order("desc")
      .take(clampPlaylistItemsLimit(args.limit));
    return {
      status: "ok",
      playlistId: playlist._id,
      name: playlist.name,
      items: await Promise.all(items.map((item) => itemView(ctx, item))),
    };
  },
});

async function deleteItems(ctx: MutationCtx, playlistId: Id<"listenerPlaylists">) {
  let deletedItems = 0;
  for (;;) {
    // Reads inside a mutation see its own deletes, so each pass picks up the next batch.
    const batch = await ctx.db
      .query("listenerPlaylistItems")
      .withIndex("by_playlist", (q) => q.eq("playlistId", playlistId))
      .take(DELETE_BATCH_SIZE);
    if (batch.length === 0) return deletedItems;
    await Promise.all(batch.map((item) => ctx.db.delete(item._id)));
    deletedItems += batch.length;
  }
}

export const remove = mutation({
  args: { serverKey: v.string(), listenerId: v.string(), playlistId: v.string() },
  handler: async (ctx, args): Promise<NotFound | { status: "ok"; deletedItems: number }> => {
    guard(args.serverKey);
    assertListenerId(args.listenerId);
    const playlist = await ownedPlaylist(ctx, args.listenerId, args.playlistId);
    if (playlist === null) return { status: "not_found" };
    const deletedItems = await deleteItems(ctx, playlist._id);
    await ctx.db.delete(playlist._id);
    return { status: "ok", deletedItems };
  },
});
