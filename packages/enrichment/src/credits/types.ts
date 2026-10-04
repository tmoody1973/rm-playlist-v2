export type FactGroup = "performer" | "writer" | "producer" | "engineer" | "release" | "connection";
export type ConnectionRole = "samples" | "interpolates" | "cover_of" | "sampled_by" | "covered_by";
export type FactSourceName = "musicbrainz" | "discogs" | "genius";

export interface FactSource {
  readonly source: FactSourceName;
  readonly sourceUrl: string;
  readonly sourceRef: string;
  readonly fetchedAt: number;
}

export interface CreditFact {
  readonly group: FactGroup;
  readonly role: string;
  readonly value: string;
  readonly personKey?: string;
  readonly linkedRecording?: {
    readonly title: string;
    readonly artist?: string;
    readonly mbid?: string;
  };
  readonly scope: "track" | "album";
  readonly sources: readonly FactSource[];
}

/** How the MusicBrainz recording id was obtained. */
export type RecordingVia = "isrc" | "search" | "stored";

export interface TrackForCredits {
  readonly trackId: string;
  readonly artist: string;
  readonly title: string;
  readonly album: string | null;
  readonly isrc: string | null;
  readonly recordingMbid: string | null;
  readonly hasAppleMatch: boolean;
}

export interface TrackCreditsResult {
  readonly creditsStatus: "found" | "none" | "error";
  readonly facts: CreditFact[];
  readonly cueTags: string[];
  readonly recordingMbid?: string;
  readonly releaseYear?: number;
  readonly matchConfidence: "high" | "low";
  readonly problems: string[];
}
