import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Apple Music developer token cache.
 *
 * The static secret is the private key (lives as env var
 * `APPLE_MUSIC_PRIVATE_KEY_B64` in the environments that mint tokens —
 * the Trigger.dev task, NOT Convex). The minted JWT lives here in Convex
 * for cross-process sharing by enrichment workers.
 *
 * `getDeveloperToken` returns the cached JWT if valid for at least
 * another 24h, otherwise `null` so the caller triggers a refresh.
 * `writeDeveloperToken` replaces the cached row.
 *
 * Minting (signing the JWT) happens in the Trigger.dev weekly cron task
 * (session 2), not here — Convex's mutation runtime can't use Node
 * crypto without `"use node"` pragma, and the JWT minter is a trivial
 * one-shot that doesn't need Convex scheduling. Keep Convex as pure
 * cache storage.
 */

const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export const getDeveloperToken = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cached = await ctx.db.query("appleMusicTokenCache").order("desc").first();
    if (cached === null) return null;
    if (cached.expiresAt <= Date.now() + REFRESH_THRESHOLD_MS) return null;
    return { token: cached.token, expiresAt: cached.expiresAt };
  },
});

export const writeDeveloperToken = internalMutation({
  args: {
    token: v.string(),
    expiresAt: v.number(),
    mintedAt: v.number(),
  },
  handler: async (ctx, args) => {
    for await (const row of ctx.db.query("appleMusicTokenCache")) {
      await ctx.db.delete(row._id);
    }
    await ctx.db.insert("appleMusicTokenCache", args);
  },
});
