#!/usr/bin/env bash
# Push OAuth-related env vars to Vercel from your terminal (secrets are not stored in git).
# Prereqs: npm i -g vercel@latest (or npx), run `vercel link` in apps/web-next first.
#
# Usage:
#   cd apps/web-next
#   ./scripts/push-oauth-env-to-vercel.sh              # defaults to production
#   ./scripts/push-oauth-env-to-vercel.sh preview
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="${1:-production}"
if [[ "$TARGET" != "production" && "$TARGET" != "preview" && "$TARGET" != "development" ]]; then
  echo "Usage: $0 [production|preview|development]"
  exit 1
fi

if [[ ! -f .vercel/project.json ]]; then
  echo "Link this directory first: npx vercel link"
  exit 1
fi

add_plain() {
  local name="$1" value="$2"
  printf '%s' "$value" | npx vercel env add "$name" "$TARGET" --yes --force
}

add_sensitive() {
  local name="$1" value="$2"
  printf '%s' "$value" | npx vercel env add "$name" "$TARGET" --sensitive --yes --force
}

echo "Vercel OAuth env → target: $TARGET"
echo "Default app host: https://naap-platform.vercel.app (override if needed)."
read -r -p "NEXT_PUBLIC_APP_URL [https://naap-platform.vercel.app]: " APP_URL
APP_URL=${APP_URL:-https://naap-platform.vercel.app}
# Strip trailing slash; require scheme + host (no path/query/fragment)
APP_URL="${APP_URL%/}"
if [[ ! "$APP_URL" =~ ^https?://[^/]+$ ]]; then
  echo "NEXT_PUBLIC_APP_URL must be an origin only (e.g. https://naap-platform.vercel.app), no path."
  exit 1
fi
GOOGLE_CB="${APP_URL}/api/v1/auth/callback/google"
GITHUB_CB="${APP_URL}/api/v1/auth/callback/github"

read -r -p "GOOGLE_CLIENT_ID: " GOOGLE_CLIENT_ID
read -r -s -p "GOOGLE_CLIENT_SECRET: " GOOGLE_CLIENT_SECRET
echo
read -r -p "GITHUB_CLIENT_ID: " GITHUB_CLIENT_ID
read -r -s -p "GITHUB_CLIENT_SECRET: " GITHUB_CLIENT_SECRET
echo

if [[ -z "$GOOGLE_CLIENT_ID" || -z "$GOOGLE_CLIENT_SECRET" || -z "$GITHUB_CLIENT_ID" || -z "$GITHUB_CLIENT_SECRET" ]]; then
  echo "All four client fields are required."
  exit 1
fi

echo "Writing NEXT_PUBLIC_APP_URL, redirect URIs, and OAuth clients..."
add_plain NEXT_PUBLIC_APP_URL "$APP_URL"
add_plain GOOGLE_REDIRECT_URI "$GOOGLE_CB"
add_plain GITHUB_REDIRECT_URI "$GITHUB_CB"
add_plain GOOGLE_CLIENT_ID "$GOOGLE_CLIENT_ID"
add_sensitive GOOGLE_CLIENT_SECRET "$GOOGLE_CLIENT_SECRET"
add_plain GITHUB_CLIENT_ID "$GITHUB_CLIENT_ID"
add_sensitive GITHUB_CLIENT_SECRET "$GITHUB_CLIENT_SECRET"

if [[ "$TARGET" == "production" ]]; then
  echo "Done. Redeploy: Vercel dashboard or npx vercel --prod"
else
  echo "Done. Redeploy: push a branch / open a preview, or npx vercel (preview for $TARGET)"
fi
