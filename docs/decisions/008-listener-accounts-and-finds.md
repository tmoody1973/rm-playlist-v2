# 008: Real listener accounts through a separate Clerk app; Finds stored in the playlist database

**Decision:** Listeners get real accounts through a new Clerk application, separate from the staff sign-in. Alexa links to it with standard OAuth. Each listener's saved songs ("Finds") and their Apple Music connection are stored in this playlist database, and only the Alexa server can read or write them.

**Why this came up:** "Alexa, save it" only means something if the station knows who "me" is. Amazon passes listener identity to an add-on in exactly one way: account linking, a one-time sign-in that the Alexa app walks the listener through. Nothing for this existed yet, since Radio Commons had deferred it. Getting it wrong means either a demo-only feature that falls apart when judges try it, or personal data stored somewhere it can leak.

**Options:**
- **Demo-only, one shared library.** No accounts. Fastest. Cost: it isn't real, and anyone testing it would see everyone's saves.
- **A separate listener Clerk app, with Finds in the playlist database.** Clerk already acts as a standard OAuth login server, and has a guide for this exact setup (an MCP server). Finds sit next to the tracks they point to, so artwork, facts and previews come for free. Cost: about 5–6 days of the 19 left, a second Clerk app to manage, and the first personal data in this database, which needs a new locked-down access pattern.
- **Reuse the staff Clerk app.** One set of keys. Cost: listener sign-ups would mix into the dashboard's staff user list and role checks.
- **Store listener data in Radio Commons' own new database.** Keeps personal data out of the playlist database. Cost: a third Convex project to run, and finds wouldn't pick up later fixes to track data.

**What we chose and why:** A separate listener Clerk app, with Finds in the playlist database (Tarik). Real accounts are the point: the hackathon rewards state that lasts across sessions, and a station-owned library is the membership relationship the research doc is after. Keeping listeners in their own Clerk app means public sign-ups never touch staff access.

**What we gave up:**
- Time: roughly a third of the remaining build days.
- Simplicity: this database now holds personal data, so every Finds function needs a server key, and Apple tokens are encrypted.
- Certainty: three requirements can only be proven live: Clerk's handling of Amazon's `resource` parameter, Alexa asking for refresh tokens, and anonymous tools continuing to work under one add-on. A day-one test checks them before anything is built on them, with Auth0 or Cognito as the fallback.

**How we'll know if this was right:** The day-one test passes all four checks. A real Amazon account links, saves a song, and sees it in their own Apple Music library. And no Finds data can be read without the server key.

**What actually happened:**
