import type { FunctionReturnType } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import {
  buildCadenceSong,
  localDateKey,
  pickEpisode,
  type CadenceEpisode,
  type CadenceSong,
} from "./cadenceSong";
import { summarizePushEvents } from "./cadenceSummary";

/**
 * Live push of resolved plays into NPR Cadence.
 *
 * Flow: `enrichment.markPlayEnriched` schedules `pushPlay` for the play it
 * just resolved. The action claims the play, loads it with track/artist/
 * station, finds the Cadence episode on air at `playedAt`, and calls add-now.
 *
 * Config lives in the Convex env store:
 *   CADENCE_BASE_URL, CADENCE_CLIENT_ID, CADENCE_CLIENT_SECRET,
 *   CADENCE_CHANNEL_ID_<STATION> (only stations with a value are pushed),
 *   CADENCE_PUSH_MODE = "dry" (default) | "live".
 *
 * Dry mode does every read and builds the payload but never calls add-now;
 * the payload is logged as a `cadence_push_ok` event with `dryRun: true`.
 */

const CHANNEL_ENV_BY_STATION: Partial<Record<Doc<"stations">["slug"], string>> = {
  "88nine": "CADENCE_CHANNEL_ID_88NINE",
  hyfin: "CADENCE_CHANNEL_ID_HYFIN",
};

const CHANNEL_TIME_ZONE = "America/Chicago";

/** Value of `cadencePushedAt` while an action holds the play. */
const CLAIMED = 0;

/** Cadence episode search page size; a day has at most ~20 episodes. */
const EPISODE_PAGE_SIZE = 100;

interface PushOutcome {
  status: "skipped" | "dry-run" | "pushed" | "error";
  detail?: string;
}

/** Events scanned for the Streams-page rollup; ~a day of 88Nine plays plus heartbeats. */
const SUMMARY_SCAN_LIMIT = 600;

/**
 * Cadence push status for one station, for the Streams page. `mode` is
 * "off" when no channel ID is configured for the station.
 */
export const pushSummary = query({
  args: {
    stationSlug: v.union(
      v.literal("hyfin"),
      v.literal("88nine"),
      v.literal("414music"),
      v.literal("rhythmlab"),
    ),
  },
  handler: async (ctx, { stationSlug }) => {
    const mode: "off" | "live" | "dry" =
      channelIdFor(stationSlug) === undefined
        ? "off"
        : process.env.CADENCE_PUSH_MODE === "live"
          ? "live"
          : "dry";
    const station = await ctx.db
      .query("stations")
      .withIndex("by_slug", (q) => q.eq("slug", stationSlug))
      .first();
    if (station === null) return { mode, ...summarizePushEvents([], Date.now()) };
    const events = await ctx.db
      .query("ingestionEvents")
      .withIndex("by_station", (q) => q.eq("stationId", station._id))
      .order("desc")
      .take(SUMMARY_SCAN_LIMIT);
    return { mode, ...summarizePushEvents(events, Date.now()) };
  },
});

export const playContext = internalQuery({
  args: { playId: v.id("plays") },
  handler: async (ctx, { playId }) => {
    const play = await ctx.db.get(playId);
    if (play === null) return null;
    const station = await ctx.db.get(play.stationId);
    const track = play.canonicalTrackId ? await ctx.db.get(play.canonicalTrackId) : null;
    const artist = play.canonicalArtistId ? await ctx.db.get(play.canonicalArtistId) : null;
    return { play, station, track, artist };
  },
});

type PlayContext = NonNullable<FunctionReturnType<typeof internal.cadence.playContext>>;

/**
 * Atomically take ownership of a play for pushing. Convex mutations are
 * transactional, so two racing actions can't both see `undefined`.
 */
export const claimPush = internalMutation({
  args: { playId: v.id("plays") },
  handler: async (ctx, { playId }): Promise<boolean> => {
    const play = await ctx.db.get(playId);
    if (play === null || play.cadencePushedAt !== undefined) return false;
    await ctx.db.patch(playId, { cadencePushedAt: CLAIMED });
    return true;
  },
});

/** Finalize (real timestamp) or release (undefined, so a retry can push). */
export const settlePush = internalMutation({
  args: { playId: v.id("plays"), pushedAt: v.optional(v.number()) },
  handler: async (ctx, { playId, pushedAt }) => {
    await ctx.db.patch(playId, { cadencePushedAt: pushedAt });
  },
});

export const pushPlay = internalAction({
  args: { playId: v.id("plays") },
  handler: async (ctx, { playId }): Promise<PushOutcome> => {
    const claimed = await ctx.runMutation(internal.cadence.claimPush, { playId });
    if (!claimed) return { status: "skipped", detail: "already pushed or claimed" };

    const context = await ctx.runQuery(internal.cadence.playContext, { playId });
    const problem = eligibilityProblem(context);
    if (problem !== null || context === null) {
      await release(ctx, playId);
      return { status: "skipped", detail: problem ?? "no play" };
    }
    try {
      return await pushToCadence(ctx, context);
    } catch (err) {
      return await failPush(ctx, context.play, err);
    }
  },
});

function eligibilityProblem(context: PlayContext | null): string | null {
  if (context === null || context.station === null) return "no play";
  if (context.play.enrichmentStatus !== "resolved") return context.play.enrichmentStatus;
  if (channelIdFor(context.station.slug) === undefined) {
    return `no channel for ${context.station.slug}`;
  }
  return null;
}

async function pushToCadence(ctx: ActionCtx, context: PlayContext): Promise<PushOutcome> {
  const { play, station, track, artist } = context;
  const built = buildCadenceSong(
    {
      artistRaw: play.artistRaw,
      titleRaw: play.titleRaw,
      playedAt: play.playedAt,
      durationSec: play.durationSec,
      artist: artist ?? undefined,
      track: track ?? undefined,
    },
    CHANNEL_TIME_ZONE,
  );
  if (!built.ok) return skipPush(ctx, play, `not pushed: ${built.reason}`);

  const token = await fetchToken();
  const channelId = channelIdFor(station!.slug) ?? "";
  const episode = await findEpisode(token, channelId, play.playedAt);
  if (episode === null) return skipPush(ctx, play, "no Cadence episode on air at playedAt");

  return sendSong(ctx, play, episode, built.song, token);
}

async function sendSong(
  ctx: ActionCtx,
  play: Doc<"plays">,
  episode: CadenceEpisode,
  song: CadenceSong,
  token: string,
): Promise<PushOutcome> {
  const dryRun = process.env.CADENCE_PUSH_MODE !== "live";
  if (!dryRun) await addSongNow(token, episode.episodeId, song);
  await ctx.runMutation(internal.cadence.settlePush, { playId: play._id, pushedAt: Date.now() });
  await logEvent(ctx, play, "cadence_push_ok", `${dryRun ? "dry-run: " : ""}${song.title}`, {
    playId: play._id,
    dryRun,
    episodeId: episode.episodeId,
    programName: episode.programName,
    song,
  });
  return { status: dryRun ? "dry-run" : "pushed", detail: episode.episodeId };
}

/** Release the claim and record why the play was not sent. */
async function skipPush(ctx: ActionCtx, play: Doc<"plays">, reason: string): Promise<PushOutcome> {
  await release(ctx, play._id);
  await logEvent(ctx, play, "cadence_push_error", reason, {
    playId: play._id,
    playedAt: play.playedAt,
  });
  return { status: "skipped", detail: reason };
}

async function failPush(ctx: ActionCtx, play: Doc<"plays">, err: unknown): Promise<PushOutcome> {
  const message = err instanceof Error ? err.message : String(err);
  await release(ctx, play._id);
  await logEvent(ctx, play, "cadence_push_error", message, { playId: play._id });
  return { status: "error", detail: message };
}

async function release(ctx: ActionCtx, playId: Doc<"plays">["_id"]): Promise<void> {
  await ctx.runMutation(internal.cadence.settlePush, { playId, pushedAt: undefined });
}

function channelIdFor(slug: Doc<"stations">["slug"]): string | undefined {
  const envKey = CHANNEL_ENV_BY_STATION[slug];
  if (envKey === undefined) return undefined;
  const value = process.env[envKey];
  return value !== undefined && value.length > 0 ? value : undefined;
}

type EventKind = "cadence_push_ok" | "cadence_push_error";

async function logEvent(
  ctx: ActionCtx,
  play: Doc<"plays">,
  kind: EventKind,
  message: string,
  context: Record<string, unknown>,
): Promise<void> {
  await ctx.runMutation(internal.ingestionEvents.log, {
    orgId: play.orgId,
    stationId: play.stationId,
    sourceId: play.sourceId,
    kind,
    message,
    context,
  });
}

// --- Cadence HTTP -----------------------------------------------------------

function baseUrl(): string {
  return process.env.CADENCE_BASE_URL ?? "https://cadence.nprstations.org";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is not set on this Convex deployment`);
  }
  return value;
}

async function cadenceFetch(path: string, init: RequestInit, token?: string): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl()}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`Cadence ${init.method ?? "GET"} ${path} -> ${res.status}: ${body}`);
  }
  return res;
}

// ponytail: a token per push. ~60/hour across stations; cache in a table
// if NPR ever rate-limits the token endpoint.
async function fetchToken(): Promise<string> {
  const res = await cadenceFetch("/api/cadence/auth/token", {
    method: "POST",
    body: JSON.stringify({
      clientId: requireEnv("CADENCE_CLIENT_ID"),
      clientSecret: requireEnv("CADENCE_CLIENT_SECRET"),
    }),
  });
  const data = (await res.json()) as { access_token?: string };
  if (data.access_token === undefined)
    throw new Error("Cadence token response had no access_token");
  return data.access_token;
}

interface EpisodeSearchResponse {
  episodes?: Array<{
    episode?: {
      episodeId?: string;
      programName?: string;
      start?: { utc?: string };
      end?: { utc?: string };
    };
  }>;
}

async function searchEpisodes(token: string, channelId: string, day: string): Promise<unknown> {
  const body = JSON.stringify({
    channelId,
    startDate: day,
    endDate: day,
    size: EPISODE_PAGE_SIZE,
    sort: "start:asc",
  });
  const res = await cadenceFetch("/api/cadence/episode", { method: "POST", body }, token);
  return res.json();
}

function parseEpisodes(data: unknown): CadenceEpisode[] {
  const rows = (data as EpisodeSearchResponse).episodes ?? [];
  const episodes: CadenceEpisode[] = [];
  for (const { episode: e } of rows) {
    if (e?.episodeId && e.start?.utc && e.end?.utc) {
      episodes.push({
        episodeId: e.episodeId,
        programName: e.programName,
        startUtc: e.start.utc,
        endUtc: e.end.utc,
      });
    }
  }
  return episodes;
}

async function findEpisode(
  token: string,
  channelId: string,
  playedAt: number,
): Promise<CadenceEpisode | null> {
  const day = localDateKey(playedAt, CHANNEL_TIME_ZONE);
  const data = await searchEpisodes(token, channelId, day);
  return pickEpisode(parseEpisodes(data), playedAt);
}

async function addSongNow(token: string, episodeId: string, song: CadenceSong): Promise<void> {
  await cadenceFetch(
    `/api/cadence/episode/${episodeId}/add-now`,
    { method: "PUT", body: JSON.stringify(song) },
    token,
  );
}
