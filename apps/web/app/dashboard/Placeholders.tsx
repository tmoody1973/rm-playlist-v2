/**
 * Row 3 placeholder. The real Upcoming-from-rotation panel lands in
 * Week 5 once Ticketmaster + AXS ingestion is online. ReportsPanel
 * became real and moved to `./ReportsPanel.tsx`.
 */

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
