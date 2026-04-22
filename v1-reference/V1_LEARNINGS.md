# V1_LEARNINGS.md

What V1 got right, what it got wrong, what V2 should steal vs leave behind. Scanned from `radiomke-playlist-app V1/` on 2026-04-22.

## Stack / architecture

V1 ran on Vite + React + Supabase Edge Functions (Deno std 0.168.0) + Spinitron API. Five Edge Functions: `spinitron-proxy`, `youtube-search`, `spotify-enhance`, `ticketmaster-events`, `related-tracks`. 12 migrations over ~10 months.

## Patterns that worked — steal these in V2

1. **One Edge Function per external API.** Clean blast radius. V2 translates this to one Trigger.dev task per source-kind, which is stronger (retries, concurrency, checkpointing).
2. **Database-first search before API.** `spinitron-proxy` checks `songs` table with Postgres full-text (gin indexes on `artist`, `song`, `release`) before falling back to Spinitron API. Saves rate limit + fast. V2: same pattern, Convex `searchIndex search_plays`.
3. **Generic `api_cache` table** (`cache_key`, `payload JSONB`, `expires_at`, auto `updated_at`) — used for related-tracks, Ticketmaster cache, etc. V2: `artists`/`tracks` canonical tables fill this role; no need for a separate cache.
4. **Per-station API key lookup via env-var indirection.** `stations.api_key_secret_name` points to `Deno.env.get(...)` — key value never sits in the DB row. V2 must preserve this. Translates to `ingestionSources.config.apiKeyRef` → Convex env var.
5. **RLS + role model.** `app_role` enum (`admin`, `moderator`, `user`) + `has_role(user_id, role)` SECURITY DEFINER function. Clerk roles in V2 map 1:1 — keep the three-tier model.
6. **Auto-assign admin on email match.** Postgres trigger on `auth.users` insert: `IF NEW.email ILIKE '%@radiomilwaukee.org' THEN INSERT INTO user_roles ...`. V2 on Clerk: webhook → assign role on signup for @radiomilwaukee.org domain.
7. **Stations table locked down, public RPC for safe fields.** Migration 2025-09-10 removed public SELECT on `stations`, added `public_list_stations()` RPC returning only `id` + `name`. Prevents accidental API-key leak over public endpoints. V2: Convex public queries should never project `ingestionSources.config`.
8. **YouTube cache is cache-on-miss.** Even a "not found" result gets cached to prevent repeat API hits on artists YouTube has no video for. V2: do the same for MusicBrainz, Discogs, Spotify lookups — cache the negative.
9. **Scroll/pagination initial fetch was perf-tuned.** Originally 1000 songs, reduced to 100 based on real usage. V2: start small (~50), raise only if users hit the floor.
10. **Custom events as their own table** (`custom_events`), separate from `ticketmaster_events_cache`. Brainstorm already plans this — keep the separation.

## Patterns that accumulated debt — don't port these

1. **Schema fragmentation.** Multiple `ALTER TABLE songs ADD COLUMN` migrations for enrichment fields (`spotify_album_id`, `spotify_artist_id`, `spotify_track_id`, `enhanced_metadata JSONB`, `is_manual`, `manual_added_at`, `added_by_user_id`). Metadata kept growing. V2: canonical `artists`/`tracks` tables absorb this cleanly; `plays` stays thin.
2. **Supabase Edge Functions for scheduled polling is wrong tool.** V1 leans on frontend polling every 10s + DB cache. V2's Trigger.dev task model is strictly better for scheduled ingestion.
3. **No structured ingestion event log.** V1 logs go to stdout; no queryable history of what the poller did/saw. V2's `ingestionEvents` table + the Ingestion Health dashboard (Expansion #4) fix this.
4. **Mixed theme/style isolation approach.** `Embed.tsx` forcibly clears document-level classes and re-injects CSS via JS to isolate themes from host pages. V2: shadow DOM (accepted in brainstorm) is the right approach — delete this approach.
5. **No rate-limit awareness.** YouTube search politely pauses 100ms between calls and caps at 8 attempts; Spinitron has no explicit backoff. V2: Trigger.dev concurrency keys + queue concurrency-1 on MB handle this declaratively.
6. **Frontend polling.** `useSpinData` likely polls every 10s. V2: Convex subscription eliminates this entirely.

## Architecture-level learnings for V2

- **Dynamic env-var lookup per station is good.** Keep. `config.apiKeyRef = "HYFIN_SPINITRON_KEY"` → Convex env → actual value. Never store values in rows.
- **The `songs` table shape is wrong for V2.** V1 has one flat row per play with artist+song+release+metadata all denormalized. V2 splits: `plays` (thin event log), `artists`/`tracks` (canonical), `*Overlays` (corrections). Much better for reporting joins.
- **`youtube_cache` justifies the hit rate.** Worth building the same pattern for every enrichment source. V2's canonical tables do this implicitly (one row per artist/track).
- **Admin UX was spread across `/admin` page with tabs.** V2's ingestion-health + manual-enrich admin screens should consolidate in the same pattern — one admin home with tabs per concern.

## Environment variables V1 uses (names only)

Frontend: `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`.
Edge Functions (inferred from code): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `YOUTUBE_API_KEY`, `TICKETMASTER_API_KEY`, `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` (via spotify-enhance), plus per-station Spinitron keys referenced dynamically by `stations.api_key_secret_name`.

V2 equivalents: Convex deployment env, Fly secrets, Trigger env. Single source per service, never duplicated.

## What made V1 brittle in production (inferred)

- Spinitron rate-limit-driven 500s — spinitron-proxy has a fallback to cached DB rows, which means silent degradation. V2: same behavior but MUST emit `ingestionEvents(poll_error)` so the Ingestion Health dashboard sees it.
- YouTube quota exhaustion — no user-facing indicator. V2: same fix as accepted Ticketmaster quota banner.
- Embed theme isolation required brute-force CSS override — shadow DOM in V2 makes this trivial.

## What users loved about V1 (infer from feature list + embed config richness)

- Live updates
- Search across history
- Date range filtering
- Embed generator with extensive config
- YouTube preview integration
- Responsive design

All carry forward to V2. The embed generator especially — V2 must ship a dashboard page matching the V1 `/demo` UX richness (open questions #15, #16 in brainstorm).
