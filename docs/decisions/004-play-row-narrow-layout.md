# 004 — Size the play row against the widget, not the phone

## Decision

The playlist row switches to a stacked layout when the **widget** is 460px wide
or narrower, using a container query (a CSS rule that reacts to the size of a
chosen ancestor element rather than the size of the browser window).

## Why this came up

A listener sent a screenshot of `radiomilwaukee.org/playlist` on their phone.
Song titles were showing as `N..`, `K..`, `L..`. Not shortened. Gone.

Measuring the live page at common phone widths showed how bad it was:

| Phone width | Rows cut off (of 25) | Space left for the title |
| ----------- | -------------------- | ------------------------ |
| 430px       | 3                    | 131px                    |
| 390px       | 12                   | 91px                     |
| 375px       | 13                   | 76px                     |
| 320px       | 19                   | 21px                     |

On a 390px phone, only 91 pixels of 390 reached the song title. The rest went
to the page's own margins, the widget's padding, the album art, the timestamp
and the 44px play button. Rows for songs with no play button looked fine, which
is exactly why this read as a data problem for months rather than a layout one.

What was at stake: the playlist's entire job is telling a listener what they
just heard. A row that says `N..` does not do that, and most of our listeners
are on phones.

The design was never in question. `docs/design/003-responsive-accessibility.md`
section B already specified the mobile play row as "Stacked: art + (track /
artist / time)", and the content-edge-cases table already said a long name
"wraps at word boundary in list layout". Neither was ever built. The real
decision was **what should trigger the switch**.

## Options

**1. A media query on the phone's width, matching the design doc's `<640px`.**
The doc's breakpoint table is written in viewport widths, so this is the
literal reading. Real cost: it measures the wrong thing. The widget is not the
phone. On `radiomilwaukee.org` it renders 350px wide inside a 390px phone
because the page adds its own margins, and a partner station can drop the same
widget into a 400px sidebar on a 1440px desktop, where a viewport rule would
see "desktop" and leave the row broken.

**2. A container query on the widget's own width.** Reacts to the box the row
actually lives in, so both cases above are covered by one rule. Real cost: a
newer CSS feature, and a number (460px) that is not the one written in the
design doc, so the doc and the code now disagree until someone updates the doc.

**3. Buy back pixels without changing the layout.** Halve the padding on
narrow screens, shorten `11:45 AM` to `11:45`, move the play button on top of
the album art. Real cost: it invents a layout nobody approved, it gets the
title to roughly 187px instead of 226px, and moving that button puts the 44px
tap target from the April accessibility pass at risk. Our audience skews older;
that target was deliberate.

## What we chose and why

Option 2. Joint call — Tarik chose "implement the spec", Claude chose the
trigger and the threshold.

The load-bearing reason is that **the widget's width, not the phone's, is what
decides whether a title fits**. Everything competing for that row — art,
timestamp, button, padding — is measured against the widget's box. A rule that
watches a different box is guessing.

Two supporting details:

- **460px is measured, not chosen for roundness.** Title space works out to
  roughly `widget width − 257px` once art, gaps, timestamp and button are
  subtracted. 460px is where a title stops having about 180px to sit in, which
  is what a name like "Black Dog Rabbit Hole" needs.
- **The 44px play button was left alone.** Shrinking it would have been the
  easy 52 pixels, and it would have quietly undone a WCAG fix shipped for
  older listeners on 2026-04-28.

A concern about container queries being too new turned out not to apply. The
`widget-legacy.js` bundle exists because some content management systems strip
`type="module"` from pasted embed code, not because of old browsers. The
browser running it is a current one.

## What we gave up

- **The design doc and the code now disagree on a number.** The doc says
  `<640px` viewport; the code says `≤460px` widget. Section B needs updating,
  and until it is, the next person reading the doc will implement the wrong
  thing.
- **Row layout styling moved out of inline styles into `tokens.css`.** The
  component previously kept everything inline on purpose. A container query
  cannot be an inline style, and an inline style would out-specify the
  stylesheet rule anyway, so a half-and-half version would silently keep the
  broken layout. The widget now has two styling systems instead of one.
- **Narrow rows are taller.** Three lines instead of two, so fewer songs fit on
  screen before scrolling. Reading one title beats glancing at three we cannot
  read.
- **Only the `list` layout was fixed.** The `grid` layout and the live-event
  row were not touched. The live-event row is independently broken on narrow
  screens, verified as pre-existing rather than caused by this change.
- **The regression test is not in CI.** It needs a browser, and CI has none, so
  wiring it up means adding a browser install step to `ci.yml`. Until that
  happens the check only runs when someone runs it by hand.

## How we'll know if this was right

- No listener reports a truncated song title on a phone.
- `bun run test:e2e` in `apps/embed` stays green at 320, 375, 390 and 430, and
  keeps the single-row layout at 1024.
- A partner station embedding the widget in a narrow column gets readable rows
  without asking us for anything.
- Nobody proposes shrinking the play button below 44px to win space back.

## What actually happened

<!-- Tarik fills this in later. -->
