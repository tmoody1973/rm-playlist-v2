/**
 * Stand-in for blocks not yet implemented. Used for `fundraiser-progress`
 * until Phase 5. The Phase 2 live-data blocks (now-playing, playlist,
 * upcoming-events, touring) now have real components.
 */
export function LiveDataPlaceholder({ label }: { label: string }) {
  return (
    <section className="px-6 py-8">
      <div
        className="mx-auto max-w-2xl px-5 py-6 text-center text-sm opacity-70"
        style={{
          background: "var(--rm-color-card)",
          borderRadius: "var(--rm-radius)",
        }}
      >
        {label} — coming soon.
      </div>
    </section>
  );
}
