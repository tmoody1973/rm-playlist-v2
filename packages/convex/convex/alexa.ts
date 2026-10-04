import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { matchKey } from "./matchKey";
import { upcomingShowsByMetro } from "./plays";
import {
  chooseRecallStatus,
  clampConnectionLimit,
  dedupeByKey,
  evidenceLevel,
  MAX_MATCHES,
  mergePlaysAscending,
  neighborSpin,
  normalizeCues,
  rankSpins,
  type SpinForRecall,
} from "./recall";

/** Spins read on each side of the window midpoint (~3 hours at ~20/hour), so a wide window keeps the spins nearest the middle. */
const HALF_WINDOW_SPINS = 30;
/** Spins read on each side of an anchor when the caller asks for the one before/after. */
const NEIGHBOR_SCAN = 10;
const LOCAL_STATION_SLUG = "414music";
const stationSlug = v.union(
  v.literal("hyfin"),
  v.literal("88nine"),
  v.literal("414music"),
  v.literal("rhythmlab"),
);

type LoadedSpin = { play: Doc<"plays">; track: Doc<"tracks"> | null; recall: SpinForRecall };

async function loadSpins(
  ctx: QueryCtx,
  plays: Doc<"plays">[],
  isLocal: boolean,
): Promise<LoadedSpin[]> {
  const tracks = await Promise.all(
    plays.map((play) => (play.canonicalTrackId ? ctx.db.get(play.canonicalTrackId) : null)),
  );
  return plays.map((play, i) => {
    const track = tracks[i] ?? null;
    const cueTags = [...(track?.cueTags ?? []), ...(isLocal ? ["local"] : [])];
    const hidden = play.enrichmentStatus === "ignored" || play.deletedAt !== undefined;
    return {
      play,
      track,
      recall: {
        playId: play._id,
        playedAt: play.playedAt,
        durationSec: play.durationSec ?? track?.durationSec ?? null,
        cueTags,
        hidden,
      },
    };
  });
}

async function toMatch(ctx: QueryCtx, spin: LoadedSpin, label: string, matchedCues: string[]) {
  const artist = spin.track
    ? ((await ctx.db.get(spin.track.artistId))?.displayName ?? spin.play.artistRaw)
    : spin.play.artistRaw;
  const title = spin.track?.displayTitle ?? spin.play.titleRaw;
  return {
    label,
    playId: spin.play._id,
    artist,
    title,
    playedAt: spin.play.playedAt,
    trackId: spin.track?._id ?? null,
    matchKey: matchKey(artist, title),
    matchedCues,
    matchReason: matchedCues.length > 0 ? `tagged ${matchedCues.join(", ")}` : null,
    matchConfidence: spin.track?.matchConfidence ?? null,
    artworkUrl: spin.track?.artworkUrl ?? null,
    previewUrl: spin.track?.previewUrl ?? null,
    upcomingShows: await upcomingShowsByMetro(ctx, artist),
  };
}

async function stationBySlug(ctx: QueryCtx, slug: string) {
  return ctx.db
    .query("stations")
    .withIndex("by_slug", (q) => q.eq("slug", slug as Doc<"stations">["slug"]))
    .first();
}

async function playsAround(
  ctx: QueryCtx,
  stationId: Id<"stations">,
  from: number,
  mid: number,
  to: number,
  take: number,
) {
  const before = await ctx.db
    .query("plays")
    .withIndex("by_station_played_at", (q) =>
      q.eq("stationId", stationId).gte("playedAt", from).lte("playedAt", mid),
    )
    .order("desc")
    .take(take);
  const after = await ctx.db
    .query("plays")
    .withIndex("by_station_played_at", (q) =>
      q.eq("stationId", stationId).gt("playedAt", mid).lte("playedAt", to),
    )
    .take(take);
  return mergePlaysAscending(before, after);
}

async function neighborMatch(
  ctx: QueryCtx,
  stationId: Id<"stations">,
  anchorId: Id<"plays">,
  direction: "before" | "after",
  isLocal: boolean,
) {
  const anchor = await ctx.db.get(anchorId);
  if (anchor === null || anchor.stationId !== stationId) return null;
  const earlier = await ctx.db
    .query("plays")
    .withIndex("by_station_played_at", (q) =>
      q.eq("stationId", stationId).lte("playedAt", anchor.playedAt),
    )
    .order("desc")
    .take(NEIGHBOR_SCAN);
  const later = await ctx.db
    .query("plays")
    .withIndex("by_station_played_at", (q) =>
      q.eq("stationId", stationId).gte("playedAt", anchor.playedAt),
    )
    .take(NEIGHBOR_SCAN);
  const spins = await loadSpins(ctx, mergePlaysAscending([anchor, ...earlier], later), isLocal);
  const next = neighborSpin(
    spins.map((s) => s.recall),
    anchorId,
    direction,
  );
  const loaded = next ? spins.find((s) => s.recall.playId === next.playId) : undefined;
  return loaded ? toMatch(ctx, loaded, "1", []) : null;
}

/**
 * Alexa: "what was that song on 88Nine around 8:15 / with the horns /
 * no, the one before that". Index reads only — no outside calls.
 */
export const findSongPlayed = query({
  args: {
    station: stationSlug,
    from: v.number(),
    to: v.number(),
    cues: v.optional(v.array(v.string())),
    // Strings, not v.id: an id Alexa made up answers "no_spins" instead of failing as an outage.
    beforePlayId: v.optional(v.string()),
    afterPlayId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const station = await stationBySlug(ctx, args.station);
    if (station === null) return { status: "unknown_station" as const, matches: [] };
    const isLocal = args.station === LOCAL_STATION_SLUG;
    const rawAnchorId = args.beforePlayId ?? args.afterPlayId;
    if (rawAnchorId !== undefined) {
      const anchorId = ctx.db.normalizeId("plays", rawAnchorId);
      if (anchorId === null) return { status: "no_spins" as const, matches: [] };
      const match = await neighborMatch(
        ctx,
        station._id,
        anchorId,
        args.beforePlayId ? "before" : "after",
        isLocal,
      );
      return {
        status: match ? ("ok" as const) : ("no_spins" as const),
        matches: match ? [match] : [],
      };
    }
    const cues = normalizeCues(args.cues ?? []);
    const windowMid = (args.from + args.to) / 2;
    const spins = await loadSpins(
      ctx,
      await playsAround(ctx, station._id, args.from, windowMid, args.to, HALF_WINDOW_SPINS),
      isLocal,
    );
    const ranked = rankSpins(
      spins.map((s) => s.recall),
      cues,
      windowMid,
    );
    const status = chooseRecallStatus(ranked, cues, windowMid);
    const top = ranked.slice(0, status === "ok" ? 1 : MAX_MATCHES);
    const matches = await Promise.all(
      top.map((r, i) =>
        toMatch(
          ctx,
          spins.find((s) => s.recall.playId === r.playId)!,
          String(i + 1),
          r.matchedCues,
        ),
      ),
    );
    return { status, matches };
  },
});

function groupFacts(facts: Doc<"facts">[]) {
  const grouped: Record<
    string,
    Array<Omit<Doc<"facts">, "_id" | "_creationTime" | "trackId">>
  > = {};
  for (const {
    _id: _unusedId,
    _creationTime: _unusedCreation,
    trackId: _unusedTrack,
    ...fact
  } of facts)
    (grouped[fact.group] ??= []).push(fact);
  return grouped;
}

async function trackBasics(ctx: QueryCtx, track: Doc<"tracks">) {
  const artist = (await ctx.db.get(track.artistId))?.displayName ?? "";
  return {
    artist,
    title: track.displayTitle,
    album: track.albumDisplayName ?? null,
    year: track.releaseYear ?? null,
    label: track.recordLabel ?? null,
    isrc: track.isrc ?? null,
    artworkUrl: track.artworkUrl ?? null,
    previewUrl: track.previewUrl ?? null,
  };
}

/** Alexa: "where does that sound come from / tell me about it". Unresolved plays answer with playlist basics. */
export const getTrackFacts = query({
  // Strings, not v.id: an id Alexa made up answers "not_found" instead of failing as an outage.
  args: { trackId: v.optional(v.string()), playId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const playId = args.playId ? ctx.db.normalizeId("plays", args.playId) : null;
    const play = playId ? await ctx.db.get(playId) : null;
    const trackId = (args.trackId ? ctx.db.normalizeId("tracks", args.trackId) : null) ?? play?.canonicalTrackId;
    const track = trackId ? await ctx.db.get(trackId) : null;
    if (track === null) {
      if (play === null) return { status: "not_found" as const };
      const basics = {
        artist: play.artistRaw,
        title: play.titleRaw,
        album: play.albumRaw ?? null,
        year: null,
        label: play.labelRaw ?? null,
        isrc: null,
        artworkUrl: null,
        previewUrl: null,
      };
      return {
        status: "ok" as const,
        trackId: null,
        ...basics,
        matchKey: matchKey(play.artistRaw, play.titleRaw),
        evidence: "none" as const,
        facts: {},
        upcomingShows: await upcomingShowsByMetro(ctx, play.artistRaw),
      };
    }
    const facts = await ctx.db
      .query("facts")
      .withIndex("by_track", (q) => q.eq("trackId", track._id))
      .collect();
    const basics = await trackBasics(ctx, track);
    const trackScopeFactCount = facts.filter(
      (f) => f.scope === "track" && f.group !== "release",
    ).length;
    return {
      status: "ok" as const,
      trackId: track._id,
      ...basics,
      matchKey: matchKey(basics.artist, basics.title),
      evidence: evidenceLevel({
        resolved: true,
        matchConfidence: track.matchConfidence,
        trackScopeFactCount,
      }),
      facts: groupFacts(facts),
      upcomingShows: await upcomingShowsByMetro(ctx, basics.artist),
    };
  },
});

const MAX_PEOPLE_SCANNED = 10;
/** Caps a busy session player so one person can't blow the read budget. */
const MAX_TRACKS_PER_PERSON = 25;

async function lastPlayedAt(ctx: QueryCtx, trackId: Id<"tracks">): Promise<number | null> {
  const latest = await ctx.db
    .query("plays")
    .withIndex("by_canonical_track", (q) => q.eq("canonicalTrackId", trackId))
    .order("desc")
    .first();
  return latest?.playedAt ?? null;
}

async function sharedPeople(ctx: QueryCtx, trackId: Id<"tracks">, facts: Doc<"facts">[]) {
  const personFacts = facts.filter((f) => f.personKey !== undefined);
  const people = dedupeByKey(personFacts, (f) => f.personKey as string).slice(
    0,
    MAX_PEOPLE_SCANNED,
  );
  const found = await Promise.all(
    people.map(async (person) => {
      const others = await ctx.db
        .query("facts")
        .withIndex("by_person", (q) => q.eq("personKey", person.personKey))
        .take(MAX_TRACKS_PER_PERSON);
      return Promise.all(
        others
          .filter((o) => o.trackId !== trackId)
          .map(async (other) => {
            const played = await lastPlayedAt(ctx, other.trackId);
            const otherTrack = played === null ? null : await ctx.db.get(other.trackId);
            if (otherTrack === null || played === null) return null;
            const artist = (await ctx.db.get(otherTrack.artistId))?.displayName ?? "";
            return {
              kind: "shared_person" as const,
              personKey: person.personKey as string,
              person: person.value,
              role: person.role,
              otherRole: other.role,
              otherTrack: { trackId: otherTrack._id, artist, title: otherTrack.displayTitle },
              lastPlayedAt: played,
            };
          }),
      );
    }),
  );
  const connections = found.flat().filter((c): c is NonNullable<typeof c> => c !== null);
  return dedupeByKey(connections, (c) => `${c.personKey}|${c.otherTrack.trackId}`);
}

async function sampleLinks(ctx: QueryCtx, facts: Doc<"facts">[]) {
  return Promise.all(
    facts
      .filter((f) => f.group === "connection")
      .map(async (fact) => {
        const mbid = fact.linkedRecording?.mbid;
        const ours = mbid
          ? await ctx.db
              .query("tracks")
              .withIndex("by_recording_mbid", (q) => q.eq("recordingMbid", mbid))
              .first()
          : null;
        const played = ours ? await lastPlayedAt(ctx, ours._id) : null;
        return {
          kind: "link" as const,
          role: fact.role,
          value: fact.value,
          linkedRecording: fact.linkedRecording ?? null,
          played: played !== null,
          lastPlayedAt: played,
          sources: fact.sources,
        };
      }),
  );
}

/** Station-only SongDNA: people on this track who are on other tracks we've played, plus samples/covers. */
export const getTrackConnections = query({
  args: { trackId: v.id("tracks"), limit: v.optional(v.number()) },
  handler: async (ctx, { trackId, limit }) => {
    const cap = clampConnectionLimit(limit);
    const facts = await ctx.db
      .query("facts")
      .withIndex("by_track", (q) => q.eq("trackId", trackId))
      .collect();
    const byRecency = (a: { lastPlayedAt: number | null }, b: { lastPlayedAt: number | null }) =>
      (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0);
    const people = (await sharedPeople(ctx, trackId, facts)).sort(byRecency).slice(0, cap);
    const links = (await sampleLinks(ctx, facts)).sort(byRecency).slice(0, cap);
    return { people, links };
  },
});
