# 003 — Watch the ingestion pipeline from Convex, and email on the edges

## Decision

A Convex cron checks every five minutes whether each enabled ingestion source
has polled recently, and emails a configurable list of people once when it
stalls and once when it recovers.

## Why this came up

On 25 August 2026 the Trigger.dev scheduler stopped firing our every-minute
polling job. It ran seven times in five hours and fifty-two minutes instead of
about three hundred and fifty. We recorded roughly 340 fewer songs than a normal
morning, and the 8 AM hour recorded none at all.

Nothing in our code was broken. Every poll that did run finished correctly in
under two seconds. The source (StreamGuys) was healthy the whole time.

What was at stake if we got this wrong: the outage was not discovered by a
system, it was discovered by a person happening to look, almost six hours in.
StreamGuys keeps about seventeen minutes of history, so every minute we stay
unaware is a minute of spins we can never get back — and those spins also feed
the SoundExchange royalty report.

## Options

**1. Add the watchdog to Trigger.dev, next to the existing jobs.**
Cheapest to write; the deploy pipeline already exists. Real cost: it is a smoke
detector wired to the fuse that just blew. The exact failure we are trying to
catch would also silence the catcher.

**2. Run the watchdog on Convex, which is a different vendor on a different
scheduler.** Costs a new `crons.ts`, two small tables, and an email integration.
Real cost: a second place where scheduled work lives, so "where does this run?"
now has two answers instead of one.

**3. Use an external uptime service (Better Stack, Cronitor) pinging a public
health endpoint.** Survives both Convex and Trigger.dev going down. Real cost:
a third vendor, another bill, another login, and a public endpoint to secure —
for a station-sized problem.

## What we chose and why

Option 2. Joint call (Tarik asked for the alert; Claude picked the host).

The load-bearing reason is independence: the watchdog must not share a failure
domain with the thing it watches. Convex is already in the stack, already paid
for, already runs its own scheduler, and already holds the data the check needs
— so it satisfies independence without adding a vendor.

Two supporting choices inside that:

- **The signal is `lastSuccessAt`, not "newest song".** A station can honestly
  go twenty minutes without a new song — an interview, a long set, a live
  remote. `lastSuccessAt` advances every time a poll succeeds whether or not the
  song changed, so it distinguishes "nothing new is playing" from "we stopped
  looking." Only the second is an outage.

- **Email fires on the edges only** — once when it breaks, once when it clears,
  never a reminder in between. An alert that arrives every five minutes for six
  hours gets a mail rule, and a muted alert is worse than no alert.

Threshold is ten minutes of no successful poll, checked every five, so the worst
case is a fifteen-minute delay before anyone is told. Against a six-hour silence,
that is the win.

## What we gave up

- **Scheduled work now lives in two places.** Someone debugging "why didn't this
  run" has to know that ingestion and enrichment are on Trigger.dev while the
  watchdog is on Convex. The comment at the top of `crons.ts` explains why, but
  a comment is not the same as obviousness.
- **Fifteen minutes of blind spot** in the worst case. We could check every
  minute, but that trades real cost for very little — the outages we have seen
  last hours, not minutes.
- **We still only get told, not saved.** This decision detects the hole; it does
  not fill it. Filling it needs Spinitron, which keeps a permanent log rather
  than a seventeen-minute window, and which is a separate decision blocked on
  getting API keys per station.
- **Convex going down takes the watchdog with it.** We accepted that: if Convex
  is down, the dashboard and the widgets are down too, which is loud in a way a
  quiet scheduler is not.
- **A new dependency on Resend** for delivery, and two secrets
  (`RESEND_API_KEY`, `ALERT_EMAIL_FROM`) that must be set on the Convex
  deployment or the alert silently degrades to a log line.

## How we'll know if this was right

- The next scheduler stall produces an email within fifteen minutes of starting,
  and a recovery email when it ends.
- Over three months, nobody creates a mail rule to file these away — that would
  mean we tuned the threshold wrong.
- No false alarm fires during a legitimate long-form show or overnight
  automation block.
- Time-to-discovery for an ingestion outage drops from "whenever someone looks"
  to under twenty minutes.

## What actually happened

<!-- Tarik fills this in later. -->
