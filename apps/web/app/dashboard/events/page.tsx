import { EventsClient } from "./EventsClient";

/**
 * /dashboard/events — operator browse view of every upcoming event in the
 * database. Different lens than the homepage's Upcoming-from-Rotation panel
 * (which filters to artists in rotation); this page surfaces ALL events
 * Ticketmaster (and eventually AXS / custom) has fed into the system, so
 * music directors can:
 *
 *   - Verify TM coverage by venue ("Is the Pabst showing up here?")
 *   - Browse upcoming shows by region ("What's at Madison venues?")
 *   - Search by show title or venue ("Anything by The Strokes booked?")
 *   - Cross-reference what AXS will fill in once the access_token lands
 *
 * Server-component shell (route metadata + auth via the dashboard layout);
 * the actual interactive list is a client component using useQuery so
 * filter state lives in URL params and updates feel snappy.
 */
export default function EventsPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1
          style={{ fontFamily: "var(--font-display)" }}
          className="text-2xl font-semibold tracking-tight"
        >
          Upcoming events
        </h1>
        <p className="text-sm text-text-muted">
          Every concert in the next 90 days that Ticketmaster has surfaced for Milwaukee, Madison,
          or Chicago. AXS coverage joins this list once the access token is wired (Step 6).
        </p>
      </header>
      <EventsClient />
    </main>
  );
}
