import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { EnsureUserRecord } from "./EnsureUserRecord";

/**
 * Domains allowed into the CMS admin builder. Single-tenant allowlist for
 * Radio Milwaukee staff, mirroring apps/web/app/dashboard/layout.tsx.
 */
const ALLOWED_EMAIL_DOMAINS = ["radiomilwaukee.org"];

function isAllowedDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain !== undefined && ALLOWED_EMAIL_DOMAINS.includes(domain);
}

/**
 * Protected admin shell. proxy.ts already guards /admin/* behind Clerk auth;
 * this server component adds the email-domain allowlist on top — authenticated
 * non-RM users get redirected to /access-denied. The check is server-side so it
 * can't be bypassed client-side.
 *
 * EnsureUserRecord upserts the Convex `users` row once per session. Role-based
 * authorization on individual mutations arrives with the builder in Phase 3.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  const primaryEmail = user?.primaryEmailAddress?.emailAddress ?? "";

  if (primaryEmail.length === 0 || !isAllowedDomain(primaryEmail)) {
    redirect("/access-denied");
  }

  return (
    <>
      <EnsureUserRecord />
      {children}
    </>
  );
}
