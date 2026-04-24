"use client";

import { useEffect } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@rm/convex/api";

/**
 * On first mount, make sure the Convex `users` row exists for the signed-in
 * Clerk identity. Idempotent — calling twice is fine.
 *
 * Gated on `useConvexAuth().isAuthenticated` so we wait for Clerk's token to
 * propagate into the ConvexProviderWithClerk-wrapped client before calling
 * the mutation. Without this gate the effect fires on the same tick as mount,
 * before Convex has an auth identity, and the server throws
 * "ensureUserRecord called without a signed-in user".
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
