export type RecallStatus = "ok" | "options" | "cues_unchecked" | "no_spins";

export const MAX_MATCHES = 3;
/** Cues read per question; extra cues only make a full match less likely. */
const MAX_CUES = 5;
const RICH_MIN_TRACK_FACTS = 3;
/** Used when a spin has no duration: a typical song length. */
const FALLBACK_DURATION_SEC = 210;

export interface SpinForRecall {
  readonly playId: string;
  readonly playedAt: number;
  readonly durationSec: number | null;
  readonly cueTags: readonly string[];
  /** ignored (station IDs, promos) or soft-deleted — never a match, never a neighbor. */
  readonly hidden: boolean;
}

export type RankedSpin = SpinForRecall & { readonly matchedCues: string[] };

function distance(spin: SpinForRecall, windowMid: number): number {
  return Math.abs(spin.playedAt - windowMid);
}

export function normalizeCues(cues: readonly string[]): string[] {
  return [...new Set(cues.map((cue) => cue.toLowerCase()))].slice(0, MAX_CUES);
}

/** Cue matches first, then closeness to the middle of the asked-about window. */
export function rankSpins(spins: readonly SpinForRecall[], cues: readonly string[], windowMid: number): RankedSpin[] {
  const wanted = cues.map((cue) => cue.toLowerCase());
  return spins
    .filter((spin) => !spin.hidden)
    .map((spin) => ({ ...spin, matchedCues: wanted.filter((cue) => spin.cueTags.includes(cue)) }))
    .sort((a, b) => b.matchedCues.length - a.matchedCues.length || distance(a, windowMid) - distance(b, windowMid));
}

function coversMoment(spin: SpinForRecall, moment: number): boolean {
  const end = spin.playedAt + (spin.durationSec ?? FALLBACK_DURATION_SEC) * 1000;
  return spin.playedAt <= moment && moment < end;
}

/** Mirrors InstrumentFamily in packages/enrichment/src/credits/instrumentFamily.ts — keep the two in sync. */
export const INSTRUMENT_FAMILIES: readonly string[] = ["horns", "keys", "strings", "bass", "guitar", "electronic", "drums", "percussion", "vocals"];

const DECADE_TAG = /^\d{4}s$/;

/**
 * Whether a spin's credits were actually looked at for these cues. "local" (station-added)
 * and decade tags say nothing about instruments or style, so they don't count.
 */
function isCheckedFor(spin: RankedSpin, wantsInstrument: boolean): boolean {
  if (wantsInstrument) return spin.cueTags.some((tag) => INSTRUMENT_FAMILIES.includes(tag));
  return spin.cueTags.some((tag) => tag !== "local" && !DECADE_TAG.test(tag));
}

function chooseCueStatus(ranked: readonly RankedSpin[], cues: readonly string[]): RecallStatus {
  const [top, second] = ranked as [RankedSpin, RankedSpin | undefined];
  const distinctRequestedCues = [...new Set(cues.map((c) => c.toLowerCase()))];
  const wantsInstrument = distinctRequestedCues.some((cue) => INSTRUMENT_FAMILIES.includes(cue));
  if (!ranked.some((spin) => isCheckedFor(spin, wantsInstrument))) return "cues_unchecked";

  // "ok" only when the top spin matches every cue, every competitor was checked, and the runner-up matched fewer.
  const matchesAllCues = top.matchedCues.length === distinctRequestedCues.length;
  const competitorsChecked = ranked.every((spin, idx) => idx === 0 || isCheckedFor(spin, wantsInstrument));
  const clearWinner = second === undefined || top.matchedCues.length > second.matchedCues.length;
  return matchesAllCues && competitorsChecked && clearWinner ? "ok" : "options";
}

export function chooseRecallStatus(ranked: readonly RankedSpin[], cues: readonly string[], windowMid: number): RecallStatus {
  const top = ranked[0];
  if (top === undefined) return "no_spins";
  if (cues.length > 0) return chooseCueStatus(ranked, cues);
  return coversMoment(top, windowMid) ? "ok" : "options";
}

export function neighborSpin(spinsByTimeAsc: readonly SpinForRecall[], anchorPlayId: string, direction: "before" | "after"): SpinForRecall | null {
  const visible = spinsByTimeAsc.filter((spin) => !spin.hidden || spin.playId === anchorPlayId);
  const index = visible.findIndex((spin) => spin.playId === anchorPlayId);
  if (index === -1) return null;
  return visible[direction === "before" ? index - 1 : index + 1] ?? null;
}

export function evidenceLevel(input: { resolved: boolean; matchConfidence?: "high" | "low"; trackScopeFactCount: number }): "rich" | "basic" | "none" {
  if (!input.resolved) return "none";
  return input.matchConfidence === "high" && input.trackScopeFactCount >= RICH_MIN_TRACK_FACTS ? "rich" : "basic";
}

const DEFAULT_CONNECTION_LIMIT = 5;
const MAX_CONNECTION_LIMIT = 10;

/** Union of two play reads, one row per _id, oldest first. */
export function mergePlaysAscending<T extends { _id: string; playedAt: number }>(first: readonly T[], second: readonly T[]): T[] {
  return dedupeByKey([...first, ...second], (play) => play._id).sort((a, b) => a.playedAt - b.playedAt);
}

export function dedupeByKey<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function clampConnectionLimit(limit: number | undefined): number {
  const requested = limit === undefined || Number.isNaN(limit) ? DEFAULT_CONNECTION_LIMIT : Math.floor(limit);
  return Math.min(MAX_CONNECTION_LIMIT, Math.max(1, requested));
}
