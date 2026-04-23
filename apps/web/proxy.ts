import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Next.js 16 renamed the middleware file convention from `middleware.ts` to
 * `proxy.ts`. The function signature + behavior are identical; only the
 * filename changed. See node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md.
 *
 * Clerk still exports `clerkMiddleware()` — the name refers to the function
 * it returns, not the file it lives in.
 */

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/widgets(.*)",
  "/streams(.*)",
  "/reports(.*)",
  "/events(.*)",
  "/unclassified(.*)",
  "/settings(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  // Standard Clerk matcher — skips Next internals and static files.
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
