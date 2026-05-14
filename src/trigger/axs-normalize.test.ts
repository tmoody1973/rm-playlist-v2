import { test, expect } from "bun:test";
import type { AxsResponse } from "./axs-normalize";
import { stripHtml, appendTrackingCode, mapAxsStatus } from "./axs-normalize";
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
