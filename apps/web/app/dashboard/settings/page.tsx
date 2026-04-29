import { SettingsClient } from "./SettingsClient";

/**
 * /dashboard/settings — operator settings hub.
 *
 * Five sections:
 *   - Org info: read-only header with RM identity.
 *   - Operators: who has dashboard access (Clerk-allowlisted to
 *     @radiomilwaukee.org per dashboard/layout.tsx).
 *   - Ingestion sources: pause/resume per source. The single most
 *     useful affordance here — operator can stop a flaky source's
 *     error noise without a dev round-trip.
 *   - Station regions: CRUD over the geographic anchors that
 *     poll-ticketmaster (and future poll-axs) use. Empty table =
 *     defaults from the cron's hardcoded fallback.
 *   - Env reference: docs of which secrets need to be set on which
 *     deployment target (Vercel / Trigger.dev / Convex). Not a
 *     status check — just a checklist.
 */
export default function SettingsPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1
          style={{ fontFamily: "var(--font-display)" }}
          className="text-2xl font-semibold tracking-tight"
        >
          Settings
        </h1>
        <p className="text-sm text-text-muted">
          Org config, operator access, ingestion sources, and the geographic anchors used to poll
          Ticketmaster.
        </p>
      </header>
      <SettingsClient />
    </main>
  );
}
