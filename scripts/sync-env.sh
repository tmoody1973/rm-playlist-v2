#!/usr/bin/env bash
#
# sync-env.sh — push secrets from the canonical .env.local to each managed
# runtime's env store (Convex + GitHub Actions). Single source of truth is
# the gitignored .env.local at repo root.
#
# Per docs/decisions/002-secrets-at-rest.md.
#
# NOT synced here (need manual steps):
#   - Trigger.dev env: the CLI has no `env set` command; use the dashboard
#     web UI OR `bunx trigger.dev dev --env-file .env.local` for local dev.
#   - Fly.io ICY worker secrets: `fly secrets set` per-key, Week 3+.
#   - Cloudflare Pages env: via dashboard or `wrangler pages secret put`,
#     Milestone 7+.
#
# Usage:
#   bash scripts/sync-env.sh            # prints diff of what would change
#   bash scripts/sync-env.sh --apply    # actually writes

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
ENV_FILE="${REPO_ROOT}/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ Missing $ENV_FILE — nothing to sync."
  exit 1
fi

APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    *) echo "Unknown arg: $arg" ; exit 1 ;;
  esac
done

# Which keys go to which runtime. Keep this list in sync with
# decisions/002 as new adapters land.
CONVEX_KEYS=(
  SGMETADATA_API_KEY
  HYFIN_SPINITRON_KEY
  STATION_88NINE_SPINITRON_KEY
  STATION_414MUSIC_SPINITRON_KEY
  RHYTHMLAB_SPINITRON_KEY
  SPOTIFY_CLIENT_ID
  SPOTIFY_CLIENT_SECRET
  TICKETMASTER_CONSUMER_KEY
  TICKETMASTER_CONSUMER_SECRET
  APPLE_MUSIC_TEAM_ID
  APPLE_MUSIC_KEY_ID
)

# GitHub Actions repo secrets — only CI-only things that aren't already
# hardcoded as stubs in ci.yml.
GH_SECRETS=(
  CONVEX_DEPLOY_KEY
  CLOUDFLARE_API_TOKEN
  TRIGGER_SECRET_KEY
)

# --- Helpers -----------------------------------------------------------

# Read a single env var from .env.local. Empty string if missing.
# (grep exits 1 on no match; `|| true` keeps set -e happy.)
read_env() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true
}

sync_convex() {
  pushd "${REPO_ROOT}/packages/convex" >/dev/null

  # Snapshot remote state once
  echo "→ Fetching current Convex env state..."
  local remote_state
  remote_state=$(bunx convex env list 2>/dev/null || true)

  for key in "${CONVEX_KEYS[@]}"; do
    local value
    value=$(read_env "$key")
    if [[ -z "$value" ]]; then
      echo "  ⊖ $key — not in $ENV_FILE, skipping"
      continue
    fi

    # Rough check: does the remote have this key AND matching value?
    if echo "$remote_state" | grep -qE "^${key}=${value}$"; then
      echo "  = $key — already in sync"
      continue
    fi

    if [[ "$APPLY" -eq 1 ]]; then
      bunx convex env set "$key" "$value" >/dev/null 2>&1 \
        && echo "  ✓ $key — pushed to Convex" \
        || echo "  ✗ $key — failed to push (see `bunx convex env list`)"
    else
      echo "  ⋯ $key — WOULD push (dry-run; use --apply)"
    fi
  done

  popd >/dev/null
}

sync_github_secrets() {
  if ! command -v gh >/dev/null 2>&1; then
    echo "→ gh CLI not installed, skipping GitHub Actions secrets"
    return
  fi

  echo "→ Syncing GitHub Actions repo secrets..."
  for key in "${GH_SECRETS[@]}"; do
    local value
    value=$(read_env "$key")
    if [[ -z "$value" ]]; then
      echo "  ⊖ $key — not in $ENV_FILE, skipping"
      continue
    fi

    if [[ "$APPLY" -eq 1 ]]; then
      echo "$value" | gh secret set "$key" --repo "$(gh repo view --json nameWithOwner -q .nameWithOwner)" \
        && echo "  ✓ $key — pushed to GitHub" \
        || echo "  ✗ $key — failed"
    else
      echo "  ⋯ $key — WOULD push to GitHub (dry-run)"
    fi
  done
}

# --- Main --------------------------------------------------------------

if [[ "$APPLY" -eq 1 ]]; then
  echo "🚀 APPLY mode — writes to real env stores"
else
  echo "🔍 Dry run — use --apply to actually push"
fi
echo ""

sync_convex
echo ""
sync_github_secrets
echo ""

if [[ "$APPLY" -eq 1 ]]; then
  echo "Done. Remember to manually push to Trigger.dev (dashboard), Fly (fly secrets), and Cloudflare Pages (dashboard) as those milestones light up."
else
  echo "Dry run complete. Re-run with --apply to write."
fi
