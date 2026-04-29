import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { EnsureUserRecord } from "./EnsureUserRecord";
import { Shell } from "./Shell";

/**
 * Domains allowed to access the operator dashboard.
 *
 * During shakedown this is a single-tenant allowlist for Radio Milwaukee
 * staff. When partner stations onboard, add their domains here — KEXP,
 * KCRW, The Current, etc. At that point also consider upgrading Clerk to
 * Pro and managing this in their dashboard's Allowlist UI instead, so
 * domain changes don't require a code deploy.
 *
 * The check is server-side (this is an async server component) so it
 * can't be bypassed by tampering with the client. proxy.ts already
 * guards /dashboard/* behind Clerk auth; this layer adds the
 * domain-allowlist check on top.
 */
const ALLOWED_EMAIL_DOMAINS = ["radiomilwaukee.org"];

function isAllowedDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain !== undefined && ALLOWED_EMAIL_DOMAINS.includes(domain);
}

/**
 * Protected shell. Proxy (proxy.ts) already guards /dashboard/* via
 * Clerk auth. This layout adds an additional email-domain allowlist
 * check on top — non-RM users get redirected to /access-denied with
 * a friendly explanation, even if they successfully authenticated.
 *
 * Every dashboard route renders inside Shell (sidebar + top bar).
 * EnsureUserRecord fires once per session to upsert the Convex users row.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  const primaryEmail = user?.primaryEmailAddress?.emailAddress ?? "";

  if (primaryEmail.length === 0 || !isAllowedDomain(primaryEmail)) {
    redirect("/access-denied");
  }

  return (
    <Shell>
      <EnsureUserRecord />
      {children}
    </Shell>
  );
}
