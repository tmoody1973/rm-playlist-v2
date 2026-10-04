import { instrumentFamily } from "./instrumentFamily";
import type { CreditFact, RecordingVia } from "./types";

/** Cue tags never include vocals: "the one with singing" doesn't narrow anything. */
const UNTAGGED_FAMILIES = new Set(["vocals"]);

function normalizeName(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}

function mergeKey(fact: CreditFact): string {
  const rolePart = fact.group === "performer" ? (instrumentFamily(fact.role) ?? fact.role.toLowerCase()) : fact.role.toLowerCase();
  return `${fact.group}|${rolePart}|${normalizeName(fact.value)}`;
}

function preferMbPersonKey(a?: string, b?: string): string | undefined {
  if (a?.startsWith("mb:")) return a;
  if (b?.startsWith("mb:")) return b;
  return a ?? b;
}

/**
 * Collapse the same statement from several sources into one fact.
 * ponytail: person identity across sources is by normalized name; two
 * different people with the same name on one track would merge (rare).
 */
export function mergeFacts(facts: readonly CreditFact[]): CreditFact[] {
  const merged = new Map<string, CreditFact>();
  for (const fact of facts) {
    const key = mergeKey(fact);
    const existing = merged.get(key);
    merged.set(key, existing === undefined ? fact : {
      ...existing,
      personKey: preferMbPersonKey(existing.personKey, fact.personKey),
      scope: existing.scope === "track" || fact.scope === "track" ? "track" : "album",
      sources: [...existing.sources, ...fact.sources],
    });
  }
  return [...merged.values()];
}

function decadeTag(year?: number): string[] {
  return year === undefined ? [] : [`${Math.floor(year / 10) * 10}s`];
}

export function deriveCueTags(input: {
  readonly facts: readonly CreditFact[];
  readonly releaseYear?: number;
  readonly styles: readonly string[];
}): string[] {
  const families = input.facts
    .filter((fact) => fact.group === "performer" && fact.scope === "track")
    .map((fact) => instrumentFamily(fact.role))
    .filter((family): family is NonNullable<typeof family> => family !== null && !UNTAGGED_FAMILIES.has(family));
  const styles = input.styles.map((style) => style.toLowerCase());
  return [...new Set([...families, ...decadeTag(input.releaseYear), ...styles])];
}

export function deriveMatchConfidence(via: RecordingVia | null, hasAppleMatch: boolean): "high" | "low" {
  if (via === "isrc") return "high";
  if ((via === "search" || via === "stored") && hasAppleMatch) return "high";
  return "low";
}
