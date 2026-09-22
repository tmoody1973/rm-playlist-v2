# 005 — Push each resolved play to NPR Cadence the moment it resolves

**Decision** — When a play finishes enrichment, schedule one small job that posts it into the
on-air episode in NPR Cadence, defaulting to a dry-run that logs the payload without sending.

**Why this came up** — Cadence is NPR's scheduling and music-rights system. Radio Milwaukee
files quarterly SoundExchange reports through it by hand-uploading a file. On 2026-09-11 a
colleague rebuilt the 88Nine schedule in Cadence, so for the first time every hour of the day
has an "episode" (a dated instance of a show) that songs can be attached to. That made a live
feed possible. Getting it wrong means Cadence holds duplicate or mis-timed songs that someone
has to clean up before a quarterly report.

**Options**

1. *Nightly file upload.* Render yesterday's plays as the tab-delimited file the Reports page
   already produces and post it to Cadence's bulk import. Cost: simple, but Cadence's bulk
   import sorts rows into episodes in a background job we can't watch closely, and the day's
   corrections land a day late.
2. *Live push from the enrichment step (chosen).* The function that marks a play "resolved"
   schedules a follow-up job (a Convex action, code that runs after the database write and may
   call the internet). That job finds the episode covering the play's start time and calls
   Cadence's add-song-now endpoint. Cost: one extra HTTP round trip per song, and no way to
   correct a song after it lands, since add-now is append-only.
3. *Live push from the Trigger.dev enrichment task.* Same idea, but wired into the cron worker
   instead of the database layer. Cost: a second dependency on Trigger.dev, which caused the
   August outage, and the push would be skipped for any play resolved by an operator action in
   the dashboard rather than by the cron.

**What we chose and why** — Option 2, decided jointly. Hooking the database-side "resolved"
transition means every path that resolves a play (cron, operator override, backfill) pushes the
same way. Dry-run is the default so the first deploy proves episode matching on real plays with
zero writes to NPR. Only 88Nine pushes for now because HYFIN has no episodes in Cadence yet.

**What we gave up** — Corrections don't propagate; the quarterly file upload stays as the
source of truth for reporting. A retried resolve could push a song twice, since the guard is a
timestamp on the play rather than a lock. We fetch a fresh Cadence token per song instead of
caching one.

**How we'll know if this was right** — After a day in dry mode, the dashboard's event log shows
a `cadence_push_ok` for nearly every resolved 88Nine play with a matching program name, and
`cadence_push_error` only for plays with no duration. After flipping to live, Cadence's public
now-playing widget for WYMS shows the same song our widget does within two minutes.

**What actually happened** —
