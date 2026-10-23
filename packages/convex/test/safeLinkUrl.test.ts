import { describe, expect, test } from "bun:test";
import { safeLinkUrl } from "../convex/events";

describe("safeLinkUrl", () => {
  test("keeps https and http ticket links", () => {
    expect(safeLinkUrl("https://www.axs.com/events/1")).toBe("https://www.axs.com/events/1");
    expect(safeLinkUrl("http://cubs.com/noahkahan")).toBe("http://cubs.com/noahkahan");
  });

  test("drops script and data URLs, including disguised ones", () => {
    expect(safeLinkUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeLinkUrl("  JavaScript:alert(1)")).toBeUndefined();
    expect(safeLinkUrl("java\tscript:alert(1)")).toBeUndefined();
    expect(safeLinkUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
  });

  test("drops relative and unparseable values", () => {
    expect(safeLinkUrl("/tickets")).toBeUndefined();
    expect(safeLinkUrl("not a url")).toBeUndefined();
    expect(safeLinkUrl(undefined)).toBeUndefined();
  });
});
