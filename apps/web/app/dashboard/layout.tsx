import type { ReactNode } from "react";
import { EnsureUserRecord } from "./EnsureUserRecord";

/**
 * Protected shell. Proxy (proxy.ts) already guards /dashboard/*; this layout
 * just ensures the Convex user row exists on first authenticated visit.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <EnsureUserRecord />
      {children}
    </>
  );
}
