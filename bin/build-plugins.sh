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

# All plugins to build
PLUGINS=(
  "capacity-planner"
  "community"
  "daydream-video"
  "developer-api"
  "gateway-manager"
  "marketplace"
  "my-dashboard"
  "my-wallet"
  "network-analytics"
  "orchestrator-manager"
  "plugin-publisher"
)

# Parse arguments
PARALLEL=false
CLEAN=false
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
  local output_subdir="$OUTPUT_DIR/$plugin_name/1.0.0"

  # Check if vite config exists
  if [ ! -f "$plugin_dir/vite.config.ts" ]; then
    log_warn "Skipping $plugin_name - no vite.config.ts"
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
  npx vite build --mode production 2>&1 | while read line; do
    echo "  $line"
  done

  # Check if build succeeded
  if [ ! -d "dist/production" ]; then
    log_error "Build failed for $plugin_name - no dist/production directory"
    return 1
  fi

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

# Build specific plugin or all
if [ -n "$SPECIFIC_PLUGIN" ]; then
  PLUGINS=("$SPECIFIC_PLUGIN")
fi

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
  for pid in "${pids[@]}"; do
    if wait $pid; then
      ((success++))
    else
      ((failed++))
    fi
  done
else
  log_info "Building ${total} plugins sequentially..."
  echo ""

  for plugin in "${PLUGINS[@]}"; do
    if build_plugin "$plugin"; then
      ((success++))
    else
      ((failed++))
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
