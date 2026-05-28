import { SignOutButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { PageManager } from "./PageManager";

/**
 * CMS admin home — page management (Phase 3a). Create pages from templates,
 * publish/unpublish, delete. The block-stack editor is Phase 3b.
 */
export default async function AdminHome() {
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
            Radio Milwaukee · CMS Admin
          </span>
          <h1 className="text-2xl font-bold tracking-tight">Pages</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/themes"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-semibold"
          >
            Themes
          </Link>
          {email !== null && <span className="text-sm text-neutral-500">{email}</span>}
          <SignOutButton redirectUrl="/">
            <button
              type="button"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-semibold"
            >
              Sign out
            </button>
          </SignOutButton>
        </div>
      </header>

      <PageManager />
    </main>
  );
}
