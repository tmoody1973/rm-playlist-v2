/**
 * Every Finds / Apple Music function is reachable on the public Convex
 * deployment, so each one checks the caller holds Radio Commons' server key.
 * Constant-time compare so the key can't be guessed byte by byte from timing.
 */
export function assertServerKey(given: string, expected: string | undefined): void {
  if (!expected || given.length !== expected.length) throw new Error("Unauthorized");
  let difference = 0;
  for (let i = 0; i < expected.length; i += 1)
    difference |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  if (difference !== 0) throw new Error("Unauthorized");
}
