import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { appleOutcome } from "./appleOutcome";
import { decryptToken } from "./tokenCrypto";

const RETRY_DELAY_MS = 60_000;
const LIBRARY_URL = "https://api.music.apple.com/v1/me/library";

async function postToLibrary(
  songId: string,
  developerToken: string,
  userToken: string,
): Promise<number | "network"> {
  try {
    const res = await fetch(`${LIBRARY_URL}?ids[songs]=${encodeURIComponent(songId)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${developerToken}`, "Music-User-Token": userToken },
    });
    return res.status;
  } catch {
    return "network";
  }
}

/** Runs after Alexa has answered (scheduled by finds.save), so Apple's speed never touches the 500 ms budget. */
export const addToAppleMusic = internalAction({
  args: { findId: v.id("finds"), attempt: v.optional(v.number()) },
  handler: async (ctx, { findId, attempt = 1 }): Promise<void> => {
    const loaded = await ctx.runQuery(internal.finds.loadForApple, { findId });
    if (loaded === null) return;
    if (loaded.link === null) {
      await ctx.runMutation(internal.finds.recordAppleOutcome, { findId, status: "not_linked" });
      return;
    }
    if (loaded.appleMusicSongId === null) {
      await ctx.runMutation(internal.finds.recordAppleOutcome, {
        findId,
        status: "failed",
        reason: "not in Apple Music catalog",
      });
      return;
    }
    const key = process.env.FINDS_ENCRYPTION_KEY;
    const developer = await ctx.runQuery(api.appleMusic.getDeveloperToken, {});
    if (!key || !developer) {
      await ctx.runMutation(internal.finds.recordAppleOutcome, {
        findId,
        status: "failed",
        reason: "Apple Music not configured",
      });
      return;
    }
    let userToken: string;
    try {
      userToken = await decryptToken(loaded.link.encryptedUserToken, key);
    } catch {
      await ctx.runMutation(internal.finds.recordAppleOutcome, {
        findId,
        status: "expired",
        reason: "Apple Music needs reconnecting",
        expireLink: loaded.link.linkId,
      });
      return;
    }
    const outcome = appleOutcome(
      await postToLibrary(loaded.appleMusicSongId, developer.token, userToken),
    );
    if (outcome.retry && attempt === 1) {
      await ctx.scheduler.runAfter(RETRY_DELAY_MS, internal.findsApple.addToAppleMusic, {
        findId,
        attempt: 2,
      });
      return;
    }
    await ctx.runMutation(internal.finds.recordAppleOutcome, {
      findId,
      status: outcome.status,
      reason: outcome.reason,
      expireLink: outcome.status === "expired" ? loaded.link.linkId : undefined,
    });
  },
});
