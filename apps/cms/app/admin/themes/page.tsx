import Link from "next/link";
import { ThemeManager } from "./ThemeManager";

/**
 * Theme management (Phase 4). Gated by the /admin layout (Clerk +
 * @radiomilwaukee.org). Listing is readable by any CMS user; the create/edit/
 * default/delete controls are admin-only — enforced server-side in the theme
 * mutations and mirrored in the UI.
 */
export default function ThemesPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-1">
        <Link href="/admin" className="text-sm text-neutral-500 underline">
          ← All pages
        </Link>
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
          Radio Milwaukee · CMS Admin
        </span>
        <h1 className="text-2xl font-bold tracking-tight">Themes</h1>
      </header>
      <ThemeManager />
    </main>
  );
}
