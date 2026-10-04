# Finds library + Apple Music save — design

**Date:** 2026-10-04
**Sub-project:** 2 of 4 for the Alexa+ music pillar (deadline 2026-10-23)
**Builds on:** `docs/superpowers/specs/2026-10-04-music-recall-tier1-facts-design.md` (song recall, `findSongPlayed` returns `playId`)
**Decision record:** `docs/decisions/008-listener-accounts-and-finds.md`
**Source docs:** `~/Downloads/alexa-plus-music-feature-decisions.md` §9 (saving songs); Radio Commons `docs/superpowers/specs/2026-10-02-story-tools-design.md` (account linking was out of scope for slice 1)

## 1. Goal

A listener who heard a song on FM can say **"Alexa, save it"** and keep it in a station-owned **Finds** library. If they've connected Apple Music, the song is added to their Apple Music library too.

This works for **real listeners** with their own accounts, not just a demo listener.

Success means:
- Account linking works end to end in the Alexa+ simulator with a real Amazon account.
- "Save it" after a recall answer stores the right song for the right listener.
- "What's in my Finds?" lists it, newest first, with a card on Echo Show.
- With Apple Music connected, the song appears in the listener's Apple Music library.
- Tools that don't need an account (recall, track stories, podcast stories) keep working for listeners who never link.
- Every tool call responds in under 500 ms.

## 2. Where each piece lives

| Repo | Owns |
|---|---|
| **Clerk: new "Radio Milwaukee Listeners" application** | Listener sign-up and sign-in. OAuth login server for Alexa. Separate from the staff Clerk app the dashboard uses. |
| **Radio Commons** (`~/Projects/radio-commons`) | MCP token check and the `/.well-known` documents. Tools `save_find`, `list_finds`, `delete_my_finds`. The `/connect/apple-music` page. The privacy policy page. |
| **rm-playlist-v2 (this repo)** | `finds` and `appleMusicLinks` tables. Server-key-locked Convex functions. The background Apple add job. |

## 3. Step 0 — the day-one account-linking spike (throwaway)

Before any Finds code, prove the linking path live. Report the results; nothing built here is kept.

1. Create the listener Clerk application (development instance). In the Alexa OAuth app, require PKCE, use **JWT access tokens** (the default), and set scopes `openid profile offline_access`.
2. Publish `/.well-known/oauth-protected-resource` (with `resource` = the exact MCP URL in the add-on manifest, Clerk as the authorization server, and `scopes_supported`), plus the auth-server metadata. Follow Clerk's "Build an MCP server with Clerk" guide (`mcp-handler` + `@clerk/mcp-tools`).
3. Run `alexa-ai configure-account-linking --addon-id <id> --stage development --client-id <id>`. Register **every** redirect URI it prints in the Clerk OAuth app.
4. Link a real Amazon account in the simulator.

**Pass criteria (record each):**
- (a) Linking completes.
- (b) A refresh token is issued.
- (c) Clerk accepts or ignores the RFC 8707 `resource` parameter without failing.
- (d) Tools without auth still work for an unlinked listener, and an auth-needing tool gets a 401 that Alexa turns into a "link your account" prompt.

**If (a)–(c) fail:** switch the login server to Auth0 or AWS Cognito, which Amazon names directly. Sections 4–8 stay the same.

**If (d) fails:** split Finds into its own small add-on with linking required.

## 4. Identity

- The **listener ID** is the Clerk user ID (`sub` in the access token). It is the only identity this system stores. Email and name stay in Clerk.
- Radio Commons checks the bearer token locally (JWT signature, issuer, and authorized client). That costs no network call, which protects the 500 ms budget.
- `save_find`, `list_finds` and `delete_my_finds` need a valid token. Without one they return 401 plus the protected-resource pointer, which Alexa turns into account linking.
- All other tools ignore the token.
- **Hackathon:** Clerk development instance (public `*.clerk.accounts.dev` domain).
- **Launch:** production instance on a station domain (e.g. `accounts.radiomilwaukee.org`, which needs a DNS record), then re-run `configure-account-linking`. Amazon caches the auth metadata at deploy time.

## 5. Storage (rm-playlist-v2 Convex)

### 5.1 `finds`

One row per saved song per listener.

| Field | Type | Notes |
|---|---|---|
| `listenerId` | string | Clerk user ID |
| `playId` | `Id<"plays">` | The spin the listener heard |
| `trackId` | `Id<"tracks">`? | Empty for unidentified songs; they can still be saved |
| `dedupeKey` | string | `track:<trackId>`, or `play:<playId>` when there's no track |
| `artist`, `title` | string | Copied at save time from the track, else the play's raw text |
| `stationSlug` | string | Station the song was heard on |
| `savedAt` | number | Updated when the same song is saved again |
| `appleMusic` | `{ status: "not_linked" \| "pending" \| "added" \| "failed" \| "expired", reason?: string, at: number }` | Outcome of the Apple add |

Indexes:
- `by_listener_saved` on `["listenerId", "savedAt"]`, for listing newest first.
- `by_listener_dedupe` on `["listenerId", "dedupeKey"]`, for the duplicate check.

### 5.2 `appleMusicLinks`

One row per listener who connected Apple Music.

| Field | Type | Notes |
|---|---|---|
| `listenerId` | string | |
| `encryptedUserToken` | string | AES-256-GCM: IV + ciphertext + tag, base64 |
| `linkedAt` | number | |
| `status` | `"active" \| "expired"` | Becomes `expired` when Apple rejects the token |

Index: `by_listener` on `["listenerId"]`.

**Key:** `FINDS_ENCRYPTION_KEY`, 32 random bytes, set in Convex's environment only. Encryption and decryption happen inside Convex functions. The key never leaves Convex.

### 5.3 Access rule

Every Finds and Apple function needs `serverKey` = `RADIO_COMMONS_SERVER_KEY`. It's checked in constant time, and a mismatch is rejected with no data returned.

These are the repo's first tables holding personal data. The open public-mutation pattern used by enrichment is **not** used here.

Functions:
- `finds.save`
- `finds.list`
- `finds.deleteAllForListener`
- `appleMusicLinks.connect`
- `appleMusicLinks.status`
- `internal.finds.addToAppleMusic`: an internal action, never callable from outside.

## 6. Tools (Radio Commons)

**`save_find({ playId })`**
1. `playId` comes from the last `findSongPlayed` result ("save it" means the song Alexa just named).
2. Calls `finds.save`, which upserts by `(listenerId, dedupeKey)`. If an active Apple link exists, it sets `appleMusic.status = "pending"` and schedules `addToAppleMusic` via `ctx.scheduler.runAfter(0, …)`.
3. Returns at once, with spoken text such as "Saved to your 88Nine Finds" or "…and adding it to Apple Music".

**`list_finds({ limit? })`**
- Returns the newest Finds with `limit` clamped to 1–10, default 5.
- Each item has a stable label (1, 2, 3…), artist, title, station, saved time, `appleMusic.status`, and the `trackId` / `playId` for follow-ups.
- Card data includes artwork and `previewUrl`, joined from tracks.
- Deep-dive buttons ("The story", "Influences") are P1 and not in this spec.

**`delete_my_finds()`**
- Alexa confirms by voice first. It then calls `finds.deleteAllForListener`, which removes the listener's Finds and Apple link.

**Not built:** saving to Spotify (doc §9: development-mode limits), and handing off to Amazon Music natively (only if verified on a device; separate spike).

## 7. Apple Music

**Connect page `/connect/apple-music` (Radio Commons, Next.js):**
1. The listener signs in with the same listener Clerk app.
2. The page loads MusicKit JS with the developer token from the playlist app's existing public `appleMusic.getDeveloperToken`.
3. "Connect Apple Music" calls `music.authorize()`. Apple's own window returns the Music User Token.
4. The page posts it to a Radio Commons route. The route checks the Clerk session and calls `appleMusicLinks.connect`, which encrypts and stores the token.
5. Alexa's pointer to this page: "Visit radiomilwaukee.org/connect to add Apple Music." The exact public URL is set at launch.

**Background add `internal.finds.addToAppleMusic(findId)`:**
1. Load the find, the track's `appleMusicSongId`, and the listener's link. Decrypt the token.
2. Call `POST https://api.music.apple.com/v1/me/library?ids[songs]=<appleMusicSongId>`, with the developer token as `Authorization: Bearer` and the user token as `Music-User-Token`. A 202 means accepted.
3. Map the outcome:

| Outcome | Result |
|---|---|
| 202 | `added` |
| 401 / 403 on the user token | link `expired`; find `expired` |
| No `trackId` or no `appleMusicSongId` | `failed`, `reason: "not in Apple Music catalog"` |
| 5xx / network | Retry once after 60 s, then `failed` |

**Subscription:** Apple may refuse library adds for listeners without an Apple Music subscription. The find is kept, the Finds list still works, and the reason is recorded. Confirm the behavior and MusicKit's terms for public apps during the build.

## 8. Errors

| Case | Behavior |
|---|---|
| Not linked | 401 → Alexa prompts for account linking |
| `playId` not found or deleted | Structured `not_found`; Alexa asks which song |
| Unidentified song | Saved from the play's text; no Apple add, with the reason recorded |
| Same song saved twice | Upsert; `savedAt` refreshed; no duplicate |
| Wrong or missing server key | Rejected; no data returned |
| Apple token expired | Link marked `expired`; the next `list_finds` says "Apple Music needs reconnecting" |
| Encryption key missing | `connect` and `addToAppleMusic` fail loudly (logged); saving Finds still works |

## 9. Privacy

- A public privacy policy page on Radio Commons is required by Amazon for account linking. It covers what's stored (Clerk user ID, saved songs, encrypted Apple token), why, and how to delete it ("Alexa, delete my Finds", or email).
- No voice data, no email or name in the playlist database, and nothing stored for unlinked listeners.

## 10. Testing

**Unit tests:**
- Dedupe keys (track vs play).
- Encryption round-trip and tamper detection (a GCM tag mismatch is rejected).
- The server-key check, including a constant-time compare and a wrong key returning nothing.
- Mapping Apple responses to statuses, from recorded 202 / 401 / 403 / 404 / 5xx responses.
- Clamping `list_finds`'s `limit`.
- Radio Commons: tools return 401 without a token, and anonymous tools are unaffected.

**Live:**
- The Step 0 spike, written up.
- At the end: link an account → recall a song → "save it" → the song appears in the tester's own Apple Music library → "what's in my Finds?" lists it → "delete my Finds" empties it.

## 11. Order of work

1. Step 0 spike: report the results before continuing.
2. Playlist Convex: tables, encryption helper, server-key check, `finds.*` and `appleMusicLinks.*`, the background Apple add.
3. Radio Commons: token check and `/.well-known` documents, `save_find`, `list_finds`, `delete_my_finds`, the card.
4. Radio Commons: `/connect/apple-music` page and the privacy page.
5. Live end-to-end test; production Clerk instance and DNS at launch.

## 12. Open items

- Which Apple Music listeners can add to their library (subscription required?), and whether MusicKit's terms allow a public app. Confirm before the demo.
- How the public `/connect` URL is hosted: the Radio Commons domain, or a radiomilwaukee.org path.
- Production Clerk domain and DNS (launch, not the hackathon).
- Whether Alexa+ passes individual voice ID (doc §16): not needed with account linking, since one linked account means one Finds library per Amazon account.

## 13. Research sources

- Amazon, Account linking for MCP add-ons: https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-account-linking.html
- Clerk, How Clerk implements OAuth: https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth. Covers JWT access tokens by default (verifiable without a network call), `offline_access` refresh tokens that never expire, PKCE on by default, and no mention of RFC 8707.
- Clerk, Build an MCP server with Clerk: https://github.com/clerk/clerk-docs/blob/main/docs/guides/ai/mcp/build-mcp-server.mdx
- RFC 6749 §3.1: authorization servers MUST ignore unrecognized request parameters. RFC 8707: resource indicators.
- Apple Music API, Add a Resource to a Library: https://developer.apple.com/documentation/applemusicapi/add-a-resource-to-a-library
