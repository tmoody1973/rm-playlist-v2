import type { NextConfig } from "next";
import { join } from "node:path";

const nextConfig: NextConfig = {
  // Pin Turbopack's workspace root to the repo root so it doesn't pick up a
  // stray lockfile from outside the project. Same as apps/web.
  turbopack: {
    root: join(import.meta.dirname, "..", ".."),
  },
  // Let Next resolve the hoisted workspace package (@rm/convex).
  transpilePackages: ["@rm/convex"],
};

export default nextConfig;
