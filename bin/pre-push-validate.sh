#!/bin/bash
#
# Pre-push validation — catches build/test issues before CI.
# Run automatically via git pre-push hook (installed by setup.sh).
# Also: npm run ci-check
#
# Fast checks (~15-30s):
#   1. plugin-build compiles (required for plugin vite configs)
#   2. SDK tests pass
# Optional --full: runs full vercel-build (~2 min)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }

FULL=0
for arg in "$@"; do
  case "$arg" in
    --full|-f) FULL=1 ;;
  esac
done

cd "$ROOT_DIR" || { log_error "Failed to cd to $ROOT_DIR"; exit 1; }

log_info "Pre-push validation (quick checks)..."

# 1. plugin-build must compile — plugins import from dist/, not src/
log_info "[1/2] Building @naap/plugin-build..."
if ! (cd "$ROOT_DIR" && npm run build --workspace=@naap/plugin-build 2>&1); then
  log_error "plugin-build failed to compile. Run 'npm install' and retry."
  exit 1
fi
log_success "plugin-build OK"

# 2. SDK tests — catches codeGenerator/impl drift
log_info "[2/2] Running plugin-sdk tests..."
if ! (cd packages/plugin-sdk && npm run test:run 2>&1); then
  log_error "SDK tests failed. Fix before pushing."
  exit 1
fi
log_success "SDK tests OK"

if [ "$FULL" = "1" ]; then
  log_info "[3/3] Full Vercel build..."
  export DATABASE_URL="${DATABASE_URL:-postgresql://test:test@localhost:5432/test}"
  export NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-test-secret-at-least-32-characters-long}"
  if ! ./bin/vercel-build.sh 2>&1; then
    log_error "Vercel build failed."
    exit 1
  fi
  log_success "Full build OK"
fi

log_success "Pre-push validation passed."
exit 0
