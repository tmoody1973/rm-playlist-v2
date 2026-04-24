# @rm/icy-worker

Persistent ICY stream listener for rm-playlist-v2. Holds long-lived HTTP
connections to broadcaster streams, extracts Shoutcast/Icecast in-band
metadata (`StreamTitle='Artist - Title';`), and writes normalized plays to
Convex via `plays.recordStreamPlay`.

The worker discovers which streams to listen to by polling Convex's
`ingestionSources.listEnabledForPolling` every 60 seconds and filtering to
`adapter: "icy"`. Adding a new ICY source is a single
`ingestionSources:upsertIcy` call — no worker redeploy.

## Environment variables

| Var                                        | Purpose                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `CONVEX_URL` (or `NEXT_PUBLIC_CONVEX_URL`) | Convex deployment URL. Required.                                                                 |
| `SOURCE_REFRESH_SEC`                       | Override the 60s source-list refresh cadence. Optional.                                          |
| `ICY_ALLOWED_PORTS`                        | Comma-separated non-default ports the SSRF allowlist should accept (e.g. `8000,8443`). Optional. |

## Seeding a source

```bash
# From repo root. Upsert the Rhythm Lab ICY source:
cd packages/convex
bunx convex run ingestionSources:upsertIcy '{
  "stationSlug": "rhythmlab",
  "streamUrl": "https://wyms.streamguys1.com/rhythmlab",
  "role": "primary",
  "enabled": true
}'
```

The worker picks up the new row on its next refresh tick (within 60s).

## Local development

```bash
# From repo root
bun install
CONVEX_URL="https://<your-dev>.convex.cloud" \
  bun --filter @rm/icy-worker run dev
```

## Tests

```bash
cd apps/icy-worker && bun test
```

Tests cover the SSRF allowlist, the ICY byte-stream parser, the exponential
backoff, the supervisor's lifecycle (spawn/abort/respawn on URL change),
the Convex gateway contract (duplicate-silent, unknown-source-abort), and an
end-to-end path: mock ICY server → client → adapter → mock Convex writePlay.

## Deployment

```bash
# From repo root, after `flyctl auth login`
fly deploy --config apps/icy-worker/fly.toml --dockerfile apps/icy-worker/Dockerfile .

fly secrets set CONVEX_URL="https://<your-prod>.convex.cloud" \
  --config apps/icy-worker/fly.toml
```

## What this worker does NOT do (yet)

- No Rhythm Lab dual-source reconciliation against Spinitron. Session 3.
- No WebSocket-based live source-list subscription. We poll on interval. Session 3.
- No heartbeat / `lastSuccessAt` updates on the `ingestionSources` row. Session 3.
- No HTTP health endpoint — Fly TCP checks suffice until Convex wiring needs monitoring.

Architecture rationale lives in `radiomke-playlist-v2-brainstorm.md` sections
"Persistent stream connections (ICY)" and "Rhythm Lab dual-source reconciliation".
