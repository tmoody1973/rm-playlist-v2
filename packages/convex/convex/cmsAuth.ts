import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Server-side authorization for the Station Microsites CMS.
 *
 * The user is ALWAYS derived from the verified Clerk identity
 * (`ctx.auth.getUserIdentity()`) → the `users` row → its role. A client-passed
 * userId or role is never trusted — matches the repo convention and the
 * design doc 005 "Authorization" rule.
 *
 * Roles (design doc 005): `operator` may create/edit/publish pages for any
 * station; `admin` additionally manages themes and deletes pages.
 */
export type CmsRole = "operator" | "admin";

/**
 * Resolve the signed-in CMS user, or `null` when there's no verified identity
 * or no `users` row yet (the row is created on first admin mount by
 * EnsureUserRecord — a read query that fires before that lands should degrade
 * gracefully, not throw).
 */
export async function getCmsUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first();
}

/**
 * Require a signed-in CMS user with at least `minRole`. Throws otherwise.
 * Use in every CMS write mutation. Returns the `users` row for attribution
 * (createdBy / updatedBy).
 */
export async function requireCmsUser(
  ctx: QueryCtx | MutationCtx,
  minRole: CmsRole = "operator",
): Promise<Doc<"users">> {
  const user = await getCmsUser(ctx);
  if (user === null) {
    throw new Error("Not authorized — sign in with a Radio Milwaukee account.");
  }
  if (minRole === "admin" && user.role !== "admin") {
    throw new Error("Admin role required for this action.");
  }
  return user;
}
