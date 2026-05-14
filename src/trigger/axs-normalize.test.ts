import { test, expect } from "bun:test";
import type { AxsResponse } from "./axs-normalize";
import { stripHtml } from "./axs-normalize";
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
