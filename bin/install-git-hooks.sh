#!/bin/bash
#
# Install git pre-push hook to run validation before every push.
# Called automatically by setup.sh; can be run manually: ./bin/install-git-hooks.sh
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
HOOKS_DIR="$ROOT_DIR/.git/hooks"
PRE_PUSH="$HOOKS_DIR/pre-push"

if [ ! -d "$ROOT_DIR/.git" ]; then
  echo "Not a git repository, skipping hook install"
  exit 0
fi

mkdir -p "$HOOKS_DIR"

# Use a wrapper that invokes our script — avoids path/relocation issues
HOOK_CONTENT="#!/bin/bash
# NAAP pre-push validation — installed by bin/install-git-hooks.sh
# Skip with: git push --no-verify
exec \"$SCRIPT_DIR/pre-push-validate.sh\"
"

if [ -f "$PRE_PUSH" ] && grep -q "pre-push-validate" "$PRE_PUSH" 2>/dev/null; then
  echo "[OK] Pre-push hook already installed"
  exit 0
fi

if [ -f "$PRE_PUSH" ]; then
  echo "[WARN] Pre-push hook exists but is not from NAAP. Backup at .git/hooks/pre-push.bak"
  cp "$PRE_PUSH" "$PRE_PUSH.bak"
fi

echo "$HOOK_CONTENT" > "$PRE_PUSH"
chmod +x "$PRE_PUSH"
echo "[OK] Pre-push hook installed (runs plugin-build + SDK tests before push)"
echo "     Skip with: git push --no-verify"
