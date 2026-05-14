import { test, expect } from "bun:test";
import type { AxsResponse, AxsEvent } from "./axs-normalize";
import {
  stripHtml,
  appendTrackingCode,
  mapAxsStatus,
  mapGenre,
  pickBestImage,
  normalizeAxsEvent,
} from "./axs-normalize";
import fixture from "./fixtures/axs-sample-event.json";

test("fixture parses as an AXS response with one event", () => {
  const response = fixture as AxsResponse;
  expect(response.events).toBeDefined();
  expect(response.events?.length).toBe(1);
  expect(response.events?.[0]?.eventId).toBe("959");
});

test("stripHtml removes anchor tags but keeps text", () => {
  expect(stripHtml('<a href="http://x.com">Phoebe Bridgers</a>')).toBe("Phoebe Bridgers");
});

test("stripHtml collapses whitespace and trims", () => {
  expect(stripHtml("  Foo   vs.\n  Bar  ")).toBe("Foo vs. Bar");
});

test("stripHtml returns empty string for empty input", () => {
  expect(stripHtml("")).toBe("");
});

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

test("normalizeAxsEvent returns null when eventId is missing", () => {
  const axsEvent: AxsEvent = {
    eventDateTimeUTC: "2026-09-01T00:00:00",
    venue: { title: "Pabst Theater", city: "Milwaukee", state: "WI" },
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
