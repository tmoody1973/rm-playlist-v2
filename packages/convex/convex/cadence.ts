import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import {
  buildCadenceSong,
  localDateKey,
  pickEpisode,
  type CadenceEpisode,
  type CadenceSong,
} from "./cadenceSong";

/**
 * Live push of resolved plays into NPR Cadence.
 *
 * Flow: `enrichment.markPlayEnriched` schedules `pushPlay` for the play it
 * just resolved. The action loads the play with its track/artist/station,
 * finds the Cadence episode on air at `playedAt`, and calls add-now.
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

export const markPushed = internalMutation({
  args: { playId: v.id("plays"), pushedAt: v.number() },
  handler: async (ctx, { playId, pushedAt }) => {
    await ctx.db.patch(playId, { cadencePushedAt: pushedAt });
  },
});

export const pushPlay = internalAction({
  args: { playId: v.id("plays") },
  handler: async (ctx, { playId }): Promise<{ status: string; detail?: string }> => {
    const context = await ctx.runQuery(internal.cadence.playContext, { playId });
    if (context === null || context.station === null)
      return { status: "skipped", detail: "no play" };
    const { play, station, track, artist } = context;

    // ponytail: guard only, not a lock. A retried markPlayEnriched can race
    // two pushes through here; add a claim mutation if duplicates show up.
    if (play.cadencePushedAt !== undefined) return { status: "skipped", detail: "already pushed" };
    if (play.enrichmentStatus !== "resolved")
      return { status: "skipped", detail: play.enrichmentStatus };

    const channelId = channelIdFor(station.slug);
    if (channelId === undefined)
      return { status: "skipped", detail: `no channel for ${station.slug}` };

    const built = buildCadenceSong({
      artistRaw: play.artistRaw,
      titleRaw: play.titleRaw,
      playedAt: play.playedAt,
      durationSec: play.durationSec,
      artist: artist ?? undefined,
      track: track ?? undefined,
    });
    if (!built.ok) {
      await logEvent(ctx, play, "cadence_push_error", `not pushed: ${built.reason}`, { playId });
      return { status: "skipped", detail: built.reason };
    }

    try {
      const token = await fetchToken();
      const episode = await findEpisode(token, channelId, play.playedAt);
      if (episode === null) {
        await logEvent(ctx, play, "cadence_push_error", "no Cadence episode on air at playedAt", {
          playId,
          playedAt: play.playedAt,
        });
        return { status: "error", detail: "no episode" };
      }

      const dryRun = process.env.CADENCE_PUSH_MODE !== "live";
      if (!dryRun) await addSongNow(token, episode.episodeId, built.song);

      await ctx.runMutation(internal.cadence.markPushed, { playId, pushedAt: Date.now() });
      await logEvent(
        ctx,
        play,
        "cadence_push_ok",
        `${dryRun ? "dry-run: " : ""}${built.song.title}`,
        {
          playId,
          dryRun,
          episodeId: episode.episodeId,
          programName: episode.programName,
          song: built.song,
        },
      );
      return { status: dryRun ? "dry-run" : "pushed", detail: episode.episodeId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logEvent(ctx, play, "cadence_push_error", message, { playId });
      return { status: "error", detail: message };
    }
  },
});

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

async function findEpisode(
  token: string,
  channelId: string,
  playedAt: number,
): Promise<CadenceEpisode | null> {
  const day = localDateKey(playedAt, CHANNEL_TIME_ZONE);
  const res = await cadenceFetch(
    "/api/cadence/episode",
    {
      method: "POST",
      body: JSON.stringify({
        channelId,
        startDate: day,
        endDate: day,
        size: 100,
        sort: "start:asc",
      }),
    },
    token,
  );
  const data = (await res.json()) as EpisodeSearchResponse;
  const episodes: CadenceEpisode[] = [];
  for (const row of data.episodes ?? []) {
    const e = row.episode;
    if (e?.episodeId && e.start?.utc && e.end?.utc) {
      episodes.push({
        episodeId: e.episodeId,
        programName: e.programName,
        startUtc: e.start.utc,
        endUtc: e.end.utc,
      });
    }
  }
  return pickEpisode(episodes, playedAt);
}

async function addSongNow(token: string, episodeId: string, song: CadenceSong): Promise<void> {
  await cadenceFetch(
    `/api/cadence/episode/${episodeId}/add-now`,
    { method: "PUT", body: JSON.stringify(song) },
    token,
  );
}
