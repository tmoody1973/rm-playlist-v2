import type { MbRecordingRelations, MbRelation } from "../musicbrainz/client";
import type { CreditFact, FactGroup, FactSource } from "./types";

const ARTIST_RELATION_GROUPS: Record<string, FactGroup> = {
  instrument: "performer", vocal: "performer", performer: "performer",
  producer: "producer", "co-producer": "producer",
  mix: "engineer", recording: "engineer", mastering: "engineer", engineer: "engineer", "sound engineer": "engineer",
  composer: "writer", lyricist: "writer", writer: "writer",
};

function artistFact(rel: MbRelation, source: FactSource): CreditFact | null {
  const group = ARTIST_RELATION_GROUPS[rel.type];
  const name = rel.artist?.name;
  if (group === undefined || name === undefined) return null;
  const role = rel.attributes?.[0] ?? rel.type;
  const personKey = rel.artist?.id ? `mb:${rel.artist.id}` : undefined;
  return { group, role, value: name, personKey, scope: "track", sources: [source] };
}

function sampleFact(rel: MbRelation, source: FactSource): CreditFact | null {
  if (rel.type !== "samples material" || rel.recording?.title === undefined) return null;
  const artist = rel.recording["artist-credit"]?.map((credit) => credit.name).filter(Boolean).join(", ") || undefined;
  const role = rel.direction === "backward" ? "sampled_by" : "samples";
  const linkedRecording = { title: rel.recording.title, artist, mbid: rel.recording.id };
  return { group: "connection", role, value: `${artist ?? "Unknown"} – ${rel.recording.title}`, linkedRecording, scope: "track", sources: [source] };
}

function workFacts(rel: MbRelation, source: FactSource): CreditFact[] {
  if (rel.type !== "performance" || rel.work?.title === undefined) return [];
  const writers = (rel.work.relations ?? []).map((inner) => artistFact(inner, source)).filter((f): f is CreditFact => f?.group === "writer");
  if (!rel.attributes?.includes("cover")) return writers;
  const cover: CreditFact = { group: "connection", role: "cover_of", value: rel.work.title, linkedRecording: { title: rel.work.title }, scope: "track", sources: [source] };
  return [cover, ...writers];
}

function parseYear(date?: string): number | undefined {
  const year = date ? Number.parseInt(date.slice(0, 4), 10) : Number.NaN;
  return Number.isFinite(year) ? year : undefined;
}

export function parseMusicBrainzRelations(json: MbRecordingRelations, fetchedAt: number): { facts: CreditFact[]; releaseYear?: number } {
  const source: FactSource = { source: "musicbrainz", sourceUrl: `https://musicbrainz.org/recording/${json.id}`, sourceRef: json.id, fetchedAt };
  const facts = (json.relations ?? []).flatMap((rel) => {
    const single = artistFact(rel, source) ?? sampleFact(rel, source);
    return single ? [single] : workFacts(rel, source);
  });
  return { facts, releaseYear: parseYear(json["first-release-date"]) };
}
