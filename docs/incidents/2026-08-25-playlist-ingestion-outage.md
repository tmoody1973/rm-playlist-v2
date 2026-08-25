# Playlist outage — Tuesday, August 25, 2026

*Written for the whole team. No engineering background needed.*

## The short version

For about six hours this morning, the playlist stopped writing down the songs
we played. The songs still went out over the air. We just did not record them.

We lost roughly **340 songs** across all four stations.

Nothing was hacked. No data was deleted. We simply stopped taking notes.

## What you would have seen

The "now playing" strip and the playlist page were stuck on an old song. If you
looked at a station page at 9:00 AM, it may have been showing something that
played at 5:20 AM.

## How the playlist normally works

Think of it as three pieces:

1. **The source.** StreamGuys (our stream host) knows what is playing right now
   on each station. It answers the question "what's on?"
2. **The note-taker.** A small program asks StreamGuys "what's on?" once every
   minute, and writes the answer in our database.
3. **The alarm clock.** A service called Trigger.dev rings once a minute and
   tells the note-taker to go ask.

## What broke

**The alarm clock stopped ringing.**

At 5:18 AM it went quiet. Between 5:18 AM and 11:10 AM it rang only seven times
instead of about 350 times. At 11:10 AM it started ringing normally again on
its own.

The source was fine the whole time. The note-taker was fine the whole time —
every single time it was woken up, it did its job in under two seconds and
recorded the song correctly.

We were not broken. We were asleep.

## Why we lost the songs for good

StreamGuys only tells you what is playing **right now**. It keeps about
seventeen minutes of history and then forgets. It is a window, not a logbook.

So when we sleep through six hours, those six hours are gone. There is no
"catch up" button. We checked our old V1 system as a possible backup — that
database no longer exists.

## What it cost us

| Hour (Central) | Songs recorded | Normal |
|---|---|---|
| 4:00 AM | 68 | ~65 |
| 5:00 AM | 21 | ~65 |
| 6:00 AM | 12 | ~65 |
| 7:00 AM | 5 | ~65 |
| 8:00 AM | 0 | ~65 |
| 9:00 AM | 4 | ~65 |
| 10:00 AM | 11 | ~65 |
| 11:00 AM | back to normal | ~65 |

Roughly 340 missing spins.

This also means our **SoundExchange royalty report** for August 25 will be
short by those spins. That matters and we should flag it before we file.

## Why it probably happened

Our Trigger.dev account was on the free plan. Running two jobs every minute,
all month, costs almost exactly what the free plan gives you. We were sitting
right on the ceiling. When you go over, the service throttles you — which looks
exactly like an alarm clock that rings only occasionally.

Tarik upgraded the plan to $10/month at 11:20 AM. We are watching to confirm
that was the cause.

## The real problem is not the outage

It is that **nobody knew for six hours.** We found out because a person
happened to look. That is the part we are fixing.

## What we are changing

1. **An alarm on the alarm clock.** A separate watchdog, running on a different
   service (Convex, not Trigger.dev), checks every five minutes whether we are
   still taking notes. If we have not recorded anything for ten minutes, it
   emails a list of people. It emails again when things recover.

   The watchdog deliberately runs somewhere else. A smoke detector wired to the
   fuse that just blew is not a smoke detector.

2. **A real logbook as a backup.** Spinitron — which some of our stations
   already use — keeps a permanent record of every spin, not a seventeen-minute
   window. If we hook it up, a future outage becomes a *delay* instead of a
   *hole*: we can go back and ask "what did we miss between 5 and 11?" and fill
   it in. This needs API keys from Spinitron.

## Open questions for the team

- Which of our four stations actually log spins in Spinitron today?
- Who should receive the outage emails?
- Do we need to correct or annotate the August 25 SoundExchange report?
