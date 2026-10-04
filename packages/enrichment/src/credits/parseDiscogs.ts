import type { DiscogsCredit, DiscogsRelease } from "../discogs/client";
import { instrumentFamily } from "./instrumentFamily";
import type { CreditFact, FactGroup, FactSource } from "./types";

const ROLE_GROUPS: ReadonlyArray<readonly [RegExp, FactGroup]> = [
  [/^(written|composed|lyrics|songwriter|music by|words by)/i, "writer"],
  [/^(co-)?produc/i, "producer"],
  [/(engineer|mixed|mastered|recorded|mixing|mastering)/i, "engineer"],
];

const BRACKETS = /\s*\[[^\]]*\]/g;

/** "Saxophone [Tenor], Flute" → ["Saxophone", "Flute"]. Brackets go first so their commas don't split. */
function splitRoles(role: string): string[] {
  return role.replace(BRACKETS, "").split(",").map((part) => part.trim()).filter(Boolean);
}

function groupFor(role: string): FactGroup | null {
  for (const [pattern, group] of ROLE_GROUPS) if (pattern.test(role)) return group;
  return instrumentFamily(role) === null ? null : "performer";
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function creditFacts(credit: DiscogsCredit, scope: "track" | "album", source: FactSource): CreditFact[] {
  if (!credit.name || !credit.role) return [];
  const name = credit.name;
  const personKey = credit.id ? `discogs:${credit.id}` : undefined;
  return splitRoles(credit.role).flatMap((role) => {
    const group = groupFor(role);
    return group === null ? [] : [{ group, role, value: name, personKey, scope, sources: [source] }];
  });
}

function namesPosition(tracks: string | undefined, position: string | undefined): boolean {
  if (!tracks || !position) return false;
  return tracks.split(/[,&]/).map((part) => part.trim()).includes(position);
}

/** null = credit names only other tracks, so it says nothing about ours. */
// ponytail: ranges ("A1 to A3") are not expanded; they fall back to album scope (no false cue tags).
function releaseCreditScope(tracks: string | undefined, position: string | undefined): "track" | "album" | null {
  if (!tracks?.trim()) return "album";
  if (namesPosition(tracks, position)) return "track";
  return / to /i.test(tracks) ? "album" : null;
}

export function parseDiscogsRelease(json: DiscogsRelease, trackTitle: string, fetchedAt: number): { facts: CreditFact[]; styles: string[]; year?: number } {
  const source: FactSource = { source: "discogs", sourceUrl: json.uri ?? `https://www.discogs.com/release/${json.id}`, sourceRef: String(json.id), fetchedAt };
  const ourTrack = (json.tracklist ?? []).find((track) => slug(track.title ?? "") === slug(trackTitle));
  const trackCredits = (ourTrack?.extraartists ?? []).flatMap((credit) => creditFacts(credit, "track", source));
  const releaseCredits = (json.extraartists ?? []).flatMap((credit) => {
    const scope = releaseCreditScope(credit.tracks, ourTrack?.position);
    return scope === null ? [] : creditFacts(credit, scope, source);
  });
  return { facts: [...trackCredits, ...releaseCredits], styles: json.styles ?? [], year: json.year || undefined };
}
