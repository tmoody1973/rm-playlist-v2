import { z } from "zod";
import type { NormalizedPlay } from "@rm/types";
import type { AdapterContract, AdapterParseContext } from "../types";

/**
 * Spinitron v2 API. Docs: https://spinitron.com/api
 *
 * Endpoint: GET https://spinitron.com/api/spins?count=N
 * Auth:     Authorization: Bearer <api-key>
 * Response: { items: [Spin, ...], _links: {...} }
 *
 * A Spin describes one recorded play on a Spinitron-managed station.
 * Subset used here is tolerant — `.passthrough()` preserves unknown fields
 * for audit in `raw`.
 */

const SpinSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    song: z.string(),
    artist: z.string(),
    release: z.string().nullish(), // album / release
    label: z.string().nullish(),
    start: z.string(), // ISO 8601
    duration: z.number().nullish(), // seconds
  })
  .passthrough();

const SpinitronResponseSchema = z
  .object({
    items: z.array(z.unknown()),
  })
  .passthrough();

export interface SpinitronPollConfig {
  /** Per-station Spinitron API key. */
  apiKey: string;
  /** How many recent spins to fetch. Defaults to 20. */
  count?: number;
  /** Base URL override for testing; production always uses spinitron.com. */
  baseUrl?: string;
}

function parseSpinitron(raw: unknown, context: AdapterParseContext): NormalizedPlay[] {
  const envelope = SpinitronResponseSchema.safeParse(raw);
  if (!envelope.success) return [];

  const plays: NormalizedPlay[] = [];
  for (const rawItem of envelope.data.items) {
    const parsed = SpinSchema.safeParse(rawItem);
    if (!parsed.success) continue;

    const { song, artist, release, label, start, duration } = parsed.data;

    const artistTrim = artist.trim();
    const titleTrim = song.trim();
    if (artistTrim.length === 0 || titleTrim.length === 0) continue;

    const playedAt = Date.parse(start);
    if (Number.isNaN(playedAt)) continue;

    const play: NormalizedPlay = {
      stationSlug: context.stationSlug,
      source: "spinitron",
      artistRaw: artistTrim,
      titleRaw: titleTrim,
      playedAt,
      raw: parsed.data,
    };
    if (release != null && release.trim().length > 0) play.albumRaw = release.trim();
    if (label != null && label.trim().length > 0) play.labelRaw = label.trim();
    if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
      play.durationSec = duration;
    }

    plays.push(play);
  }
  return plays;
}

async function pollSpinitron(
  config: SpinitronPollConfig,
  context: AdapterParseContext,
): Promise<NormalizedPlay[]> {
  const base = config.baseUrl ?? "https://spinitron.com";
  const count = config.count ?? 20;
  const url = `${base}/api/spins?count=${encodeURIComponent(count)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Spinitron ${url} returned ${res.status}`);
  }
  const body: unknown = await res.json();
  return parseSpinitron(body, context);
}

export const spinitronAdapter: AdapterContract<SpinitronPollConfig> = {
  kind: "spinitron",
  parse: parseSpinitron,
  poll: pollSpinitron,
};
