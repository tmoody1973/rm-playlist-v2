# Product

## Register

product

## Users

**Internal — Operator dashboard.** Radio Milwaukee music directors and ingestion ops staff. Context: dashboard open in a browser tab during the workday, often for long stretches. Need to scan ingestion health across four streams (HYFIN, 88Nine, Rhythm Lab, 414 Music) and act on anomalies — paused ingestion, enrichment failures, missing label data. Job to be done: keep playlist data flowing and accurate without daily firefighting; trust the pipeline enough to stop watching it.

**Public — Embeddable widgets.** Radio Milwaukee listeners and partner-station listeners. Audience skews older (the public-radio reality), so WCAG 2.2 AA accessibility is mandatory rather than aspirational; older eyes, varying device fluency. Context: widget appears on `radiomilwaukee.org` or partner station pages, often embedded mid-page within content. Job to be done: see what's playing now, browse what played recently, occasionally preview a song they don't recognize.

**Future — Partner stations.** Other public-radio stations adopting RM's widgets on their own sites. Treated as brand ambassadors of RM (not just consumers of data), which is why widget surfaces on partner pages are a brand-mode override even though the rest of the system is product-mode.

## Product Purpose

Surface live playlist data, ingestion health, and reporting for Radio Milwaukee's four streams. The dashboard is an operator tool; the widgets are public-facing artifacts that have to feel native to the host page (`radiomilwaukee.org` or partner site) while staying recognizably Radio Milwaukee. Single-tenant by design: multi-tenancy is forward-compatible in the schema but deferred until external station demand proves out.

Success looks like ingestion running unattended for weeks, anomalies surfacing in the Needs Attention panel before listeners notice them, widgets rendering correctly on partner sites without custom CSS overrides, and older listeners reading every timestamp and tapping every button without friction.

## Brand Personality

**Knowing, restrained, distinctly Milwaukee.**

Voice: an experienced curator who doesn't need to perform. Quietly opinionated about the music; institutional but not stiff. Editorial-broadcast tone, an indie music magazine crossed with NPR's restraint. Civic identity matters: this is a Milwaukee artifact, not a generic alternative-public-radio template, and the design should differentiate from KEXP, KCRW, and The Current rather than imitate them.

Emotional goals: trust (the data is right), recognition (this looks like Radio Milwaukee, not a SaaS dashboard), calm (operators don't dread opening it; listeners don't feel sold to).

Not: corporate, playful, breathless, urgent-by-default, generically alternative.

## Anti-references

- **Generic SaaS dashboards.** Linear/Vercel-aesthetic borrowed visuals are fine as a starting point, but RM is a public-radio operator tool, not a developer tool. No hero-metric template (big number, small label, supporting stats, gradient accent). No three-column feature grids with icons in colored circles.
- **Centered marketing heroes** with happy-talk copy ("Welcome back!", "Discover the magic of..."). Operator screens go straight to data; public widgets go straight to the playlist.
- **Public-radio template clichés.** Purple, violet, or indigo gradients. System-font primary stacks (Inter, Roboto, Arial, Helvetica, system-ui). Generic stock photography. "Powered by" footers in a different visual language than the host.
- **Decorative blobs, gradients, glassmorphism, gradient text.** Anything that says "an AI made that landing page in 2024."
- **Color-only signaling.** Status indicators always pair color + text + shape. Accessibility mandate, not preference.
- **Auto-playing audio or video** of any kind. Listener consent is the rule.
- **Bubbly uniform border radius** on every element. Each surface uses the radius that fits its role; album art is square.

## Design Principles

1. **Older listeners aren't a constraint, they're the audience.** WCAG 2.2 AA is the floor, not the ceiling. 13px minimum body text on widgets, ≥4.5:1 contrast on every text token, ≥3:1 contrast on focus indicators, 44px tap targets on every interactive button, plain language over clever copy. The public-radio audience skews older; designing well for them designs well for everyone.

2. **Album art carries the picture, typography carries the hierarchy.** Spotify enrichment is reliable, so we lean in: large album art is the visual artifact. Everything else is handled by type — General Sans for display, Geist for body, JetBrains Mono for tabular numerals. No icons-in-colored-circles, no decorative gradients, no hero illustrations. The music does the visual work.

3. **Public-radio convention, not SaaS template.** Every PR gets measured against this: does it look more like KEXP, KCRW, The Current, or MPR — or like a Vercel landing page? RM's lane is editorial broadcast, not developer-tool minimalism. When in doubt, make the choice an indie music magazine art director would make.

## Surface modes (register override)

PRODUCT.md's default register is `product`, but partner-site widgets behave like brand artifacts. When a task touches:

- `apps/web/app/dashboard/**` → register: **product** (operator tool, design serves the data).
- `apps/embed/src/**` rendered on RM-owned pages (`radiomilwaukee.org`, `apps/web/app/embed/**`) → register: **product** (data display, host-respectful).
- `apps/embed/src/**` rendered on partner station sites → register: **brand** (RM ambassador role; stronger visual identity, lower data density tolerance, more attention to "this is Radio Milwaukee, not a generic playlist" feel).

The shared color palette, type scale, motion contract, and component vocabulary apply to both modes. Density (dashboard compact, widget comfortable), default theme (dashboard dark, widget light), and ownership (dashboard owns its space, widget defers to host page typography via shadow-DOM custom-property piercing) are the per-mode differentiators.

## Accessibility & Inclusion

- **WCAG 2.2 AA** is the floor for all public surfaces (widgets) and aspirational for the dashboard.
- **Older-listener readability.** 13px body floor on widgets, ≥4.5:1 contrast on every text-on-background pair, ≥3:1 contrast on focus indicators, 44px minimum tap targets on widget tab buttons. The recently-shipped a11y pass (PR #30, commit `0199a7c`) raised text-muted contrast and lifted tab `fontSize` to 14px; future work must not regress these values.
- **Reduced-motion contract.** `prefers-reduced-motion: reduce` collapses all transitions to ≤50ms, replaces the ingestion-health pulse with a static color, removes the live-update fade. Already documented in DESIGN.md "Motion".
- **Keyboard-first.** Every interactive element reachable via Tab, with a visible `:focus-visible` ring (≥3:1 contrast against its surround). Tab-trap modals are forbidden. Tab-specific inset `outline-offset: -2px` is the durable pattern for focus rings inside scroll-clipping tablists.
- **No color-only signaling.** Status indicators always pair color + text + shape. Status dots are 8px filled circles paired with a text label.
- **Plain language.** Avoid jargon in widget copy. The operator dashboard may use ops-language ("ingestion drift", "enrichment lag") since the audience is internal; widget copy may not.
