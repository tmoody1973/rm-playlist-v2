import { SignOutButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";

/**
 * Friendly bounce for users who authenticated but whose email domain isn't on
 * the admin allowlist (app/admin/layout.tsx). Mirrors apps/web's access-denied
 * page, self-contained styling (no shared design-token CSS in the CMS yet).
 */
export default async function AccessDeniedPage() {
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-16 text-neutral-900">
      <div className="flex max-w-xl flex-col gap-5 text-center">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
          Radio Milwaukee · CMS
        </span>
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          This admin is for Radio Milwaukee staff.
        </h1>
        <p className="text-base leading-relaxed text-neutral-600">
          The CMS admin is restricted to staff with a{" "}
          <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-sm">
            @radiomilwaukee.org
          </code>{" "}
          email. If you should have access — or signed up with the wrong email — email{" "}
          <a
            href="mailto:digital@radiomilwaukee.org"
            className="font-medium text-neutral-900 underline underline-offset-2"
          >
            digital@radiomilwaukee.org
          </a>{" "}
          and we&apos;ll get you sorted.
        </p>
        {email !== null && (
          <p className="font-mono text-sm text-neutral-500">
            You&apos;re currently signed in as <span className="text-neutral-900">{email}</span>.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold"
        >
          Back to homepage
        </Link>
        <SignOutButton redirectUrl="/">
          <button
            type="button"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Sign out
          </button>
        </SignOutButton>
      </div>
    </main>
  );
}
