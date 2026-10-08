# 011 — In the NPR log, no song runs past the start of the next one

**Decision** — When the playlist log file is built, each row's length is cut off at the moment
the next row starts, even when the music catalog says the song is longer.

**Why this came up** — After the duration backfill (decision 010) we exported August 2026 for all
four stations and checked every row. Formats, the End − Start = Duration math and time order were
all correct, but 346 to 3,753 rows per station overlapped the next song. The cause: the export
trusts the catalog's length for a song first. That length is often for a different version than
the one that aired. "Got to Give It Up" is 11:52 in the catalog (the album version), but the next
song started 3:56 later; "Get Down (Live Version)" is 20:29 in the catalog and aired for about
4 minutes. Most overlaps were small (crossfades, 1–15 seconds), but about 2,100 rows a month across
the four stations claimed a song played minutes longer than it did. NPR's own rule ("make sure the
math checks out") passed, but the lengths were wrong.

**Options**

1. _Cut at the next row's start when the file is built (chosen)._ A few lines in the file
   formatter. Fixes every station and every month, past and future, with no database changes.
   Cost: a crossfaded song is reported a few seconds shorter than its full length.
2. _Leave it and ask NPR whether overlaps matter._ No work. Cost: about 2,100 rows a month keep
   wrong lengths if they do.
3. _Prefer the measured gap over the catalog length in the database._ More accurate at the source,
   but it changes the live ingest path and needs another backfill, close to the Oct 19 freeze.

**What we chose and why** — Option 1, Tarik's call. The time the next song started is the best
evidence of when this one stopped airing, and the export is the only place the overlap shows. If
the next play starts in the same second, the row keeps a 1-second length rather than none, because
NPR wants a length on every row. (In the August files, no row needed that.)

**What we gave up** — Songs that crossfade lose a few seconds in the report. The catalog length is
still stored and still shown elsewhere in the dashboard, so the two can disagree. The cut uses the
next row in the file, and plays we can't match to a catalog track aren't in the file, so a song
followed by an unmatched play is cut at the next *matched* play instead, which can leave it a bit
long.

**How we'll know if this was right** — Re-exporting any month for any station shows zero rows
whose End Time is after the next row's Start Time (August 2026: 0 of 28,726 rows after the fix),
and NPR's next upload comes back without questions about lengths.

**What actually happened** —
