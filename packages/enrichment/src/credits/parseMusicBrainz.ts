import type { MbRecordingRelations, MbRelation } from "../musicbrainz/client";
import type { CreditFact, FactGroup, FactSource } from "./types";

const ARTIST_RELATION_GROUPS: Record<string, FactGroup> = {
  instrument: "performer", vocal: "performer", performer: "performer",
  producer: "producer", "co-producer": "producer",
  mix: "engineer", recording: "engineer", mastering: "engineer", engineer: "engineer", "sound engineer": "engineer",
  composer: "writer", lyricist: "writer", writer: "writer",
};

/** Attributes that qualify a credit rather than name an instrument ("additional guitar", "executive producer"). */
const MODIFIER_ATTRIBUTES = new Set(["additional", "guest", "solo", "minor", "co", "executive", "assistant", "associate"]);

/** Performers get one role per instrument/vocal attribute; other groups keep the type, prefixed by its modifiers. */
function rolesFor(rel: MbRelation, group: FactGroup): string[] {
  const attributes = rel.attributes ?? [];
  const modifiers = attributes.filter((attribute) => MODIFIER_ATTRIBUTES.has(attribute));
  if (group !== "performer") return [[...modifiers, rel.type].join(" ")];
  const instruments = attributes.filter((attribute) => !MODIFIER_ATTRIBUTES.has(attribute));
  return instruments.length > 0 ? instruments : [rel.type];
}

function artistFacts(rel: MbRelation, source: FactSource): CreditFact[] {
  const group = ARTIST_RELATION_GROUPS[rel.type];
  const name = rel.artist?.name;
  if (group === undefined || name === undefined) return [];
  const personKey = rel.artist?.id ? `mb:${rel.artist.id}` : undefined;
  return rolesFor(rel, group).map((role) => ({ group, role, value: name, personKey, scope: "track" as const, sources: [source] }));
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
  const writers = (rel.work.relations ?? []).flatMap((inner) => artistFacts(inner, source)).filter((f) => f.group === "writer");
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
    const people = artistFacts(rel, source);
    if (people.length > 0) return people;
    const sample = sampleFact(rel, source);
    return sample ? [sample] : workFacts(rel, source);
  });
  return { facts, releaseYear: parseYear(json["first-release-date"]) };
}
