# 010 — Give every play a length for the NPR log, estimating when we can't measure it

**Decision** — When we can't measure how long a song aired, store an estimate on the play, label
it "estimated", and show it to staff to correct, instead of leaving the length blank.

**Why this came up** — NPR's music-rights playlist log needs an End Time or a Duration on every
row, and rejects rows without one. Most of our feeds (SGmetadata for 88Nine, HYFIN and 414 Music)
report when a song started but not how long it is, and local releases are often missing from
every music catalog. Since 2026-09-22 we measure a song's length as the gap until the next song
starts (an "observed" length), but until now we refused to trust a gap shorter than 30 seconds or
longer than 8 minutes, since that usually means a glitch or a talk break. Those plays, and everything from
before 2026-09-22, still had no length: in June through September that was roughly 26–40 rows a
month on 88Nine and HYFIN and 113–307 a month on Rhythm Lab and 414 Music. Each one is a row NPR
bounces back.

**Options**

1. _Leave them blank and have staff fill each one in by hand._ Cost: hundreds of manual entries
   a month on the two eclectic stations, and the report is late until someone does it.
2. _Estimate, and flag the estimate (chosen)._ Any gap up to 8 minutes is the length, even a very
   short one: a song cut off after 12 seconds aired 12 seconds. Only a longer gap, usually a talk
   break, gets an estimate: the middle value (median) of the lengths we already know for that same
   song, failing that 210 seconds, a typical song. No estimate is allowed to run past the next
   song's start, so rows never overlap. Cost: some rows carry a length that is a guess, possibly
   off by a minute or more.
3. _Pull lengths from a music catalog for every song._ Cost: the songs missing lengths are mostly
   the ones no catalog has, so this doesn't close the gap. (The existing "Auto-fill from Apple
   Music" button already covers the songs that are in Apple's catalog.)

**What we chose and why** — Option 2, Tarik's call. NPR needs a number on every row, and a
same-song median is usually within seconds of the truth. Labelling each guess "estimated" keeps it
honest: the report preview counts estimated rows separately, and Needs Attention lists the affected
tracks as "duration (estimated)" so staff can enter the real length, which then replaces the
guess in every export. The historical backfill runs as a dry run first (it counts what it would
change and writes nothing), so we see the size of the change before committing to it.

**What we gave up** — Some submitted rows will be wrong by an unknown amount until someone
corrects them. A metadata glitch (a wrong title that flashed up for a few seconds) is logged as a
few-second play instead of being dropped. Two plays stamped in the same second can't both get a
length without overlapping, so the earlier one stays blank for staff to look at. NPR Cadence (the live feed, decision 005) can't be corrected after
the fact, so a song pushed before its estimate existed keeps Cadence's own 180-second placeholder.

**How we'll know if this was right** — After the backfill, the report preview shows
`missing duration: 0` for every station and month since 2026-06-08, NPR accepts the next quarterly
upload without bounced rows, and the `estimated duration` count shrinks as staff correct tracks.

**What actually happened** —
