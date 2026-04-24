/**
 * Shared env-var helpers for Trigger.dev tasks.
 *
 * Extracted so each new cron doesn't re-implement the same precedence
 * rules or the same missing-var errors.
 */

export function getConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL or CONVEX_URL must be set on the Trigger.dev project");
  }
  return url;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}
