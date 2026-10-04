# Agentic Radio Commons: what Alexa+ allows, and which feature to build

*Research note, 2026-10-04. Audience: PM. Deadline context: Alexa+ hackathon, 2026-10-23.*

## 1. What the Alexa+ docs actually say

| Topic | What the docs say | Source |
|---|---|---|
| Protocol | Alexa+ supports MCP (Model Context Protocol, the open standard for letting an assistant call outside tools) version 2025-11-25, over Streamable HTTP only. | [Overview](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html) |
| Session memory | "The session is based on the customer's previous conversations with Alexa+ rather than an explicit identifier for a session with your MCP App." Alexa keeps the conversation history and reviews earlier tool calls before choosing the next one. | [Client lifecycle](https://developer.amazon.com/docs/alexaplus/add-ons/category-sdk-mcp-client-lifecycle.html) |
| Multi-turn | Turn-based. Your add-on "may be invoked across multiple turns", listeners hop between add-ons, and Alexa resumes after interruptions. "Treat each tool response as self-contained." | [Conversation surface](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-conversation-surface.html) |
| Memory across sessions | **Alexa does not promise to remember our data between sessions.** The docs tell you to put that memory in your own tools: "Your tools must be able to return relevant confirmation data so Alexa can answer these recall questions." | [Components and patterns](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-components-and-patterns.html) |
| Personalization | Two layers. Alexa handles references to earlier turns and preferences it already knows. You return personal data such as "recent orders... saved preferences" once the listener has linked their account. | [Tools, schema, data design](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-tools-schema-data-design.html) |
| Elicitation (the server asking the listener a follow-up question) | Supported. Alexa first tries to fill the gap from context, then "uses the existing elicitation framework through the MCP protocol." | Client lifecycle (above) |
| Notifications | Alexa may notify the listener after a transaction, built from the data you return. **I found no documented way for an MCP server to send a notification on its own schedule (a proactive push).** Unverified. | Components and patterns |
| Cards | MCP Apps (small HTML interfaces that show in the conversation) are supported, inline or fullscreen. Games are listed as a fit. Every response must also work as voice only. | [Display modes](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-display-modes.html) |
| Latency | Best practice: "Return results within 3 seconds", and show a "still working" message when a call is slow. The `_meta.ui.invoking` field ("Searching hotels...") provides that message. **The docs never mention the < 500 ms figure. It is our own budget, so I could not verify it as an Amazon rule.** | [Functional requirements](https://developer.amazon.com/docs/alexaplus/add-ons/functional-requirements.html) |
| Long-running work | Not documented. | n/a |
| Certification | "Tool signatures and descriptions are locked after publication." | [Certify](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-certify.html) |

**What this means for us:** Alexa remembers the current conversation, and we have to remember everything else. That is good news, because cross-session memory is exactly where we can stand out. Alexa gives it to no one for free.

## 2. Agentic features in the MCP 2025-11-25 spec

From the [changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog):

- **Elicitation**, including a new URL mode (sending the listener to a web page, for example a login). The Alexa+ docs say elicitation is supported.
- **Sampling with tools** (the server borrows the assistant's AI model, which can call tools while it does so). Alexa+ support is not documented, so treat it as unverified and do not rely on it.
- **Tasks**, experimental (a durable request the client checks back on later, for slow jobs). Alexa+ support is not documented. Unverified.
- **Resource subscriptions and progress notifications**, from earlier spec versions. Alexa+ support is not documented. Unverified.

**Practical rule:** do the agentic work on our own server. Plan for Alexa to call a tool and get an answer. Treat everything beyond that as a bonus.

## 3. Patterns worth borrowing

- **Orchestrator tool:** one tool runs a fixed multi-step workflow internally, so the AI model does not have to reason through each step ([Gravitee, MCP orchestration](https://gravitee.io/corpus/gen-940/walker-soundtrack/mcp-orchestration.html)). For slow parts, durable background jobs (work that survives crashes and retries itself), such as Trigger.dev, Inngest or Convex scheduled functions, compute ahead of time so the tool only reads ([PkgPulse comparison](https://www.pkgpulse.com/guides/hatchet-vs-trigger-dev-v3-vs-inngest-durable-workflows-2026)).
- **Taste memory:** Spotify DJ takes voice requests and answers them from "your listening history, music preferences" ([Digital Music News](https://www.digitalmusicnews.com/2025/05/13/spotify-ai-dj-requests/)). This is generic, global taste.
- **Artist tracking leading to local alerts:** Songkick and Bandsintown alert you when a tracked artist announces a show near you ([Hypebot](https://www.hypebot.com/our-service-is-pretty-simple-track-your-favorite-bands-never-miss-them-live-says-michelle-you-head-o/)). They have no idea what your radio station played.
- **Public radio resume:** NPR One lets you "listen right where you left off" and ran on Echo ([WRVO](https://www.wrvo.org/post/npr-one-public-radio-made-personal), [NPR](https://www.npr.org/sections/npr-extra/2017/02/28/517755544/-alexa-enable-npr-one)). NPR already owns this space.
- **Radio interactivity on Alexa:** Amazon offers song-request-to-DJ, contest and poll components for broadcasters ([Alexa music skills](https://developer.amazon.com/en-US/alexa/alexa-skills-kit/music)). These are skill-era components, and I did not verify whether they are available to MCP add-ons.

**The gap:** no one combines *what this station's DJs actually played* with *who is playing in town* and *our own stories and sessions*, remembered per listener. Radio Milwaukee has all three.

## 4. Three options

### A. "Save it" becomes a workflow, plus a "what's new for me?" digest
- **Moment:** "Alexa, save this song." Alexa replies: "Saved Thao to your Finds and your Apple Music. She plays Turner Hall Friday, and we have her Studio Milwaukee session." Next week: "Alexa, ask Radio Commons what's new for me." Alexa replies: "88Nine played Thao twice since Tuesday, her Turner Hall show is Friday, and HYFIN has a new premiere from an artist you saved."
- **Orchestration:** identify the song from the playlist → save the Find → Apple Music library (existing background job) → follow the artist → check events (Field Guide) → check stories and sessions (Backstory) → one combined answer. A background job does the slow lookups right after the save. The digest only reads results that are already stored.
- **Memory:** a follow per listener, a "last checked in" time per listener, and stored lookup results for each artist. All of it lives in Convex next to Finds, the delete-my-data tool already covers it, and the privacy page needs one new line.
- **Why only a local station can do this:** the digest is built from *our DJs' actual spins*, *Milwaukee shows*, and *our own journalism*. Spotify knows your taste. It does not know that 88Nine played the artist twice this week.
- **Judging story:** it hits both things the judges named. The save runs across five services, and the digest carries context from one session to the next. The demo is two sessions a few days apart.
- **Size:** M. Most of the pieces exist. The new work is a follows table, the background job that gathers results, a `whats_new_for_me` tool, and an MCP Apps card.
- **Risks:** a cold save could blow the latency budget. Fix: return the save right away with whatever results are already stored, and let the job fill in the rest. "Follow" must be stated plainly in the reply so listeners are not surprised. A brand-new listener gets an empty digest, so fall back to station picks.

### B. Resume anywhere for station podcasts
- **Moment:** "Alexa, keep playing that Backstory episode." Alexa resumes at 14:32.
- **Orchestration:** Backstory audio → a stored position per listener → the player.
- **Memory:** an episode ID and a timestamp per listener, in Convex.
- **Unique?** Weakly. NPR One did this first.
- **Size:** M-L. **Risk: high.** To resume, we have to learn where playback stopped. Nothing I found documents playback-position callbacks for MCP add-ons, and a card's audio player cannot report back on a device with no screen. Unverified, and possibly impossible on voice-only devices.

### C. Show-night concierge
- **Moment:** "Alexa, I'm going to the Thao show tonight." Alexa replies with doors, set time if we know it, tickets, a two-minute station story to hear on the way, and the songs 88Nine played from her this month.
- **Orchestration:** events → ticket link → Backstory story → playlist history.
- **Memory:** a "going" flag per listener and event, which can trigger a later "how was the show?" prompt.
- **Unique?** Yes. It ties local journalism to a local night out.
- **Size:** S-M. **Risks:** ticket deep links may break the rule "no third-party tracking parameters, or upstream deep links" ([data design](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-tools-schema-data-design.html)). It only works on show nights, which makes it hard to demo live, and its cross-session memory is thin.

## 5. Recommendation: build A, and fold C into it

Option A is the one that is clearly agentic and clearly ours. One spoken sentence ("save this") sets off five services, and the payoff arrives in a later session, which is the "keeps context across sessions" behavior the judges asked for. It is also the behavior Alexa explicitly leaves to add-ons. It reuses what is already live (Finds, Apple Music, Field Guide, Backstory, playlist recall). That keeps the new work at a medium size and leaves time for polish before 23 October.

Fold C in as one line of the digest ("Thao is at Turner Hall tonight, and here's a story to hear before you go") instead of building a separate tool. Drop B. NPR already owns it, and the playback-position question is a risk we cannot retire in three weeks.

**The one design choice that makes A work:** keep the expensive work off the listener's path. The background job gathers and stores results when something changes (a save, a new spin, a new event). Live tools only read those stored results, which keeps them inside the latency budget. On a slow path, the `invoking` message ("Checking what's new at the station...") covers the wait.

**Open questions to verify before building:** whether Alexa+ honors MCP tasks or proactive notifications. If it does, the digest could be pushed to listeners instead of waiting for them to ask. Also where the 500 ms budget came from, since Amazon's published guidance is 3 seconds.
