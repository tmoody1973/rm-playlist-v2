import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, query } from "./_generated/server";
import { assertServerKey } from "./listenerGuard";
import { encryptToken } from "./tokenCrypto";

const guard = (serverKey: string) =>
  assertServerKey(serverKey, process.env.RADIO_COMMONS_SERVER_KEY);
const assertListener = (listenerId: string) => {
  if (listenerId.trim().length === 0) throw new Error("InvalidListener");
};
const MAX_TOKEN_LENGTH = 4096;

// An action, not a mutation: encryptToken needs crypto.getRandomValues, which mutations deny.
export const connect = action({
  args: { serverKey: v.string(), listenerId: v.string(), musicUserToken: v.string() },
  handler: async (ctx, { serverKey, listenerId, musicUserToken }): Promise<{ linked: true }> => {
    guard(serverKey);
    assertListener(listenerId);
    if (musicUserToken.length === 0 || musicUserToken.length > MAX_TOKEN_LENGTH)
      throw new Error("InvalidMusicUserToken");
    const key = process.env.FINDS_ENCRYPTION_KEY;
    if (!key) throw new Error("FINDS_ENCRYPTION_KEY is not set");
    const encryptedUserToken = await encryptToken(musicUserToken, key);
    await ctx.runMutation(internal.appleMusicLinks.storeLink, { listenerId, encryptedUserToken });
    return { linked: true as const };
  },
});

export const storeLink = internalMutation({
  args: { listenerId: v.string(), encryptedUserToken: v.string() },
  handler: async (ctx, { listenerId, encryptedUserToken }) => {
    const existing = await ctx.db
      .query("appleMusicLinks")
      .withIndex("by_listener", (q) => q.eq("listenerId", listenerId))
      .first();
    const fields = { encryptedUserToken, linkedAt: Date.now(), status: "active" as const };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("appleMusicLinks", { listenerId, ...fields });
  },
});

export const status = query({
  args: { serverKey: v.string(), listenerId: v.string() },
  handler: async (ctx, { serverKey, listenerId }) => {
    guard(serverKey);
    assertListener(listenerId);
    const link = await ctx.db
      .query("appleMusicLinks")
      .withIndex("by_listener", (q) => q.eq("listenerId", listenerId))
      .first();
    return link ? link.status : ("none" as const);
  },
});
