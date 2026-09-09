/**
 * Play-row width regression check.
 *
 * The bug this guards against, found 2026-09-09: on radiomilwaukee.org the
 * widget renders 350px wide inside a 390px phone. Album art, a timestamp and
 * a 44px preview button took 257px of that, leaving 91px for the song title.
 * Roughly three characters. Rows for tracks with no preview button looked
 * fine, which is why it read as a data problem rather than a layout one.
 *
 * Why this is a browser test and not a unit test: nothing about the markup is
 * wrong. The component only misbehaves once a real engine has resolved widths
 * at a real viewport, so the only honest assertion is "render it narrow and
 * measure". jsdom has no layout engine and would pass while the widget was
 * broken.
 *
 * Not wired into `bun run test` yet. That script runs in CI, and CI has no
 * browser installed, so adding it there would turn every unrelated PR red.
 * Wiring it up needs a `playwright install chromium` step in ci.yml, which is
 * a separate decision.
 *
 *   bun run build            # must run first, this reads dist/
 *   bun run test:e2e
 *
 * Requires VITE_CONVEX_URL at build time or the widget renders an error and
 * every case below skips rather than lying about passing.
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "v1");
const PORT = 8934;

/**
 * Widths that matter, and why each one is here rather than a round number:
 *   320 — iPhone SE, and what iOS Display Zoom reports on a larger phone.
 *   375 — iPhone mini / SE 2nd gen.
 *   390 — iPhone 13/14/15, the single most common width.
 *   430 — Pro Max.
 *  1024 — regression guard. The wide layout must NOT stack.
 */
const CASES = [320, 375, 390, 430, 1024];

/** The host page wraps the widget in a padded column; mirror that. */
const HARNESS = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0}.col{padding:0 20px}</style></head><body>
<div class="col"><script src="/widget-legacy.js"
  data-station="88nine" data-variant="playlist" data-theme="light"
  data-unlimited-songs="true" data-enable-date-search="true"></script></div>
</body></html>`;

const server = createServer(async (req, res) => {
  if (req.url === "/" || req.url?.startsWith("/harness")) {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(HARNESS);
  }
  try {
    const body = await readFile(join(DIST, req.url.replace(/^\//, "").split("?")[0]));
    res.writeHead(200, { "content-type": "application/javascript" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

await new Promise((r) => server.listen(PORT, r));
const browser = await chromium.launch();
const failures = [];

for (const width of CASES) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 2,
    isMobile: width < 700,
    hasTouch: width < 700,
  });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/harness.html`, { waitUntil: "domcontentloaded" });

  const rendered = await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll("*")]
          .filter((e) => e.shadowRoot)
          .some((h) => h.shadowRoot.querySelectorAll("li.rmke-row").length > 3),
      { timeout: 30000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!rendered) {
    console.log(
      `  ${String(width).padStart(4)}px  SKIP — widget did not render (no network, or no VITE_CONVEX_URL at build)`,
    );
    await ctx.close();
    continue;
  }

  const r = await page.evaluate(() => {
    const host = [...document.querySelectorAll("*")]
      .filter((e) => e.shadowRoot)
      .find((h) => h.shadowRoot.querySelector("li.rmke-row"));
    const rows = [...host.shadowRoot.querySelectorAll("li.rmke-row")];

    // Clipped means the text is wider than the box it has to sit in. One
    // pixel of slack absorbs sub-pixel rounding.
    const clipped = [];
    const check = (root, selectors) => {
      for (const el of root) {
        for (const sel of selectors) {
          const node = el.querySelector(sel);
          if (node && node.scrollWidth > node.clientWidth + 1) {
            clipped.push(`${sel} "${node.textContent.trim().slice(0, 40)}"`);
          }
        }
      }
    };
    check(rows, [".rmke-row-title", ".rmke-row-artist"]);

    // The live-event row is a separate component with the same failure mode:
    // artwork, a LIVE badge and a Tickets button squeezing the event name.
    const events = [...host.shadowRoot.querySelectorAll(".rmke-event")];
    check(events, [".rmke-event-title", ".rmke-event-venue", ".rmke-event-support"]);

    const body = rows[0]?.querySelector(".rmke-row-body");
    const eventBody = events[0]?.querySelector(".rmke-event-body");
    return {
      widget: Math.round(host.getBoundingClientRect().width),
      stacked: body ? getComputedStyle(body).flexDirection === "column" : null,
      eventWrapped: eventBody ? getComputedStyle(eventBody).flexWrap === "wrap" : null,
      rows: rows.length,
      events: events.length,
      clipped,
    };
  });

  // Wide must stay on one line; narrow must stack. A container query that
  // fires at every width would "fix" truncation by making desktop ugly.
  const expectNarrow = r.widget <= 460;
  const layoutOk = r.stacked === expectNarrow;
  // null when the page happened to serve no upcoming events; that is not a
  // failure, it just means there was nothing to check.
  const eventLayoutOk = r.eventWrapped === null || r.eventWrapped === expectNarrow;
  const textOk = r.clipped.length === 0;

  const verdict = layoutOk && eventLayoutOk && textOk ? "PASS" : "FAIL";
  console.log(
    `  ${String(width).padStart(4)}px  ${verdict}  widget ${String(r.widget).padStart(4)}px  stacked:${String(r.stacked).padStart(5)} eventWrap:${String(r.eventWrapped).padStart(5)} (want ${expectNarrow})  rows ${r.rows} events ${r.events}  clipped ${r.clipped.length}`,
  );
  if (!layoutOk) failures.push(`${width}px: expected stacked=${expectNarrow}, got ${r.stacked}`);
  if (!eventLayoutOk) {
    failures.push(`${width}px: expected event wrap=${expectNarrow}, got ${r.eventWrapped}`);
  }
  if (!textOk) failures.push(`${width}px: ${r.clipped.length} clipped, e.g. ${r.clipped[0]}`);

  await ctx.close();
}

await browser.close();
server.close();

if (failures.length) {
  console.error("\nFAILED:\n" + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
console.log("\nAll play-row width checks passed.");
