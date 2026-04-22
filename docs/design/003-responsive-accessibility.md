# 003 — Responsive & Accessibility

**Date:** 2026-04-22
**Status:** Accepted (from /plan-design-review Pass 6)
**Depends on:** `001-information-architecture.md`, `002-interaction-states.md`

## Principle

Accessibility is built in, not gated at Week 7. Every surface specifies viewport behavior, keyboard navigation, screen-reader semantics, touch targets, and contrast requirements at design time. The Week 7 axe-core gate becomes a verification step, not a discovery step.

## Public radio audience reality

RM's audience skews older than typical web product audiences. CPB underwrites public radio in part because of accessibility-of-information mandates. Listeners include people with low vision, motor differences, screen-reader users navigating from radiomilwaukee.org. **Widgets being inaccessible is not just a code smell — it conflicts with public-media charter.**

## Viewport breakpoints (project-wide)

| Breakpoint | Range | Primary contexts |
|------------|-------|------------------|
| `mobile` | <640px | Phone portrait |
| `tablet` | 640-1023px | Phone landscape, tablet portrait |
| `desktop` | 1024-1439px | Tablet landscape, small laptop, embed in narrow article column |
| `wide` | ≥1440px | Full laptop, external monitor, dashboard primary use |

Widgets are tested against ALL four. Dashboard's required floor is `desktop` (operators are at desks); `tablet` and `mobile` should degrade gracefully but not be the optimization target.

## A. Operator dashboard responsive behavior

| Region | Wide (≥1440) | Desktop (1024-1439) | Tablet (640-1023) | Mobile (<640) |
|--------|--------------|---------------------|--------------------|---------------|
| Sidebar | Full icon nav, persistent | Persistent | Collapses to top hamburger menu | Top hamburger menu |
| Top bar | Full | Full | Full | Logo + role indicator only |
| Station card row | 4-up grid | 4-up grid (cards narrow) | 2x2 grid | 1-up stacked |
| Reports + Needs Attention | Side-by-side | Side-by-side | Stacked, Reports first | Stacked, Reports first |
| Upcoming from rotation | 2-column | 2-column | 1-column | 1-column |

**Mobile-specific concession:** the dashboard at <640px is "use it in a pinch on a phone, not a primary surface." If the music director needs to fix something on the road, it works. We don't add mobile-only features.

## B. Widget `playlist` — list layout responsive

| Element | Wide | Desktop | Tablet | Mobile |
|---------|------|---------|--------|--------|
| Tab row | Horizontal full-width | Horizontal | Horizontal scrollable | Horizontal scrollable |
| Search input | Full-width | Full-width | Full-width | Full-width |
| Date filter | Inline with search | Inline | Below search | Below search |
| Play row | Single row, all metadata | Single row | Single row, label may truncate | Stacked: art + (track / artist / time) |
| Inline concert card | Full-width inset | Full-width inset | Full-width inset | Full-width inset, smaller padding |
| Load more | Centered button | Centered | Centered | Full-width |

## C. Widget `playlist` — grid layout responsive

| Element | Wide | Desktop | Tablet | Mobile |
|---------|------|---------|--------|--------|
| Cards per row | 4 | 4 (narrower) | 2 | 1, swipeable |
| Card art ratio | 1:1 | 1:1 | 1:1 | 1:1 |
| Card metadata under art | Full | Full | Truncate album field | Track + artist only |
| Tab row | Same as list | Same | Same | Same |

## D. Widget `now-playing-card` responsive

Already designed mobile-first in the approved Variant C mockup. Mobile shows the same card with smaller padding; album art stays at 64-88px depending on width. The LIVE row stays visible on mobile — it's the differentiator.

## E. Widget `now-playing-strip` responsive

Single row at all viewports. On mobile narrow widths, truncates artist or track with ellipsis (NEVER hides the LIVE indicator dot). Designed to fit the smallest possible host slot.

## Keyboard navigation

### Dashboard

- `Tab` cycles primary regions: top bar → sidebar nav → main content row 1 → row 2 → row 3.
- Within station card row: arrow keys move between cards. `Enter` opens the focused station's detail view.
- Within Needs Attention: arrow keys move between items. `Enter` triggers the item's primary action.
- Generate Report button is reachable in a single Tab from the wall-of-status row.
- All inline-edit affordances (override panels) trap focus until commit/cancel.

### Widgets

- `playlist` widget tab row: arrow keys cycle tabs (standard tablist pattern). `Tab` exits to next focusable in host page.
- Play rows: focusable. `Enter` triggers preview if available. `Shift+Enter` deep-links to Spotify.
- Search input: `Esc` clears the search.
- Inline concert cards: focusable. `Enter` follows the ticket link.
- `now-playing-card`: focusable as a unit. `Tab` into card focuses the LIVE row's ticket link if present.

## ARIA semantics

### Dashboard

- Top bar: `role="banner"`, contains app title and user menu.
- Sidebar nav: `role="navigation"`, `aria-label="Primary navigation"`.
- Main: `role="main"`. Each row is a `section` with an `aria-label`.
- Station cards: `role="article"` with `aria-labelledby` pointing to the station name.
- Status dots: `role="status"` with `aria-label` describing health (e.g. "HYFIN ingestion healthy, last poll 3 minutes ago").
- Live updates: station cards are inside an `aria-live="polite"` region so screen readers announce track changes without interrupting.
- Needs Attention: `role="region"`, `aria-label="Items needing attention"`. List inside is `role="list"`.

### Widgets

- `playlist` widget root: `role="region"` with `aria-label="<station> playlist"`. Hosts can override the label.
- Tab row: standard `role="tablist"`, each tab `role="tab"`, panel `role="tabpanel"` with `aria-labelledby`.
- Play list: `role="list"`, each row `role="listitem"`. Live update region: `aria-live="polite"`, `aria-atomic="false"`.
- Inline concert card: `role="article"` with descriptive `aria-label`.
- Search input: standard `<input type="search">` with explicit `<label>` (visually hidden if needed).
- Preview button: `<button aria-label="Preview <track> by <artist> on Spotify">`.

### Live update announcements

When a new track plays, the station card's `aria-live="polite"` region announces "Now playing on HYFIN: <track> by <artist>". Frequency cap: max 1 announcement per 30 seconds per station to avoid screen-reader spam during rapid play sequences.

## Touch targets

- All clickable elements ≥ 44x44px tactile target (per WCAG 2.5.5). Visual size can be smaller; tap area must meet floor.
- Inline icon-only buttons (e.g. dashboard sidebar) get padding to reach 44px even when the icon glyph is 20px.
- Compact widget rows (`now-playing-strip`) have a generous full-row tap area, not just the text.
- Tab row tabs have ≥ 44px height on touch devices.

## Color contrast

- Body text ≥ 4.5:1 against background (WCAG AA). Large text (18px+ or 14px+ bold) ≥ 3:1.
- Status indicator color is NEVER the only signal — green/amber/red are paired with text labels ("healthy" / "degraded" / "paused") and tooltips.
- Focus rings ≥ 3:1 against adjacent colors. Focus ring NEVER hidden — the `outline: none` CSS is forbidden across the codebase. Visible focus rings are the keyboard-user equivalent of a cursor.

## Motion + reduced-motion

- Default transitions: 200ms ease for fades, 250ms ease for tab/section transitions.
- `prefers-reduced-motion: reduce` query: all transitions reduce to instant or 50ms; the ingestion-health pulse is replaced with a static color.
- No auto-advancing carousels in any widget. The grid layout's "next 4 cards" is a manual swipe / arrow-button advance.
- No parallax, no scroll-jacking, no autoplay video, no autoplay audio.

## Spotify preview audio

- Always user-initiated (tap/click). NEVER autoplay on hover, on widget mount, or on tab focus.
- Volume: defer to system / browser default (~50%). Not max.
- Visible STOP control while a preview is playing.
- Subtle "now previewing" indicator in the playing row so user knows what's making sound.

## Error/recovery affordances

- Every error state has a keyboard-reachable recovery action (no clicking-only "retry" links).
- Form errors place `aria-describedby` linking the field to its error text.
- Connection-lost banner is `aria-live="polite"` so it's announced once, not repeated.

## Content edge cases

| Edge | Behavior |
|------|----------|
| Artist name 47+ chars | Wraps at word boundary in `list` layout; truncates with ellipsis + tooltip in `now-playing-strip` |
| Non-Latin script (Korean/Japanese pop on HYFIN) | Renders correctly with system fallback fonts; no romanization fallback |
| Right-to-left scripts | Mirror the layout via CSS logical properties from day one (cheap when designed for, painful to retrofit) |
| Missing album art | Muted music-glyph placeholder (NOT a broken image icon) |
| Track has no Spotify ID | Preview button absent (graceful absence, not disabled state) |
| Show name in 88Nine schedule >40 chars | Wrap, don't truncate (schedule is informational) |

## Verification gates

| Gate | Check | When |
|------|-------|------|
| Storybook a11y addon | All components pass axe in isolation | Per-component CI |
| axe-core full-page audit | Dashboard + every widget + embed generator | Per-PR CI |
| Keyboard-only manual smoke | All flows runnable without mouse | Pre-shakedown release |
| Screen reader pass (NVDA + VoiceOver) | All flows narrate sensibly | Pre-shakedown release |
| Contrast audit | Real CSS tokens checked against AA | Per-PR CI (linter) |
| Reduced-motion test | `prefers-reduced-motion` honored everywhere | Pre-shakedown release |

## Rating recovery

**Rating after fix: 9/10.**

Remaining 1 point: live screen-reader testing with actual NVDA / VoiceOver users from RM's listener community. Recommend pre-launch as part of shakedown. Logged as TODO.
