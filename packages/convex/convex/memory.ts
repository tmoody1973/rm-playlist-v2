import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { assertListenerId, assertServerKey } from "./listenerGuard";
import { MAX_SCREEN, playAtNumber } from "./memoryLogic";

const guard = (serverKey: string) =>
  assertServerKey(serverKey, process.env.RADIO_COMMONS_SERVER_KEY);

export const stateFor = (ctx: QueryCtx | MutationCtx, listenerId: string) =>
  ctx.db
    .query("listenerState")
    .withIndex("by_listener", (q) => q.eq("listenerId", listenerId))
    .first();

export const rememberScreen = mutation({
  args: { serverKey: v.string(), listenerId: v.string(), playIds: v.array(v.string()) },
  handler: async (ctx, { serverKey, listenerId, playIds }) => {
    guard(serverKey);
    assertListenerId(listenerId);
    const valid = playIds
      .map((id) => ctx.db.normalizeId("plays", id))
      .filter((id): id is Id<"plays"> => id !== null)
      .slice(0, MAX_SCREEN);
    const screen = { shownAt: Date.now(), playIds: valid };
    const existing = await stateFor(ctx, listenerId);
    if (existing) await ctx.db.patch(existing._id, { screen });
    else await ctx.db.insert("listenerState", { listenerId, screen });
    return null;
  },
});

export const screenPlay = query({
  args: { serverKey: v.string(), listenerId: v.string(), number: v.number() },
  handler: async (ctx, { serverKey, listenerId, number }) => {
    guard(serverKey);
    assertListenerId(listenerId);
    return playAtNumber((await stateFor(ctx, listenerId))?.screen, number, Date.now());
  },
});
