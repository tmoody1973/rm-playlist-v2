# V1_EDGE_CASES.md

Specific heuristics, string handlers, and workarounds V1 accumulated that V2 must preserve or explicitly replace. Scanned from `radiomke-playlist-app V1/` on 2026-04-22. File paths are relative to that folder.

---

## 1. YouTube search query variants (8 attempts per track)

Source: `supabase/functions/youtube-search/search-utils.ts`, `youtube-api.ts`

**Artist/song cleanup pattern** (V2 must replicate in enrichment package):

```typescript
term
  .replace(/\(.*?\)/g, "") // strip (parens content)
  .replace(/\[.*?\]/g, "") // strip [bracket content]
  .replace(/feat\.|ft\.|featuring/gi, "") // strip featuring indicators
  .replace(/[^\w\s]/g, " ") // strip non-word chars
  .replace(/\s+/g, " ")
  .trim(); // normalize whitespace
```

**Artist name variations** — try all:

- Original: `"The Beatles"`
- Cleaned: `"Beatles"`
- Abbreviated: strip `.` and leading `The ` → `"Beatles"`

**Query sequence (in order, stop on excellent match):**

1. `${cleanArtist} ${cleanSong}`
2. `${artist} ${song}` (raw)
3. `${cleanSong} ${cleanArtist}` (reversed)
4. `${cleanArtist} ${cleanSong} official`
5. `${cleanArtist} ${cleanSong} music video`
6. `${cleanArtist} ${cleanSong} audio`
7. `${cleanArtist} ${cleanSong} lyrics`
8. `${cleanArtist} ${cleanSong} live`
9. Each artist variation × cleanSong
10. Song-only + modifiers (fallback)
11. `${cleanSong} by ${cleanArtist}`

**Stop conditions:** `bestScore >= 8 && candidate.isOfficial && candidate.score >= 8` OR `searchAttempts >= 8` (rate-limit cap).

## 2. YouTube scoring heuristic (hard-won tuning)

Source: `supabase/functions/youtube-search/scoring.ts`

```
Base:
  title contains artist  → +3
  title contains song    → +3
  title contains "artist song" or "song artist"  → +2

Channel quality:
  isOfficialMusicChannel  → +3
  channel contains "vevo" → +2
  channel ends with " - Topic"  → +2

Content indicators:
  title contains "official"  → +2
  title contains "music video" → +1
  title contains "audio" → +1
  title contains "hd" or "high quality" → +1

Penalties:
  title contains "cover" AND NOT "official"  → -2
  title contains "remix" AND NOT "official"  → -1
  title contains "karaoke"                   → -3
  title contains "instrumental"              → -2
  title contains "lyrics" AND NOT "official" → -1

Floor: Math.max(0, score)
```

**Migrate as-is to V2 enrichment pipeline.** Add a unit test per tuning decision; these weights are not arbitrary.

## 3. "Official music channel" detection

Source: `supabase/functions/youtube-search/channel-utils.ts`

```typescript
channel.toLowerCase() contains any of:
  'vevo' | 'records' | 'music' | 'official' | 'label'
OR channel.endsWith(' - topic')
```

Note: the `- Topic` channels are YouTube's auto-generated artist channels — high-signal official content.

## 4. Ticketmaster artist filtering (strict matching for single-word names)

Source: `supabase/functions/ticketmaster-events/utils/filtering.ts`

**Single-word artist names** (e.g. "Omar", "Prince", "Sault") are a minefield. V1 hard-codes strict match rules:

- Event name must exactly equal artist name, OR
- Event name must start with `artist + ' '` / `artist + ':'` / `artist + ' -'` / `artist + ' |'`, OR
- Event name must end with `' ' + artist`, OR
- Event name must contain `'(' + artist + ')'`, OR
- Event name matches `/^{artist}\s+(live|concert|tour|show)(\s|$)/i`

**Multi-word artist names:** bidirectional `startsWith` check (artist startsWith event OR event startsWith artist) after non-alphanumeric normalization.

**Normalization for both:**

```typescript
name
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, "") // strip special chars (handles "NxWorries" vs "NXworries")
  .replace(/\s+/g, " ")
  .trim();
```

V2: fold this into `packages/enrichment/src/normalize.ts`'s `artistKey()` path. Brainstorm flags this as open question #11 — this file is the answer for the common cases.

## 5. Station naming convention

Source: `src/components/embed/generators/IframeCodeGenerator.ts`, `src/hooks/useEmbedDemoState.ts`

- **URL slug:** lowercase, no spaces: `hyfin`, `88nine`
- **Display name:** mixed case: `HYFIN`, `88Nine Radio Milwaukee`
- **V2 additions:** `414music`, `rhythmlab` (lowercase slugs)

V2 `stations.slug` must stay lowercase-no-spaces. Display name is a separate field.

## 6. Embed URL contract (partner sites depend on these exact query params)

Source: `src/pages/Embed.tsx`

Route: `/embed?station=hyfin&...`

Query params in use:
| Param | Default | Notes |
|---|---|---|
| `station` | `hyfin` | lowercase slug |
| `autoUpdate` | `true` | `!= 'false'` semantics |
| `showSearch` | `true` | `!= 'false'` |
| `showHeader` | `true` | `!= 'false'` |
| `maxItems` | `20` | special: `'unlimited'` → parse as 1000 |
| `compact` | `false` | `=== 'true'` |
| `height` | `auto` | string |
| `theme` | `light` | `light` / `dark` |
| `startDate` | empty | ISO date string |
| `endDate` | empty | ISO date string |
| `enableYouTube` | `true` | `!= 'false'` |
| `showLoadMore` | `true` | `!= 'false'` |
| `layout` | `list` | `list` / `grid` |

**V2 MUST serve these exact URLs at the v2 domain as iframe fallback** (per accepted Expansion #3 — the v1-embed shim). The JS widget's `data-*` attributes should map to these same names for migration parity.

## 7. Theme isolation (V1 brute force — V2 uses shadow DOM instead)

V1 does this to escape host-page CSS:

```typescript
document.documentElement.className = "";
document.body.className = "";
// then forcibly injects CSS vars and scrollbar styles via style element
```

V2: shadow DOM inside widget root. Host CSS can't bleed in. CSS custom properties still pierce the shadow boundary for theming. Delete the brute-force approach.

## 8. "Now playing" time-window heuristic

Source: `src/utils/playlistHelpers.ts`

Only the FIRST item in the live feed (index 0) shows as "now playing," and only when:

- No active filters (no search, no date filter)
- `timeSinceStart >= -twoMinutesInMs` (2-min grace for clock drift)
- AND `timeSinceStart <= maxTimeWindow` (configured max window)

With track `duration`: use `duration + 2min` as max window.
Without `duration`: use `defaultMaxDurationMs` (typical song length).

**V2 widget logic needs the same heuristic** — the "now playing" label can't trust Spinitron's timestamp alone; clock drift and missing durations are real.

## 9. Spinitron search fallback chain

Source: `src/services/spinDataService.ts`

Order of operations when user searches:

1. **Database-first:** ILIKE on `song | artist | release` in local `songs` table (full-text via gin).
2. If no DB results AND user has search term → hit Spinitron API via `spinitron-proxy`.
3. If Spinitron API fails → fall back to older DB rows in same station (last 14 days or similar).
4. Initial live fetch: 100 songs (originally 1000, tuned down for perf).

V2: same cascade, but `plays` table is the search target and Convex `searchIndex search_plays` handles full-text.

## 10. API cache generic pattern

Source: `supabase/migrations/20250808175138_*.sql`

```sql
create table api_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,   -- e.g. 'related:spotify:{track_id}'
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- trigger sets updated_at on row update
```

Cache keys in use (found via grep of function source):

- `related:spotify:{track_id}`
- `related:artist:{artist}:{song}`
- Ticketmaster events per artist

V2: canonical `artists`/`tracks` replaces `api_cache` for enrichment. Related-tracks / radio-adjacent APIs (if retained) can use a parallel table — same shape.

## 11. RLS + role model

Source: `supabase/migrations/20250825194513_*.sql`, `20260330152743_*.sql`

```sql
CREATE TYPE app_role AS ENUM ('admin', 'moderator', 'user');

CREATE FUNCTION has_role(_user_id uuid, _role app_role)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$ SELECT EXISTS(SELECT 1 FROM user_roles
       WHERE user_id = _user_id AND role = _role) $$;

-- Auto-assign admin on email match
CREATE FUNCTION auto_assign_admin_role() RETURNS trigger AS $$
BEGIN
  IF NEW.email ILIKE '%@radiomilwaukee.org' THEN
    INSERT INTO user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
```

**V2 Clerk equivalent:** webhook on user.created → if email ends in `@radiomilwaukee.org` → assign `admin` role via Clerk metadata. Brainstorm Clerk roles (`admin`, `editor`, `viewer`) map close enough: `admin=admin`, `editor≈moderator`, `viewer≈user`.

## 12. Stations table public-access lockdown

Source: `supabase/migrations/20250910145240_*.sql`

Security migration: removed public `SELECT` on `stations` (full rows leaked API keys), added `public_list_stations()` SECURITY DEFINER function returning only `id, name`.

**V2: Convex public queries must never project `ingestionSources.config`.** Always project explicit safe field lists. Add lint/review check.

## 13. Dynamic per-station API key lookup

Source: `supabase/functions/spinitron-proxy/index.ts:74`

```typescript
const { data: stationData } = await supabase
  .from("stations")
  .select("*")
  .eq("id", stationId)
  .single();

const apiKey = Deno.env.get(stationData.api_key_secret_name);
// stationData.api_key_secret_name is e.g. "HYFIN_SPINITRON_KEY"
```

V2 translation: `ingestionSources.config.apiKeyRef = "HYFIN_SPINITRON_KEY"` → adapter does `process.env[config.apiKeyRef]` (or `Convex.env[...]`). Keep the indirection — actual secret never in the DB row.

## 14. Known-TODO inventory in V1

Only one live TODO found:

- `src/components/admin/ManualSongsList.tsx:184` — "Implement edit functionality" (manual song edit UI not yet built)

V2 equivalent (overlay UI in Weeks 9-12 per brainstorm) supersedes this.

## 15. Custom events schema

V1 `custom_events` table (migration history) has: `is_active`, `artist_name`, `event_date`, indexes on each. V2 `events` table (brainstorm) supersedes with richer shape — custom events are a row with `source: "custom"`.

## 16. Ticketmaster cache has an `is_active` soft-delete flag

Source: migration `idx_ticketmaster_cache_active`. V1 soft-deletes stale events rather than hard-delete. V2 `events.status` enum (`active | cancelled | postponed | sold_out`) is richer and replaces this.

---

**Summary:** the two highest-value carryovers are (1) YouTube search heuristics + scoring (Section 2) and (2) Ticketmaster artist-filtering strict-match rules for single-word names (Section 4). Both are algorithmic knowledge that took production tuning — don't re-derive.

The biggest explicit replacement is the theme-isolation brute force (Section 7) — shadow DOM wins cleanly.
