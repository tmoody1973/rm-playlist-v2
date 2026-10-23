import type { Auth } from "convex/server";

/**
 * Who counts as Radio Milwaukee staff, checked inside Convex.
 *
 * Clerk sign-up is open, so "has a session" includes anyone with a Gmail
 * account. The dashboard layout's domain allowlist
 * (apps/web/app/dashboard/layout.tsx) only guards pages — a direct call to a
 * Convex function never passes through it. Keep these two lists in sync.
 */
const STAFF_EMAIL_DOMAINS = ["radiomilwaukee.org"];

interface IdentityClaims {
  email?: string;
  emailVerified?: boolean;
}

export function isStaffIdentity(identity: IdentityClaims | null): boolean {
  if (identity === null || identity.email === undefined) return false;
  // Clerk's Convex JWT template may omit email_verified; reject only an explicit false.
  if (identity.emailVerified === false) return false;
  const email = identity.email.toLowerCase();
  return STAFF_EMAIL_DOMAINS.some((domain) => email.endsWith(`@${domain}`));
}

export async function isStaff(ctx: { auth: Auth }): Promise<boolean> {
  return isStaffIdentity(await ctx.auth.getUserIdentity());
}

export async function requireStaff(ctx: { auth: Auth }): Promise<void> {
  if (!(await isStaff(ctx))) {
    throw new Error("Only Radio Milwaukee staff can do this.");
  }
}
