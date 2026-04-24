import { ConvexClient } from "convex/browser";

/**
 * One ConvexClient per page. Every widget mount on a given host shares
 * the same WebSocket connection, so a page with a strip + a card still
 * only opens one upstream subscription transport.
 *
 * The public URL is baked into the bundle at build time via Vite's
 * `VITE_CONVEX_URL` env. Partner stations never need to configure this —
 * it's encoded in the `/v1/widget.js` asset they load.
 */

let shared: ConvexClient | null = null;

export function getConvexClient(): ConvexClient {
  if (shared !== null) return shared;

  const url = import.meta.env.VITE_CONVEX_URL;
  if (!url) {
    throw new Error(
      "VITE_CONVEX_URL missing — the embed bundle was built without a Convex URL. " +
        "Set VITE_CONVEX_URL in apps/embed/.env before `bun run build`.",
    );
  }

  shared = new ConvexClient(url);
  return shared;
}
