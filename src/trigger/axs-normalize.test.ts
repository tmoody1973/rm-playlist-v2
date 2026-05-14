import { test, expect } from "bun:test";
import type { AxsResponse } from "./axs-normalize";
import fixture from "./fixtures/axs-sample-event.json";

test("fixture parses as an AXS response with one event", () => {
  const response = fixture as AxsResponse;
  expect(response.events).toBeDefined();
  expect(response.events?.length).toBe(1);
  expect(response.events?.[0]?.eventId).toBe("959");
});
