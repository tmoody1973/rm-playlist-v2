import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Next.js 16 renamed the middleware file convention from `middleware.ts` to
 * `proxy.ts`. The function signature + behavior are identical; only the
 * filename changed. Mirrors apps/web/proxy.ts.
 *
 * Only the Clerk-gated admin builder needs auth. Public microsite routes
 * (`/`, `/[station]`, ...) stay open. The `@radiomilwaukee.org` allowlist is
 * enforced on top of this in app/admin/layout.tsx (server-side).
 */
const isProtectedRoute = createRouteMatcher(["/admin(.*)"]);

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
