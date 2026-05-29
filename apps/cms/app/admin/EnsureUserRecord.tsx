"use client";

import { api } from "@rm/convex/api";
import { useConvexAuth, useMutation } from "convex/react";
import { useEffect } from "react";

/**
 * On first mount, ensure the Convex `users` row exists for the signed-in Clerk
 * identity. Idempotent. Mirrors apps/web/app/dashboard/EnsureUserRecord.tsx.
 *
 * Gated on `useConvexAuth().isAuthenticated` so we wait for Clerk's token to
 * propagate into the ConvexProviderWithClerk-wrapped client before calling the
 * mutation — otherwise the server throws "called without a signed-in user".
 */
export function EnsureUserRecord() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensure = useMutation(api.users.ensureUserRecord);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) return;
    void ensure({});
  }, [isLoading, isAuthenticated, ensure]);

  return null;
}
