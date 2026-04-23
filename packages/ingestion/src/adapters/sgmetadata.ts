import { z } from "zod";
import type { NormalizedPlay } from "@rm/types";
import type { AdapterContract, AdapterParseContext } from "../types";
import { splitArtistTitle } from "../util";

/**
 * SGmetadata REST API. Official PDF: rev 1.0.1 (06/15/2020).
 *
 * Endpoints (base is universal, not per-account):
 *   Current:    GET https://jetapi.streamguys.com/<API_KEY>/scraper/<SCRAPER_UUID>/metadata
 *   All:        GET https://jetapi.streamguys.com/<API_KEY>/scraper/<SCRAPER_UUID>/metadata/all
 *
 * Note: the API key lives in the URL PATH (effectively a bearer token). Treat
 * as a secret — see docs/decisions/002-secrets-at-rest.md.
 *
 * Response shape (single):
 *   { "StreamTitle": "Artist - Title", "StreamUrl": "...?autoID=...", "date": "...", "timestamp": 1481226141687 }
 *
 * SGmetadata gives us one concatenated `StreamTitle` per play — we split on
 * the common separator to recover artist + title. Some `StreamTitle` values
 * don't follow the "Artist - Title" convention (DJ IDs, station promos, ad
 * breaks). Those become empty output — they are not errors.
 */

const SGMetadataObjectSchema = z
  .object({
    StreamTitle: z.string(),
    StreamUrl: z.string().optional(),
    date: z.string().optional(),
    timestamp: z.number(),
  })
  .passthrough();

const SGMetadataInputSchema = z.union([SGMetadataObjectSchema, z.array(z.unknown())]);

export interface SGMetadataPollConfig {
  /** Account-level API key, provided by StreamGuys tech support. Lives in env. */
  apiKey: string;
  /** Per-stream scraper UUID, provided by StreamGuys tech support. Lives in DB. */
  scraperUuid: string;
  /** Base URL override for tests; prod always uses jetapi.streamguys.com. */
  baseUrl?: string;
  /**
   * Endpoint mode. "current" returns the single current play; "all" returns
   * the full history array. Default "current" for polling loops.
   */
  mode?: "current" | "all";
}

function parseSingle(
  obj: z.infer<typeof SGMetadataObjectSchema>,
  context: AdapterParseContext,
): NormalizedPlay | null {
  const split = splitArtistTitle(obj.StreamTitle);
  if (split == null) return null;
  if (!Number.isFinite(obj.timestamp) || obj.timestamp <= 0) return null;

  return {
    stationSlug: context.stationSlug,
    source: "sgmetadata",
    artistRaw: split.artist,
    titleRaw: split.title,
    playedAt: obj.timestamp,
    raw: obj,
  };
}

function parseSGmetadata(raw: unknown, context: AdapterParseContext): NormalizedPlay[] {
  const top = SGMetadataInputSchema.safeParse(raw);
  if (!top.success) return [];

  if (Array.isArray(top.data)) {
    const plays: NormalizedPlay[] = [];
    for (const rawItem of top.data) {
      const item = SGMetadataObjectSchema.safeParse(rawItem);
      if (!item.success) continue;
      const play = parseSingle(item.data, context);
      if (play != null) plays.push(play);
    }
    return plays;
  }

  const single = parseSingle(top.data, context);
  return single ? [single] : [];
}

async function pollSGmetadata(
  config: SGMetadataPollConfig,
  context: AdapterParseContext,
): Promise<NormalizedPlay[]> {
  const base = config.baseUrl ?? "https://jetapi.streamguys.com";
  const endpoint = config.mode === "all" ? "/metadata/all" : "/metadata";
  const url = `${base}/${encodeURIComponent(config.apiKey)}/scraper/${encodeURIComponent(config.scraperUuid)}${endpoint}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`SGmetadata ${endpoint} returned ${res.status}`);
  }
  const body: unknown = await res.json();
  return parseSGmetadata(body, context);
}

export const sgmetadataAdapter: AdapterContract<SGMetadataPollConfig> = {
  kind: "sgmetadata",
  parse: parseSGmetadata,
  poll: pollSGmetadata,
};
