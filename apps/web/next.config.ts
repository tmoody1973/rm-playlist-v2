import type { NextConfig } from "next";
import { join } from "node:path";

const nextConfig: NextConfig = {
  // Pin Turbopack's workspace root to the repo root. Without this it was
  // picking up a stray ~/package-lock.json from outside the project and
  // warning on every dev start.
  turbopack: {
    root: join(import.meta.dirname, "..", ".."),
  },
  // Let Next look up hoisted workspace packages (@rm/convex, @rm/types).
  transpilePackages: ["@rm/convex", "@rm/types"],
};

export default nextConfig;
