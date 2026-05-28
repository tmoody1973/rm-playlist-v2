import { SignOutButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";

/**
 * Phase 0 placeholder admin home. Confirms the Clerk gate + Convex provider are
 * wired. The page list, create-from-template, and block-stack editor land in
 * Phase 3.
 */
export default async function AdminHome() {
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <span className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
        Radio Milwaukee · CMS Admin
      </span>
      <h1 className="text-3xl font-bold tracking-tight">Admin — Phase 0</h1>
      <p className="text-base leading-relaxed text-neutral-600">
        You&apos;re in. The page builder, templates, and theme management arrive in later phases.
        For now this confirms the Clerk gate and Convex backend are connected.
      </p>
      {email !== null && (
        <p className="font-mono text-sm text-neutral-500">
          Signed in as <span className="text-neutral-900">{email}</span>.
        </p>
      )}
      <div>
        <SignOutButton redirectUrl="/">
          <button
            type="button"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold"
          >
            Sign out
          </button>
        </SignOutButton>
      </div>
    </main>
  );
}
