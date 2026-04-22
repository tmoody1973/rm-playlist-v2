# 002 — Secrets at Rest

**Date:** 2026-04-22
**Status:** Accepted
**Context:** rm-playlist-v2 ingests from external APIs (Spinitron per-station, SGmetadata, Ticketmaster, AXS, Spotify) and integrates with managed services (Convex, Clerk, Trigger.dev, Fly, Cloudflare). Each one needs credentials. This document defines where they live, how code references them, and how they rotate.

## Decision

**Secrets live in env vars, never in DB rows.** Convex `ingestionSources.config.apiKeyRef` stores the _name_ of the env var (e.g. `"HYFIN_SPINITRON_KEY"`); the worker resolves the actual secret from `Deno.env.get(apiKeyRef)` at call time. The DB stores a pointer; the value never appears in a row.

## Why

- Convex tables are queryable across surfaces. A leaked query (or a misconfigured public read) that returns a row containing a raw API key is a pager event. A row containing the _name_ of an env var is harmless.
- Env vars are scoped per-deployment (production vs preview vs local). A row in the DB is global to that DB. Env vars match how secrets actually want to be scoped.
- Rotation becomes one place to change instead of one per row × per environment.
- It matches Convex's intended pattern: secrets are read in actions via `Deno.env.get()`, never in queries/mutations.

## Where each secret lives

| Secret category                              | Store                                                    | Specific names                                                                                                         | Notes                                                                                                                                                                           |
| -------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spinitron API keys (per station)             | Convex env vars                                          | `HYFIN_SPINITRON_KEY`, `88NINE_SPINITRON_KEY`, `414MUSIC_SPINITRON_KEY`, `RHYTHMLAB_SPINITRON_KEY`                     | One per station; rotate per station independently                                                                                                                               |
| SGmetadata HTTP basic auth                   | Convex env vars                                          | `SGMETADATA_USER`, `SGMETADATA_PASS`                                                                                   | Single tenant credential, applies to all SG-served streams                                                                                                                      |
| ICY stream URL                               | Convex env vars                                          | `RHYTHMLAB_ICY_URL`                                                                                                    | Not technically a secret but treated as one (private endpoint)                                                                                                                  |
| Ticketmaster Discovery API                   | Convex env vars                                          | `TICKETMASTER_API_KEY`                                                                                                 | Free-tier rate-limited; rotate annually                                                                                                                                         |
| AXS API                                      | Convex env vars                                          | `AXS_API_KEY`, `AXS_PARTNER_ID`                                                                                        | Pabst Theater Group venues                                                                                                                                                      |
| Spotify Web API (enrichment + deep-link)     | Convex env vars                                          | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`                                                                           | Used for canonical metadata enrichment + "Listen on Spotify" deep-link affordance only. Preview source moved to Apple Music API on 2026-04-22                                   |
| Apple Music API (preview source + deep-link) | Convex env vars                                          | `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, `APPLE_MUSIC_PRIVATE_KEY_B64`                                             | `.p8` private key contents base64-encoded for env-var safety. Used to sign ES256 JWT developer tokens. See TODO-1 for setup                                                     |
| Apple Music developer token (cached)         | Convex DB row (NOT env var — derived secret)             | `appleMusicTokenCache.token` + `expiresAt`                                                                             | Generated by signing JWT with the private key. Refreshed via Trigger.dev cron weekly. Lives in DB because it's a per-deployment derived value with TTL, not a static credential |
| Clerk auth                                   | Both Convex AND Next.js env vars                         | `CLERK_SECRET_KEY` (server), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (client OK)                                           | Publishable key is safe in client bundle                                                                                                                                        |
| Convex deploy / admin                        | Convex CLI + GitHub Actions                              | `CONVEX_DEPLOY_KEY`                                                                                                    | CI-only; never in code                                                                                                                                                          |
| Trigger.dev                                  | Trigger.dev project + Convex env (for outbound triggers) | `TRIGGER_SECRET_KEY`                                                                                                   | Used by Convex actions to enqueue tasks                                                                                                                                         |
| Fly.io ICY worker                            | Fly secrets (`fly secrets set`)                          | All `RHYTHMLAB_*` secrets needed by ICY worker, plus `CONVEX_DEPLOY_URL` and a Convex HTTP action token for write-back | Fly secrets are encrypted at rest by Fly                                                                                                                                        |
| Cloudflare Pages (widget CDN)                | Cloudflare Pages env vars                                | `NEXT_PUBLIC_CONVEX_URL` (public, OK in widget bundle)                                                                 | No secrets — widget is unauthenticated client                                                                                                                                   |

### Multi-store reality

There is no one place. Convex env vars, Next.js env vars (Vercel or self-hosted), Trigger.dev project env, Fly secrets, and Cloudflare Pages env all have to be set. **`scripts/sync-env.sh` is a per-environment helper that takes a single `.env.production` source-of-truth and writes to each store via their CLI.** Manual sync is error-prone; this helper exists so secret rotation is one command, not five.

`.env.production` itself never gets committed. It lives in `~/.gstack/secrets/rm-playlist-v2/.env.production` (user-scoped, outside the repo). 1Password / Bitwarden export integration deferred until rotation actually becomes painful.

## How code references secrets

### Pattern A — DB-driven (per-station ingestion sources)

```ts
// convex/schema.ts
ingestionSources: defineTable({
  orgId: v.id("organizations"),
  stationId: v.id("stations"),
  adapter: v.string(),                  // "spinitron" | "icy" | "sgmetadata"
  config: v.object({
    apiKeyRef: v.optional(v.string()),  // env var NAME, e.g. "HYFIN_SPINITRON_KEY"
    endpoint: v.optional(v.string()),
    // adapter-specific config; never raw secrets
  }),
  enabled: v.boolean(),
  ...
})
```

```ts
// convex/actions/poll.ts
export const pollOnce = internalAction({
  args: { sourceId: v.id("ingestionSources") },
  handler: async (ctx, { sourceId }) => {
    const source = await ctx.runQuery(internal.sources.get, { sourceId });
    const apiKey = source.config.apiKeyRef ? Deno.env.get(source.config.apiKeyRef) : undefined;
    if (source.config.apiKeyRef && !apiKey) {
      throw new Error(`Missing env var: ${source.config.apiKeyRef}`);
    }
    // ...adapter call with apiKey
  },
});
```

The DB row says "use the value at `HYFIN_SPINITRON_KEY`." It does not say what that value is.

### Pattern B — Direct (singleton service credentials)

For services with a single credential (Ticketmaster, Spotify), action handlers read directly from `Deno.env.get("TICKETMASTER_API_KEY")` without DB indirection. The `apiKeyRef` indirection only earns its complexity when there's a 1-to-many relationship (multiple ingestion sources sharing one credential pattern but different values).

### Pattern C — Public (widget bundle)

The widget bundle has ONE acceptable env var injection: `NEXT_PUBLIC_CONVEX_URL`. Everything else is forbidden. Build-time check in `apps/embed/`'s build pipeline:

```bash
# fail the widget build if any non-NEXT_PUBLIC env var is referenced
grep -rE 'process\.env\.[A-Z_]+' apps/embed/src \
  | grep -vE 'NEXT_PUBLIC_CONVEX_URL' \
  && exit 1 || true
```

This is a CI gate. The widget cannot ship with a secret in it.

## Rotation procedure

When a secret needs rotation (compromise, scheduled rotation, employee departure):

1. Generate new value at the source (Spotify console, Spinitron admin, etc.)
2. Update `~/.gstack/secrets/rm-playlist-v2/.env.production` (single source of truth)
3. Run `scripts/sync-env.sh production` — pushes to all stores (Convex, Next.js host, Trigger, Fly, Cloudflare)
4. Confirm services pick up the new value (Convex action invokes get refreshed env on next deploy; Fly secrets push triggers machine restart; Trigger picks up on next task run)
5. Revoke the old value at the source
6. Tag the rotation in `~/.gstack/secrets/rm-playlist-v2/rotation-log.md` (date, who, why)

Critical secrets (Spotify, Clerk, Convex deploy key) get tested via a smoke action right after rotation: `convex run internal.diagnostics.smokeTest` confirms each connected service responds with the new credential.

## What this excludes

- **Secret encryption at the env-var-store level.** We trust the platform stores (Convex, Fly, Cloudflare) to encrypt env vars at rest. They do.
- **Secret-scanning in source code.** Pre-commit hook with `gitleaks` is a separate decision, deferred to TODOS.md if not already there.
- **Per-user secrets / OAuth tokens.** Clerk handles user OAuth (Spotify-for-listener-login, future feature). Those tokens live in Clerk's user metadata, not in our DB or env vars.
- **HSM / KMS-managed keys.** Overkill for a single-tenant public-radio playlist. Reconsider if/when multi-tenancy revives (decision 001).

### Apple Music developer token caching pattern

The Apple Music developer token is derived (signed JWT, max 6mo TTL) rather than a static credential. The static secret is the private key (`APPLE_MUSIC_PRIVATE_KEY_B64`). The token is generated, cached in Convex, and refreshed via cron:

```ts
// convex/appleMusic.ts
export const getDeveloperToken = internalQuery({
  handler: async (ctx) => {
    const cached = await ctx.db.query("appleMusicTokenCache").first();
    if (cached && cached.expiresAt > Date.now() + 24 * 3600 * 1000) {
      return cached.token; // valid for at least another day
    }
    return null; // cron will mint a fresh one
  },
});

// convex/crons.ts — Trigger.dev hourly check, mint if cache is empty or expiring
// signs JWT with `APPLE_MUSIC_PRIVATE_KEY_B64` decoded → `kid: APPLE_MUSIC_KEY_ID`, `iss: APPLE_MUSIC_TEAM_ID`, exp: now + 30 days
```

This pattern keeps the long-lived secret (private key) in env vars, the short-lived derived secret (JWT) in DB with explicit TTL, and rotation is automated.

## Open questions / future revisits

- When multi-tenancy revives (decision 001 → reverse), per-org secrets need a different storage strategy. Likely candidates: Doppler, 1Password Secrets Automation, or per-org Clerk Org private metadata. Revisit at that trigger.
- Apple Music API rate limits aren't well-documented publicly. If we hit throttling during shakedown, evaluate caching `previews[0].url` on the play row at enrichment time (avoids per-request API calls; trades freshness for resilience).

## Related

- `decisions/001-single-tenant-first.md` — context for why per-tenant secret storage isn't yet a problem
- `radiomke-playlist-v2-brainstorm.md` — `ingestionSources.config.apiKeyRef` pattern referenced
- `TODOS.md#TODO-1` — Spotify grandfathered-app verification (affects whether `SPOTIFY_*` secrets are needed at all)
