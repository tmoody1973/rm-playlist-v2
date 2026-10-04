import type { GeniusSong } from "../genius/client";
import type { ConnectionRole, CreditFact, FactGroup, FactSource } from "./types";

/** Genius relationship → our fixed connection roles. Anything else (remix_of, translations…) is dropped. */
const RELATIONSHIP_ROLES: Record<string, ConnectionRole> = {
  samples: "samples",
  sampled_in: "sampled_by",
  interpolates: "interpolates",
  cover_of: "cover_of",
  covered_by: "covered_by",
};

function people(
  list: GeniusSong["producer_artists"],
  group: FactGroup,
  source: FactSource,
): CreditFact[] {
  return (list ?? []).flatMap((person) =>
    person.name === undefined || person.name === ""
      ? []
      : [
          {
            group,
            role: group,
            value: person.name,
            personKey: person.id ? `genius:${person.id}` : undefined,
            scope: "track" as const,
            sources: [source],
          },
        ],
  );
}

function connections(song: GeniusSong, source: FactSource): CreditFact[] {
  return (song.song_relationships ?? []).flatMap((relationship) => {
    const role = RELATIONSHIP_ROLES[relationship.relationship_type];
    if (role === undefined) return [];
    return (relationship.songs ?? []).flatMap((linked) => {
      if (!linked.title) return [];
      const artist = linked.primary_artist?.name;
      return [
        {
          group: "connection" as const,
          role,
          value: `${artist ?? "Unknown"} – ${linked.title}`,
          linkedRecording: { title: linked.title, artist },
          scope: "track" as const,
          sources: [source],
        },
      ];
    });
  });
}

/** Whitelist parser: reads only credit + relationship fields, never embed_content/description/annotations (lyrics). */
export function parseGeniusSong(song: GeniusSong, fetchedAt: number): CreditFact[] {
  const source: FactSource = {
    source: "genius",
    sourceUrl: song.url,
    sourceRef: String(song.id),
    fetchedAt,
  };
  return [
    ...people(song.producer_artists, "producer", source),
    ...people(song.writer_artists, "writer", source),
    ...connections(song, source),
  ];
}
