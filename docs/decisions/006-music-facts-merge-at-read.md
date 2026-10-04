# 006: Premiere facts are combined when Alexa answers, not copied between databases

**Decision:** Backstory keeps the facts it pulls from Milwaukee Music Premieres in its own database. The Alexa add-on (Radio Commons) asks both Backstory and the playlist app at the same moment and combines the answers.

**Why this came up:** The Backstory plan says premieres should "create or update the local track and artist" in the music database, which is this playlist app. But Backstory and the playlist app are separate Convex projects (separate databases, deployed separately). Following the plan literally means one app writing into another's database. If we got this wrong, a local song's story could be missing or out of date exactly when it airs, and local songs are the ones only we can tell.

**Options:**
- **Combine when answering.** Each app keeps its own facts; Radio Commons calls both at once and merges. No app writes into another. Cost: the rule that turns "Glitzy – Effort (feat. X)" into a matching key must be identical in two repos, and the merging logic lives in the Alexa server.
- **Backstory pushes into the playlist app.** Through a locked-down endpoint. All facts end up in one place. Cost: a write path between apps, a shared secret to manage, and two repos that must deploy in step.
- **The playlist app pulls from Backstory** every few minutes. Cost: copied data can go stale, and there's one more background job to watch.

**What we chose and why:** Combine when answering (Tarik, on Claude's recommendation). It matches Backstory's decision 001, where the Alexa server already reads Backstory through public queries. Every database has exactly one writer.

**What we gave up:** Two network calls per track story instead of one, which still fits the 500 ms budget because they run in parallel. And the matching key is duplicated across two repos. A shared file of tricky artist/title examples, tested in both repos, is what keeps them in sync.

**How we'll know if this was right:** When a premiered local song airs on 88Nine, asking Alexa about it returns the premiere's credits, and the shared key fixtures pass in both repos. If we ever see a premiere that exists but doesn't show up for its spin, the key rule drifted.

**What actually happened:**
