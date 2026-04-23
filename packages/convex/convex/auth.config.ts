/**
 * Tells Convex how to validate Clerk-issued JWTs.
 *
 * The `domain` is Clerk's frontend API URL (`https://<slug>.clerk.accounts.dev`
 * for dev instances, or a custom domain in prod). Set via Convex env:
 *   bunx convex env set CLERK_JWT_ISSUER_DOMAIN "https://<your-slug>.clerk.accounts.dev"
 *
 * The `applicationID` "convex" must also be configured on the Clerk side as a
 * JWT template named "convex". See:
 *   https://docs.convex.dev/auth/clerk
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
