"use client";

import { useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@rm/convex/api";

/**
 * On first mount, make sure the Convex `users` row exists for the signed-in
 * Clerk identity. Idempotent — calling twice is fine.
 *
 * Client component so it runs once per dashboard session. The mutation reads
 * `ctx.auth.getUserIdentity()` server-side; no args needed here.
 */
export function EnsureUserRecord() {
  const ensure = useMutation(api.users.ensureUserRecord);

  useEffect(() => {
    void ensure({});
  }, [ensure]);

  return null;
}
