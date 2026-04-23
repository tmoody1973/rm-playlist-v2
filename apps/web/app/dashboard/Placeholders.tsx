/**
 * Row 2 left and Row 3 placeholders. The real Reports panel + Upcoming
 * from rotation land in Week 3-6. Keeping the shapes/copy honest so the
 * dashboard doesn't look broken while we build.
 */

export function ReportsPanel() {
  return (
    <section
      role="region"
      aria-label="Reports"
      className="flex flex-col gap-3 rounded-md border border-border bg-bg-surface p-5"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">Reports</h3>
        <span className="text-xs text-text-muted" style={{ fontFamily: "var(--font-mono)" }}>
          Week 3-4
        </span>
      </header>
      <button
        type="button"
        disabled
        className="rounded-md border border-border bg-bg-elevated px-4 py-2 text-left text-sm text-text-secondary opacity-60"
      >
        Generate SoundExchange Q-next export
      </button>
      <p className="text-xs text-text-muted">
        CPB + PRO exports land alongside SoundExchange once the enrichment waterfall is writing
        ISRCs.
      </p>
    </section>
  );
}

export function UpcomingFromRotation() {
  return (
    <section
      role="region"
      aria-label="Upcoming from rotation"
      className="flex flex-col gap-3 rounded-md border border-border bg-bg-surface p-5"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">Upcoming from rotation</h3>
        <span className="text-xs text-text-muted" style={{ fontFamily: "var(--font-mono)" }}>
          Week 5
        </span>
      </header>
      <p className="text-sm text-text-muted">
        Artists currently in rotation who are playing Milwaukee in the next 14 days. Ticketmaster +
        AXS feeds cache nightly per the perf plan.
      </p>
    </section>
  );
}
