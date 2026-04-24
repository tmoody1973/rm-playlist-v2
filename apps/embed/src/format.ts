/**
 * Formatting helpers shared across widget variants. Kept deliberately tiny —
 * the embed bundle budget is 15KB gzip (see vite.config.ts comment).
 */

/** "just now", "2m ago", "3h ago", "Apr 22". */
export function formatPlayedAt(epochMs: number): string {
  const ageSec = Math.floor((Date.now() - epochMs) / 1000);
  if (ageSec < 10) return "just now";
  if (ageSec < 60) return `${ageSec}s ago`;
  const ageMin = Math.floor(ageSec / 60);
  if (ageMin < 60) return `${ageMin}m ago`;
  const ageHr = Math.floor(ageMin / 60);
  if (ageHr < 24) return `${ageHr}h ago`;
  return new Date(epochMs).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
