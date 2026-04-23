import type { ReactNode } from "react";
import { EnsureUserRecord } from "./EnsureUserRecord";
import { Shell } from "./Shell";

/**
 * Protected shell. Proxy (proxy.ts) already guards /dashboard/*.
 * Every dashboard route renders inside Shell (sidebar + top bar).
 * EnsureUserRecord fires once per session to upsert the Convex users row.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Shell>
      <EnsureUserRecord />
      {children}
    </Shell>
  );
}
