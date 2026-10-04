# Finds Library + Apple Music Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real Alexa+ listeners link a station account, say "save it" after a song-recall answer, keep a station-owned Finds library, and optionally get the song added to their own Apple Music library.

**Architecture:**
- A new **listener Clerk application** is the OAuth login server that Alexa account-links to.
- **Radio Commons** (Next.js, `mcp-handler`) checks the token locally, gates only the Finds tools, and calls the playlist Convex deployment.
- **rm-playlist-v2 Convex** stores `finds` and encrypted `appleMusicLinks`. Every function is behind a server key. Adding a song to Apple Music happens in a scheduled internal action, after Alexa has already answered.

**Tech Stack:** Convex (rm-playlist-v2, Bun tests), Next.js 16 + `mcp-handler` 2.2 + `@modelcontextprotocol/ext-apps` 2 + vitest (Radio Commons), Clerk (`@clerk/backend`), Apple MusicKit JS v3 + Apple Music API, `alexa-ai` CLI.

**Spec:** `docs/superpowers/specs/2026-10-04-finds-library-design.md` (approved 2026-10-04). Decision: `docs/decisions/008-listener-accounts-and-finds.md`.

### Corrections to the spec found while planning

1. **Radio Commons has no playlist tools yet.** It has no `find_song_played`, no track-story tool, and no client for the playlist deployment. `save_find` needs the `playId` that `find_song_played` returns, so **Part B starts with B1–B2**: a playlist client and the two recall tools that call sub-project #1's queries (`alexa:findSongPlayed`, `alexa:getTrackFacts`).
2. **Amazon wants HTTP 401 for a tool called without a token, but MCP tools can't set HTTP status.** So the per-tool gate lives in the route. A small wrapper reads the JSON-RPC body, and when `tools/call` names a Finds tool and no valid token is attached, it returns 401 with `WWW-Authenticate: Bearer resource_metadata="…"` (Task B3).

## Global Constraints

- **Repos:**
  - rm-playlist-v2 = `/Users/tarikmoody/Documents/Projects/rm-playlist-v2` (work in a worktree off `main`; never commit in the main checkout)
  - Radio Commons = `/Users/tarikmoody/Projects/radio-commons` (branch off `main`)
- **Never run `bunx convex dev`, `bunx convex codegen` or `bunx convex deploy`** in rm-playlist-v2. They push to the shared production deployment. Register new Convex modules by hand in `packages/convex/convex/_generated/api.d.ts`.
- **Every Tool call stays under 500 ms.** Token checks are local (Clerk JWT access tokens, verified with `CLERK_LISTENER_JWT_KEY`, no network). The Apple call never runs inside a tool call.
- **Every `finds`/`appleMusicLinks` function needs `serverKey`**, checked in constant time against Convex env `RADIO_COMMONS_SERVER_KEY`. A mismatch throws `Unauthorized`, and no data is returned.
- **Apple Music User Tokens are stored encrypted only:** AES-256-GCM, key = Convex env `FINDS_ENCRYPTION_KEY` (32 bytes, base64). The key never leaves Convex.
- **Identity:** `listenerId` = Clerk user ID (the token's `sub`). Never store email or name in Convex.
- **Finds tools need auth:** exactly `save_find`, `list_finds`, `delete_my_finds`. Every other tool must keep working with no token.
- **Scopes:** `openid profile offline_access`. Access tokens are in **JWT** format.
- **`list_finds` `limit`:** integer clamped to 1–10, default 5.
- **`dedupeKey`:** `track:<trackId>` when a track exists, else `play:<playId>`.
- **Apple outcome statuses:** exactly `not_linked | pending | added | failed | expired`.
- **New env vars:**
  - Convex: `RADIO_COMMONS_SERVER_KEY`, `FINDS_ENCRYPTION_KEY`
  - Radio Commons: `PLAYLIST_CONVEX_URL`, `RADIO_COMMONS_SERVER_KEY`, `CLERK_LISTENER_SECRET_KEY`, `CLERK_LISTENER_PUBLISHABLE_KEY`, `CLERK_LISTENER_JWT_KEY`, `CLERK_LISTENER_ISSUER`, `MCP_RESOURCE_URL`
- **Commit only. Never push or open PRs** (the human does that). Deploy order: the rm-playlist Convex PR (Part A) deploys before the Radio Commons PR that calls it (Part B).

## Review Focus

1. **A listener says "save it" before any recall in the conversation** (no `playId`). Expect `save_find` to fail validation with a message Alexa can turn into "which song?", never a crash. Pinned in B4.
2. **Wrong or missing server key on a read** (someone calls `finds.list` directly on the public deployment). Expect `Unauthorized` and no rows. Pinned in A1 (helper) and A3 (handler uses it first).
3. **A tampered or truncated encrypted token, or a different key.** Expect decryption to throw, and the Apple add to record `expired` rather than retry forever. Pinned in A1 and A4.
4. **An anonymous listener asks a podcast question while Finds tools exist.** Expect the existing tools to work exactly as before, with no 401. Pinned in B3.
5. **Saving the same song twice, from two different spins.** Expect one find with a refreshed `savedAt` (same `track:` key). Pinned in A3.

---

## Part 0 — Account-linking spike (gate, throwaway)

### Task 0: Prove Alexa+ ↔ Clerk account linking live

Nothing from this task is kept except the report. **Tarik owns the dashboard and console steps**, because they need his Clerk and Amazon developer accounts. The agent prepares and checks everything else.

**Files:**
- Create (report only): `docs/superpowers/spikes/2026-10-xx-account-linking-spike.md` in rm-playlist-v2
- Throwaway branch in Radio Commons: `spike/account-linking`, deleted after the report

- [ ] **Step 1 (Tarik): create the listener Clerk application.** Clerk Dashboard → Create application "Radio Milwaukee Listeners" (development instance) → enable email sign-in. Then **OAuth applications** → **New** "Alexa+". Set:
  - Public client: **off** (confidential, with a secret)
  - Scopes: `openid profile offline_access`
  - Access token format: **JWT**
  - **Settings → Require PKCE: on**

  Copy the client ID and secret, plus the instance's **Frontend API URL** (the issuer, e.g. `https://<slug>.clerk.accounts.dev`) and its **JWT public key** (API Keys → Show JWT public key).

- [ ] **Step 2 (agent): minimal auth on the spike branch.** In Radio Commons on `spike/account-linking`, add `@clerk/backend` and wire Tasks B3's `src/lib/listenerAuth.ts` + `src/app/.well-known/...` routes (use B3's code verbatim) around the existing handler. Deploy to a Vercel **preview** URL (not production).

- [ ] **Step 3 (Tarik): register with Amazon.**

```bash
alexa-ai configure-account-linking --addon-id <your add-on id> --stage development --client-id <Clerk OAuth client id>
```

  Enter the client secret at the masked prompt, then paste **every** redirect URI it prints into the Clerk OAuth app's redirect URIs.

- [ ] **Step 4 (Tarik + agent): link a real Amazon account** in the Alexa+ web simulator, and record each check:
  - (a) Linking completes.
  - (b) A refresh token is issued. Check in the Clerk dashboard: Users → the linked user → the OAuth grant should list `offline_access`. Don't log tokens themselves; temporarily logging the access token's `scope` and `exp` claims is enough evidence.
  - (c) The `resource` parameter is accepted (linking didn't fail at authorize or token).
  - (d) An unlinked listener can still use `find_station_story`, and calling the gated test tool gets a "link your account" prompt.

- [ ] **Step 5: write the report** with pass/fail per check and the exact console output (secrets redacted). Then:
  - If **(a)–(c) fail**, stop and re-plan B3 for Auth0 or Cognito (only `listenerAuth.ts` and the Clerk env vars change).
  - If **(d) fails**, stop and re-plan B3–B4 as a separate add-on with `required: true`.
  - **Only continue to Parts A and B on a pass.**

```bash
git add docs/superpowers/spikes/
git commit -m "docs: account-linking spike results (Clerk + Alexa+)"
```

---

## Part A — rm-playlist-v2 Convex (PR A)

### Task A1: Server-key guard and token encryption (pure)

**Files:**
- Create: `packages/convex/convex/listenerGuard.ts`
- Create: `packages/convex/convex/tokenCrypto.ts`
- Test: `packages/convex/test/listenerGuard.test.ts`, `packages/convex/test/tokenCrypto.test.ts`

**Interfaces:**
- Produces:
  - `assertServerKey(given: string, expected: string | undefined): void` (throws `Error("Unauthorized")`)
  - `encryptToken(plain: string, keyB64: string): Promise<string>`
  - `decryptToken(sealed: string, keyB64: string): Promise<string>` (throws on tamper or wrong key)

- [ ] **Step 1: Write the failing tests**

`packages/convex/test/listenerGuard.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { assertServerKey } from "../convex/listenerGuard";

describe("assertServerKey", () => {
  test("accepts the exact key", () => {
    expect(() => assertServerKey("s3cret-key", "s3cret-key")).not.toThrow();
  });
  test("rejects a wrong key, a prefix, and an empty key", () => {
    expect(() => assertServerKey("s3cret-kez", "s3cret-key")).toThrow("Unauthorized");
    expect(() => assertServerKey("s3cret", "s3cret-key")).toThrow("Unauthorized");
    expect(() => assertServerKey("", "s3cret-key")).toThrow("Unauthorized");
  });
  test("rejects everything when the server key env is unset", () => {
    expect(() => assertServerKey("anything", undefined)).toThrow("Unauthorized");
    expect(() => assertServerKey("", "")).toThrow("Unauthorized");
  });
});
```

`packages/convex/test/tokenCrypto.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { decryptToken, encryptToken } from "../convex/tokenCrypto";

const key = Buffer.alloc(32, 7).toString("base64");
const otherKey = Buffer.alloc(32, 9).toString("base64");

describe("token encryption", () => {
  test("round-trips and never stores the plain token", async () => {
    const sealed = await encryptToken("music-user-token-abc", key);
    expect(sealed).not.toContain("music-user-token-abc");
    expect(await decryptToken(sealed, key)).toBe("music-user-token-abc");
  });
  test("two encryptions of the same token differ (fresh IV)", async () => {
    expect(await encryptToken("t", key)).not.toBe(await encryptToken("t", key));
  });
  test("tampered ciphertext, truncation, or a different key throws", async () => {
    const sealed = await encryptToken("music-user-token-abc", key);
    const bytes = Buffer.from(sealed, "base64");
    bytes[bytes.length - 1] ^= 1;
    await expect(decryptToken(bytes.toString("base64"), key)).rejects.toThrow();
    await expect(decryptToken(sealed.slice(0, 10), key)).rejects.toThrow();
    await expect(decryptToken(sealed, otherKey)).rejects.toThrow();
  });
  test("rejects a key that isn't 32 bytes", async () => {
    await expect(encryptToken("t", Buffer.alloc(16).toString("base64"))).rejects.toThrow("FINDS_ENCRYPTION_KEY");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/convex && bun test test/listenerGuard.test.ts test/tokenCrypto.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`packages/convex/convex/listenerGuard.ts`:

```ts
/**
 * Every Finds / Apple Music function is reachable on the public Convex
 * deployment, so each one checks the caller holds Radio Commons' server key.
 * Constant-time compare so the key can't be guessed byte by byte from timing.
 */
export function assertServerKey(given: string, expected: string | undefined): void {
  if (!expected || given.length !== expected.length) throw new Error("Unauthorized");
  let difference = 0;
  for (let i = 0; i < expected.length; i += 1) difference |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  if (difference !== 0) throw new Error("Unauthorized");
}
```

`packages/convex/convex/tokenCrypto.ts`:

```ts
/** AES-256-GCM for listeners' Apple Music User Tokens. Sealed format: base64(iv[12] ‖ ciphertext+tag). */
const IV_BYTES = 12;
const KEY_BYTES = 32;

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(keyB64);
  if (raw.length !== KEY_BYTES) throw new Error("FINDS_ENCRYPTION_KEY must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(plain: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  const sealed = new Uint8Array(IV_BYTES + cipher.length);
  sealed.set(iv);
  sealed.set(cipher, IV_BYTES);
  return bytesToBase64(sealed);
}

export async function decryptToken(sealed: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const bytes = base64ToBytes(sealed);
  if (bytes.length <= IV_BYTES) throw new Error("Sealed token is too short");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, IV_BYTES) }, key, bytes.slice(IV_BYTES));
  return new TextDecoder().decode(plain);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/convex && bun test test/listenerGuard.test.ts test/tokenCrypto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/convex/convex/listenerGuard.ts packages/convex/convex/tokenCrypto.ts packages/convex/test/listenerGuard.test.ts packages/convex/test/tokenCrypto.test.ts
git commit -m "feat(convex): server-key guard and AES-GCM token encryption for listener data"
```

### Task A2: Schema — `finds` and `appleMusicLinks`

**Files:**
- Modify: `packages/convex/convex/schema.ts` (append two tables)

**Interfaces:**
- Produces:
  - table `finds`, indexes `by_listener_saved ["listenerId","savedAt"]` and `by_listener_dedupe ["listenerId","dedupeKey"]`
  - table `appleMusicLinks`, index `by_listener ["listenerId"]`
  - exported validator `appleMusicStatusValidator`

- [ ] **Step 1: Append the tables** inside `defineSchema({ ... })`, after `touringFromRotation`:

```ts
  /**
   * A listener's saved songs (Alexa "save it"). Personal data: every function
   * touching this table requires Radio Commons' server key. listenerId is the
   * listener Clerk app's user id — no email or name is stored here.
   * Spec: docs/superpowers/specs/2026-10-04-finds-library-design.md
   */
  finds: defineTable({
    listenerId: v.string(),
    playId: v.id("plays"),
    trackId: v.optional(v.id("tracks")),
    dedupeKey: v.string(),
    artist: v.string(),
    title: v.string(),
    stationSlug: v.string(),
    savedAt: v.number(),
    appleMusic: v.object({
      status: appleMusicStatusValidator,
      reason: v.optional(v.string()),
      at: v.number(),
    }),
  })
    .index("by_listener_saved", ["listenerId", "savedAt"])
    .index("by_listener_dedupe", ["listenerId", "dedupeKey"]),

  /** A listener's Apple Music connection; the Music User Token is AES-256-GCM encrypted. */
  appleMusicLinks: defineTable({
    listenerId: v.string(),
    encryptedUserToken: v.string(),
    linkedAt: v.number(),
    status: v.union(v.literal("active"), v.literal("expired")),
  }).index("by_listener", ["listenerId"]),
```

Add above `export default defineSchema(`:

```ts
export const appleMusicStatusValidator = v.union(
  v.literal("not_linked"),
  v.literal("pending"),
  v.literal("added"),
  v.literal("failed"),
  v.literal("expired"),
);
```

- [ ] **Step 2: Typecheck and run existing tests**

Run: `cd packages/convex && bun run typecheck && bun test test/`
Expected: exit 0; all pass.

- [ ] **Step 3: Commit**

```bash
git add packages/convex/convex/schema.ts
git commit -m "feat(convex): finds and appleMusicLinks tables"
```

### Task A3: Finds functions — save, list, delete

**Files:**
- Create: `packages/convex/convex/findsLogic.ts` (pure helpers)
- Create: `packages/convex/convex/finds.ts` (Convex functions)
- Modify: `packages/convex/convex/_generated/api.d.ts` (register `finds`, `findsLogic`, `listenerGuard`, `tokenCrypto`)
- Test: `packages/convex/test/findsLogic.test.ts`

**Interfaces:**
- Consumes: `assertServerKey` (A1), tables (A2).
- Produces:
  - `api.finds.save({ serverKey, listenerId, playId }) → { findId, appleMusic: "not_linked" | "pending", artist, title, alreadySaved: boolean }`
  - `api.finds.list({ serverKey, listenerId, limit? }) → FindRow[]`, where `FindRow = { label, findId, playId, trackId: string | null, artist, title, stationSlug, savedAt, appleMusic: { status, reason: string | null }, artworkUrl: string | null, previewUrl: string | null }`
  - `api.finds.deleteAllForListener({ serverKey, listenerId }) → { deletedFinds: number, deletedLink: boolean }`
  - pure `dedupeKeyFor(playId: string, trackId: string | undefined): string`
  - pure `clampFindsLimit(limit?: number): number`
  - `internal.finds.loadForApple` and `internal.finds.recordAppleOutcome` (used by A4)

- [ ] **Step 1: Write the failing tests**

`packages/convex/test/findsLogic.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { clampFindsLimit, dedupeKeyFor } from "../convex/findsLogic";

describe("dedupeKeyFor", () => {
  test("uses the track when known, so two spins of one song are one find", () => {
    expect(dedupeKeyFor("play1", "trackA")).toBe("track:trackA");
    expect(dedupeKeyFor("play2", "trackA")).toBe("track:trackA");
  });
  test("falls back to the play for unidentified songs", () => {
    expect(dedupeKeyFor("play9", undefined)).toBe("play:play9");
  });
});

describe("clampFindsLimit", () => {
  test("defaults to 5 and clamps to 1..10", () => {
    expect(clampFindsLimit(undefined)).toBe(5);
    expect(clampFindsLimit(Number.NaN)).toBe(5);
    expect(clampFindsLimit(0)).toBe(1);
    expect(clampFindsLimit(3.9)).toBe(3);
    expect(clampFindsLimit(99)).toBe(10);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/convex && bun test test/findsLogic.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the pure helpers**

`packages/convex/convex/findsLogic.ts`:

```ts
export const DEFAULT_FINDS_LIMIT = 5;
export const MAX_FINDS_LIMIT = 10;

/** Same song saved from two spins collapses to one find; unidentified songs dedupe per spin. */
export function dedupeKeyFor(playId: string, trackId: string | undefined): string {
  return trackId ? `track:${trackId}` : `play:${playId}`;
}

export function clampFindsLimit(limit?: number): number {
  if (limit === undefined || Number.isNaN(limit)) return DEFAULT_FINDS_LIMIT;
  return Math.min(MAX_FINDS_LIMIT, Math.max(1, Math.floor(limit)));
}
```

- [ ] **Step 4: Implement the Convex functions**

`packages/convex/convex/finds.ts`:

```ts
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { clampFindsLimit, dedupeKeyFor } from "./findsLogic";
import { assertServerKey } from "./listenerGuard";
import { appleMusicStatusValidator } from "./schema";

const guard = (serverKey: string) => assertServerKey(serverKey, process.env.RADIO_COMMONS_SERVER_KEY);

async function songFor(ctx: MutationCtx, play: Doc<"plays">) {
  const track = play.canonicalTrackId ? await ctx.db.get(play.canonicalTrackId) : null;
  const artist = track ? ((await ctx.db.get(track.artistId))?.displayName ?? play.artistRaw) : play.artistRaw;
  const station = await ctx.db.get(play.stationId);
  return { track, artist, title: track?.displayTitle ?? play.titleRaw, stationSlug: station?.slug ?? "unknown" };
}

async function hasActiveAppleLink(ctx: MutationCtx, listenerId: string): Promise<boolean> {
  const link = await ctx.db.query("appleMusicLinks").withIndex("by_listener", (q) => q.eq("listenerId", listenerId)).first();
  return link?.status === "active";
}

export const save = mutation({
  args: { serverKey: v.string(), listenerId: v.string(), playId: v.id("plays") },
  handler: async (ctx, { serverKey, listenerId, playId }) => {
    guard(serverKey);
    const play = await ctx.db.get(playId);
    if (play === null || play.deletedAt !== undefined) throw new Error("PlayNotFound");
    const { track, artist, title, stationSlug } = await songFor(ctx, play);
    const dedupeKey = dedupeKeyFor(playId, track?._id);
    const now = Date.now();
    const status = (await hasActiveAppleLink(ctx, listenerId)) ? "pending" : "not_linked";
    const existing = await ctx.db
      .query("finds")
      .withIndex("by_listener_dedupe", (q) => q.eq("listenerId", listenerId).eq("dedupeKey", dedupeKey))
      .first();
    const fields = { playId, trackId: track?._id, artist, title, stationSlug, savedAt: now, appleMusic: { status, at: now } };
    let findId: Id<"finds">;
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      findId = existing._id;
    } else {
      findId = await ctx.db.insert("finds", { listenerId, dedupeKey, ...fields });
    }
    if (status === "pending") await ctx.scheduler.runAfter(0, internal.findsApple.addToAppleMusic, { findId });
    return { findId, appleMusic: status, artist, title, alreadySaved: existing !== null };
  },
});

export const list = query({
  args: { serverKey: v.string(), listenerId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { serverKey, listenerId, limit }) => {
    guard(serverKey);
    const rows = await ctx.db
      .query("finds")
      .withIndex("by_listener_saved", (q) => q.eq("listenerId", listenerId))
      .order("desc")
      .take(clampFindsLimit(limit));
    return Promise.all(
      rows.map(async (find, index) => {
        const track = find.trackId ? await ctx.db.get(find.trackId) : null;
        return {
          label: String(index + 1),
          findId: find._id,
          playId: find.playId,
          trackId: find.trackId ?? null,
          artist: find.artist,
          title: find.title,
          stationSlug: find.stationSlug,
          savedAt: find.savedAt,
          appleMusic: { status: find.appleMusic.status, reason: find.appleMusic.reason ?? null },
          artworkUrl: track?.artworkUrl ?? null,
          previewUrl: track?.previewUrl ?? null,
        };
      }),
    );
  },
});

export const deleteAllForListener = mutation({
  args: { serverKey: v.string(), listenerId: v.string() },
  handler: async (ctx, { serverKey, listenerId }) => {
    guard(serverKey);
    const finds = await ctx.db.query("finds").withIndex("by_listener_saved", (q) => q.eq("listenerId", listenerId)).collect();
    await Promise.all(finds.map((find) => ctx.db.delete(find._id)));
    const link = await ctx.db.query("appleMusicLinks").withIndex("by_listener", (q) => q.eq("listenerId", listenerId)).first();
    if (link) await ctx.db.delete(link._id);
    return { deletedFinds: finds.length, deletedLink: link !== null };
  },
});

/** Everything the Apple add needs, in one read; null when the find or link is gone. */
export const loadForApple = internalQuery({
  args: { findId: v.id("finds") },
  handler: async (ctx, { findId }) => {
    const find = await ctx.db.get(findId);
    if (find === null) return null;
    const track = find.trackId ? await ctx.db.get(find.trackId) : null;
    const link = await ctx.db.query("appleMusicLinks").withIndex("by_listener", (q) => q.eq("listenerId", find.listenerId)).first();
    return { appleMusicSongId: track?.appleMusicSongId ?? null, link: link?.status === "active" ? { linkId: link._id, encryptedUserToken: link.encryptedUserToken } : null };
  },
});

export const recordAppleOutcome = internalMutation({
  args: { findId: v.id("finds"), status: appleMusicStatusValidator, reason: v.optional(v.string()), expireLink: v.optional(v.id("appleMusicLinks")) },
  handler: async (ctx, { findId, status, reason, expireLink }) => {
    const find = await ctx.db.get(findId);
    if (find !== null) await ctx.db.patch(findId, { appleMusic: { status, reason, at: Date.now() } });
    if (expireLink) await ctx.db.patch(expireLink, { status: "expired" });
  },
});

export type FindId = Id<"finds">;
```

Note: `finds.save` schedules `internal.findsApple.addToAppleMusic`, which Task A4 creates. Until A4 lands, keep this task's typecheck green by creating `packages/convex/convex/findsApple.ts` with a stub action in this task:

```ts
import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/** Replaced in Task A4. */
export const addToAppleMusic = internalAction({ args: { findId: v.id("finds") }, handler: async () => {} });
```

- [ ] **Step 5: Register the modules** in `packages/convex/convex/_generated/api.d.ts`. Add alphabetically, in both the import list and `ApiFromModules<{...}>`:
  - `import type * as finds from "../finds.js";` → `finds: typeof finds;`
  - `findsApple`, `findsLogic`, `listenerGuard`, `tokenCrypto`, in the same pattern

- [ ] **Step 6: Run tests and typecheck**

Run: `cd packages/convex && bun test test/findsLogic.test.ts && bun run typecheck && bun test test/`
Expected: PASS; exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/convex/convex/findsLogic.ts packages/convex/convex/finds.ts packages/convex/convex/findsApple.ts packages/convex/convex/_generated/api.d.ts packages/convex/test/findsLogic.test.ts
git commit -m "feat(convex): finds save/list/delete behind the Radio Commons server key"
```

### Task A4: Apple Music connect + background add

**Files:**
- Create: `packages/convex/convex/appleMusicLinks.ts`
- Create: `packages/convex/convex/appleOutcome.ts` (pure mapping)
- Replace: `packages/convex/convex/findsApple.ts` (stub → real)
- Modify: `packages/convex/convex/_generated/api.d.ts` (register `appleMusicLinks`, `appleOutcome`)
- Test: `packages/convex/test/appleOutcome.test.ts`

**Interfaces:**
- Consumes: `encryptToken` / `decryptToken` (A1), `internal.finds.loadForApple` and `recordAppleOutcome` (A3), existing `api.appleMusic.getDeveloperToken` (returns the cached developer-token row or null).
- Produces:
  - `api.appleMusicLinks.connect({ serverKey, listenerId, musicUserToken }) → { linked: true }`
  - `api.appleMusicLinks.status({ serverKey, listenerId }) → "none" | "active" | "expired"`
  - pure `appleOutcome(httpStatus: number | "network"): { status: "added" | "failed" | "expired"; retry: boolean; reason?: string }`

- [ ] **Step 1: Write the failing test**

`packages/convex/test/appleOutcome.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { appleOutcome } from "../convex/appleOutcome";

describe("appleOutcome", () => {
  test("202 and 200 mean added", () => {
    expect(appleOutcome(202)).toEqual({ status: "added", retry: false });
    expect(appleOutcome(200)).toEqual({ status: "added", retry: false });
  });
  test("401/403 mean the listener's token is expired or revoked", () => {
    expect(appleOutcome(401)).toMatchObject({ status: "expired", retry: false });
    expect(appleOutcome(403)).toMatchObject({ status: "expired", retry: false });
  });
  test("5xx, 429 and network failures retry", () => {
    expect(appleOutcome(503)).toMatchObject({ status: "failed", retry: true });
    expect(appleOutcome(429)).toMatchObject({ status: "failed", retry: true });
    expect(appleOutcome("network")).toMatchObject({ status: "failed", retry: true });
  });
  test("other 4xx fail without retry, with a reason", () => {
    expect(appleOutcome(404)).toEqual({ status: "failed", retry: false, reason: "Apple Music returned 404" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/convex && bun test test/appleOutcome.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`packages/convex/convex/appleOutcome.ts`:

```ts
export type AppleOutcome = { status: "added" | "failed" | "expired"; retry: boolean; reason?: string };

export function appleOutcome(httpStatus: number | "network"): AppleOutcome {
  if (httpStatus === "network" || httpStatus === 429 || httpStatus >= 500) return { status: "failed", retry: true, reason: "Apple Music unavailable" };
  if (httpStatus === 200 || httpStatus === 202) return { status: "added", retry: false };
  if (httpStatus === 401 || httpStatus === 403) return { status: "expired", retry: false, reason: "Apple Music needs reconnecting" };
  return { status: "failed", retry: false, reason: `Apple Music returned ${httpStatus}` };
}
```

`packages/convex/convex/appleMusicLinks.ts`:

```ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertServerKey } from "./listenerGuard";
import { encryptToken } from "./tokenCrypto";

const guard = (serverKey: string) => assertServerKey(serverKey, process.env.RADIO_COMMONS_SERVER_KEY);
const MAX_TOKEN_LENGTH = 4096;

export const connect = mutation({
  args: { serverKey: v.string(), listenerId: v.string(), musicUserToken: v.string() },
  handler: async (ctx, { serverKey, listenerId, musicUserToken }) => {
    guard(serverKey);
    if (musicUserToken.length === 0 || musicUserToken.length > MAX_TOKEN_LENGTH) throw new Error("InvalidMusicUserToken");
    const key = process.env.FINDS_ENCRYPTION_KEY;
    if (!key) throw new Error("FINDS_ENCRYPTION_KEY is not set");
    const encryptedUserToken = await encryptToken(musicUserToken, key);
    const existing = await ctx.db.query("appleMusicLinks").withIndex("by_listener", (q) => q.eq("listenerId", listenerId)).first();
    const fields = { encryptedUserToken, linkedAt: Date.now(), status: "active" as const };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("appleMusicLinks", { listenerId, ...fields });
    return { linked: true as const };
  },
});

export const status = query({
  args: { serverKey: v.string(), listenerId: v.string() },
  handler: async (ctx, { serverKey, listenerId }) => {
    guard(serverKey);
    const link = await ctx.db.query("appleMusicLinks").withIndex("by_listener", (q) => q.eq("listenerId", listenerId)).first();
    return link ? link.status : ("none" as const);
  },
});
```

`packages/convex/convex/findsApple.ts` (replaces the stub):

```ts
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { appleOutcome } from "./appleOutcome";
import { decryptToken } from "./tokenCrypto";

const RETRY_DELAY_MS = 60_000;
const LIBRARY_URL = "https://api.music.apple.com/v1/me/library";

async function postToLibrary(songId: string, developerToken: string, userToken: string): Promise<number | "network"> {
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
  handler: async (ctx, { findId, attempt = 1 }) => {
    const loaded = await ctx.runQuery(internal.finds.loadForApple, { findId });
    if (loaded === null) return;
    if (loaded.link === null) return ctx.runMutation(internal.finds.recordAppleOutcome, { findId, status: "not_linked" });
    if (loaded.appleMusicSongId === null) {
      return ctx.runMutation(internal.finds.recordAppleOutcome, { findId, status: "failed", reason: "not in Apple Music catalog" });
    }
    const key = process.env.FINDS_ENCRYPTION_KEY;
    const developer = await ctx.runQuery(api.appleMusic.getDeveloperToken, {});
    if (!key || !developer) return ctx.runMutation(internal.finds.recordAppleOutcome, { findId, status: "failed", reason: "Apple Music not configured" });
    let userToken: string;
    try {
      userToken = await decryptToken(loaded.link.encryptedUserToken, key);
    } catch {
      return ctx.runMutation(internal.finds.recordAppleOutcome, { findId, status: "expired", reason: "Apple Music needs reconnecting", expireLink: loaded.link.linkId });
    }
    const outcome = appleOutcome(await postToLibrary(loaded.appleMusicSongId, developer.token, userToken));
    if (outcome.retry && attempt === 1) {
      await ctx.scheduler.runAfter(RETRY_DELAY_MS, internal.findsApple.addToAppleMusic, { findId, attempt: 2 });
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
```

`api.appleMusic.getDeveloperToken` returns `{ token, expiresAt } | null`, verified 2026-10-04. It returns null when the cached token is near expiry, which the code above records as "Apple Music not configured". That clears once the token is re-minted: the weekly `refresh-apple-music-token` task (Sundays 00:00 UTC), or the on-demand refresh that `enrich-pending-plays` triggers when the cache is empty or near expiry.

**Pre-existing risk (not fixed here):** `appleMusic.writeDeveloperToken` is an unauthenticated public mutation (its own `TODO(security)`). Someone with the deployment URL could overwrite the cached developer token. For Finds, that makes Apple adds fail; it can't expose listener tokens, because a Music User Token only works with the developer team that minted it. Track it as a separate hardening fix.

- [ ] **Step 4: Register `appleMusicLinks` and `appleOutcome`** in `_generated/api.d.ts` (imports plus `ApiFromModules` entries, alphabetical).

- [ ] **Step 5: Run tests and typecheck**

Run: `cd packages/convex && bun test test/appleOutcome.test.ts && bun run typecheck && bun test test/`
Expected: PASS; exit 0.

- [ ] **Step 6: Commit and stop for PR A**

```bash
git add packages/convex/convex/appleOutcome.ts packages/convex/convex/appleMusicLinks.ts packages/convex/convex/findsApple.ts packages/convex/convex/_generated/api.d.ts packages/convex/test/appleOutcome.test.ts
git commit -m "feat(convex): Apple Music connect and background add-to-library for finds"
```

**Before PR A merges (Tarik):** set Convex env vars. Use the dashboard or `bunx convex env set` (env changes don't push code):
- `RADIO_COMMONS_SERVER_KEY`: 48+ random chars, e.g. `openssl rand -base64 48`
- `FINDS_ENCRYPTION_KEY`: `openssl rand -base64 32`

---

## Part B — Radio Commons (PR B, after PR A is deployed)

Work on a branch off `main` in `/Users/tarikmoody/Projects/radio-commons`. Tests: `npm test` (vitest). Typecheck: `npm run typecheck`.

### Task B1: Playlist client

**Files:**
- Create: `src/lib/playlist.ts`
- Test: `tests/playlist.test.ts`
- Modify: `tests/fixtures.ts` (add `fakePlaylist`)

**Interfaces:**
- Consumes: playlist Convex public functions `alexa:findSongPlayed`, `alexa:getTrackFacts`, `finds:save`, `finds:list`, `finds:deleteAllForListener`, `appleMusicLinks:connect`.
- Produces:
  - `interface PlaylistClient { findSongPlayed(args): Promise<RecallResult>; getTrackFacts(args): Promise<TrackFacts>; saveFind(listenerId, playId): Promise<SavedFind>; listFinds(listenerId, limit?): Promise<FindRow[]>; deleteFinds(listenerId): Promise<{ deletedFinds: number; deletedLink: boolean }>; connectAppleMusic(listenerId, musicUserToken): Promise<void> }`
  - `class PlaylistUnavailable extends Error`
  - `createPlaylistClient({ query, mutation, serverKey, timeoutMs? })`
  - `playlistFromEnv()`

- [ ] **Step 1: Write the failing test.** `tests/playlist.test.ts` covers four things:
  - a reply that fails zod validation throws `PlaylistUnavailable`
  - a slow query (`timeoutMs: 5`) throws `PlaylistUnavailable`
  - `saveFind` passes `serverKey` and never returns it
  - `PlayNotFound` from Convex maps to `{ status: "not_found" }`

```ts
import { describe, expect, it } from "vitest";
import { createPlaylistClient, PlaylistUnavailable } from "@/lib/playlist";

const noop = async () => ({});

describe("playlist client", () => {
  it("validates findSongPlayed replies", async () => {
    const client = createPlaylistClient({ query: async () => ({ status: "weird" }), mutation: noop, serverKey: "k" });
    await expect(client.findSongPlayed({ station: "88nine", from: 0, to: 1 })).rejects.toBeInstanceOf(PlaylistUnavailable);
  });

  it("times out a slow call", async () => {
    const slow = () => new Promise((resolve) => setTimeout(() => resolve({ status: "no_spins", matches: [] }), 50));
    const client = createPlaylistClient({ query: slow, mutation: noop, serverKey: "k", timeoutMs: 5 });
    await expect(client.findSongPlayed({ station: "88nine", from: 0, to: 1 })).rejects.toBeInstanceOf(PlaylistUnavailable);
  });

  it("sends the server key on saveFind and maps PlayNotFound", async () => {
    const calls: Record<string, unknown>[] = [];
    const client = createPlaylistClient({
      query: noop,
      mutation: async (_name, args) => {
        calls.push(args);
        throw new Error("Uncaught Error: PlayNotFound");
      },
      serverKey: "server-key",
    });
    await expect(client.saveFind("user_1", "play_1")).resolves.toEqual({ status: "not_found" });
    expect(calls[0]).toEqual({ serverKey: "server-key", listenerId: "user_1", playId: "play_1" });
  });
});
```

- [ ] **Step 2: Run it.** `npm test -- tests/playlist.test.ts` should FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/playlist.ts`**, mirroring `src/lib/backstory.ts`: a `call` helper with a timeout race plus zod validation. Schemas follow the shapes in rm-playlist `packages/convex/convex/alexa.ts` and `finds.ts`, using `.passthrough()` so extra fields don't break the client.

```ts
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

const showSchema = z.object({ venue: z.string(), city: z.string(), metro: z.string(), startsAtMs: z.number(), ticketUrl: z.string().nullable() }).passthrough();
const matchSchema = z.object({
  label: z.string(), playId: z.string(), artist: z.string(), title: z.string(), playedAt: z.number(),
  trackId: z.string().nullable(), matchReason: z.string().nullable(), artworkUrl: z.string().nullable(),
  previewUrl: z.string().nullable(), upcomingShows: z.array(showSchema),
}).passthrough();
const recallSchema = z.object({ status: z.enum(["ok", "options", "cues_unchecked", "no_spins", "unknown_station"]), matches: z.array(matchSchema) });
const factsSchema = z.object({ status: z.enum(["ok", "not_found"]) }).passthrough();
const savedSchema = z.object({ findId: z.string(), appleMusic: z.enum(["not_linked", "pending"]), artist: z.string(), title: z.string(), alreadySaved: z.boolean() });
const findSchema = z.object({
  label: z.string(), findId: z.string(), playId: z.string(), trackId: z.string().nullable(), artist: z.string(), title: z.string(),
  stationSlug: z.string(), savedAt: z.number(), appleMusic: z.object({ status: z.string(), reason: z.string().nullable() }),
  artworkUrl: z.string().nullable(), previewUrl: z.string().nullable(),
});
const deletedSchema = z.object({ deletedFinds: z.number(), deletedLink: z.boolean() });

export type RecallResult = z.infer<typeof recallSchema>;
export type TrackFacts = z.infer<typeof factsSchema>;
export type FindRow = z.infer<typeof findSchema>;
export type SavedFind = ({ status: "ok" } & z.infer<typeof savedSchema>) | { status: "not_found" };
export type Station = "hyfin" | "88nine" | "414music" | "rhythmlab";

export class PlaylistUnavailable extends Error {}

export interface PlaylistClient {
  findSongPlayed(args: { station: Station; from: number; to: number; cues?: string[]; beforePlayId?: string; afterPlayId?: string }): Promise<RecallResult>;
  getTrackFacts(args: { trackId?: string; playId?: string }): Promise<TrackFacts>;
  saveFind(listenerId: string, playId: string): Promise<SavedFind>;
  listFinds(listenerId: string, limit?: number): Promise<FindRow[]>;
  deleteFinds(listenerId: string): Promise<z.infer<typeof deletedSchema>>;
  connectAppleMusic(listenerId: string, musicUserToken: string): Promise<void>;
}

type Call = (name: string, args: Record<string, unknown>) => Promise<unknown>;
const DEFAULT_TIMEOUT_MS = 350;

export function createPlaylistClient({ query, mutation, serverKey, timeoutMs = DEFAULT_TIMEOUT_MS }: { query: Call; mutation: Call; serverKey: string; timeoutMs?: number }): PlaylistClient {
  async function call<T>(fn: Call, name: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([
        fn(name, args),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new PlaylistUnavailable(`${name} timed out`)), timeoutMs); }),
      ]);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new PlaylistUnavailable(`${name} returned an unexpected shape`);
      return parsed.data;
    } finally {
      clearTimeout(timer);
    }
  }
  const keyed = (args: Record<string, unknown>) => ({ serverKey, ...args });
  return {
    findSongPlayed: (args) => call(query, "alexa:findSongPlayed", args, recallSchema),
    getTrackFacts: (args) => call(query, "alexa:getTrackFacts", args, factsSchema),
    async saveFind(listenerId, playId) {
      try {
        return { status: "ok", ...(await call(mutation, "finds:save", keyed({ listenerId, playId }), savedSchema)) };
      } catch (error) {
        if (error instanceof Error && error.message.includes("PlayNotFound")) return { status: "not_found" };
        throw error instanceof PlaylistUnavailable ? error : new PlaylistUnavailable(String(error));
      }
    },
    listFinds: (listenerId, limit) => call(query, "finds:list", keyed({ listenerId, limit }), z.array(findSchema)),
    deleteFinds: (listenerId) => call(mutation, "finds:deleteAllForListener", keyed({ listenerId }), deletedSchema),
    async connectAppleMusic(listenerId, musicUserToken) {
      await call(mutation, "appleMusicLinks:connect", keyed({ listenerId, musicUserToken }), z.object({ linked: z.literal(true) }));
    },
  };
}

export function playlistFromEnv(): PlaylistClient {
  const url = process.env.PLAYLIST_CONVEX_URL;
  const serverKey = process.env.RADIO_COMMONS_SERVER_KEY;
  if (!url || !serverKey) throw new Error("PLAYLIST_CONVEX_URL and RADIO_COMMONS_SERVER_KEY must be set");
  const client = new ConvexHttpClient(url);
  return createPlaylistClient({
    query: (name, args) => client.query(makeFunctionReference<"query">(name), args),
    mutation: (name, args) => client.mutation(makeFunctionReference<"mutation">(name), args),
    serverKey,
  });
}
```

Add to `tests/fixtures.ts` a `fakePlaylist(overrides?: Partial<PlaylistClient>): PlaylistClient`. It returns canned data: one `ok` recall match (`playId: "play_1"`, `trackId: "track_1"`, "Victory Dance" / "Ezra Collective"), `saveFind` → `{ status: "ok", findId: "find_1", appleMusic: "not_linked", artist: "Ezra Collective", title: "Victory Dance", alreadySaved: false }`, and `listFinds` → one row labeled "1". Overrides are spread on top, like the existing `fakeBackstory`.

- [ ] **Step 4: Run it.** `npm test -- tests/playlist.test.ts` should PASS. Then run `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/playlist.ts tests/playlist.test.ts tests/fixtures.ts
git commit -m "feat: playlist client (recall, track facts, finds) with timeout and validation"
```

### Task B2: Recall tools — `find_song_played`, `get_track_story`

**Files:**
- Modify: `src/lib/mcp.ts` (add `playlist: () => PlaylistClient` to `Deps`; register two tools)
- Modify: `src/app/api/mcp/route.ts` (pass `playlist: playlistFromEnv`, lazily like `backstory`)
- Modify: `src/lib/speech.ts` (add `spokenRecall`, `spokenTrackFacts`)
- Test: `tests/mcp.test.ts` (update the tools/list expectation; add recall cases)

**Interfaces:**
- Consumes: `PlaylistClient` (B1).
- Produces: tools `find_song_played` (input `{ station, from, to, cues?, beforePlayId?, afterPlayId? }`, with `structuredContent.matches[].playId`) and `get_track_story` (input `{ trackId?, playId? }`).

- [ ] **Step 1: Write the failing tests** in `tests/mcp.test.ts`. Update `handlerWith` to pass `playlist: () => playlist`, with `playlist = fakePlaylist()` as a new default parameter. Then:

```ts
  it("lists the recall tools alongside the story tools", async () => {
    const tools = await mcpPost(handlerWith(), { method: "tools/list" }, 2);
    const names = tools.message.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["find_song_played", "get_track_story"]));
  });

  it("find_song_played returns playIds Alexa can save and speaks the top match", async () => {
    const { message } = await mcpPost(handlerWith(), call("find_song_played", { station: "88nine", from: 0, to: 3_600_000 }));
    expect(message.result.structuredContent.matches[0]).toMatchObject({ playId: "play_1", label: "1" });
    expect(message.result.content[0].text).toMatch(/Victory Dance/);
  });

  it("find_song_played turns a playlist outage into a plain apology", async () => {
    const down = fakePlaylist({ findSongPlayed: async () => { throw new PlaylistUnavailable("down"); } });
    const { message } = await mcpPost(handlerWith(undefined, undefined, down), call("find_song_played", { station: "88nine", from: 0, to: 1 }));
    expect(message.result.isError).toBe(true);
  });
```

- [ ] **Step 2: Run it.** `npm test -- tests/mcp.test.ts` should FAIL (unknown tools).

- [ ] **Step 3: Implement.** In `src/lib/mcp.ts`:
  - Extend `Deps` with `playlist: () => PlaylistClient`.
  - Add `PlaylistUnavailable` to the `timed()` catch condition.
  - Register the two tools with `registerAppTool`, in the same style as `station_picks`.

`find_song_played`:
- **Description:** "Find a song Radio Milwaukee played on one of its stations, by station and time window, optionally with descriptive cues like 'horns'. Returns numbered matches with playIds; pass a playId to save_find or get_track_story. Use for 'what was that song on 88Nine this morning?' and 'the one before that' (beforePlayId)."
- **inputSchema:** `z.object({ station: z.enum(["hyfin","88nine","414music","rhythmlab"]), from: z.number(), to: z.number(), cues: z.array(z.string().max(30)).max(5).optional(), beforePlayId: z.string().max(64).optional(), afterPlayId: z.string().max(64).optional() })`.
- **Returns:** `content: text(spokenRecall(result))` and `structuredContent: { stationId, matches: result.matches.map(({ label, playId, trackId, artist, title, playedAt }) => ({ label, playId, trackId, artist, title, playedAt })), status }`, plus a second text block with the JSON ids, like `find_station_story` does.

`get_track_story`:
- **inputSchema:** `z.object({ trackId: z.string().max(64).optional(), playId: z.string().max(64).optional() })`.
- **Returns:** `spokenTrackFacts(facts)`, plus the facts as `structuredContent`.

Add to `src/lib/speech.ts`:

```ts
export function spokenRecall(result: RecallResult): string {
  const [top, ...rest] = result.matches;
  if (result.status === "unknown_station") return "I don't know that station.";
  if (!top) return "I couldn't find anything Radio Milwaukee played then. Try a wider time.";
  const lead = `That was likely "${top.title}" by ${top.artist}.`;
  if (result.status === "ok") return lead;
  const others = rest.map((m) => `"${m.title}" by ${m.artist}`).join(", or ");
  const caveat = result.status === "cues_unchecked" ? " I couldn't check that detail, so here's what played around then." : "";
  return `${lead}${caveat}${others ? ` Or it might be ${others}.` : ""}`;
}

export function spokenTrackFacts(facts: TrackFacts): string {
  if (facts.status !== "ok") return "I don't have more on that song.";
  const f = facts as TrackFacts & { title?: string; artist?: string; year?: number | null; label?: string | null };
  const details = [f.year ? `released in ${f.year}` : null, f.label ? `on ${f.label}` : null].filter(Boolean).join(", ");
  return `"${f.title}" by ${f.artist}${details ? `, ${details}` : ""}.`;
}
```

(Import `RecallResult` and `TrackFacts` types from `@/lib/playlist`.)

In `src/app/api/mcp/route.ts`, add `let playlistClient: PlaylistClient | undefined; const playlist = () => (playlistClient ??= playlistFromEnv());` and pass `playlist` into `buildMcpHandler`.

- [ ] **Step 4: Run it.** `npm test` should PASS, including the existing story tests. Then run `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp.ts src/lib/speech.ts src/app/api/mcp/route.ts tests/mcp.test.ts
git commit -m "feat: song recall tools (find_song_played, get_track_story) over the playlist API"
```

### Task B3: Listener auth — token check, `/.well-known` documents, per-tool 401

**Files:**
- Create: `src/lib/listenerAuth.ts`
- Create: `src/app/.well-known/oauth-protected-resource/route.ts`
- Modify: `src/app/api/mcp/route.ts` (wrap the handler)
- Test: `tests/listenerAuth.test.ts`
- Dependency: `npm install @clerk/backend`

**Interfaces:**
- Produces:
  - `AUTH_TOOLS = ["save_find", "list_finds", "delete_my_finds"] as const`
  - `verifyListenerToken(req: Request, bearer?: string): Promise<AuthInfo | undefined>` (`AuthInfo.extra.userId` = listener ID)
  - `gateAuthTools(handler): handler`, which returns 401 for an AUTH_TOOLS call without `req.auth`
  - `listenerIdFrom(extra): string | undefined`

- [ ] **Step 1: Write the failing test**

`tests/listenerAuth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { gateAuthTools, listenerIdFrom } from "@/lib/listenerAuth";

const ok = async () => new Response("ok", { status: 200 });
const rpc = (name: string, auth?: unknown) => {
  const req = new Request("https://rc.example/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }) });
  if (auth) Object.assign(req, { auth });
  return req;
};

describe("gateAuthTools", () => {
  it("lets anonymous listeners use non-Finds tools", async () => {
    expect((await gateAuthTools(ok)(rpc("find_station_story"))).status).toBe(200);
  });
  it("returns 401 with resource metadata for a Finds tool without a token", async () => {
    const res = await gateAuthTools(ok)(rpc("save_find"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/resource_metadata=".*\/\.well-known\/oauth-protected-resource/);
  });
  it("passes a Finds tool through when the request carries auth", async () => {
    expect((await gateAuthTools(ok)(rpc("list_finds", { extra: { userId: "user_1" } }))).status).toBe(200);
  });
  it("passes non-JSON and non-tool requests untouched", async () => {
    expect((await gateAuthTools(ok)(new Request("https://rc.example/api/mcp", { method: "GET" }))).status).toBe(200);
  });
});

describe("listenerIdFrom", () => {
  it("reads the Clerk user id from tool extra", () => {
    expect(listenerIdFrom({ authInfo: { extra: { userId: "user_1" } } })).toBe("user_1");
    expect(listenerIdFrom({})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it.** `npm test -- tests/listenerAuth.test.ts` should FAIL.

- [ ] **Step 3: Implement**

`src/lib/listenerAuth.ts`:

```ts
import { createClerkClient } from "@clerk/backend";

export const AUTH_TOOLS = ["save_find", "list_finds", "delete_my_finds"] as const;
const AUTH_TOOL_SET = new Set<string>(AUTH_TOOLS);
const METADATA_PATH = "/.well-known/oauth-protected-resource";

interface AuthInfo { token: string; clientId: string; scopes: string[]; extra: { userId: string } }

const clerk = () =>
  createClerkClient({ secretKey: process.env.CLERK_LISTENER_SECRET_KEY, publishableKey: process.env.CLERK_LISTENER_PUBLISHABLE_KEY });

/** Local JWT check (jwtKey) — no network call, so it fits the 500 ms budget. Undefined = anonymous. */
export async function verifyListenerToken(req: Request, bearer?: string): Promise<AuthInfo | undefined> {
  if (!bearer) return undefined;
  const state = await clerk().authenticateRequest(req, { acceptsToken: "oauth_token", jwtKey: process.env.CLERK_LISTENER_JWT_KEY });
  if (!state.isAuthenticated) return undefined;
  const auth = state.toAuth() as { userId?: string; clientId?: string; scopes?: string[] };
  if (!auth.userId) return undefined;
  return { token: bearer, clientId: auth.clientId ?? "alexa", scopes: auth.scopes ?? [], extra: { userId: auth.userId } };
}

/** Amazon wants HTTP 401 for an auth-needing tool without a token; MCP tools can't set status, so the route does it. */
export function gateAuthTools(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST" || (req as Request & { auth?: unknown }).auth) return handler(req);
    const body = (await req.clone().json().catch(() => null)) as { method?: string; params?: { name?: string } } | null;
    if (body?.method !== "tools/call" || !AUTH_TOOL_SET.has(body.params?.name ?? "")) return handler(req);
    const metadata = new URL(METADATA_PATH, req.url).toString();
    return new Response(JSON.stringify({ error: "account_linking_required" }), {
      status: 401,
      headers: { "content-type": "application/json", "www-authenticate": `Bearer resource_metadata="${metadata}"` },
    });
  };
}

export function listenerIdFrom(extra: { authInfo?: { extra?: { userId?: unknown } } }): string | undefined {
  const id = extra.authInfo?.extra?.userId;
  return typeof id === "string" ? id : undefined;
}
```

`src/app/.well-known/oauth-protected-resource/route.ts`:

```ts
import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler";

const handler = protectedResourceHandler({
  authServerUrls: [process.env.CLERK_LISTENER_ISSUER ?? ""],
  resourceUrl: process.env.MCP_RESOURCE_URL,
});
const options = metadataCorsOptionsRequestHandler();

export { handler as GET, options as OPTIONS };
```

`scopes_supported` must include `openid profile offline_access`. If `protectedResourceHandler` doesn't accept scopes, use `generateProtectedResourceMetadata` (also exported by `mcp-handler`) and add `scopes_supported` to its output. Check the signature in `node_modules/mcp-handler/dist/index.d.ts` (~line 139).

In `src/app/api/mcp/route.ts`, replace the export with:

```ts
import { withMcpAuth } from "mcp-handler";
import { gateAuthTools, verifyListenerToken } from "@/lib/listenerAuth";

const authed = withMcpAuth(gateAuthTools(handler), verifyListenerToken, {
  required: false,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authed as DELETE, authed as GET, authed as POST };
```

The auth-server metadata Alexa reads at `/.well-known/oauth-authorization-server` is published by Clerk on its own Frontend API domain (the issuer). The Step 0 spike confirms Alexa resolves it from `authorization_servers`. If it doesn't, add `src/app/.well-known/oauth-authorization-server/route.ts` that proxies Clerk's `${CLERK_LISTENER_ISSUER}/.well-known/oauth-authorization-server`.

- [ ] **Step 4: Run it.** `npm test` should PASS, and the existing `tests/mcp.test.ts` should be unchanged (it calls the unwrapped `buildMcpHandler`). Then run `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/listenerAuth.ts src/app/.well-known src/app/api/mcp/route.ts tests/listenerAuth.test.ts
git commit -m "feat: listener account linking — local Clerk token check, resource metadata, 401 gate for Finds tools"
```

### Task B4: Finds tools — `save_find`, `list_finds`, `delete_my_finds`

**Files:**
- Modify: `src/lib/mcp.ts` (register three tools)
- Modify: `src/lib/speech.ts` (`spokenSaved`, `spokenFinds`)
- Test: `tests/mcp.test.ts` (Finds cases)

**Interfaces:**
- Consumes: `PlaylistClient.saveFind` / `listFinds` / `deleteFinds` (B1), `listenerIdFrom` (B3).

- [ ] **Step 1: Write the failing tests.** `buildMcpHandler` is called without the auth wrapper in tests, so the tool reads `extra.authInfo`. The MCP SDK passes `authInfo` from `req.auth` to tool callbacks, so set it on the request in a helper `mcpPostAs(handler, body, userId)`. Add it to `tests/mcp-wire.ts`, copying `mcpPost` and doing `Object.assign(request, { auth: { token: "t", clientId: "alexa", scopes: [], extra: { userId } } })` before calling the handler.

```ts
  it("save_find saves for the linked listener and confirms by voice", async () => {
    const saved: string[] = [];
    const playlist = fakePlaylist({ saveFind: async (listenerId, playId) => { saved.push(`${listenerId}:${playId}`); return { status: "ok", findId: "f1", appleMusic: "pending", artist: "Ezra Collective", title: "Victory Dance", alreadySaved: false }; } });
    const { message } = await mcpPostAs(handlerWith(undefined, undefined, playlist), call("save_find", { playId: "play_1" }), "user_1");
    expect(saved).toEqual(["user_1:play_1"]);
    expect(message.result.content[0].text).toMatch(/Saved .*Victory Dance.* adding it to Apple Music/);
  });

  it("save_find without a playId fails validation, not a crash", async () => {
    const { message } = await mcpPostAs(handlerWith(), call("save_find", {}), "user_1");
    expect(message.error ?? message.result?.isError).toBeTruthy();
  });

  it("save_find for a missing play asks which song", async () => {
    const playlist = fakePlaylist({ saveFind: async () => ({ status: "not_found" }) });
    const { message } = await mcpPostAs(handlerWith(undefined, undefined, playlist), call("save_find", { playId: "gone" }), "user_1");
    expect(message.result.content[0].text).toMatch(/which song/i);
  });

  it("list_finds returns numbered finds with labels", async () => {
    const { message } = await mcpPostAs(handlerWith(), call("list_finds", {}), "user_1");
    expect(message.result.structuredContent.finds[0]).toMatchObject({ label: "1", title: "Victory Dance" });
  });

  it("delete_my_finds reports what was removed", async () => {
    const playlist = fakePlaylist({ deleteFinds: async () => ({ deletedFinds: 3, deletedLink: true }) });
    const { message } = await mcpPostAs(handlerWith(undefined, undefined, playlist), call("delete_my_finds", {}), "user_1");
    expect(message.result.content[0].text).toMatch(/3/);
  });
```

- [ ] **Step 2: Run it.** `npm test -- tests/mcp.test.ts` should FAIL.

- [ ] **Step 3: Implement.** Register these in `buildMcpHandler`, in the same style as the others (wrapped in `timed`, with the `PlaylistUnavailable` fallback). Each callback takes `(args, extra)`, and `const listenerId = listenerIdFrom(extra)`. If that's undefined (a defensive case, since the route gate already returned 401), return `{ content: text("Link your Radio Milwaukee account in the Alexa app to save songs."), isError: true }`.

`save_find`:
- **Description:** "Save a song the listener heard on Radio Milwaukee to their 88Nine Finds (and Apple Music if connected). Requires a linked account. Pass the playId from find_song_played. Use for 'save it', 'save that song'."
- **inputSchema:** `z.object({ playId: z.string().min(1).max(64) })`.

`list_finds`:
- **Description:** "List the listener's saved Radio Milwaukee Finds, newest first, numbered. Requires a linked account. Use for 'what's in my Finds?'."
- **inputSchema:** `z.object({ limit: z.number().int().min(1).max(10).optional() })`.
- Returns `structuredContent: { finds }` and the spoken list.

`delete_my_finds`:
- **Description:** "Permanently delete all of the listener's Finds and disconnect Apple Music. Requires a linked account. Only call after the listener has clearly confirmed."
- **inputSchema:** `z.object({})`.

Add to `src/lib/speech.ts`:

```ts
export function spokenSaved(saved: SavedFind): string {
  if (saved.status === "not_found") return "I couldn't find that play anymore — which song did you mean?";
  const already = saved.alreadySaved ? "It was already in your Finds, so I moved it to the top" : `Saved "${saved.title}" by ${saved.artist} to your 88Nine Finds`;
  return saved.appleMusic === "pending" ? `${already}, and I'm adding it to Apple Music.` : `${already}.`;
}

export function spokenFinds(finds: FindRow[]): string {
  if (finds.length === 0) return "Your Finds are empty. After I name a song, say 'save it'.";
  const items = finds.map((f) => `${f.label}: "${f.title}" by ${f.artist}`).join("; ");
  const reconnect = finds.some((f) => f.appleMusic.status === "expired") ? " Apple Music needs reconnecting at radiomilwaukee.org slash connect." : "";
  return `Your latest Finds — ${items}.${reconnect}`;
}
```

- [ ] **Step 4: Run it.** `npm test` should PASS. Then run `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp.ts src/lib/speech.ts tests/mcp.test.ts tests/mcp-wire.ts
git commit -m "feat: save_find, list_finds and delete_my_finds tools"
```

### Task B5: Apple Music connect page + privacy page

**Files:**
- Create: `src/app/connect/apple-music/page.tsx` (client component)
- Create: `src/app/api/connect/apple-music/route.ts` (POST)
- Create: `src/app/privacy/page.tsx`
- Test: `tests/connectAppleMusic.test.ts` (route handler validation)
- Dependency: `@clerk/nextjs` (listener sign-in on the connect page)

**Interfaces:**
- Consumes: `PlaylistClient.connectAppleMusic` (B1), `api.appleMusic.getDeveloperToken` on the playlist deployment (public).

- [ ] **Step 1: Write the failing test.** Export the route's core as `handleConnect({ userId, body, connect })`, so it can be tested without Next or Clerk:

```ts
import { describe, expect, it } from "vitest";
import { handleConnect } from "@/app/api/connect/apple-music/route";

describe("POST /api/connect/apple-music", () => {
  it("rejects a signed-out request", async () => {
    expect((await handleConnect({ userId: null, body: { musicUserToken: "t" }, connect: async () => {} })).status).toBe(401);
  });
  it("rejects a missing or oversized token", async () => {
    expect((await handleConnect({ userId: "u", body: {}, connect: async () => {} })).status).toBe(400);
    expect((await handleConnect({ userId: "u", body: { musicUserToken: "x".repeat(5000) }, connect: async () => {} })).status).toBe(400);
  });
  it("stores the token for the signed-in listener", async () => {
    const calls: string[] = [];
    const res = await handleConnect({ userId: "user_1", body: { musicUserToken: "mut" }, connect: async (id, token) => { calls.push(`${id}:${token}`); } });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["user_1:mut"]);
  });
});
```

- [ ] **Step 2: Run it.** `npm test -- tests/connectAppleMusic.test.ts` should FAIL.

- [ ] **Step 3: Implement**

`src/app/api/connect/apple-music/route.ts`:

```ts
import { auth } from "@clerk/nextjs/server";
import { playlistFromEnv } from "@/lib/playlist";

const MAX_TOKEN_LENGTH = 4096;

export async function handleConnect({ userId, body, connect }: {
  userId: string | null;
  body: unknown;
  connect: (listenerId: string, token: string) => Promise<void>;
}): Promise<Response> {
  if (!userId) return Response.json({ error: "sign_in_required" }, { status: 401 });
  const token = (body as { musicUserToken?: unknown } | null)?.musicUserToken;
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return Response.json({ error: "invalid_token" }, { status: 400 });
  }
  await connect(userId, token);
  return Response.json({ linked: true });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  const body = await req.json().catch(() => null);
  return handleConnect({ userId, body, connect: (id, token) => playlistFromEnv().connectAppleMusic(id, token) });
}
```

`src/app/connect/apple-music/page.tsx`: a client component wrapped in `<ClerkProvider publishableKey={process.env.NEXT_PUBLIC_CLERK_LISTENER_PUBLISHABLE_KEY}>`. It shows `<SignIn />` when signed out. When signed in:
1. Load `https://js-cdn.music.apple.com/musickit/v3/musickit.js`.
2. Fetch the developer token from the playlist deployment's public `appleMusic:getDeveloperToken`, via `ConvexHttpClient(NEXT_PUBLIC_PLAYLIST_CONVEX_URL)`.
3. `await MusicKit.configure({ developerToken, app: { name: "Radio Milwaukee", build: "1" } })`.
4. On "Connect Apple Music", run `const mut = await MusicKit.getInstance().authorize()`, then `fetch("/api/connect/apple-music", { method: "POST", body: JSON.stringify({ musicUserToken: mut }) })`, then show "Connected — say 'save it' to Alexa after any song."

Use the station's existing card tokens (`src/lib/card/tokens.ts`) for colors. Show an error state if MusicKit fails to load or authorize.

`src/app/privacy/page.tsx`: a static page covering:
- **What's stored:** account ID, saved songs, encrypted Apple Music token
- **Why**
- **How to delete:** say "Alexa, delete my Finds", or email the station
- **What isn't stored:** voice, email or name in the song database
- **Contact**

Link it from the site footer, if there is one.

Add the Clerk middleware only for `/connect/:path*` and `/api/connect/:path*` (a `middleware.ts` matcher), so the MCP route and the rest of the site are untouched.

- [ ] **Step 4: Run it.** `npm test` should PASS, then `npm run typecheck`, then `npm run build`. Manual check: run `npm run dev`, sign in at `/connect/apple-music`, connect with a real Apple ID, and confirm `appleMusicLinks.status` returns `active` for that listener (a read-only `bunx convex run appleMusicLinks:status` with the server key).

- [ ] **Step 5: Commit and stop for PR B**

```bash
git add src/app/connect src/app/api/connect src/app/privacy middleware.ts package.json package-lock.json tests/connectAppleMusic.test.ts
git commit -m "feat: Apple Music connect page and privacy policy"
```

**Before PR B merges (Tarik):** set the Radio Commons env vars in Vercel:
- `PLAYLIST_CONVEX_URL`
- `RADIO_COMMONS_SERVER_KEY` (same value as Convex)
- `CLERK_LISTENER_SECRET_KEY`, `CLERK_LISTENER_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CLERK_LISTENER_PUBLISHABLE_KEY`
- `CLERK_LISTENER_JWT_KEY`, `CLERK_LISTENER_ISSUER`
- `MCP_RESOURCE_URL`, which must equal the add-on manifest's MCP URL exactly
- `NEXT_PUBLIC_PLAYLIST_CONVEX_URL`

---

## Part C — Live end-to-end (manual, after both PRs deploy)

### Task C1: The real listener journey

- [ ] **Step 1:** In the Alexa+ simulator with a **fresh** Amazon account, ask "what was that song on 88Nine this morning?". It should answer with no linking prompt.
- [ ] **Step 2:** Say "save it". You should get the linking prompt. Link, then say "save it" again. It should answer "Saved … to your 88Nine Finds".
- [ ] **Step 3:** Connect Apple Music at `/connect/apple-music` with a subscribed Apple ID, then recall another song and say "save it". It should answer "… adding it to Apple Music", and the song should appear in that Apple Music library within a minute.
- [ ] **Step 4:** Ask "what's in my Finds?". You should hear a numbered list, with a card on Echo Show if one is available.
- [ ] **Step 5:** Say "delete my Finds" and confirm. "What's in my Finds?" should then report it empty.
- [ ] **Step 6:** Write the results, with timings, into `docs/superpowers/spikes/` next to the Step 0 report.

---

## Self-review notes

**Spec coverage:**
- §3 → Task 0
- §4 → B3
- §5 → A1–A3
- §6 → B4 (plus B1–B2, the missing prerequisites)
- §7 → A4 + B5
- §8 → tests in A3, A4, B1, B4
- §9 → B5
- §10 → all tasks + C1
- §11 → the order of Parts 0, A, B, C

**Not in this plan:** P1 deep-dive buttons; Spotify; a native Amazon Music handoff; the production Clerk domain and DNS (launch).

**Known places an implementer must check (named in the tasks):**
- the `protectedResourceHandler` scopes support (B3)
- that the MCP SDK passes `req.auth` to `extra.authInfo` (B4 test helper). If it doesn't, read auth from a request-scoped store set in the route instead.
