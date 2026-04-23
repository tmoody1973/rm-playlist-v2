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
 * Bundle budget (eng review § architecture #2):
 *   target  — 15KB gzip for loader + one variant
 *   ceiling — 25KB gzip (fail the build above this)
 *
 * Measure via `bun run build` then `gzip -c dist/v1/widget.js | wc -c`.
 */
export default defineConfig({
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
