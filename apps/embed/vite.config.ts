import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { resolve } from "node:path";

/**
 * Vite build config for the rm-playlist-v2 embeddable widget.
 *
 * Output structure (written to apps/embed/dist/):
 *   v1/widget.js        — the loader (~5KB target, reads data-* attrs)
 *   v1/chunks/*.js      — dynamically imported variant chunks
 *   v1/chunks/*.css     — scoped widget styles (injected into shadow DOM)
 *
 * The `/v1/` prefix is an explicit version pin — breaking embed changes
 * bump to `/v2/`, never mutate `/v1/` (brainstorm § widgets: "embed URLs
 * include /v1/ from day one"). Partner stations can pin to whichever
 * version they tested against.
 *
 * Bundle budget (revised 2026-04-24 after widget-variants shipped):
 *   target  — 30KB gzip for loader + shared chunks + one variant
 *   ceiling — 40KB gzip (fail the build above this)
 *
 * The original 15KB target was set before we understood the Convex
 * browser client's minimum footprint (~20KB gzip after terser). The
 * alternative — swapping WebSocket subscriptions for HTTP polling —
 * would save ~17KB but lose the real-time UX that makes these widgets
 * worth building over V1's iframe. Keeping the subscription model and
 * accepting the weight; 30KB gzip is small vs. typical third-party
 * widgets (Spotify ~100KB, YouTube ~150KB, Twitter ~200KB).
 *
 * Measured critical-path (now-playing-card): widget.js + jsxRuntime +
 * tokens + variant ≈ 28KB gzip. Under target with headroom.
 *
 * Enforced by `scripts/check-bundle-size.sh`, wired as
 * `bun run build:check` and invoked from CI.
 */
export default defineConfig({
  // Relative base so dynamic chunk imports (`./chunks/playlist-*.js`) resolve
  // against widget.js's own URL, not the host page's origin. Without this,
  // Vite emits absolute paths ("/v1/chunks/..."), which 404 whenever a
  // partner embeds the widget on their own domain — every production embed
  // was broken until this flipped.
  base: "./",
  plugins: [preact()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    minify: "terser",
    cssMinify: true,
    rollupOptions: {
      input: {
        widget: resolve(__dirname, "src/loader.ts"),
      },
      output: {
        // Stable entry path so a partner's <script src=".../v1/widget.js">
        // never breaks across deploys.
        entryFileNames: "v1/widget.js",
        // Variant chunks get content-hashed names under /v1/chunks/ so the
        // CDN can cache them indefinitely.
        chunkFileNames: "v1/chunks/[name]-[hash].js",
        assetFileNames: "v1/chunks/[name]-[hash][extname]",
      },
    },
    sourcemap: true,
  },
  // Local test harness at http://localhost:5173
  server: {
    port: 5173,
  },
});
