#!/bin/bash
#
# Build all plugin UMD bundles for CDN deployment
# This script builds each plugin's frontend as a UMD bundle that can be loaded
# directly in the browser without iframes, enabling same-origin permissions.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Plugin directories
PLUGINS_DIR="$ROOT_DIR/plugins"
OUTPUT_DIR="$ROOT_DIR/dist/plugins"

# Ensure Node can resolve packages from the monorepo root node_modules.
# In npm workspaces, devDependencies like tailwindcss/postcss/autoprefixer
# are hoisted to root but may not be symlinked into each workspace's
# node_modules. NODE_PATH makes them discoverable from any subdirectory.
export NODE_PATH="$ROOT_DIR/node_modules${NODE_PATH:+:$NODE_PATH}"

###############################################################################
# SOURCE-HASH BUILD CACHING
# Computes a hash of all source files that affect a plugin build.
# If the hash matches the cached value in dist/production/.build-hash,
# the build is skipped. This saves ~5-10s per unchanged plugin locally
# and 30-90s on Vercel when the build cache is warm.
###############################################################################

# Compute hash of source files that affect the build output
plugin_src_hash() {
  local pdir="$1"
  local files_to_hash=()
  [ -d "$pdir/frontend/src" ] && files_to_hash+=("$pdir/frontend/src")
  [ -f "$pdir/frontend/package.json" ] && files_to_hash+=("$pdir/frontend/package.json")
  [ -f "$pdir/frontend/vite.config.ts" ] && files_to_hash+=("$pdir/frontend/vite.config.ts")
  [ -f "$pdir/frontend/tsconfig.json" ] && files_to_hash+=("$pdir/frontend/tsconfig.json")

  if [ ${#files_to_hash[@]} -eq 0 ]; then
    echo "empty"
    return
  fi

  # Use md5sum on Linux, md5 on macOS
  if command -v md5sum >/dev/null 2>&1; then
    find "${files_to_hash[@]}" -type f 2>/dev/null | sort | xargs md5sum 2>/dev/null | md5sum | cut -d' ' -f1
  elif command -v md5 >/dev/null 2>&1; then
    find "${files_to_hash[@]}" -type f 2>/dev/null | sort | xargs md5 -r 2>/dev/null | md5 -q
  else
    echo "no-hash"
  fi
}

# Check if a plugin needs rebuilding
plugin_needs_build() {
  local pdir="$1"
  local hash_file="$pdir/frontend/dist/production/.build-hash"

  # No dist at all -> needs build
  [ ! -d "$pdir/frontend/dist/production" ] && return 0
  # No hash file -> needs build (legacy build without hash)
  [ ! -f "$hash_file" ] && return 0
  # Hash mismatch -> source changed, needs rebuild
  local current_hash cached_hash
  current_hash=$(plugin_src_hash "$pdir")
  cached_hash=$(cat "$hash_file" 2>/dev/null)
  [ "$current_hash" != "$cached_hash" ]
}

# Save build hash after successful build
save_build_hash() {
  local pdir="$1"
  local hash_file="$pdir/frontend/dist/production/.build-hash"
  mkdir -p "$(dirname "$hash_file")"
  plugin_src_hash "$pdir" > "$hash_file"
}

# Parse arguments
PARALLEL=false
CLEAN=false
FORCE=false
SPECIFIC_PLUGIN=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --parallel|-p)
      PARALLEL=true
      shift
      ;;
    --clean|-c)
      CLEAN=true
      shift
      ;;
    --force|-f)
      FORCE=true
      shift
      ;;
    --plugin)
      SPECIFIC_PLUGIN="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --parallel, -p    Build plugins in parallel"
      echo "  --clean, -c       Clean output directory before building"
      echo "  --force, -f       Force rebuild even if source unchanged"
      echo "  --plugin NAME     Build only specific plugin"
      echo "  --help, -h        Show this help"
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Auto-discover plugins: find all plugin directories that have a frontend vite config
# This means any new plugin with plugins/{name}/frontend/vite.config.ts is automatically included.
if [ -n "$SPECIFIC_PLUGIN" ]; then
  PLUGINS=("$SPECIFIC_PLUGIN")
else
  PLUGINS=()
  for config in "$PLUGINS_DIR"/*/frontend/vite.config.ts; do
    [ -f "$config" ] || continue
    plugin_name="$(basename "$(dirname "$(dirname "$config")")")"
    PLUGINS+=("$plugin_name")
  done
  # Sort for deterministic output
  IFS=$'\n' PLUGINS=($(sort <<<"${PLUGINS[*]}")); unset IFS
fi

if [ ${#PLUGINS[@]} -eq 0 ]; then
  log_warn "No plugins found in $PLUGINS_DIR with frontend/vite.config.ts"
  exit 0
fi

log_info "Auto-discovered ${#PLUGINS[@]} plugins: ${PLUGINS[*]}"

# Clean output directory if requested
if [ "$CLEAN" = true ]; then
  log_info "Cleaning output directory..."
  rm -rf "$OUTPUT_DIR"
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Build a single plugin
build_plugin() {
  local plugin_name=$1
  local plugin_dir="$PLUGINS_DIR/$plugin_name/frontend"
  local plugin_root="$PLUGINS_DIR/$plugin_name"
  local output_subdir="$OUTPUT_DIR/$plugin_name/1.0.0"

  # Check if vite config exists
  if [ ! -f "$plugin_dir/vite.config.ts" ]; then
    log_warn "Skipping $plugin_name - no vite.config.ts"
    return 0
  fi

  # Source-hash cache check: skip build if source hasn't changed
  if [ "$FORCE" != "true" ] && [ "$CLEAN" != "true" ] && ! plugin_needs_build "$plugin_root"; then
    log_success "$plugin_name unchanged (cached)"
    # Still ensure output dir has the bundle
    if [ -d "$plugin_dir/dist/production" ]; then
      mkdir -p "$output_subdir"
      cp -r "$plugin_dir/dist/production/"* "$output_subdir/" 2>/dev/null || true
    fi
    return 0
  fi

  log_info "Building $plugin_name..."

  cd "$plugin_dir"

  # Install dependencies if needed
  if [ ! -d "node_modules" ]; then
    log_info "  Installing dependencies for $plugin_name..."
    npm install --silent 2>/dev/null || npm install
  fi

  # Build with production mode
  # PostCSS (tailwindcss/autoprefixer) is configured inline in
  # @naap/plugin-build's shared Vite config, so no postcss.config.js
  # or local symlinks are needed.
  npx vite build --mode production 2>&1 | while read line; do
    echo "  $line"
  done

  # Check if build succeeded
  if [ ! -d "dist/production" ]; then
    log_error "Build failed for $plugin_name - no dist/production directory"
    return 1
  fi

  # Save build hash for future cache checks
  save_build_hash "$plugin_root"

  # Copy to output directory
  mkdir -p "$output_subdir"
  cp -r dist/production/* "$output_subdir/"

  # Get bundle info
  local bundle_file=$(ls "$output_subdir"/*.js 2>/dev/null | head -1)
  if [ -n "$bundle_file" ]; then
    local bundle_size=$(ls -lh "$bundle_file" | awk '{print $5}')
    log_success "$plugin_name built ($bundle_size)"
  else
    log_success "$plugin_name built"
  fi

  return 0
}

echo ""
echo "========================================================"
echo "           Building Plugin Bundles (CDN/UMD)             "
echo "========================================================"
echo ""

total=${#PLUGINS[@]}
success=0
failed=0

if [ "$PARALLEL" = true ]; then
  log_info "Building ${total} plugins in parallel..."
  echo ""

  # Build in parallel using background jobs
  pids=()
  for plugin in "${PLUGINS[@]}"; do
    (build_plugin "$plugin") &
    pids+=($!)
  done

  # Wait for all to complete
  # NOTE: Use $((x + 1)) instead of ((x++)) because when x=0 the
  # post-increment evaluates to 0, making (( 0 )) return exit status 1
  # which kills the script under set -e.
  for pid in "${pids[@]}"; do
    if wait $pid; then
      success=$((success + 1))
    else
      failed=$((failed + 1))
    fi
  done
else
  log_info "Building ${total} plugins sequentially..."
  echo ""

  for plugin in "${PLUGINS[@]}"; do
    if build_plugin "$plugin"; then
      success=$((success + 1))
    else
      failed=$((failed + 1))
    fi
    echo ""
  done
fi

echo "========================================================"
echo "                     Build Summary                       "
echo "========================================================"
echo "  Total:    ${total}"
echo "  Success:  ${success}"
echo "  Failed:   ${failed}"
echo "========================================================"
echo ""

# List output files
if [ -d "$OUTPUT_DIR" ]; then
  log_info "Output directory: $OUTPUT_DIR"
  echo ""
  for plugin in "${PLUGINS[@]}"; do
    bundle="$OUTPUT_DIR/$plugin/1.0.0/$plugin.js"
    if [ -f "$bundle" ]; then
      size=$(ls -lh "$bundle" | awk '{print $5}')
      echo "  $plugin: $size"
    fi
  done
fi

echo ""
if [ $failed -gt 0 ]; then
  log_error "Some plugins failed to build"
  exit 1
fi

log_success "All plugins built successfully!"
