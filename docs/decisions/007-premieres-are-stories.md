# 007: Milwaukee Music Premieres are stories, not playlist data

**Decision:** Premieres stay in Backstory as ordinary stories, found by artist or title. We are not building a link that ties a premiere article to the songs it matches in the playlist. This reverses the premiere part of decision 006.

**Why this came up:** The Backstory plan said a premiere should feed facts into the playlist's track records, so that when a premiered song airs, Alexa's "what was that song?" answer would include the premiere story. Making that work needs a shared matching key copied into Backstory, a new Backstory lookup, a merge step in the Alexa server, and two repos kept in sync for good. Before building it, we checked how often a premiered song actually airs.

**Options:**
- **Build the link.** Alexa could go from "what was that song at 6:30?" straight to the premiere story. Cost: about an hour in Backstory, plus a merge step in Radio Commons, plus a matching rule that has to stay identical in two repos.
- **Park it until after the hackathon.** No work now. Cost: the idea lingers in the plan and the specs keep describing a link that doesn't exist.
- **Treat premieres as plain stories.** No new work. Premieres are still reachable by name: "tell me about Glitzy" goes through Backstory's existing story search. Cost: a listener who asks about a specific spin hears the song's name but not the premiere story behind it.

**What we chose and why:** Plain stories (Tarik). A premiere airs a few times on debut day, then rarely. A search of the playlist for Glitzy found no logged spins of "Effort" on 88Nine and one spin of a different Glitzy song on 414 Music. The link would almost never fire, and it would cost permanent cross-repo upkeep. Premieres are editorial stories, and Backstory already handles stories.

**What we gave up:** The "heard it on the radio, asked Alexa, got the artist's own story" moment for premiered songs specifically. The playlist side keeps returning `matchKey`; it's already built and costs nothing. So the link can still be added later if premieres start getting real rotation.

**How we'll know if this was right:** If premiered songs keep getting only a handful of spins, and nobody asks Alexa about a premiere by its airtime, this was right. If a premiere goes into heavy rotation, revisit.

**What actually happened:**
