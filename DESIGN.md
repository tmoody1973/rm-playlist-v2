---
name: Radio Milwaukee Playlist v2
description: Editorial-broadcast design system for Radio Milwaukee's operator dashboard and embeddable playlist widgets.
colors:
  warm-off-white: "#F7F3EE"
  surface-light: "#FFFFFF"
  event-wash-light: "#FFF6E0"
  border-light: "#E8E5DE"
  text-primary-light: "#1A1A1A"
  text-secondary-light: "#6B6E73"
  text-muted-light: "#6E6C68"
  warm-near-black: "#0E0F11"
  surface-dark: "#16191D"
  elevated-dark: "#1F242A"
  event-wash-dark: "#2A1F0A"
  border-dark: "#2A2F36"
  text-primary-dark: "#F1EFEB"
  text-secondary-dark: "#8B9099"
  text-muted-dark: "#82807C"
  cta-coral: "#E84F2F"
  cta-coral-hover: "#CC3F22"
  live-amber: "#FFB81C"
  live-amber-hover: "#E8A50F"
  status-ok: "#34D399"
  status-warn: "#FBBF24"
  status-error: "#F87171"
  status-info: "#60A5FA"
typography:
  display:
    fontFamily: "General Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "48px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "normal"
  headline:
    fontFamily: "General Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 600
    lineHeight: 1.15
  title:
    fontFamily: "General Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.2
  body-lg:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.02em"
  caption:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  none: "0"
  sm: "4px"
  md: "8px"
  lg: "12px"
  full: "9999px"
spacing:
  "2xs": "2px"
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  "2xl": "48px"
  "3xl": "64px"
components:
  button-primary:
    backgroundColor: "{colors.cta-coral}"
    textColor: "{colors.warm-off-white}"
    rounded: "{rounded.sm}"
    padding: "12px 24px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.cta-coral-hover}"
    textColor: "{colors.warm-off-white}"
  button-live:
    backgroundColor: "{colors.live-amber}"
    textColor: "{colors.warm-near-black}"
    rounded: "{rounded.sm}"
    padding: "12px 24px"
    typography: "{typography.label}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-primary-light}"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
    typography: "{typography.label}"
  card-default:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.text-primary-light}"
    rounded: "{rounded.md}"
    padding: "16px"
  card-event:
    backgroundColor: "{colors.event-wash-light}"
    textColor: "{colors.text-primary-light}"
    rounded: "{rounded.md}"
    padding: "16px"
  badge-live:
    backgroundColor: "{colors.live-amber}"
    textColor: "{colors.warm-near-black}"
    rounded: "{rounded.full}"
    padding: "4px 8px"
    typography: "{typography.caption}"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary-light}"
    padding: "12px 16px"
    typography: "{typography.label}"
    height: "44px"
  tab-active:
    backgroundColor: "transparent"
    textColor: "{colors.text-primary-light}"
  input-search:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.text-primary-light}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
    typography: "{typography.body}"
  status-dot:
    backgroundColor: "{colors.status-ok}"
    rounded: "{rounded.full}"
    size: "8px"
---

# Design System: Radio Milwaukee Playlist v2

## 1. Overview

**Creative North Star: "The Editorial Broadcast"**

This is the visual language of an indie music magazine that grew up listening to NPR. Type drives the hierarchy; album art drives the picture; everything else gets out of the way. The system serves two surfaces, an operator dashboard the music directors use eight hours a day, and embeddable widgets that ride on `radiomilwaukee.org` and partner station pages, but it's one set of tokens, one motion contract, one component vocabulary. Density flips between them, theme flips between them, but the bones are the same.

The personality is **knowing, restrained, distinctly Milwaukee**: a curator who doesn't need to perform, institutional but not stiff, civically grounded in a way that lets it look like Radio Milwaukee instead of like Generic Alternative Public Radio. The deliberate departures from peer stations are catalogued. **Album art bigger** than KEXP / KCRW / The Current convention, because the Spotify enrichment pipeline is reliable enough to lean in. **Two accents split** instead of one red doing both jobs (CTA Coral urges action, LIVE Amber announces presence). **Inline previews** as a first-class affordance, which peer stations don't ship.

This system explicitly rejects: SaaS-dashboard hero-metric templates, three-column feature grids with icons in colored circles, purple / violet / indigo gradients, system-font primary stacks (Inter, Roboto, Arial, Helvetica), centered marketing heroes with happy-talk copy, decorative glassmorphism, and the bubbly-uniform-radius-on-every-element reflex. Older listeners are the audience for the public widgets, not a constraint to plan around.

**Key Characteristics:**

- One system, two surface modes (dashboard compact-dark, widget comfortable-light by default).
- Two distinct accents — coral for CTAs, amber for LIVE — never collapsed into one red.
- Album art square (radius 0); type does the structural work; soft corners are reserved for genuinely soft affordances.
- Reduced motion is a contract, not a polish item.
- WCAG 2.2 AA is the floor on widgets: 13px minimum body, ≥4.5:1 contrast on every text token, 44px tap targets on tab buttons.

## 2. Colors

A warm-tinted, editorial palette: nothing pure black, nothing pure white. Two themes share the same role structure (`bg-base`, `bg-surface`, `bg-elevated`, `bg-event-tinted`, `border`, three text tiers). Four brand-equity colors (CTA Coral, LIVE Amber, status-ok, status-warn) sit constant on top of them.

### Primary

- **CTA Coral** (`#E84F2F`): Donate buttons, primary CTAs, focus indicators. Radio Milwaukee's signature warm coral-red, between marketing-red and editorial-orange. Hover deepens to `#CC3F22`. Contrast: 3.40:1 against `#F7F3EE` light base (passes WCAG AA non-text ≥3:1, used as focus-ring outline); 5.11:1 against `#0E0F11` dark base. Used on ≤10% of any surface. Its rarity is the point.

### Secondary

- **LIVE Amber** (`#FFB81C`): The "see them tonight" color. Box-office marquee warmth. Used as the live-event card border accent, the LIVE pill badge background, and the basis for the `bg-event-tinted` washes. Never adjacent to CTA Coral in conflicting roles. They do different jobs and must read distinctly.

### Neutral, Light Mode (widgets default, `radiomilwaukee.org/playlist`)

- **Warm Off-White** (`#F7F3EE`): Page background. Pairs with album art (which often carries warm tones) better than `#FFFFFF`.
- **Surface** (`#FFFFFF`): Card and panel surfaces. Differentiates from page background by elevation, not by shadow.
- **Border Light** (`#E8E5DE`): Warm hairlines. Replaces shadow on light-mode cards.
- **Text Primary Light** (`#1A1A1A`): Body text. Deep charcoal, not pure black.
- **Text Secondary Light** (`#6B6E73`): Artist, label, secondary metadata. 5.32:1 vs `warm-off-white`.
- **Text Muted Light** (`#6E6C68`): Timestamps, captions. Warm-tilted gray (R≥G≥B). 4.74:1 vs `warm-off-white`. **2026-04-28 a11y-pass replacement** for `#94989E` (which sat at 2.62:1 and failed WCAG AA). Widget + dashboard tokens at parity as of 2026-04-29.
- **Event Wash Light** (`#FFF6E0`): The LIVE event card background. A warm amber wash that says "this is different from a play row" without screaming.

### Neutral, Dark Mode (dashboard default, dark widget hosts)

- **Warm Near-Black** (`#0E0F11`): Page background. Deliberate departure from `#000000`. Pure black causes eye fatigue in long ops sessions.
- **Surface Dark** (`#16191D`): Section backgrounds.
- **Elevated Dark** (`#1F242A`): Cards, panels, popover surfaces.
- **Border Dark** (`#2A2F36`): Hairlines and dividers.
- **Text Primary Dark** (`#F1EFEB`): Body. Warm off-white, easier than pure white in long sessions.
- **Text Secondary Dark** (`#8B9099`): Metadata, secondary copy.
- **Text Muted Dark** (`#82807C`): Captions. Warm-tilted gray, 4.87:1 vs `warm-near-black`. **Replacement** for the original `#5C6168` (3.07:1, FAIL). Widget + dashboard tokens at parity as of 2026-04-29.
- **Event Wash Dark** (`#2A1F0A`): LIVE event card background. Subtle amber tint, distinguishes event rows from play rows.

### Status (constant across modes)

- **Status OK** (`#34D399`): Healthy ingestion.
- **Status Warn** (`#FBBF24`): Anomaly, drift.
- **Status Error** (`#F87171`): Paused, failed.
- **Status Info** (`#60A5FA`): Informational notices.

### Named Rules

**The One Voice Rule.** CTA Coral covers ≤10% of any surface. Overuse softens the donate signal Radio Milwaukee depends on.

**The Two Jobs Rule.** CTA Coral and LIVE Amber are never interchangeable and never sit adjacent in conflicting roles. Coral urges action ("donate", "submit"); amber announces presence ("they're playing tonight"). One red doing both jobs is the public-radio convention this system departs from.

**The No-Pure-Extremes Rule.** No `#000000`, no `#FFFFFF`. Every neutral is tinted toward the warm brand palette so the system feels like an editorial artifact, not a default Tailwind reset.

**The Color-Plus-Shape Rule.** Status indicators always pair color + text + shape (an 8px filled circle next to the text label). Color-only signaling is forbidden. Accessibility mandate, not preference.

## 3. Typography

**Display Font:** General Sans (with `ui-sans-serif`, `system-ui`, `sans-serif` fallbacks).
**Body Font:** Geist (with `ui-sans-serif`, `system-ui`, `sans-serif` fallbacks).
**Mono Font:** JetBrains Mono (with `ui-monospace`, `Menlo`, `monospace` fallbacks).

**Character.** General Sans for headings, geometric and slightly editorial, distinctive without being ornamental. Geist for body, humanist enough to breathe and technical enough to handle data tables. JetBrains Mono for tabular numerals (timestamps, durations, play counts). `font-feature-settings: "tnum"` is enabled globally so even Geist's body figures align in columns.

The widget bundle inherits its display and body fonts from the host page (`--rmke-font-display: inherit`, `--rmke-font-body: inherit`), so the widget feels native on `radiomilwaukee.org` and on partner sites without forcing them to load General Sans. The dashboard self-hosts via `@fontsource/general-sans` and `geist/font` packages with no CDN runtime dependency.

### Hierarchy

- **Display** (700, 48px, line-height 1.1): Page titles ("88Nine Playlist", "Operator Dashboard").
- **Headline** (600, 36px, line-height 1.15): Section headings within the dashboard.
- **Title** (600, 28px, line-height 1.2): Sub-section headings.
- **Body Large** (400, 18px, line-height 1.5): Intro paragraphs, hero descriptions.
- **Body** (400, 16px, line-height 1.55): Default reading text. Cap at 65–75ch.
- **Label** (500, 14px, line-height 1.4, letter-spacing 0.02em): Buttons, form labels, tab labels, station names. Tab buttons specifically were raised from 12px to 14px in the 2026-04-28 a11y pass.
- **Caption** (500, 13px, mono, line-height 1.4): Timestamps, badges, micro-text. **13px is the floor** on widgets. The a11y pass eliminated all 10–12px text from widget surfaces.

### Named Rules

**The 13px Floor Rule.** Widget body text never goes below 13px. Older listeners are the audience; 11px and 12px captions were removed in the 2026-04-28 a11y pass and must not return.

**The Tabular Numerals Rule.** Every timestamp, duration, play count, and date renders with `font-feature-settings: "tnum"` so figures align cleanly in scrolling lists.

**The Three Faces Rule.** Display + body + mono. No fourth family loaded simultaneously per page.

**The No System Font Rule.** System fonts (`Inter`, `Roboto`, `Arial`, `Helvetica`, `system-ui`) are fallbacks only and never sit at the head of the font stack on dashboard surfaces. Widget hosts may override via `--rmke-font-*` and we honor whatever they set.

## 4. Elevation

This system is **flat by default with tonal layering, not shadows.** Light-mode cards differentiate from the page via a 1px warm-hairline border (`border-light: #E8E5DE`); dark-mode cards step up via the surface ladder (`bg-base` → `bg-surface` → `bg-elevated`). Shadows appear only in two places: a subtle ambient drop on the operator dashboard's popover and dropdown menus (so they read as floating above the table they cover), and the implicit elevation that the elevated-dark card token represents.

If you're reaching for a shadow on a light-mode card, the answer is almost always wrong. Bump the border, add a tonal step, or use `bg-event-tinted` for a meaningful color shift instead. The system reads as a print artifact (newsroom CMS, indie record-label sleeve), not as Material Design.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. Tonal stepping conveys hierarchy in dark mode; warm hairlines convey it in light mode. Shadows are reserved for genuinely floating affordances (popovers, dropdown menus).

**The No-Glassmorphism Rule.** Backdrop blur is forbidden as decoration. The system does not lean on the 2014 Material / iOS aesthetic; it leans on print typography and tonal restraint.

## 5. Components

Component vocabulary is shared between dashboard (Next.js + React) and widget (Preact bundle in shadow DOM). The naming and behavioral contract are identical; the implementation differs by stack. A `Button` is a `Button` everywhere.

### Buttons

- **Shape:** Subtly rounded (`radius-sm`, 4px) on dashboard buttons; widget buttons inherit the same. Album art adjacent to buttons stays square (`radius-none`, 0).
- **Primary:** CTA Coral background, warm-off-white label, 12px × 24px padding, label typography (Geist 14/500 with 0.02em letter-spacing). Hover deepens to coral-hover.
- **Live:** Amber background, warm-near-black label. Used **only** for LIVE event affordances, never for generic CTAs. Hover deepens to amber-hover.
- **Ghost:** Transparent background, primary text color, 10px × 16px padding. Used in toolbars, secondary actions, and dashboard table-row controls.
- **Focus:** 2px CTA-coral outline with 2px positive offset on most surfaces; **inset** offset of -2px on tab buttons specifically (so the focus ring isn't clipped by the tablist's `overflow: auto` scroll-fade). `:focus-visible` only. Mouse clicks never paint the outline.
- **Tap target:** 44px minimum height on widget tabs (just-shipped a11y commitment).

### Cards / Containers

- **Default:** `surface-light` (light mode) or `elevated-dark` (dark mode), `radius-md` (8px), 16px internal padding. Differentiation from page background via warm hairline border (light) or tonal step-up (dark). No shadow at rest.
- **Event:** `event-wash-light` / `event-wash-dark` background, same shape, same padding. The interleaved LIVE event row inside a play-list. The user explicitly asked for a tinted background in the 2026-04-22 design-review session: *"event should have a different background color to standout slightly."* This is the one card variant in the system that does not look like the others, and that's by design.
- **Nested cards forbidden.** A card never contains another card.

### Tabs

- **Style:** Horizontal tablist, label typography, 44px minimum height, 12px × 16px padding. Active tab is solid text-primary; inactive is text-secondary. Indicator slide on the bottom edge transitions over 250ms `ease-out`; content cross-fades over 200ms.
- **Mobile:** Horizontally scrollable (`overflow-x: auto`), with a soft right-edge fade hint that more tabs follow.
- **Labels:** Mono uppercase preserved as the visual signature. The 2026-04-28 a11y pass moved label fontSize from 12px to 14px.

### Inputs / Search

- **Style:** `surface-light` background, `border-light` 1px border, `radius-sm`, 10px × 12px padding, body typography.
- **Focus:** 2px CTA-coral outline with 2px offset (same as buttons). No glow, no border-color shift.

### Status Dot + Badge

- **Status dot:** 8px filled circle, `radius-full`, paired **always** with a text label. Status-only dots are forbidden by The Color-Plus-Shape Rule.
- **Live badge:** `live-amber` background, warm-near-black text, `radius-full`, 4px × 8px padding, caption typography.
- **Neutral badges:** Surface-elevated background, text-secondary text, `radius-sm`.

### Album Art (signature component)

- **Shape:** Square. `radius-none` (0). Album art is the visual anchor of the entire widget aesthetic. Its shape is dictated by the artifact (12-inch sleeves, jewel cases, square Spotify art), not by the design system's general roundness scale.
- **Size:** 56px on the now-playing-strip variant; 96px on the now-playing-card variant; 48px on playlist list-item rows; 240px hero on the now-playing-card detail view.
- **Loading state:** Skeleton shimmer in `border-light` color, never a placeholder icon.
- **Missing-art fallback:** Solid `border-light` square with a small typographic mark (the station's slug initial), never a generic music-note SVG, never a stock placeholder image.

### LIVE Event Row (signature component)

The interleaved card that appears mid-playlist when an artist on rotation is performing in Milwaukee tonight. Distinguished by the `event-wash` background tint and a leading `live-amber` left-border accent. **This is the one exception to the "no colored side-stripe borders" rule, by design and after explicit user confirmation in 2026-04-22.** Used nowhere else.

## 6. Do's and Don'ts

### Do:

- **Do** keep CTA Coral at ≤10% of any surface. Its rarity is the donation signal.
- **Do** pair CTA Coral and LIVE Amber as semantically distinct. Coral urges action; amber announces presence.
- **Do** use 13px as the body-text floor on widget surfaces. Widgets are read by older listeners; the 2026-04-28 a11y pass made this binding.
- **Do** hit ≥4.5:1 contrast on every text-on-background pair, ≥3:1 on focus indicators and non-text UI.
- **Do** size widget tab buttons to a 44px minimum height.
- **Do** use `:focus-visible` (not `:focus`), so mouse clicks never paint outlines but every Tab navigation lands somewhere visible.
- **Do** use inset `outline-offset: -2px` on tab buttons inside scroll-clipping tablists. The durable workaround for `overflow: auto` clipping the focus ring.
- **Do** ship reduced-motion as a contract: `prefers-reduced-motion: reduce` collapses transitions to 0ms across all surfaces.
- **Do** load tabular numerals globally via `font-feature-settings: "tnum"` so figures align in lists.
- **Do** let widget surfaces inherit display and body fonts from the host page via `--rmke-font-*: inherit` so the widget feels native on partner sites.
- **Do** keep album art square (`radius-none`). It's the one element exempt from the system's roundness scale.

### Don't:

- **Don't** use `#000000` or `#FFFFFF`. Use `warm-near-black` (`#0E0F11`) and `warm-off-white` (`#F7F3EE`).
- **Don't** use system-font primary stacks (Inter, Roboto, Arial, Helvetica, `system-ui`). They are fallbacks only.
- **Don't** use purple, violet, or indigo gradients as a primary or accent color, anywhere.
- **Don't** ship a hero-metric template (big number / small label / supporting stats / gradient accent). Public-radio operator tools do not look like Stripe dashboards.
- **Don't** ship a three-column feature grid with icons in colored circles. This is the SaaS-landing tell.
- **Don't** use gradient text (`background-clip: text`). Decoration-only, never meaningful.
- **Don't** apply `border-left` (or `border-right`) greater than 1px as a colored stripe on cards or list items. The LIVE Event Row is the one exception, by named exception, and not a precedent.
- **Don't** use bubbly uniform border-radius on every element. Each surface gets the radius that fits its role.
- **Don't** use glassmorphism (backdrop-blur as decoration).
- **Don't** use emoji as UI icons. Emoji is permitted in user-generated content only.
- **Don't** use color-only signaling. Status indicators always pair color + text + shape.
- **Don't** auto-play audio or video of any kind. Listener consent is the rule.
- **Don't** use "Powered by" footers in a different visual language than the host page.
- **Don't** nest cards. A card never contains another card.
- **Don't** drop body text below 13px on widget surfaces.
- **Don't** introduce a fourth font family. Display + body + mono is the budget.

### Resolved drift (2026-04-29)

The two pre-a11y-pass token gaps the audit flagged are now closed:

- `apps/web/app/design-tokens.css` `--text-muted` light → `#6E6C68` (4.74:1), dark → `#82807C` (4.87:1). Dashboard at parity with widget tokens.
- `apps/embed/src/tokens.css` `prefers-color-scheme: dark` auto-fallback → `#82807C`. All three widget theme paths (static dark, static light, auto-following-host) now hit WCAG AA.
