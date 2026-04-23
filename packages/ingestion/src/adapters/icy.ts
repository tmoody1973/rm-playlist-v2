import type { NormalizedPlay } from "@rm/types";
import type { AdapterContract, AdapterParseContext } from "../types";
import { splitArtistTitle } from "../util";

/**
 * ICY in-band metadata parser.
 *
 * ICY is the Shoutcast/Icecast convention where every `icy-metaint` bytes of
 * audio stream data are followed by a length-prefixed metadata block
 * containing pairs like:
 *
 *   StreamTitle='Artist - Title';StreamUrl='...';
 *
 * This adapter only parses metadata *strings* — the listener that pulls them
 * off a live HTTP stream is the Fly persistent worker (services/icy-worker,
 * Week 3). That worker reads the bytes, extracts the metadata block, and
 * passes it here for normalization.
 *
 * ICY does not include timestamps in-band, so `playedAt` is set to the caller's
 * receipt time, which is close enough for reconciliation with Spinitron/SG.
 */

export interface IcyParseInput {
  streamTitle?: string;
  rawMetadataString?: string;
  receivedAt?: number;
}

const STREAM_TITLE_RE = /StreamTitle='([^']*)';?/;

function parseIcy(raw: unknown, context: AdapterParseContext): NormalizedPlay[] {
  let streamTitle: string | undefined;
  let rawForAudit: unknown = raw;
  let receivedAt: number | undefined;

  if (typeof raw === "string") {
    const match = raw.match(STREAM_TITLE_RE);
    if (match?.[1] != null) streamTitle = match[1];
  } else if (raw != null && typeof raw === "object") {
    const obj = raw as IcyParseInput;
    if (typeof obj.streamTitle === "string") {
      streamTitle = obj.streamTitle;
    } else if (typeof obj.rawMetadataString === "string") {
      const match = obj.rawMetadataString.match(STREAM_TITLE_RE);
      if (match?.[1] != null) streamTitle = match[1];
    }
    if (typeof obj.receivedAt === "number" && Number.isFinite(obj.receivedAt)) {
      receivedAt = obj.receivedAt;
    }
    rawForAudit = obj;
  }

  if (streamTitle == null || streamTitle.trim().length === 0) return [];

  const split = splitArtistTitle(streamTitle);
  if (split == null) return [];

  return [
    {
      stationSlug: context.stationSlug,
      source: "icy",
      artistRaw: split.artist,
      titleRaw: split.title,
      playedAt: receivedAt ?? Date.now(),
      raw: rawForAudit,
    },
  ];
}

export const icyAdapter: AdapterContract = {
  kind: "icy",
  parse: parseIcy,
  // poll intentionally omitted — ICY is a long-lived listener, not a poll-based
  // adapter. services/icy-worker (Week 3) owns the HTTP connection loop.
};
