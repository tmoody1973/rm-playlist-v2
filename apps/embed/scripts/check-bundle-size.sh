#!/usr/bin/env bash
#
# Enforce the gzip bundle budget documented in vite.config.ts.
#
# Checks every critical-path variant (widget.js loader + shared chunks +
# variant) is under the ceiling. Exits non-zero and prints which variant
# blew the budget so CI can gate on it.
#
# Invoked via `bun run build:check` (builds then checks).

set -euo pipefail

CEILING_KB=40
DIST_DIR="$(cd "$(dirname "$0")/.." && pwd)/dist/v1"

if [ ! -d "$DIST_DIR" ]; then
  echo "error: $DIST_DIR missing — run \`bun run build\` first" >&2
  exit 2
fi

gzip_kb() {
  # Size in KB (one decimal), gzipped at default level — matches vite's own
  # reported gzip size column.
  local bytes
  bytes=$(gzip -c "$1" | wc -c | tr -d ' ')
  awk -v b="$bytes" 'BEGIN{ printf "%.1f", b/1024 }'
}

loader_kb=$(gzip_kb "$DIST_DIR/widget.js")
# Shared chunks: jsxRuntime (Preact runtime) and tokens (shared components
# + Convex client). Both are imported by every non-stub variant.
jsx_kb=$(gzip_kb "$(ls "$DIST_DIR"/chunks/jsxRuntime.module-*.js | head -1)")
tokens_kb=$(gzip_kb "$(ls "$DIST_DIR"/chunks/tokens-*.js | head -1)")

echo "Widget bundle sizes (gzip):"
printf "  %-22s %6s KB\n" "widget.js (loader)" "$loader_kb"
printf "  %-22s %6s KB\n" "jsxRuntime" "$jsx_kb"
printf "  %-22s %6s KB\n" "tokens (shared+convex)" "$tokens_kb"

fail=0
for variant_path in "$DIST_DIR"/chunks/{now-playing-card,now-playing-strip,playlist}-*.js; do
  [ -f "$variant_path" ] || continue
  variant_name=$(basename "$variant_path" | sed -E 's/-[A-Za-z0-9_]+\.js$//')
  variant_kb=$(gzip_kb "$variant_path")
  # Critical path for an embed request: loader + shared chunks + this variant.
  total_kb=$(awk -v a="$loader_kb" -v b="$jsx_kb" -v c="$tokens_kb" -v d="$variant_kb" \
    'BEGIN{ printf "%.1f", a+b+c+d }')
  status="ok"
  over=$(awk -v t="$total_kb" -v c="$CEILING_KB" 'BEGIN{ print (t>c) ? 1 : 0 }')
  if [ "$over" -eq 1 ]; then
    status="OVER BUDGET (ceiling ${CEILING_KB} KB)"
    fail=1
  fi
  printf "  %-22s %6s KB variant | %6s KB critical-path — %s\n" \
    "$variant_name" "$variant_kb" "$total_kb" "$status"
done

if [ "$fail" -eq 1 ]; then
  echo "" >&2
  echo "One or more variants exceed the ${CEILING_KB} KB gzip ceiling." >&2
  echo "Options: reduce bundle, swap Convex subscribe → fetch polling, or" >&2
  echo "raise the ceiling in vite.config.ts + this script after justification." >&2
  exit 1
fi

echo ""
echo "All critical-path bundles under ${CEILING_KB} KB ceiling."
