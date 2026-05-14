# AXS Events Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Trigger.dev scheduled task that polls the AXS Event Discovery API for upcoming Pabst Theater Group shows and feeds them into the existing `events.upsertBatch` pipeline.

**Architecture:** Mirror `src/trigger/poll-ticketmaster.ts`, but split the pure normalization logic into `src/trigger/axs-normalize.ts` so it can be unit-tested. The Trigger.dev task (`poll-axs.ts`) handles scheduling, the AXS HTTP fetch with pagination, and the Convex round-trip. No Convex schema or validator changes — `events.ts:62` already lists `"axs"` in the `SOURCE` union.

**Tech Stack:** TypeScript, Trigger.dev SDK v4 (`@trigger.dev/sdk/v3`), `bun:test`, `ConvexHttpClient`.

**Companion design doc:** `docs/plans/2026-05-14-axs-events-adapter-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/trigger/axs-normalize.ts` (create) | AXS API response types, the local `NormalizedEvent`/`EventStatus` types, and pure normalization functions. No IO, no SDK imports. |
| `src/trigger/poll-axs.ts` (create) | The `schedules.task`: env read, AXS fetch + pagination, normalize loop, `upsertBatch` call. |
| `src/trigger/axs-normalize.test.ts` (create) | `bun:test` unit tests for every function in `axs-normalize.ts`. |
| `src/trigger/fixtures/axs-sample-event.json` (create) | The AXS doc's "Sample Event Response", used as the normalizer test input. |
| `package.json` (modify) | Extend the root `test` script so `bun run test` also runs `bun test src/trigger/`. |

**Reference:** `src/trigger/poll-ticketmaster.ts` is the working template for the task structure. The target `NormalizedEvent` shape is authoritative in `packages/convex/convex/events.ts:82-130`.

---

### Task 1: Wire `src/trigger/` into the test runner + add the fixture

**Files:**
- Modify: `package.json:14`
- Create: `src/trigger/fixtures/axs-sample-event.json`
- Create: `src/trigger/axs-normalize.test.ts`
- Create: `src/trigger/axs-normalize.ts`

- [ ] **Step 1: Create the fixture**

Create `src/trigger/fixtures/axs-sample-event.json` — the AXS doc's Sample Event Response, trimmed to one event with the fields the normalizer reads:

```json
{
  "events": [
    {
      "eventId": "959",
      "title": {
        "presentedBy": "Radio Milwaukee",
        "headliners": "<a href=\"http://www.axs.com/artists/117030/x\">Phoebe Bridgers</a>",
        "supporting": null,
        "eventTitle": "<a href=\"http://www.axs.com/artists/117030/x\">Phoebe Bridgers</a>",
        "eventTitleText": "Phoebe Bridgers"
      },
      "eventDateTimeUTC": "2026-08-20T01:00:00",
      "eventDateTimeZone": "America/Chicago",
      "dateOnly": false,
      "onsaleDateTimeUTC": "2026-05-01T15:00:00",
      "ticketing": {
        "statusId": 1,
        "status": "Buy Tickets",
        "url": "http://www.axs.com/events/123/phoebe-bridgers-tickets"
      },
      "minorCategoryId1": "21",
      "majorCategoryId1": "2",
      "venue": {
        "venueId": "55001",
        "title": "Pabst Theater",
        "city": "Milwaukee",
        "state": "WI",
        "country": "United States",
        "latitude": "43.041500",
        "longitude": "-87.910400"
      },
      "associations": {
        "headliners": [
          { "performerId": "117030", "name": "Phoebe Bridgers" }
        ],
        "supportingActs": [
          { "performerId": "117031", "name": "Christian Lee Hutson" }
        ]
      },
      "relatedMedia": {
        "1": { "media_id": "1", "width": "678", "height": "399", "file_name": "https://images.discovery-prod.axs.com/primary-678.jpg" },
        "2": { "media_id": "2", "width": "238", "height": "140", "file_name": "https://images.discovery-prod.axs.com/small-238.jpg" }
      }
    }
  ]
}
```

- [ ] **Step 2: Create the normalizer module with types only**

Create `src/trigger/axs-normalize.ts` with the AXS response interfaces and the normalized output types. No functions yet.

```typescript
/**
 * Pure normalization logic for the AXS Events adapter. No IO, no SDK
 * imports — everything here is unit-tested in axs-normalize.test.ts.
 *
 * The Trigger.dev task (poll-axs.ts) imports normalizeAxsEvent and feeds
 * the result straight into events.upsertBatch. The output shape mirrors
 * the authoritative NormalizedEvent in packages/convex/convex/events.ts.
 */

// ---- AXS API response types (only the fields we consume) ---- //

export interface AxsMediaEntry {
  readonly width: string | number;
  readonly height: string | number;
  readonly file_name: string;
}

export interface AxsPerformer {
  readonly performerId?: string;
  readonly name?: string;
}

export interface AxsVenue {
  readonly venueId?: string;
  readonly title?: string;
  readonly city?: string;
  readonly state?: string;
  readonly country?: string;
  readonly latitude?: string;
  readonly longitude?: string;
}

export interface AxsTitle {
  readonly presentedBy?: string | null;
  readonly eventTitle?: string | null;
  readonly eventTitleText?: string | null;
}

export interface AxsTicketing {
  readonly statusId?: number;
  readonly url?: string;
  readonly eventUrl?: string;
}

export interface AxsEvent {
  readonly eventId?: string;
  readonly title?: AxsTitle;
  readonly eventDateTimeUTC?: string;
  readonly dateOnly?: boolean;
  readonly onsaleDateTimeUTC?: string;
  readonly ticketing?: AxsTicketing;
  readonly minorCategoryId1?: string;
  readonly venue?: AxsVenue;
  readonly associations?: {
    readonly headliners?: AxsPerformer[];
    readonly supportingActs?: AxsPerformer[];
  };
  readonly relatedMedia?: Record<string, AxsMediaEntry>;
}

export interface AxsResponse {
  readonly events?: AxsEvent[];
}

// ---- Normalized output types (match events.ts NORMALIZED_EVENT) ---- //

export type EventStatus =
  | "buyTickets"
  | "soldOut"
  | "cancelled"
  | "postponed"
  | "rescheduled"
  | "venueChange"
  | "free"
  | "private"
  | "other";

export type NormalizedArtist = {
  artistNameRaw: string;
  role: "headliner" | "support";
  externalPerformerId?: string;
};

export type NormalizedEvent = {
  externalId: string;
  title?: string;
  presenterName?: string;
  venueName: string;
  venueExternalId?: string;
  city: string;
  region: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  startsAt: number;
  dateOnly?: boolean;
  onSaleAt?: number;
  ticketUrl?: string;
  status?: EventStatus;
  imageUrl?: string;
  genre?: string;
  artists: NormalizedArtist[];
};

/** Affiliate tracking code appended to every ticket URL so Radio
 *  Milwaukee gets click-through attribution. */
export const TRACKING_CODE = "cid=usaffradiomilwaukee";
```

- [ ] **Step 3: Create the test file with a fixture smoke test**

Create `src/trigger/axs-normalize.test.ts`:

```typescript
import { test, expect } from "bun:test";
import type { AxsResponse } from "./axs-normalize";
import fixture from "./fixtures/axs-sample-event.json";

test("fixture parses as an AXS response with one event", () => {
  const response = fixture as AxsResponse;
  expect(response.events).toBeDefined();
  expect(response.events?.length).toBe(1);
  expect(response.events?.[0]?.eventId).toBe("959");
});
```

- [ ] **Step 4: Wire `src/trigger/` into the root test script**

Modify `package.json:14`. Change:

```json
    "test": "bun --filter='@rm/*' run test",
```

to:

```json
    "test": "bun --filter='@rm/*' run test && bun test src/trigger/",
```

CI runs `bun run test` (`.github/workflows/ci.yml:51`), so this single change makes CI pick up every `src/trigger/*.test.ts` file.

- [ ] **Step 5: Run the test to verify it passes and the runner is wired**

Run: `bun run test`
Expected: all `@rm/*` workspace tests pass, then `bun test src/trigger/` runs and reports `1 pass` for `axs-normalize.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add package.json src/trigger/axs-normalize.ts src/trigger/axs-normalize.test.ts src/trigger/fixtures/axs-sample-event.json
git commit -m "test: wire src/trigger into test runner + AXS normalizer scaffold"
```

---

### Task 2: `stripHtml` — remove anchor tags from AXS title fields

**Files:**
- Modify: `src/trigger/axs-normalize.ts`
- Modify: `src/trigger/axs-normalize.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/trigger/axs-normalize.test.ts`:

```typescript
import { stripHtml } from "./axs-normalize";

test("stripHtml removes anchor tags but keeps text", () => {
  expect(stripHtml('<a href="http://x.com">Phoebe Bridgers</a>')).toBe("Phoebe Bridgers");
});

test("stripHtml collapses whitespace and trims", () => {
  expect(stripHtml("  Foo   vs.\n  Bar  ")).toBe("Foo vs. Bar");
});

test("stripHtml returns empty string for empty input", () => {
  expect(stripHtml("")).toBe("");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/trigger/axs-normalize.test.ts`
Expected: FAIL — `stripHtml` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `src/trigger/axs-normalize.ts`:

```typescript
/**
 * AXS title fields (`headliners`, `eventTitle`) embed `<a>` tags. Strip
 * all tags and collapse whitespace. Used as a fallback when the plain
 * `eventTitleText` field is absent.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/trigger/axs-normalize.test.ts`
Expected: PASS — 3 new tests green.

- [ ] **Step 5: Commit**

```bash
git add src/trigger/axs-normalize.ts src/trigger/axs-normalize.test.ts
git commit -m "feat: add stripHtml for AXS title fields"
```

---

### Task 3: `appendTrackingCode` — attach the affiliate code to ticket URLs

**Files:**
- Modify: `src/trigger/axs-normalize.ts`
- Modify: `src/trigger/axs-normalize.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/trigger/axs-normalize.test.ts`:

```typescript
import { appendTrackingCode } from "./axs-normalize";

test("appendTrackingCode uses ? when the URL has no query string", () => {
  expect(appendTrackingCode("http://www.axs.com/events/123")).toBe(
    "http://www.axs.com/events/123?cid=usaffradiomilwaukee",
  );
});

test("appendTrackingCode uses & when the URL already has a query string", () => {
  expect(appendTrackingCode("http://www.axs.com/events/123?ref=x")).toBe(
    "http://www.axs.com/events/123?ref=x&cid=usaffradiomilwaukee",
  );
});

test("appendTrackingCode is a no-op when the code is already present", () => {
  expect(appendTrackingCode("http://www.axs.com/e?cid=usaffradiomilwaukee")).toBe(
    "http://www.axs.com/e?cid=usaffradiomilwaukee",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/trigger/axs-normalize.test.ts`
Expected: FAIL — `appendTrackingCode` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `src/trigger/axs-normalize.ts`:

```typescript
/**
 * Append the Radio Milwaukee affiliate tracking code to an AXS ticket
 * URL. Picks `?` or `&` based on whether the URL already has a query
 * string. No-op if the code is already present.
 */
export function appendTrackingCode(url: string): string {
  if (url.includes(TRACKING_CODE)) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${TRACKING_CODE}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/trigger/axs-normalize.test.ts`
Expected: PASS — 3 new tests green.

- [ ] **Step 5: Commit**

```bash
git add src/trigger/axs-normalize.ts src/trigger/axs-normalize.test.ts
git commit -m "feat: add appendTrackingCode for AXS ticket URLs"
```

---

### Task 4: `mapAxsStatus` — map AXS `statusId` to the `EventStatus` enum

**Files:**
- Modify: `src/trigger/axs-normalize.ts`
- Modify: `src/trigger/axs-normalize.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/trigger/axs-normalize.test.ts`:

```typescript
import { mapAxsStatus } from "./axs-normalize";

test("mapAxsStatus maps known buy-variant ids to buyTickets", () => {
  for (const id of [1, 27, 29, 30, 31, 32, 33]) {
    expect(mapAxsStatus(id)).toBe("buyTickets");
  }
});

test("mapAxsStatus maps soldOut, cancelled, venueChange, private", () => {
  expect(mapAxsStatus(7)).toBe("soldOut");
  expect(mapAxsStatus(2)).toBe("cancelled");
  expect(mapAxsStatus(11)).toBe("venueChange");
  expect(mapAxsStatus(10)).toBe("private");
});

test("mapAxsStatus maps postponed, rescheduled, free pairs", () => {
  expect(mapAxsStatus(5)).toBe("postponed");
  expect(mapAxsStatus(37)).toBe("postponed");
  expect(mapAxsStatus(6)).toBe("rescheduled");
  expect(mapAxsStatus(38)).toBe("rescheduled");
  expect(mapAxsStatus(3)).toBe("free");
  expect(mapAxsStatus(9)).toBe("free");
});

test("mapAxsStatus falls back to other for unknown or unmapped ids", () => {
  expect(mapAxsStatus(8)).toBe("other");
  expect(mapAxsStatus(36)).toBe("other");
  expect(mapAxsStatus(999)).toBe("other");
  expect(mapAxsStatus(undefined)).toBe("other");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/trigger/axs-normalize.test.ts`
Expected: FAIL — `mapAxsStatus` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `src/trigger/axs-normalize.ts`:

```typescript
/**
 * AXS `ticketing.statusId` → our `EventStatus` enum. statusId values are
 * from AXS doc Appendix 1. Unmapped ids (TBD=8, Unavailable=12, Box
 * Office Only=14, Suspended=36, etc.) collapse to "other".
 */
const AXS_STATUS_BY_ID: Record<number, EventStatus> = {
  1: "buyTickets",
  27: "buyTickets",
  29: "buyTickets",
  30: "buyTickets",
  31: "buyTickets",
  32: "buyTickets",
  33: "buyTickets",
  7: "soldOut",
  2: "cancelled",
  5: "postponed",
  37: "postponed",
  6: "rescheduled",
  38: "rescheduled",
  11: "venueChange",
  3: "free",
  9: "free",
  10: "private",
};

export function mapAxsStatus(statusId: number | undefined): EventStatus {
  if (statusId === undefined) return "other";
  return AXS_STATUS_BY_ID[statusId] ?? "other";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/trigger/axs-normalize.test.ts`
Expected: PASS — 4 new tests green.

- [ ] **Step 5: Commit**

```bash
git add src/trigger/axs-normalize.ts src/trigger/axs-normalize.test.ts
git commit -m "feat: add mapAxsStatus for AXS ticketing status ids"
```

---

### Task 5: `mapGenre` — map AXS `minorCategoryId1` to a genre label

**Files:**
- Modify: `src/trigger/axs-normalize.ts`
- Modify: `src/trigger/axs-normalize.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/trigger/axs-normalize.test.ts`:

```typescript
import { mapGenre } from "./axs-normalize";

test("mapGenre maps known music minorCategory ids to labels", () => {
  expect(mapGenre("12")).toBe("Rock");
  expect(mapGenre("25")).toBe("Pop");
  expect(mapGenre("20")).toBe("Hip Hop/Rap");
  expect(mapGenre("23")).toBe("Jazz/Blues");
  expect(mapGenre("21")).toBe("Indie/Emo");
});

test("mapGenre returns undefined for unknown or missing ids", () => {
  expect(mapGenre("99999")).toBeUndefined();
  expect(mapGenre(undefined)).toBeUndefined();
  expect(mapGenre("")).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/trigger/axs-normalize.test.ts`
Expected: FAIL — `mapGenre` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `src/trigger/axs-normalize.ts`. Genre ids and labels are from AXS doc Appendix 2 (majorCat 2 = Music):

```typescript
/**
 * AXS `minorCategoryId1` → human genre label, from AXS doc Appendix 2
 * (Music minor categories). Returns undefined for unknown ids — genre is
 * an optional, display-only field.
 */
const AXS_GENRE_BY_ID: Record<string, string> = {
  "10": "Alternative/Punk",
  "11": "Christian",
  "12": "Rock",
  "13": "Classical",
  "15": "Country",
  "16": "International",
  "17": "Dance/Electronic",
  "18": "Festivals",
  "19": "Folk/Acoustic",
  "20": "Hip Hop/Rap",
  "21": "Indie/Emo",
  "22": "Hard Rock/Metal",
  "23": "Jazz/Blues",
  "24": "Latin",
  "25": "Pop",
  "26": "R&B",
  "27": "Reggae",
  "28": "Other",
  "49": "Kpop",
  "51": "Award Shows",
  "53": "Soundtrack",
  "54": "Bollywood/Desi",
};

export function mapGenre(minorCategoryId: string | undefined): string | undefined {
  if (!minorCategoryId) return undefined;
  return AXS_GENRE_BY_ID[minorCategoryId];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/trigger/axs-normalize.test.ts`
Expected: PASS — 2 new tests green.

- [ ] **Step 5: Commit**

```bash
git add src/trigger/axs-normalize.ts src/trigger/axs-normalize.test.ts
git commit -m "feat: add mapGenre for AXS music categories"
```

---

### Task 6: `pickBestImage` — choose the best image from `relatedMedia`

**Files:**
- Modify: `src/trigger/axs-normalize.ts`
- Modify: `src/trigger/axs-normalize.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/trigger/axs-normalize.test.ts`:

```typescript
import { pickBestImage } from "./axs-normalize";

test("pickBestImage prefers the 678-wide primary image", () => {
  const media = {
    "1": { width: "678", height: "399", file_name: "https://x.com/primary.jpg" },
    "2": { width: "238", height: "140", file_name: "https://x.com/small.jpg" },
  };
  expect(pickBestImage(media)).toBe("https://x.com/primary.jpg");
});

test("pickBestImage falls back to the widest available image", () => {
  const media = {
    "1": { width: "238", height: "140", file_name: "https://x.com/small.jpg" },
    "2": { width: "322", height: "322", file_name: "https://x.com/medium.jpg" },
  };
  expect(pickBestImage(media)).toBe("https://x.com/medium.jpg");
});

test("pickBestImage returns undefined for empty or missing media", () => {
  expect(pickBestImage({})).toBeUndefined();
  expect(pickBestImage(undefined)).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/trigger/axs-normalize.test.ts`
Expected: FAIL — `pickBestImage` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `src/trigger/axs-normalize.ts`:

```typescript
/** AXS doc: the primary event image width is 678 (678x399). */
const AXS_PRIMARY_IMAGE_WIDTH = 678;

/**
 * Pick the best image URL from an AXS `relatedMedia` map. Prefers the
 * 678-wide primary; otherwise the widest available. `relatedMedia`
 * follows the event→tour→performer→venue inheritance hierarchy, so it is
 * the AXS-recommended source over the raw `media` field.
 */
export function pickBestImage(
  relatedMedia: Record<string, AxsMediaEntry> | undefined,
): string | undefined {
  if (!relatedMedia) return undefined;
  const entries = Object.values(relatedMedia);
  if (entries.length === 0) return undefined;

  const primary = entries.find((e) => Number(e.width) === AXS_PRIMARY_IMAGE_WIDTH);
  if (primary) return primary.file_name;

  const widest = [...entries].sort((a, b) => Number(b.width) - Number(a.width))[0];
  return widest?.file_name;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/trigger/axs-normalize.test.ts`
Expected: PASS — 3 new tests green.

- [ ] **Step 5: Commit**

```bash
git add src/trigger/axs-normalize.ts src/trigger/axs-normalize.test.ts
git commit -m "feat: add pickBestImage for AXS relatedMedia"
```

---

### Task 7: `normalizeAxsEvent` — compose everything into a `NormalizedEvent`

**Files:**
- Modify: `src/trigger/axs-normalize.ts`
- Modify: `src/trigger/axs-normalize.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/trigger/axs-normalize.test.ts`:

```typescript
import { normalizeAxsEvent } from "./axs-normalize";
import type { AxsEvent } from "./axs-normalize";

test("normalizeAxsEvent maps the fixture event end to end", () => {
  const axsEvent = (fixture as AxsResponse).events![0]!;
  const result = normalizeAxsEvent(axsEvent);
  expect(result).not.toBeNull();
  expect(result!.externalId).toBe("959");
  expect(result!.title).toBe("Phoebe Bridgers");
  expect(result!.presenterName).toBe("Radio Milwaukee");
  expect(result!.venueName).toBe("Pabst Theater");
  expect(result!.venueExternalId).toBe("55001");
  expect(result!.city).toBe("Milwaukee");
  expect(result!.region).toBe("WI");
  expect(result!.country).toBe("US");
  expect(result!.latitude).toBeCloseTo(43.0415);
  expect(result!.longitude).toBeCloseTo(-87.9104);
  expect(result!.startsAt).toBe(Date.parse("2026-08-20T01:00:00Z"));
  expect(result!.dateOnly).toBeUndefined();
  expect(result!.onSaleAt).toBe(Date.parse("2026-05-01T15:00:00Z"));
  expect(result!.status).toBe("buyTickets");
  expect(result!.genre).toBe("Indie/Emo");
  expect(result!.imageUrl).toBe("https://images.discovery-prod.axs.com/primary-678.jpg");
  expect(result!.ticketUrl).toBe(
    "http://www.axs.com/events/123/phoebe-bridgers-tickets?cid=usaffradiomilwaukee",
  );
});

test("normalizeAxsEvent maps headliners and supporting acts with roles", () => {
  const axsEvent = (fixture as AxsResponse).events![0]!;
  const result = normalizeAxsEvent(axsEvent)!;
  expect(result.artists).toEqual([
    { artistNameRaw: "Phoebe Bridgers", role: "headliner", externalPerformerId: "117030" },
    { artistNameRaw: "Christian Lee Hutson", role: "support", externalPerformerId: "117031" },
  ]);
});

test("normalizeAxsEvent uses stripHtml fallback when eventTitleText is absent", () => {
  const axsEvent: AxsEvent = {
    eventId: "1",
    title: { eventTitle: '<a href="http://x">The Band</a>' },
    eventDateTimeUTC: "2026-09-01T00:00:00",
    ticketing: { statusId: 1, url: "http://x.com/t" },
    venue: { title: "Turner Hall", city: "Milwaukee", state: "WI" },
    associations: { headliners: [{ performerId: "9", name: "The Band" }] },
  };
  expect(normalizeAxsEvent(axsEvent)!.title).toBe("The Band");
});

test("normalizeAxsEvent returns null when the start time is unparseable", () => {
  const axsEvent: AxsEvent = {
    eventId: "1",
    eventDateTimeUTC: "not-a-date",
    venue: { title: "Pabst Theater", city: "Milwaukee", state: "WI" },
    associations: { headliners: [{ performerId: "9", name: "X" }] },
  };
  expect(normalizeAxsEvent(axsEvent)).toBeNull();
});

test("normalizeAxsEvent returns null when there is no venue title", () => {
  const axsEvent: AxsEvent = {
    eventId: "1",
    eventDateTimeUTC: "2026-09-01T00:00:00",
    venue: { city: "Milwaukee", state: "WI" },
    associations: { headliners: [{ performerId: "9", name: "X" }] },
  };
  expect(normalizeAxsEvent(axsEvent)).toBeNull();
});

test("normalizeAxsEvent returns null when there are no named artists", () => {
  const axsEvent: AxsEvent = {
    eventId: "1",
    eventDateTimeUTC: "2026-09-01T00:00:00",
    venue: { title: "Pabst Theater", city: "Milwaukee", state: "WI" },
    associations: { headliners: [{ performerId: "9" }], supportingActs: [] },
  };
  expect(normalizeAxsEvent(axsEvent)).toBeNull();
});

test("normalizeAxsEvent passes dateOnly through when true", () => {
  const axsEvent: AxsEvent = {
    eventId: "1",
    title: { eventTitleText: "X" },
    eventDateTimeUTC: "2026-09-01T00:00:00",
    dateOnly: true,
    ticketing: { statusId: 1, url: "http://x.com/t" },
    venue: { title: "Pabst Theater", city: "Milwaukee", state: "WI" },
    associations: { headliners: [{ performerId: "9", name: "X" }] },
  };
  expect(normalizeAxsEvent(axsEvent)!.dateOnly).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/trigger/axs-normalize.test.ts`
Expected: FAIL — `normalizeAxsEvent` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `src/trigger/axs-normalize.ts`:

```typescript
/** AXS sends "United States"; the events pipeline expects ISO-style
 *  codes to match Ticketmaster. Extend this map if other countries
 *  appear. */
const COUNTRY_CODE_BY_NAME: Record<string, string> = {
  "United States": "US",
  Canada: "CA",
};

function normalizeCountry(country: string | undefined): string | undefined {
  if (!country) return undefined;
  return COUNTRY_CODE_BY_NAME[country] ?? country;
}

/** AXS eventDateTimeUTC has no trailing "Z"; parse it as UTC explicitly.
 *  Returns null when the value is missing or unparseable. */
function parseAxsUtc(value: string | undefined): number | null {
  if (!value) return null;
  const withZone = value.endsWith("Z") ? value : `${value}Z`;
  const ms = Date.parse(withZone);
  return Number.isNaN(ms) ? null : ms;
}

/** Resolve the display title: prefer the plain `eventTitleText`, fall
 *  back to HTML-stripped `eventTitle`. */
function resolveTitle(title: AxsTitle | undefined): string | undefined {
  if (!title) return undefined;
  if (title.eventTitleText && title.eventTitleText.trim().length > 0) {
    return title.eventTitleText.trim();
  }
  if (title.eventTitle) {
    const stripped = stripHtml(title.eventTitle);
    return stripped.length > 0 ? stripped : undefined;
  }
  return undefined;
}

/** Map AXS performer arrays to NormalizedArtist[], dropping entries with
 *  no name. Headliners first, then supporting acts. */
function resolveArtists(associations: AxsEvent["associations"]): NormalizedArtist[] {
  const headliners = (associations?.headliners ?? [])
    .filter((p): p is AxsPerformer & { name: string } => typeof p.name === "string" && p.name.length > 0)
    .map((p) => ({
      artistNameRaw: p.name,
      role: "headliner" as const,
      externalPerformerId: p.performerId,
    }));
  const support = (associations?.supportingActs ?? [])
    .filter((p): p is AxsPerformer & { name: string } => typeof p.name === "string" && p.name.length > 0)
    .map((p) => ({
      artistNameRaw: p.name,
      role: "support" as const,
      externalPerformerId: p.performerId,
    }));
  return [...headliners, ...support];
}

/**
 * Normalize one AXS event into the shape `events.upsertBatch` accepts.
 * Returns null — and the caller increments a skip count — when the event
 * lacks a parseable start time, a venue name, or any named artist. These
 * mirror the skip rules in poll-ticketmaster.ts's normalizeTmEvent.
 */
export function normalizeAxsEvent(event: AxsEvent): NormalizedEvent | null {
  const startsAt = parseAxsUtc(event.eventDateTimeUTC);
  if (startsAt === null) return null;

  const venueName = event.venue?.title;
  if (!venueName) return null;

  const artists = resolveArtists(event.associations);
  if (artists.length === 0) return null;

  if (!event.eventId) return null;

  const ticketUrlRaw = event.ticketing?.url ?? event.ticketing?.eventUrl;
  const lat = event.venue?.latitude ? parseFloat(event.venue.latitude) : undefined;
  const long = event.venue?.longitude ? parseFloat(event.venue.longitude) : undefined;
  const onSaleAt = parseAxsUtc(event.onsaleDateTimeUTC);

  return {
    externalId: event.eventId,
    title: resolveTitle(event.title),
    presenterName: event.title?.presentedBy ?? undefined,
    venueName,
    venueExternalId: event.venue?.venueId,
    city: event.venue?.city ?? "",
    region: event.venue?.state ?? "",
    country: normalizeCountry(event.venue?.country),
    latitude: lat !== undefined && !Number.isNaN(lat) ? lat : undefined,
    longitude: long !== undefined && !Number.isNaN(long) ? long : undefined,
    startsAt,
    dateOnly: event.dateOnly === true ? true : undefined,
    onSaleAt: onSaleAt ?? undefined,
    ticketUrl: ticketUrlRaw ? appendTrackingCode(ticketUrlRaw) : undefined,
    status: mapAxsStatus(event.ticketing?.statusId),
    imageUrl: pickBestImage(event.relatedMedia),
    genre: mapGenre(event.minorCategoryId1),
    artists,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/trigger/axs-normalize.test.ts`
Expected: PASS — all 7 new tests green.

- [ ] **Step 5: Commit**

```bash
git add src/trigger/axs-normalize.ts src/trigger/axs-normalize.test.ts
git commit -m "feat: add normalizeAxsEvent with skip rules"
```

---

### Task 8: `poll-axs.ts` — the Trigger.dev scheduled task

**Files:**
- Create: `src/trigger/poll-axs.ts`

This task wraps the normalizer in scheduling + IO. It mirrors `src/trigger/poll-ticketmaster.ts`, which has no task-level unit test (the task is verified by typecheck, lint, and a manual dev run). Verification steps below follow that same pattern.

- [ ] **Step 1: Write the task**

Create `src/trigger/poll-axs.ts`:

```typescript
import { logger, schedules } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../packages/convex/convex/_generated/api.js";
import type { Id } from "../../packages/convex/convex/_generated/dataModel.js";
import { getConvexUrl } from "./env";
import { normalizeAxsEvent } from "./axs-normalize";
import type { AxsEvent, AxsResponse, NormalizedEvent } from "./axs-normalize";

/**
 * Poll the AXS Event Discovery API every 6 hours for upcoming Pabst
 * Theater Group shows in Milwaukee, normalize each into the
 * source-agnostic shape events.upsertBatch accepts, and upsert them.
 *
 * Mirrors poll-ticketmaster.ts. Two intentional differences:
 *   1. Geo scoping is siteId=110 (Pabst), not lat/long radius anchors —
 *      so this task does not read stationRegions.
 *   2. The normalizer is extracted to axs-normalize.ts so it can be
 *      unit-tested. See docs/plans/2026-05-14-axs-events-adapter-design.md.
 *
 * Cadence is staggered to 03/09/15/21 UTC so it never runs alongside
 * poll-ticketmaster (00/06/12/18).
 */

/** Pabst Theater Group site. Confirmed with AXS 2026-05-14. */
const AXS_SITE_ID = "110";
/** AXS Primary tickets only (29 = Marketplace resale, excluded). */
const AXS_TICKETER_ID = "22";
/** AXS majorCat for Music. */
const AXS_MUSIC_MAJOR_CAT = "2";
/** Forward window per poll. Matches poll-ticketmaster.ts. */
const SEARCH_HORIZON_DAYS = 90;
/** AXS max page size (range 10-100). */
const PAGE_SIZE = 100;
/** Defensive cap on pagination — AXS shouldn't return 50+ pages for one
 *  venue group's 90-day horizon, but stop rather than loop forever. */
const HARD_PAGE_CAP = 50;

const ORG_SLUG = "radiomilwaukee";

/** AXS datetime params must be full UTC datetimes — date-only errors. */
function axsDateTime(date: Date): string {
  return date.toISOString().slice(0, 19);
}

async function fetchAllAxsEvents(accessToken: string): Promise<AxsEvent[]> {
  const now = new Date();
  const horizon = new Date(now.getTime() + SEARCH_HORIZON_DAYS * 86_400_000);

  const all: AxsEvent[] = [];
  let page = 1;

  while (page <= HARD_PAGE_CAP) {
    const params = new URLSearchParams({
      access_token: accessToken,
      siteId: AXS_SITE_ID,
      ticketerId: AXS_TICKETER_ID,
      majorCat: AXS_MUSIC_MAJOR_CAT,
      returnData: "complete",
      start: axsDateTime(now),
      end: axsDateTime(horizon),
      rows: String(PAGE_SIZE),
      page: String(page),
    });

    // The AXS doc shows http://; use https:// so the access_token is
    // never sent in plaintext. If AXS rejects https, escalate to them —
    // do not downgrade to http.
    const response = await fetch(`https://api.axs.com/v1/events?${params}`);
    if (!response.ok) {
      throw new Error(`AXS API ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as AxsResponse;
    const pageEvents = data.events ?? [];
    all.push(...pageEvents);
    logger.log(`[AXS] page ${page} fetched ${pageEvents.length} events`);

    // AXS returns an empty event list once page > total pages.
    if (pageEvents.length < PAGE_SIZE) break;
    page++;

    // Polite spacing — at a 6h cadence this costs nothing.
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return all;
}

export const pollAxs = schedules.task({
  id: "poll-axs",
  // Staggered from poll-ticketmaster (00/06/12/18) to spread API load.
  cron: "0 3,9,15,21 * * *",
  queue: { concurrencyLimit: 1 },
  maxDuration: 300,
  run: async () => {
    const client = new ConvexHttpClient(getConvexUrl());
    const accessToken = process.env["AXS_ACCESS_TOKEN"];

    // Graceful idle when the token isn't configured on the Trigger.dev
    // project yet — mirrors poll-ticketmaster.ts. Crashing every 6h would
    // just be alert noise.
    if (!accessToken) {
      logger.warn("AXS_ACCESS_TOKEN not set on Trigger.dev project — skipping poll");
      return {
        fetched: 0,
        normalized: 0,
        inserted: 0,
        updated: 0,
        dedupedNew: 0,
        dedupedExisting: 0,
        skipped: 0,
        skippedReason: "missing-api-key" as const,
      };
    }

    const orgId = await client.query(api.events.getOrgIdBySlug, { slug: ORG_SLUG });
    if (orgId === null) {
      logger.error(`Org with slug "${ORG_SLUG}" not found — seed.ts may be missing`);
      return {
        fetched: 0,
        normalized: 0,
        inserted: 0,
        updated: 0,
        dedupedNew: 0,
        dedupedExisting: 0,
        skipped: 0,
      };
    }

    const axsEvents = await fetchAllAxsEvents(accessToken);
    logger.log(`Fetched ${axsEvents.length} AXS events`);

    let skipped = 0;
    const normalized: NormalizedEvent[] = [];
    for (const axsEvent of axsEvents) {
      const norm = normalizeAxsEvent(axsEvent);
      if (norm === null) {
        skipped++;
        continue;
      }
      normalized.push(norm);
    }

    if (normalized.length === 0) {
      logger.log(`No normalizable events (skipped=${skipped})`);
      return {
        fetched: axsEvents.length,
        normalized: 0,
        inserted: 0,
        updated: 0,
        dedupedNew: 0,
        dedupedExisting: 0,
        skipped,
      };
    }

    const result = await client.mutation(api.events.upsertBatch, {
      orgId: orgId as Id<"organizations">,
      source: "axs",
      events: normalized,
    });

    logger.log(
      `Upserted: inserted=${result.inserted} updated=${result.updated} ` +
        `dedupedNew=${result.dedupedNew} dedupedExisting=${result.dedupedExisting} skipped=${skipped}`,
    );

    return { fetched: axsEvents.length, normalized: normalized.length, ...result, skipped };
  },
});
```

- [ ] **Step 2: Verify it typechecks**

Run: `bun run typecheck`
Expected: PASS — no errors. If `src/trigger/` is not covered by a workspace tsconfig, run `bunx tsc --noEmit src/trigger/poll-axs.ts src/trigger/axs-normalize.ts` and expect no errors.

- [ ] **Step 3: Verify it lints**

Run: `bunx eslint src/trigger`
Expected: PASS — no errors. (`.github/workflows/ci.yml:45` already lints `src/trigger`.)

- [ ] **Step 4: Verify the full test suite still passes**

Run: `bun run test`
Expected: PASS — all `@rm/*` tests plus every `src/trigger/*.test.ts`.

- [ ] **Step 5: Verify formatting**

Run: `bun run format:check`
Expected: PASS. If it fails, run `bun run format` and re-check.

- [ ] **Step 6: Commit**

```bash
git add src/trigger/poll-axs.ts
git commit -m "feat: add poll-axs Trigger.dev task for AXS events"
```

---

## Out of scope (do not implement in this plan)

- The widget event-image thumbnail — a separate workstream with its own plan (touches `apps/embed/src/types.ts`, the Convex public events query, `LiveEventRow.tsx`, and `DESIGN.md`).
- Incremental sync via `modifiedStartDate` / `modifiedEndDate`.
- `venueId` filtering on top of `siteId=110`.
- `doorsAt` — AXS only provides venue-local `doorDateTime` with no UTC variant; deriving UTC needs timezone math. Revisit if the door time becomes a display requirement.

## Prerequisites for the deployed task to actually poll (not code — ops)

- `AXS_ACCESS_TOKEN` added to the Trigger.dev project environment (the deployed task reads the project env, not `.env.local`).
- AXS device allow-list satisfied: provision a Trigger.dev static-IP region and send AXS that egress IP.

## Self-Review

**Spec coverage** — every design-doc decision maps to a task:
- Standalone task mirroring Ticketmaster → Task 8
- `siteId=110`, `ticketerId=22`, `majorCat=2`, 90-day horizon → Task 8 constants + `fetchAllAxsEvents`
- Full re-fetch, pagination → Task 8 `fetchAllAxsEvents`
- Staggered 6h cadence → Task 8 `cron`
- AXS→`NormalizedEvent` mapping → Task 7 `normalizeAxsEvent`
- HTML stripping → Task 2; tracking code → Task 3; status mapping → Task 4; genre → Task 5; image → Task 6
- Skip rules → Task 7
- Headliners + supporting acts with roles → Task 7 `resolveArtists`
- Testable normalizer in `src/trigger/` + test wiring → Tasks 1-7
- Fixture from the AXS doc sample → Task 1

**Placeholder scan** — no TBDs; every code step contains complete code.

**Type consistency** — `NormalizedEvent`, `NormalizedArtist`, `EventStatus`, `AxsEvent`, `AxsResponse`, `AxsTitle`, `AxsPerformer`, `AxsMediaEntry`, `AxsVenue`, `AxsTicketing` are all defined in Task 1 Step 2 and used consistently in Tasks 2-8. Function names (`stripHtml`, `appendTrackingCode`, `mapAxsStatus`, `mapGenre`, `pickBestImage`, `normalizeAxsEvent`) are stable across their defining task and their use in Task 7/8. The `upsertBatch` call in Task 8 matches the verified contract in `events.ts:187-192` (`orgId`, `source`, `events`).

**Known risk** — the AXS response types and the fixture are written against the AXS doc's schema, not a live API response. The first real poll may reveal field discrepancies (nullability, casing). The unit tests pin the normalizer's behavior; adjust the `Axs*` interfaces and re-run if the live shape differs.
