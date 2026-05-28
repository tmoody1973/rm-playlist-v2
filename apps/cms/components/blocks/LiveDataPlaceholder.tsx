import type { LiveDataBlockType } from "@/lib/blocks";

const LABELS: Record<LiveDataBlockType, string> = {
  "now-playing": "Now playing",
  playlist: "Recent playlist",
  "upcoming-events": "Upcoming events",
  touring: "Artists we play, coming to town",
  "fundraiser-progress": "Fundraiser progress",
};

/**
 * Stand-in for live-data / campaign blocks until Phase 2 wires them to
 * @rm/convex queries. Keeps a station-home template renderable today.
 */
export function LiveDataPlaceholder({ type }: { type: LiveDataBlockType }) {
  return (
    <section className="px-6 py-8">
      <div
        className="mx-auto max-w-2xl px-5 py-6 text-center text-sm opacity-70"
        style={{
          background: "var(--rm-color-card)",
          borderRadius: "var(--rm-radius)",
        }}
      >
        {LABELS[type]} — live data coming soon.
      </div>
    </section>
  );
}
