import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Ensure a `users` row exists for the currently-signed-in Clerk identity.
 *
 * Called by the dashboard's providers on first mount. Default role is
 * `operator`. An existing admin row is left as-is — never auto-demotes.
 */
export const ensureUserRecord = mutation({
  args: {},
  returns: v.object({
    userId: v.id("users"),
    role: v.union(v.literal("operator"), v.literal("admin")),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new Error("ensureUserRecord called without a signed-in user");
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();

    if (existing !== null) {
      return { userId: existing._id, role: existing.role };
    }

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", "radiomilwaukee"))
      .first();
    if (org === null) {
      throw new Error("RM organization not seeded — run seed:rmOrg first");
    }

    const email = identity.email ?? `${identity.subject}@unknown`;
    const fullName = identity.name ?? identity.givenName ?? undefined;

    const role = "operator" as const;

    const userId = await ctx.db.insert("users", {
      orgId: org._id,
      clerkUserId: identity.subject,
      email,
      fullName,
      role,
      createdAt: Date.now(),
    });

    return { userId, role };
  },
});

/**
 * Read the current user's record. Returns null if not signed in or no row yet.
 */
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();

    if (user === null) return null;

    return {
      _id: user._id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };
  },
});
