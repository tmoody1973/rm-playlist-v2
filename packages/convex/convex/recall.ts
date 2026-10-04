export type RecallStatus = "ok" | "options" | "cues_unchecked" | "no_spins";

export const MAX_MATCHES = 3;
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

export function chooseRecallStatus(ranked: readonly RankedSpin[], cues: readonly string[], windowMid: number): RecallStatus {
  const [top, second] = ranked;
  if (top === undefined) return "no_spins";
  if (cues.length > 0) {
    if (ranked.every((spin) => spin.cueTags.length === 0)) return "cues_unchecked";

    // Dedupe and lowercase requested cues
    const distinctRequestedCues = Array.from(new Set(cues.map((c) => c.toLowerCase())));

    // Return "ok" only when:
    // - top matches ALL requested cues
    // - no OTHER spin has empty cueTags (unchecked competitor)
    // - second is undefined OR second has fewer matched cues than top
    const matchesAllCues = top.matchedCues.length === distinctRequestedCues.length;
    const noUntaggedCompetitors = !ranked.some((spin, idx) => idx !== 0 && spin.cueTags.length === 0);
    const clearWinner = second === undefined || top.matchedCues.length > second.matchedCues.length;

    return matchesAllCues && noUntaggedCompetitors && clearWinner ? "ok" : "options";
  }
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
