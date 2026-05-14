/**
 * AXS API smoke test — makes ONE real call to the AXS Event Discovery
 * API with the exact scoping params poll-axs.ts uses, prints a summary,
 * and writes the raw JSON response to a file.
 *
 * Why this exists: the unit-test fixture
 * (src/trigger/fixtures/axs-sample-event.json) was hand-built from the
 * AXS doc, not a real response. This script captures a REAL response so
 * we can confirm the doc matches reality and, if it does, replace the
 * fixture with real data.
 *
 * Prerequisites:
 *   - AXS_ACCESS_TOKEN in .env.local (`bun run` loads it automatically)
 *   - This machine's public IP must be on the AXS allow-list — without
 *     that the call fails. That gate is the whole reason this script
 *     exists: it's the fastest way to confirm access the moment an IP
 *     lands on the allow-list.
 *
 * Usage:
 *   bun run scripts/axs-smoke-test.ts [output-path]
 *   Default output: src/trigger/fixtures/axs-real-response.json
 *
 * Security: AXS authenticates only via the access_token query param, so
 * the token is in the request URL. This script never prints the URL or
 * the token — only status codes, counts, and non-secret params.
 */

import { writeFileSync } from "node:fs";

const ACCESS_TOKEN = process.env["AXS_ACCESS_TOKEN"];
if (!ACCESS_TOKEN) {
  console.error(
    "AXS_ACCESS_TOKEN is not set. Add it to .env.local — `bun run` loads that automatically.",
  );
  process.exit(1);
}

// Same scoping params poll-axs.ts uses. rows=10 keeps the smoke test small.
const SITE_ID = "110"; // Pabst Theater Group
const TICKETER_ID = "22"; // AXS Primary tickets
const MUSIC_MAJOR_CAT = "2";
const SMOKE_TEST_ROWS = "10";
const HORIZON_DAYS = 90;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_OUTPUT = "src/trigger/fixtures/axs-real-response.json";

/** AXS datetime params must be full UTC datetimes — date-only errors. */
function axsDateTime(date: Date): string {
  return date.toISOString().slice(0, 19);
}

const outputPath = process.argv[2] ?? DEFAULT_OUTPUT;

const now = new Date();
const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);

const params = new URLSearchParams({
  access_token: ACCESS_TOKEN,
  siteId: SITE_ID,
  ticketerId: TICKETER_ID,
  majorCat: MUSIC_MAJOR_CAT,
  returnData: "complete",
  start: axsDateTime(now),
  end: axsDateTime(horizon),
  rows: SMOKE_TEST_ROWS,
  page: "1",
});

console.log(
  `AXS smoke test → siteId=${SITE_ID} ticketerId=${TICKETER_ID} ` +
    `majorCat=${MUSIC_MAJOR_CAT} rows=${SMOKE_TEST_ROWS} ` +
    `window=${axsDateTime(now)}..${axsDateTime(horizon)}`,
);

let response: Response;
try {
  response = await fetch(`https://api.axs.com/v1/events?${params}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
} catch (err) {
  // Never print the URL — it carries the access_token.
  console.error(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
  console.error(
    "A timeout or connection error most likely means this machine's public " +
      "IP is not on the AXS allow-list yet.",
  );
  process.exit(1);
}

if (!response.ok) {
  console.error(`AXS API responded ${response.status} ${response.statusText}`);
  if (response.status === 401 || response.status === 403) {
    console.error(
      "401/403 usually means either the access_token is wrong or this " +
        "machine's IP is not allow-listed by AXS.",
    );
  }
  process.exit(1);
}

const raw = await response.text();
let parsed: unknown;
try {
  parsed = JSON.parse(raw);
} catch {
  console.error("Response was not valid JSON. First 500 chars:");
  console.error(raw.slice(0, 500));
  process.exit(1);
}

writeFileSync(outputPath, JSON.stringify(parsed, null, 2) + "\n");

const events = (parsed as { events?: unknown[] }).events ?? [];
console.log(`\nHTTP ${response.status} — ${events.length} event(s) returned`);
console.log(`Raw JSON written to ${outputPath}`);

const first = events[0] as
  | { eventId?: string; title?: { eventTitleText?: string }; venue?: { title?: string } }
  | undefined;
if (first) {
  console.log(
    `First event: id=${first.eventId} ` +
      `title=${JSON.stringify(first.title?.eventTitleText)} ` +
      `venue=${JSON.stringify(first.venue?.title)}`,
  );
}

console.log(
  `\nNext: compare ${outputPath} against the doc-derived fixture ` +
    `(src/trigger/fixtures/axs-sample-event.json). If field names or nesting ` +
    `differ, update the Axs* interfaces in src/trigger/axs-normalize.ts.`,
);
