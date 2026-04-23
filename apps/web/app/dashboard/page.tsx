import { currentUser } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { RoleBadge } from "./RoleBadge";

/**
 * Milestone 3 exit gate: authenticated dashboard landing renders with a role
 * badge and the current user's name. Replaces with the real wall-of-status
 * in Milestone 5.
 */
export default async function DashboardPage() {
  const user = await currentUser();

  return (
    <main className="flex flex-1 flex-col p-12">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-[#2A2F36] pb-6">
        <div className="flex items-center gap-3">
          <span className="font-semibold tracking-tight text-lg">Radio Milwaukee</span>
          <span className="text-sm text-[#5C6168]">/</span>
          <span className="text-sm text-[#8B9099]">Dashboard</span>
        </div>
        <div className="flex items-center gap-4">
          <RoleBadge />
          <UserButton afterSignOutUrl="/" />
        </div>
      </header>

      {/* Hero */}
      <section className="flex flex-1 flex-col items-start justify-center gap-4">
        <h1 className="text-5xl font-semibold tracking-tight">
          Hello, {user?.firstName ?? user?.username ?? "operator"}.
        </h1>
        <p className="max-w-lg text-base text-[#8B9099]">
          Milestone 3 scaffold landing. The wall-of-status + ingestion health panels arrive in
          Milestone 5. For now — sign-in works, Clerk → Convex auth bridge is live, your users row
          has been ensured.
        </p>
      </section>
    </main>
  );
}
