# @rm/icy-worker

Persistent ICY stream listener for rm-playlist-v2. Holds a long-lived HTTP
connection to a broadcaster stream, extracts Shoutcast/Icecast in-band
metadata (`StreamTitle='Artist - Title';`), and normalizes plays through
`@rm/ingestion`'s `icyAdapter`.

Session 1 scope — this ships the worker that reads one hardcoded stream URL
(via env var) and logs parsed plays to stdout. Session 2 wires Convex-driven
source discovery and mutation writes.

## Environment variables

| Var | Purpose |
|-----|---------|
| `ICY_STREAM_URL`   | Full URL of the ICY stream. Must pass the SSRF allowlist (see `src/ssrf.ts`). |
| `ICY_STATION_SLUG` | Which `StationSlug` tag to attach to emitted plays. Default `rhythmlab`. |
| `ICY_ALLOWED_PORTS` | Comma-separated non-default ports to accept (e.g. `8000,8443`). |

## Local development

```bash
# From repo root
bun install

# Point at any public ICY stream for a smoke test
ICY_STREAM_URL="http://stream.example.com:8000/live" \
ICY_STATION_SLUG=rhythmlab \
  bun --filter @rm/icy-worker run dev
```

## Tests

```bash
bun --filter @rm/icy-worker run test
```

Tests use `Bun.serve` to spin up a mock ICY HTTP server on a random port —
no network access required, no real broadcaster credentials needed.

## Deployment

```bash
# From repo root, after `flyctl auth login`
fly deploy --config apps/icy-worker/fly.toml --dockerfile apps/icy-worker/Dockerfile .

# Secrets
fly secrets set \
  ICY_STREAM_URL="https://..." \
  --config apps/icy-worker/fly.toml
```

## What this worker does NOT do (yet)

- No Convex mutations — plays are logged to stdout only. Session 2.
- No multi-source fan-out — one stream URL per worker instance. Session 2.
- No reconciliation with Spinitron — dual-source logic is session 3.
- No HTTP health endpoint — Fly TCP checks suffice for session 1. Added with Convex wiring.

Architecture rationale lives in `radiomke-playlist-v2-brainstorm.md` sections
"Persistent stream connections (ICY)" and "Rhythm Lab dual-source reconciliation".
