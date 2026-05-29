import Link from "next/link";

/**
 * Phase 0 placeholder for the public microsites root. The real station hubs
 * (`/[station]`) and the block render pipeline land in Phase 1.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <span className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
        Radio Milwaukee
      </span>
      <h1
        className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Station microsites
      </h1>
      <p className="text-base leading-relaxed text-neutral-600">
        Themeable pages for HYFIN, 88Nine, and Rhythm Lab — now playing, recent playlists, upcoming
        events, and campaigns. Public station hubs arrive in Phase 1.
      </p>
      <div>
        <Link
          href="/admin"
          className="inline-flex rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Open admin
        </Link>
      </div>
    </main>
  );
}
