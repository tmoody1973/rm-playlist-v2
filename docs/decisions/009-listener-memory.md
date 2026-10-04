# 009 — Remember listeners in our own database, not a memory service

**Decision** — Radio Commons remembers each signed-in listener (the artists they follow, the last song list they were shown, when they last asked "what's new") in the playlist database, next to their saved songs, instead of using an AI memory service.

**Why this came up** — Hackathon judges said assistants that keep context across sessions stand out. Amazon's Alexa+ docs say Alexa keeps only the current conversation and leaves longer memory to each add-on. Live testing showed the cost of having none: "save number 3" saved nothing because Alexa's AI no longer had the song's id. If we got this wrong, listeners would keep hearing "I can't find that song" and the demo would fail in front of judges.

**Options**
1. *A hosted AI memory service (an MCP "memory server" such as Mem0 or Mnemoverse).* Stores fuzzy notes found by meaning. Cost: a second network hop on every answer, listener data sent to a third company, fuzzy recall where we need exact song ids, and a vendor we'd depend on three weeks before a deadline.
2. *Let Alexa's own conversation memory carry it.* No new code. Cost: Alexa only remembers within one conversation, and in testing even that lost the ids.
3. *A few small tables in our playlist database* (chosen). Cost: we design and maintain them, and "delete my data" and the privacy page must cover them.

**What we chose and why** — Option 3 (Tarik chose the scope; Claude recommended the storage). The things worth remembering are exact facts (song ids, artist ids, timestamps), the playlist database already holds the songs, artists and concerts they point to, and keeping it there means one place to erase it.

**What we gave up** — "Fuzzy" memory: Radio Commons won't remember things a listener says in passing ("I love horns"). It remembers only follows, saves, the last list, and the last visit.

**How we'll know if this was right** — The real-phrase test script passes "save number 3" on every run; a returning listener's "what's new for me?" mentions spins since their last visit; "delete my data" leaves zero rows behind for that listener.

**What actually happened** —
