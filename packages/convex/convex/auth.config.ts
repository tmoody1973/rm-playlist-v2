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
 *
 * Two issuers because this single Convex deployment serves both local
 * dev (pk_test JWTs from the dev Clerk instance) and playlistfm.app
 * (pk_live JWTs from the production Clerk instance):
 *   bunx convex env set CLERK_JWT_ISSUER_DOMAIN_PROD "https://clerk.playlistfm.app"
 * Until that env var is set, the provider list is unchanged. Evaluated
 * at deploy time — re-run the Convex deploy workflow after setting it.
 */
const issuerDomains = [
  process.env.CLERK_JWT_ISSUER_DOMAIN,
  process.env.CLERK_JWT_ISSUER_DOMAIN_PROD,
].filter((domain): domain is string => domain !== undefined);

export default {
  providers: issuerDomains.map((domain) => ({
    domain,
    applicationID: "convex",
  })),
};
