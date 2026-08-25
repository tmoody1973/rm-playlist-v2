---
title: The morning the playlist slept
date: 2026-08-25
author: Tarik Moody
audience: Radio Milwaukee staff, the public-radio community, and anyone who runs a system that has to keep taking notes
---

# The morning the playlist slept

On Tuesday morning our playlist stopped writing down the songs we played.

The radio was fine. Four streams went out over the air the way they always do,
Dori Zori at six, Anthony Foster after that, nothing off about any of it. But
the thing behind the scenes whose only job is to write down what played had
gone quiet at 5:18 in the morning, and it stayed quiet until 11:10. Almost six
hours, roughly 340 songs, and the 8 AM hour recorded nothing at all.

Nobody knew until I looked.

## How the thing actually works

There are three pieces, and it helps to think of them as people.

There's a source, StreamGuys, the company that hosts our streams. It knows
what's playing right now on each station. Ask it and it tells you.

There's a note-taker, a small program that asks StreamGuys "what's on?" and
writes the answer into our database.

And there's an alarm clock, a service called Trigger.dev, whose entire job is
to ring once a minute and tell the note-taker to go ask.

The alarm clock stopped ringing.

## Every run said Completed

My first guess was that something had broken. It usually is. So I went looking
for errors, and there weren't any.

That's the detail I keep coming back to. When I pulled up the list of times the
note-taker had run, every single run said Completed. Every one finished in
under two seconds. Clean.

There just weren't very many of them.

```
11:15, 11:14, 11:13, 11:12, 11:11, 11:10   every minute, healthy
10:47, 10:46                                then 23 minutes of nothing
10:17, 10:16                                then 29 minutes of nothing
 9:02                                        then 74 minutes of nothing
```

Between 5:18 and 11:10 it ran seven times. It should have run about 350.

The jobs weren't failing. They weren't starting. Those are different problems
with different answers, and I'd have burned the whole morning hunting for a bug
in code that was working perfectly.

Then I checked our other background job, the one that goes and finds album art.
Same blackouts, same minutes, awake again at the same minute. That's not two
bugs. That's one clock.

## Why it happened

We were on the free plan.

Two jobs, once a minute, all month, comes to about 86,000 runs. That is almost
exactly what the free plan covers, and we'd been sitting right on the ceiling
for months without knowing it. Go over and the service throttles you, which
looks precisely like an alarm clock that rings whenever it feels like it.

I upgraded to the ten dollar plan at 11:20. It's been perfect since.

That's an embarrassing root cause and I'm leaving it in, because it isn't the
part that cost us anything.

## Six hours of not knowing

The outage wasn't found by a system. It was found by a person who happened to
glance at a page. If I'd had a meeting that morning it would have been eight
hours, or ten, and every one of those minutes is songs we can't get back.

So we built a watchdog. Every five minutes it checks when each station last
managed to write something down. If any of them goes ten minutes without
managing it, everyone on a list gets an email. They get one more when it
recovers, and nothing in between.

The watchdog runs somewhere else on purpose. It doesn't run on Trigger.dev. It
runs on Convex, our database, which has its own clock and belongs to a
different company. A smoke detector wired to the fuse that just blew is not a
smoke detector. If I'd put the alarm on the thing that failed, the alarm would
have been asleep too, and I'd have built myself a very convincing feeling of
safety.

One more choice, and I think it's the one that decides whether this survives.
The watchdog watches when we last successfully checked, not when we last saw a
new song. Those sound like the same thing and they really aren't. A station can
honestly go twenty minutes without a new song: an interview, a long set, a live
remote. If I'd alarmed on that, it'd cry wolf twice a week, and within a month
everybody would have a mail rule sending it straight to a folder. An alert
people mute is worse than no alert.

## The better fix

An alarm tells you it broke. It doesn't fix anything.

StreamGuys only knows what's playing right now. It keeps about seventeen
minutes of history and then it forgets. It's a window, not a logbook, so every
minute we spend asleep is gone for good and no amount of alerting changes that.

Three of our four stations already log every spin into Spinitron, the service
DJs use to enter what they're playing. Spinitron is a logbook. It keeps
everything. You can go back and ask it what happened between 5 and 11 this
morning, and it will just tell you.

So we did. We asked for the window we'd slept through and wrote the answer back
in.

| Station | Songs recovered |
|---|---|
| HYFIN | 94 |
| 88Nine | 88 |
| Rhythm Lab Radio | 84 |
| 414 Music | 0 |
| Total | 266 |

Twenty-one more were skipped because we already had them, which is the check
working. And the recovered records are better than what we normally get.
Spinitron carries the album, the record label, the release year and the ISRC,
the code that identifies a recording anywhere in the world. StreamGuys hands us
one string that says `Lily Allen - LDN` and we pull it apart ourselves.

414 Music got nothing back. It's the one station that doesn't log to Spinitron,
so its share of that morning is gone permanently. That's not something I can
fix with code. It's a question about whether we buy that station a safety net.

## What I took from this

Detection and recovery aren't the same project, and I nearly stopped after the
first one. The email alert felt like the answer. It isn't. It would have told
me at 5:28 instead of 11:00, which is genuinely better, and I'd still have lost
forty minutes of songs. The Spinitron catch-up is what turns an outage into a
delay instead of a hole. If you can only build one, build that one.

The second thing is about what the failure looked like from outside. A playlist
that stopped updating looks exactly like a station that stopped playing new
songs. Both look like a page that isn't moving. That's why nobody reported it.
Nothing was on fire, nothing threw an error, no page was down. Silence is the
hardest failure to notice and it's the one worth building for.

The third one I'd have told you in the abstract without blinking: don't monitor
a thing with the thing. I still almost did it before it landed.

## Still open

- 414 Music has no logbook. Should it get one?
- The catch-up still needs a person to notice and run it. It should run itself
  every night.
- Our royalty filing for August 25 is nearly whole again, but it's still short
  414 Music's share of that window. That's a note we'll carry into the filing.

The radio never stopped. It just took us six hours to notice we'd stopped
listening.

Tarik
