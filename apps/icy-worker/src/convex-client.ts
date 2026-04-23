import { ConvexHttpClient } from "convex/browser";
import { api } from "@rm/convex/api";
import type { Id } from "@rm/convex/values";
import type { NormalizedPlay, StationSlug } from "@rm/types";

/**
 * Narrow gateway interface so the supervisor can be tested with an
 * in-memory fake without speaking Convex protocol.
 */

export type AdapterRole = "primary" | "supplementary" | "shadow";

export interface IcySource {
  readonly _id: string;
  readonly stationSlug: StationSlug;
  readonly role: AdapterRole;
  readonly streamUrl: string;
}

export type WriteResult =
  | { inserted: true }
  | { inserted: false; reason: "duplicate" }
  | { inserted: false; reason: "unknown_source"; error: string };

export interface ConvexGateway {
  listIcySources(): Promise<IcySource[]>;
  writePlay(sourceId: string, play: NormalizedPlay): Promise<WriteResult>;
}

export interface RealGatewayOptions {
  readonly url: string;
}

export function createConvexGateway({ url }: RealGatewayOptions): ConvexGateway {
  const client = new ConvexHttpClient(url);

  return {
    async listIcySources(): Promise<IcySource[]> {
      const rows = await client.query(api.ingestionSources.listEnabledForPolling, {});
      const icy: IcySource[] = [];
      for (const row of rows) {
        if (row.adapter !== "icy") continue;
        const streamUrl = row.config.streamUrl;
        if (typeof streamUrl !== "string" || streamUrl.length === 0) continue;
        icy.push({
          _id: row._id,
          stationSlug: row.stationSlug,
          role: row.role,
          streamUrl,
        });
      }
      return icy;
    },

    async writePlay(sourceId: string, play: NormalizedPlay): Promise<WriteResult> {
      try {
        const result = await client.mutation(api.plays.recordStreamPlay, {
          sourceId: sourceId as Id<"ingestionSources">,
          play: {
            artistRaw: play.artistRaw,
            titleRaw: play.titleRaw,
            albumRaw: play.albumRaw,
            labelRaw: play.labelRaw,
            durationSec: play.durationSec,
            playedAt: play.playedAt,
            raw: play.raw,
          },
        });
        if (result.inserted) return { inserted: true };
        return { inserted: false, reason: "duplicate" };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("Unknown source")) {
          return { inserted: false, reason: "unknown_source", error: message };
        }
        throw err;
      }
    },
  };
}
