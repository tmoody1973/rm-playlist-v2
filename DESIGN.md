# Design System — Radio Milwaukee Playlist v2

**Established:** 2026-04-22 via `/design-consultation`
**Grounded by:** approved mockups in `~/.gstack/projects/rm-playlist-v2/designs/`

## Product Context

- **What this is:** Internal operator dashboard + embeddable widgets that surface live playlists, ingestion health, and reporting for Radio Milwaukee's four streams (HYFIN, 88Nine, 414 Music, Rhythm Lab). Public widgets render on `radiomilwaukee.org` and partner station sites.
- **Who it's for:** RM staff (music directors, ingestion ops) for the dashboard; public radio listeners (older skewing, accessibility-mandated) for widgets; partner stations as future widget consumers.
- **Space/industry:** Public radio music-platform tooling. Peers: KEXP, KCRW, The Current (MPR), WXPN.
- **Project type:** Hybrid — internal web app (dashboard) + embeddable JS widgets with iframe fallback.

## Visual Thesis

**Editorial broadcast.** The energy of an indie music magazine crossed with NPR's editorial restraint. Type-driven hierarchy. Album art does the visual heavy lifting. Quietly opinionated, music-knowing, calmly professional.

## Aesthetic Direction

- **Direction:** Editorial / Industrial-Utilitarian hybrid — newsroom CMS meets indie record label.
- **Decoration level:** **Minimal.** Typography and album art carry the visual interest. No gradients, no decorative blobs, no patterns, no icons-in-colored-circles, no purple anything.
- **Mood:** Trustworthy, music-knowing, calmly professional. Not corporate. Not playful. Quietly opinionated.

### Reference research

- **KEXP** (`#fefdfa` + `#231f20` + `#fbad18` gold accent + Figtree) — light editorial, gold for live-now indicator
- **KCRW** (dark editorial hero + light card grid + condensed grotesque + `#e8003d` coral-red CTA) — dual-mode, strong condensed display type
- **The Current** (`#1C1A1A` dark + `#DA291C` red CTA + Univers LT) — full dark commitment, single-purpose CTA red

v2 deliberately departs from these in three ways:

1. **Album art bigger than peers** (we have Spotify enrichment producing high-quality art for nearly every track — lean in).
2. **Two accent colors split** (CTA-red and LIVE-amber, not one red carrying both meanings).
3. **Inline Spotify previews as a first-class affordance** (peers don't have this).

## Surface Modes

This is one design system with **two surface modes** that share tokens (spacing, type scale, color semantics, motion) and differ in expression:

- **Mode A — Operator dashboard** (dark default, ops-dense). Internal authenticated surface.
- **Mode B — Widget** (theme-inherits from host page, respects host typography via CSS custom properties piercing shadow DOM, light by default on `radiomilwaukee.org`).

The CTA color, LIVE-event color, and status colors are constant across both modes — they're brand equity. Surface tokens (background, text, border) flip between dark and light.

## Color

### Dark mode (dashboard primary, widget when host is dark)

| Token               | Hex       | Use                                                                                                                            |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `--bg-base`         | `#0E0F11` | Page background — warm near-black, NOT pure black                                                                              |
| `--bg-surface`      | `#16191D` | One tier up — section backgrounds                                                                                              |
| `--bg-elevated`     | `#1F242A` | Cards, panels, popover surfaces                                                                                                |
| `--bg-event-tinted` | `#2A1F0A` | LIVE event card background — subtle amber tint, distinguishes event rows from regular play rows (per user feedback 2026-04-22) |
| `--border`          | `#2A2F36` | All hairlines, dividers                                                                                                        |
| `--text-primary`    | `#F1EFEB` | Body — warm off-white, easier on eyes than pure white                                                                          |
| `--text-secondary`  | `#8B9099` | Metadata, secondary copy                                                                                                       |
| `--text-muted`      | `#5C6168` | Timestamps, badges, captions                                                                                                   |

### Light mode (widget when host is light, default for `radiomilwaukee.org/playlist`)

| Token               | Hex                                       | Use                                                                                                                                         |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `--bg-base`         | `#F7F3EE`                                 | Page background — warm off-white (extracted from approved mockup)                                                                           |
| `--bg-surface`      | `#FFFFFF`                                 | Cards, panels                                                                                                                               |
| `--bg-elevated`     | `#FFFFFF` with `border` instead of shadow | Cards (no heavy shadow)                                                                                                                     |
| `--bg-event-tinted` | `#FFF6E0`                                 | LIVE event card background — warm amber wash that says "this is different from a play row" without screaming. Per user feedback 2026-04-22. |
| `--border`          | `#E8E5DE`                                 | Warm hairline                                                                                                                               |
| `--text-primary`    | `#1A1A1A`                                 | Body — deep charcoal                                                                                                                        |
| `--text-secondary`  | `#6B6E73`                                 | Artist, label, secondary metadata                                                                                                           |
| `--text-muted`      | `#94989E`                                 | Timestamps, captions                                                                                                                        |

### Brand-equity colors (constant across modes)

| Token                 | Hex       | Use                                                                                                                                             |
| --------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `--accent-cta`        | `#E84F2F` | Donate, primary CTAs — warm coral-red, RM signature                                                                                             |
| `--accent-cta-hover`  | `#CC3F22` | CTA hover state                                                                                                                                 |
| `--accent-live`       | `#FFB81C` | LIVE event affordance — warm amber, evokes a box-office marquee. Used as accent border, badge color, and basis for the `--bg-event-tinted` wash |
| `--accent-live-hover` | `#E8A50F` | Hover state                                                                                                                                     |
| `--status-ok`         | `#34D399` | Healthy ingestion                                                                                                                               |
| `--status-warn`       | `#FBBF24` | Anomaly, drift                                                                                                                                  |
| `--status-error`      | `#F87171` | Paused, failed                                                                                                                                  |
| `--status-info`       | `#60A5FA` | Informational notices                                                                                                                           |

### Color rules

- **Two accents are distinct.** CTA-red and LIVE-amber must never sit adjacent in conflict. CTA-red is the "donate / urgent action" color. LIVE-amber is the "see them tonight" color. They serve different jobs.
- **Status colors are always paired with text and shape.** Never color-only signaling (a11y).
- **Dark mode is NOT pure black.** Pure black causes eye fatigue in long ops sessions. `#0E0F11` is warm near-black.
- **Light mode is NOT pure white.** `#F7F3EE` is a warm off-white that pairs better with album art (which often has warm tones) than `#FFFFFF`.

## Typography

Three faces, each with a job. **Open-source primary stack** (no licensing required). License-upgrade option documented.

### Primary stack (open-source, ship today)

| Role                                | Font               | Source                                                         | Weights            |
| ----------------------------------- | ------------------ | -------------------------------------------------------------- | ------------------ |
| **Display / H1-H3**                 | **General Sans**   | [Fontshare](https://www.fontshare.com/fonts/general-sans)      | 400, 500, 600, 700 |
| **Body / UI / labels**              | **Geist**          | [Vercel](https://vercel.com/font)                              | 400, 500, 600, 700 |
| **Mono (timestamps, counts, code)** | **JetBrains Mono** | Google Fonts / [JetBrains](https://www.jetbrains.com/lp/mono/) | 400, 500, 700      |

**Loading strategy:** self-hosted via `@fontsource/general-sans`, `geist/font`, `@fontsource/jetbrains-mono` packages. No CDN dependency for fonts (Convex-only network at runtime).

### License-upgrade option (for the future, if budget allows)

| Role    | Font                                                                          | Notes                                                                                           |
| ------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Display | **Söhne Breit** (Klim Type Foundry) or **GT America Condensed** (Grilli Type) | ~$300-500/year web license. Editorial broadcast feel — looks like a record-label printed sleeve |
| Body    | Söhne or GT America (same family as display)                                  | Coherent type system                                                                            |
| Mono    | **Berkeley Mono** (Berkeley Graphics, $75 perpetual)                          | Premium feel                                                                                    |

### Type scale (modular ~1.25)

| Role           | Size / Line-height | Weight  | Use                                             |
| -------------- | ------------------ | ------- | ----------------------------------------------- |
| Display L (H1) | 48px / 1.1         | 700     | Page titles ("88Nine Playlist")                 |
| Display M (H2) | 36px / 1.15        | 600     | Section headings                                |
| Display S (H3) | 28px / 1.2         | 600     | Sub-section headings                            |
| Body L         | 18px / 1.5         | 400     | Intro paragraphs, hero descriptions             |
| Body M         | 16px / 1.55        | 400     | Default reading text                            |
| UI / Label     | 14px / 1.4         | 500     | Buttons, form labels, station names, tab labels |
| Caption        | 12px / 1.4         | 400-500 | Timestamps (mono), badges, micro-text           |

### Numerals

All timestamps, durations, play-counts use **`font-feature-settings: "tnum"`** (tabular-nums). Geist supports it natively. JetBrains Mono is monospace by default.

### Typography rules

- **No system-font defaults as primary.** No Inter, Roboto, Arial, Helvetica, system-ui as a primary stack. They're permitted only as fallback after the named font.
- **No serifs** in editorial UI. Italic (oblique) sans is fine for album-name styling.
- **No more than three faces** loaded simultaneously per page.
- **Display font at body size is forbidden.** Display sizes only — General Sans below 18px loses character.

## Spacing

- **Base unit:** **4px**
- **Density modes:**
  - **Comfortable** (default for widgets): 16-24px between rows, generous breathing room
  - **Compact** (default for dashboard): 8-12px between rows, ops-dense

### Scale

| Token       | Value |
| ----------- | ----- |
| `space-2xs` | 2px   |
| `space-xs`  | 4px   |
| `space-sm`  | 8px   |
| `space-md`  | 16px  |
| `space-lg`  | 24px  |
| `space-xl`  | 32px  |
| `space-2xl` | 48px  |
| `space-3xl` | 64px  |
| `space-4xl` | 96px  |

## Layout

- **Approach:** Hybrid — grid-disciplined for app surfaces (dashboard, widgets), composition-first reserved for any future marketing/about page (none today).
- **Max widths:**
  - Dashboard content: `1440px`
  - Widget on `radiomilwaukee.org/playlist` (host page is RM nav + content): `880px` (single-column reading width)
  - Embeddable widget: respects host container (no fixed max)
- **Grid:** 12-column for dashboard at `desktop+`, 8-column at `tablet`, 4-column at `mobile`.

### Border radius scale

| Token         | Value  | Use                                |
| ------------- | ------ | ---------------------------------- |
| `radius-sm`   | 4px    | Buttons, inputs, badges            |
| `radius-md`   | 8px    | Cards, panels, dropdowns           |
| `radius-lg`   | 12px   | Modal overlays, large surfaces     |
| `radius-full` | 9999px | Avatars, status dots, pill buttons |

**No bubbly uniform radius across all elements.** Each surface uses the radius that fits its role. Album art = `0` (square, respects album-art convention).

## Motion

- **Approach:** **Intentional** — not minimal, not expressive. Motion that aids comprehension and signals state change.

### Easing

- Enter: `ease-out`
- Exit: `ease-in`
- Move: `ease-in-out`

### Duration tokens

| Token        | Value | Use                                    |
| ------------ | ----- | -------------------------------------- |
| `dur-micro`  | 100ms | Hover state changes, color transitions |
| `dur-short`  | 200ms | Live-update fades (new play arrives)   |
| `dur-medium` | 300ms | Tab/section transitions                |
| `dur-long`   | 500ms | Modal entry/exit, page transitions     |

### Specific motion patterns

- **Live update arrival** (Convex subscription): new play row fades in over 200ms `ease-out`. No slide, no jump, no layout shift.
- **Ingestion-health pulse** (dashboard station card): 2-second loop `ease-in-out`, low contrast (10% opacity diff). Visual breathing, not flashing.
- **Tab transitions**: 250ms `ease-out` for the indicator slide; content fades 200ms.
- **No auto-advancing carousels.** Grid-layout widget pagination is manual swipe / arrow buttons.
- **No scroll-jacking, no parallax, no autoplay video, no autoplay audio.**

### Reduced-motion contract

`@media (prefers-reduced-motion: reduce)`:

- All transitions reduce to instant (or 50ms maximum)
- Ingestion-health pulse becomes a static color (`--status-ok` solid, no pulse)
- Live updates appear without fade — instant insertion

## Iconography

- **Style:** Outline-only at default. Filled state on active/selected only.
- **Default size:** 20px (UI icons), 16px (inline-text icons).
- **Library:** [Lucide](https://lucide.dev) (open-source, ~1100 icons, single coherent stroke style). Override sparingly with custom-drawn icons for music-specific concepts (waveform, vinyl, antenna).
- **Color:** Inherit `currentColor`. Status icons get `--status-*` tokens. CTA icons get `--accent-cta`. **No icons in colored circle backgrounds.**
- **No emoji as UI icons.** Emoji is permitted in user-generated content only (custom DJ event notes).

## Component Vocabulary

Defined here so dashboard and widget components share the same vocabulary, even though their stacks differ (Next.js + React for dashboard, Preact for widget bundle).

- **Button** — variants: `primary` (CTA-red), `secondary` (border + bg-elevated), `ghost` (text-only), `live` (amber, only for LIVE event affordances)
- **Card** — variants: `default` (bg-elevated), `event` (`--bg-event-tinted` + amber border-left, the LIVE event interleaved row)
- **Row** — list-item, used for play rows in widget and table rows in dashboard
- **Tab** — horizontal tablist (V1 convention preserved)
- **Badge** — small inline pill, variants: `neutral`, `status-ok`, `status-warn`, `status-error`, `live`
- **Status dot** — 8px filled circle, paired with text label (never color-only)
- **Input** — text inputs, search, date range pickers
- **Toggle** — boolean switch, used for "Auto-update", "Date Search"
- **Skeleton** — loading shimmer, replaces content during initial paint

### Decisions log

| Date                 | Decision                                                                                                                                 | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-04-22           | Initial design system created                                                                                                            | Built via `/design-consultation` after `/plan-design-review` produced 4 design docs grounding IA, states, a11y, and unresolved decisions                                                                                                                                                                                                                                                                                                               |
| 2026-04-22           | Dark + light surface modes (one system)                                                                                                  | Dashboard ops staff need dark; widgets must theme-inherit from host pages, most of which are light                                                                                                                                                                                                                                                                                                                                                     |
| 2026-04-22           | Two-accent split: CTA-red `#E84F2F` + LIVE-amber `#FFB81C`                                                                               | Public-radio convention is one red for everything urgent. Splitting it lets LIVE event affordance earn its own color without competing with Donate CTA                                                                                                                                                                                                                                                                                                 |
| 2026-04-22           | Open-source typography stack (General Sans + Geist + JetBrains Mono)                                                                     | No licensing budget required for MVP. Distinctive enough to not look like a generic SaaS dashboard. License-upgrade path documented                                                                                                                                                                                                                                                                                                                    |
| 2026-04-22           | LIVE event cards get a tinted background (`--bg-event-tinted`), not just an accent bar                                                   | Per user feedback on Variant C: "event should have a different background color to standout slightly"                                                                                                                                                                                                                                                                                                                                                  |
| 2026-04-22           | Warm off-white light mode `#F7F3EE`, warm near-black dark mode `#0E0F11`                                                                 | Pairs better with album art (often warm-toned) than pure black/white. Easier on eyes in long ops sessions                                                                                                                                                                                                                                                                                                                                              |
| 2026-04-22           | Album art larger than public-radio peer convention                                                                                       | RM has high-quality enrichment producing reliable album art. Peers (KCRW, The Current) keep art small or absent. v2 leans into the visual artifact                                                                                                                                                                                                                                                                                                     |
| 2026-04-22 (revised) | **Preview source: Apple Music API** (in-place 30-sec audio in our own `<audio>`) + **deep-link buttons to both Spotify and Apple Music** | Spotify deprecated `preview_url` for new apps after Nov 27, 2024. Spotify Web Playback SDK is premium-only (cuts most listeners). Spotify iframe embed is Spotify-branded (fights editorial design). RM has Apple Developer Program membership, so Apple Music API is no-cost-blocker and gives us reliable in-place previews with full theming control. Spotify enrichment stays for canonical metadata + Spotify deep-link as a secondary affordance |

## Approved Mockups (visual reference)

| Surface                                    | Mockup                                                                                     | Direction                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Operator dashboard home                    | `~/.gstack/projects/rm-playlist-v2/designs/dashboard-home-20260422/variant-B.png`          | Dark Linear/Vercel-aesthetic, amber accent in sidebar, 4-station wall-of-status |
| Widget `now-playing-card`                  | `~/.gstack/projects/rm-playlist-v2/designs/widget-now-playing-card-20260422/variant-C.png` | Light editorial card embedded in host-page chrome, NPR-adjacent                 |
| `playlist` widget on host (system applied) | `~/.gstack/projects/rm-playlist-v2/designs/design-system-20260422/variant-C.png`           | Light mode 88Nine playlist on radiomilwaukee.org with inline LIVE event card    |

## Anti-patterns (never ship these)

- Purple/violet/indigo gradients as a primary or accent color
- 3-column feature grid with icons in colored circles
- Centered hero with happy-talk copy ("Welcome back!", "Discover the magic of...")
- Uniform bubbly border-radius on every element
- Emoji as UI elements
- Colored left-borders on every card (event card is the _one_ exception, by design)
- Generic stock-photo hero sections
- "Powered by" footers in a different visual language than the host
- System fonts as the primary face (Inter, Roboto, Arial, Helvetica, system-ui)
- Pure black `#000000` backgrounds (use warm near-black)
- Pure white `#FFFFFF` page backgrounds (use warm off-white)
- Auto-playing audio or video
- Color-only signaling (status indicators MUST pair color + text + shape)
