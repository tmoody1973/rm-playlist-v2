"use client";

import { useQuery } from "convex/react";
import { api } from "@rm/convex/api";

/**
 * Reads the Convex `users` row for the signed-in identity and renders a
 * small pill showing the role. Placeholder until the real chrome arrives
 * in Milestone 5.
 */
export function RoleBadge() {
  const me = useQuery(api.users.currentUser, {});

  if (me === undefined) {
    // Still loading
    return <span className="text-xs text-[#5C6168]">Checking role...</span>;
  }

  if (me === null) {
    return (
      <span className="rounded-full bg-[#2A1F0A] px-3 py-1 text-xs text-[#FFB81C]">
        No role yet
      </span>
    );
  }

  const pillBg = me.role === "admin" ? "bg-[#FFB81C]" : "bg-[#34D399]";
  const pillText = me.role === "admin" ? "text-[#1A1A1A]" : "text-[#0E0F11]";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${pillBg} ${pillText}`}>
      {me.role === "admin" ? "Admin" : "Operator"}
    </span>
  );
}
