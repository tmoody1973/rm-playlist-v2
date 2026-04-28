import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { resolve } from "node:path";

/**
 * Sister vite config for the CLASSIC-SCRIPT bundle.
 *
 * Output: dist/v1/widget-legacy.js — single IIFE bundle, all three
 * variants statically imported (no dynamic import() / no code splitting).
 *
 * Why a separate config: IIFE format is incompatible with code splitting,
 * and the default vite.config.ts depends on code splitting to keep its
 * critical path small. Cleanest separation is two configs that both
 * write into dist/v1/ — the modular build runs first (emptying dist),
 * the legacy build runs second (appending widget-legacy.js alongside
 * widget.js, the chunks/, and the public/ files like iframe.html).
 *
 * Bundle expectation: ~30–35KB gzip (everything inlined). Under the
 * 40KB ceiling enforced by check-bundle-size.sh.
 */
export default defineConfig({
  base: "./",
  plugins: [preact()],
  build: {
    outDir: "dist",
    // Critical: do NOT empty here — the modular build ran first and
    // we want to keep its outputs alongside ours.
    emptyOutDir: false,
    target: "es2020",
    minify: "terser",
    cssMinify: true,
    rollupOptions: {
      input: resolve(__dirname, "src/loader-legacy.ts"),
      output: {
        format: "iife",
        // The IIFE wrapper needs a global name even though we don't
        // intentionally expose anything; keep it brand-prefixed so it
        // can't collide with a partner's globals.
        name: "RmkePlaylistWidgetLegacy",
        // Stable entry filename so partners can pin to .../v1/widget-legacy.js
        entryFileNames: "v1/widget-legacy.js",
        // No code splitting in IIFE format. inlineDynamicImports forces
        // any leftover dynamic imports to bundle inline rather than
        // produce chunks (which IIFE can't load anyway).
        inlineDynamicImports: true,
      },
    },
    sourcemap: true,
  },
});
