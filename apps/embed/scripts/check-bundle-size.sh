#!/usr/bin/env bash
#
# Enforce the gzip bundle budget documented in vite.config.ts.
#
# Computes each variant's critical-path size by parsing its actual
# top-of-file ES `import "./foo.js"` statements — robust to Vite's
# occasional re-chunking (Preact runtime sometimes gets a dedicated
# chunk, sometimes inlined into tokens, sometimes split out as
# `format-*` helpers).
#
# Invoked via `bun run build:check` (builds then checks).

set -euo pipefail

CEILING_KB=40
DIST_DIR="$(cd "$(dirname "$0")/.." && pwd)/dist/v1"
CHUNKS_DIR="$DIST_DIR/chunks"

if [ ! -d "$DIST_DIR" ]; then
  echo "error: $DIST_DIR missing — run \`bun run build\` first" >&2
  exit 2
fi

gzip_bytes() {
  gzip -c "$1" | wc -c | tr -d ' '
}

kb_from_bytes() {
  awk -v b="$1" 'BEGIN{ printf "%.1f", b/1024 }'
}

# Extract the filenames a chunk imports from `./chunks/` via its top-of-file
# `import{...}from"./foo.js"` statements. Output one basename per line.
imported_chunks() {
  local file="$1"
  # Pull the first ~2KB where ES imports live. Match `from"./NAME.js"`.
  head -c 2048 "$file" \
    | grep -oE 'from"\./[A-Za-z0-9_.-]+\.js"' \
    | sed -E 's/from"\.\///; s/"$//'
}

loader_bytes=$(gzip_bytes "$DIST_DIR/widget.js")
loader_kb=$(kb_from_bytes "$loader_bytes")

echo "Widget bundle sizes (gzip):"
printf "  %-24s %7s KB\n" "widget.js (loader)" "$loader_kb"

# Report the standalone size of each shared chunk so humans can see the
# breakdown. Shared = anything that isn't a variant.
declare -a variant_files=()
declare -a shared_files=()
for f in "$CHUNKS_DIR"/*.js; do
  [ -f "$f" ] || continue
  case "$(basename "$f")" in
    now-playing-card-*|now-playing-strip-*|playlist-*)
      variant_files+=("$f")
      ;;
    *)
      shared_files+=("$f")
      ;;
  esac
done

for f in "${shared_files[@]}"; do
  name=$(basename "$f" | sed -E 's/-[A-Za-z0-9_-]{8}\.js$//')
  size_kb=$(kb_from_bytes "$(gzip_bytes "$f")")
  printf "  %-24s %7s KB\n" "$name (shared)" "$size_kb"
done

fail=0
for variant_path in "${variant_files[@]}"; do
  variant_name=$(basename "$variant_path" | sed -E 's/-[A-Za-z0-9_-]{8}\.js$//')
  variant_bytes=$(gzip_bytes "$variant_path")
  variant_kb=$(kb_from_bytes "$variant_bytes")

  # Critical path = loader + this variant + every chunk this variant imports.
  total_bytes=$((loader_bytes + variant_bytes))
  for dep in $(imported_chunks "$variant_path"); do
    dep_path="$CHUNKS_DIR/$dep"
    if [ -f "$dep_path" ]; then
      total_bytes=$((total_bytes + $(gzip_bytes "$dep_path")))
    fi
  done
  total_kb=$(kb_from_bytes "$total_bytes")

  status="ok"
  over=$(awk -v t="$total_kb" -v c="$CEILING_KB" 'BEGIN{ print (t>c) ? 1 : 0 }')
  if [ "$over" -eq 1 ]; then
    status="OVER BUDGET (ceiling ${CEILING_KB} KB)"
    fail=1
  fi
  printf "  %-24s %7s KB variant | %7s KB critical-path — %s\n" \
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
