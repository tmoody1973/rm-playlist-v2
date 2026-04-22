# 001 — Single-Tenant v2 First

**Date:** 2026-04-22
**Status:** Accepted
**Context:** Supersedes the brainstorm's multi-tenant-from-day-1 assumption.

## Decision

v2 ships as a single-tenant system for Radio Milwaukee. Multi-tenancy is deferred and only revisited if external station interest materializes.

## Why

- Multi-tenancy tax is real (org model, overlays, promotion queue, shared canonical policy, API keys, signup/onboarding, pricing). Paying that tax before any external demand is premature.
- Radio Milwaukee is the only confirmed customer. The brainstorm's "Radio Milwaukee shakedown" already assumed RM was the only real tenant for months; this decision just makes that the plan instead of the transition.
- Single-tenant removes ~6 of 23 open questions from the critical path.
- Architecture choice (Convex + Clerk + Trigger.dev + Fly + Next 15) is preserved. Schema keeps `orgId` fields as forward-compatibility markers with a constant value.

## What we're NOT building (day 1)

- Clerk Organizations (switchers, per-org roles, per-org API keys)
- Multi-row `organizations` / onboarding flow / signup
- Cross-tenant enrichment moat
- `canonicalProposals` + promotion queue
- Per-tenant overlays with cross-org conflict resolution
- Public API with OpenAPI spec
- Pricing / billing
- Onboarding / station-signup flow

## What we ARE building (still high-value for RM alone)

- Multi-station within one tenant: HYFIN, 88Nine, 414 Music, Rhythm Lab
- Multi-source per station (Spinitron + ICY on Rhythm Lab at minimum)
- Adapter architecture + registry + 6-layer testing
- Events layer (Ticketmaster + AXS + custom DJ events)
- Reverse-lookup "touring from rotation"
- JS widgets with shadow DOM + iframe fallback
- Reporting layer (SoundExchange + CPB + PRO)
- Enrichment waterfall (single-tenant scope)

## Forward-compat markers

Schema retains `orgId` on every table. Convex queries filter on `orgId` even when there is exactly one. This means the day multi-tenant becomes real, the migration is:

1. Un-hardcode the single org ID
2. Wire Clerk Organizations for the org-switcher UX
3. Build onboarding
4. Introduce the promotion queue + overlays' cross-org behavior

No schema rewrites. No query rewrites. That's the whole point of keeping the `orgId` columns.

## Revisit triggers

Revisit this decision if any of:

- A second public radio station commits to using v2 in production
- Radio Milwaukee spins up a new brand that warrants real org separation
- Pricing experiment requires per-tenant billing telemetry

Otherwise: stay single-tenant.
