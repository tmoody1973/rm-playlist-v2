# 013 — Widget search looks back two weeks and reads only matching plays

**Decision** — The playlist widget's text search uses the existing `search_text` search index
and covers the last 14 days unless the listener picks a date range.

**Why this came up** — After decision 012 fixed the Top charts, widget search was the largest
remaining database cost. It asks for up to 500 results, so every search read the latest 2,500
plays (about 1.9 MB), checked each one's artist and title in code, and repeated that every time
a song aired while the search stayed open. One minute with a listener searching read 9 MB.

**Options**

1. _Search index plus a 14-day default (chosen)._ Reads only plays whose words match, in the
   last two weeks. Cost: matching is by whole word, with the last word allowed to be a start
   ("simz" finds Little Simz, "imz" does not).
2. _Keep scanning, but only the last 14 days._ No matching change. Cost: 14 days of 88Nine is
   about 5,900 plays, more than today's 2,500-row scan, so this costs more, not less.
3. _Search index over all history._ Same reads per match, but popular words ("love") match
   far more plays.

**What we chose and why** — Option 1. Tarik asked to keep search to one or two weeks to save
money; the index is what makes that cheap. Tested read-only on live 88Nine data: "simz" read
5 rows instead of 2,500, "love" 272 instead of 2,500, "st. paul" 96 instead of 2,500, and each
found more songs because two weeks is longer than the 5.6 days the old scan reached.

**What we gave up** — Searching letters inside a word no longer works (one of 67 "love" matches
was lost in testing). Plays older than the search field backfill (about mid-August 2026) cannot
be found by text, even with a date range, until that backfill is run further back. Searches
for very common words read up to 200 candidates per two-week bucket.

**How we'll know if this was right** — A log sample during a search shows
`plays.searchByStation` reading a few hundred rows at most, and no listener reports that a
recently played song can't be found.

**What actually happened** —
