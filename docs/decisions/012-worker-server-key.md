# 012 — Our workers prove who they are with a shared key before they can write

**Decision** — The ten database functions that only our background workers should call now check
a secret key, `INGEST_SERVER_KEY`, that only those workers hold. It rolls out in three stages so
the playlist never stops recording while the workers are being given the key.

**Why this came up** — The October 2026 security audit found that anyone could write to the
playlist database. The database address isn't a secret: the listener widget has to contain it to
work, so it ships inside every page that embeds the widget. Ten functions behind that address
accept writes from the workers (the jobs that poll stations, look up song details, fetch
concerts, and refresh the Apple Music token), and none of them checked who was calling. Someone
who read the address out of the widget could add fake plays, which are the station's royalty
record sent to NPR and SoundExchange. They could also rewrite song details or concert listings,
or replace the Apple Music token so song lookups break. Code comments had said "add a shared
secret before partner stations go live" since April.

**Options**

1. _A key passed with every write (chosen)._ Each worker sends the key along with its data, and
   the database compares it with its own copy. This is the pattern the Finds functions already
   use with Radio Commons (decision 008), so the check itself is reused, not new. Cost: the key is
   one more secret to keep in three places (the database, Trigger.dev, and the Fly server), and
   every worker call site has to send it.
2. _Move the writes behind a web address that checks a password header._ Workers would send
   ordinary web requests instead of database calls, and the database functions would become
   private. That's a little cleaner, because the key travels in a header rather than with the
   data. Cost: it rewrites every worker call, roughly double the change for the same protection.
3. _Make the functions private and give the workers the database's deploy key._ Least code. But
   the deploy key can also replace the database's code, so a leak from any worker would hand over
   the whole system. Rejected.

**What we chose and why** — Option 1, Claude's recommendation, pending Tarik's approval. It
matches a pattern already in the codebase and already reviewed. It's also the only option that
can be switched on gradually.

It uses a *new* key rather than reusing Radio Commons' key, because that key lives in the
listener apps, and a leak there shouldn't let anyone forge plays.

The rollout works in three stages, because of the 2026-04-24 outage: the database rejects any
field it doesn't expect, so a worker that starts sending the key before the database knows about
it takes ingestion down.

1. The database *accepts* a key. A wrong key is refused. A missing key is still allowed, but each
   one is written to the log.
2. The key is set in the database first, then in Trigger.dev, then on the Fly server. The log
   shows when every worker is sending it.
3. Once the log shows each worker function has stopped arriving without a key for a full day, a
   missing key is refused too. The gate is per function, matched against when each worker
   runs, not "zero keyless calls", because anyone can send keyless calls on purpose to keep that
   count above zero.

Two functions are deliberately left open:
- **The widget's preview lookup.** It runs in listeners' browsers, which can't hold a secret, and
  it only acts on songs already in the database.
- **Reading the Apple Music developer token.** Apple designs that token to ship to browsers, and
  Radio Commons' "connect Apple Music" page reads it. Overwriting it does need the key.

The dashboard's "add an event" form writes concerts without a key. It is allowed because the
person using it is signed in as Radio Milwaukee staff (the same staff check as the rest of the
dashboard).

**What we gave up**
- **Three copies of one secret.** Rotating it means updating three places in the right order.
- **The key travels with the data.** It's sent inside each request's data rather than in a
  header. Convex doesn't record request data in normal logs, but when a call fails its argument
  check (the 2026-04-24 kind of failure), the error message repeats the arguments, key included.
  If that ever happens, rotate the key.
- **A one-day window.** Until stage 3, a keyless write still works, so the hole stays open about
  a day longer than a single cut-over would leave it.
- **No rate limit.** If the key ever leaks, nothing caps how fast someone could write. A per-source
  limit on stream plays is noted in the code as the next step.

**How we'll know if this was right**
- **During the rollout, ingestion never stops.** Plays keep arriving every few minutes, and enrichment
  shows `resolved` counts, not errors.
- **Before stage 3, the switch-over is complete.** For 24 hours, the Convex logs show no
  `[ingest-key] unkeyed call` line from a worker's own schedule, checked function by function.
- **After stage 3, outsiders are refused.** A test write without the key, from outside the
  workers, returns `Unauthorized`.

**What actually happened** —
