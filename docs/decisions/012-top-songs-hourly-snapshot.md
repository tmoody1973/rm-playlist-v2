# 012 — The widget's Top 7 / Top 30 charts update hourly, not live

**Decision** — The playlist widget's Top 7 and Top 30 tabs now read a ranking that is recounted
once an hour, instead of recounting every play in the window each time a new song airs.

**Why this came up** — Convex billed us for about 13 GB of database reads a day for this project
starting Nov 12, 2026, up from about 3 GB, with no code change since Oct 22. A 90-second sample of
the live function log (every function call, with how many bytes it read) showed one function,
`plays.topSongsByStation`, doing about 90% of the reading: 37.85 of 41.8 MB. To rank the top 20,
it read every play in the last 30 days for the station (about 12,700 rows, 9.5 MB). The widget
holds a live subscription to it (a standing request that re-runs whenever its data changes), so
each new play, and each enrichment update to that play a few seconds later, re-read the whole
month. That happens only while someone has a Top tab open, which is likely why the cost jumped
on a specific day, for example a tab or kiosk left open or the widget added to a new page. That
cause is a guess; we did not confirm which page or viewer it was.

**Options**

1. _Hourly snapshot (chosen)._ A scheduled job (a cron) counts each station's plays once an hour
   and saves the top 50 for both windows. The widget reads only those rows. Cost: rankings can be
   up to an hour old, plus a new table and job to maintain.
2. _Fetch once instead of subscribing._ A one-line change in the widget. Cost: still 9.5 MB every
   time someone opens the tab, so the bill grows with listener traffic.
3. _Running tally._ Add 1 to a per-song counter on each play and age out old plays daily. Lowest
   reads. Cost: the most code, and counts can drift from the real playlist if any step fails.

**What we chose and why** — Option 1, Tarik's call on Claude's recommendation. A 30-day chart that
lags by an hour looks the same to a listener, and the cost no longer depends on how many people
open the tab. Only the ranking is cached: each row's artwork, album and links are still looked
up live, so enrichment that finishes mid-hour still shows. If no snapshot exists yet (the first
hour after deploy), the query falls back to counting live, so the tab is never empty. The staff
Reports page uses the same function and now gets the hourly ranking too.

**What we gave up** — A song that airs heavily in the last hour won't climb the chart until the
next refresh. The refresh still reads about 9.5 MB per busy station every hour (under 1 GB a day
in total at today's play volume), so it is cheaper, not free. A play deleted mid-hour drops off
the chart and leaves it one row short until the next refresh.

**How we'll know if this was right** — After deploy, a fresh 90-second log sample shows
`plays.topSongsByStation` reading under 1 MB, and the Convex usage chart for rm-playlist-v2 falls
back toward ~3 GB a day within two days.

**What actually happened** —
