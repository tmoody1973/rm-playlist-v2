import { logger, schedules } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { signDeveloperToken } from "../../packages/enrichment/src/apple-music/jwt";
import { api } from "../../packages/convex/convex/_generated/api.js";
import { getConvexUrl, requireEnv } from "./env";

/**
 * Weekly Apple Music JWT refresh.
 *
 * Signs a new ES256 developer token with the private key env var,
 * writes it to `appleMusicTokenCache` via Convex. Runs Sundays at
 * 00:00 UTC. The enrichment task triggers this on-demand when the
 * cache is empty.
 *
 * Env vars (set in the Trigger.dev dashboard):
 *   APPLE_MUSIC_TEAM_ID          — 10-char Apple Developer team ID
 *   APPLE_MUSIC_KEY_ID           — 10-char key ID from the .p8
 *   APPLE_MUSIC_PRIVATE_KEY_B64  — base64-encoded .p8 contents
 *   NEXT_PUBLIC_CONVEX_URL       — Convex deployment URL (or CONVEX_URL)
 */

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export const refreshAppleMusicToken = schedules.task({
  id: "refresh-apple-music-token",
  cron: "0 0 * * 0", // Sundays at 00:00 UTC
  maxDuration: 60,
  run: async () => {
    const teamId = requireEnv("APPLE_MUSIC_TEAM_ID");
    const keyId = requireEnv("APPLE_MUSIC_KEY_ID");
    const privateKeyB64 = requireEnv("APPLE_MUSIC_PRIVATE_KEY_B64");
    const privateKeyPem = Buffer.from(privateKeyB64, "base64").toString("utf8");

    const now = Math.floor(Date.now() / 1000);
    const token = signDeveloperToken({
      teamId,
      keyId,
      privateKeyPem,
      ttlSeconds: TOKEN_TTL_SECONDS,
      now: () => now,
    });
    const expiresAt = (now + TOKEN_TTL_SECONDS) * 1000;
    const mintedAt = now * 1000;

    const client = new ConvexHttpClient(getConvexUrl());
    await client.mutation(api.appleMusic.writeDeveloperToken, {
      token,
      expiresAt,
      mintedAt,
    });

    logger.log(`Minted fresh Apple Music JWT, expires ${new Date(expiresAt).toISOString()}`);
    return { refreshedAt: mintedAt, expiresAt };
  },
});
