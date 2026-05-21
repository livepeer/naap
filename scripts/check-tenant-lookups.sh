#!/usr/bin/env bash
# scripts/check-tenant-lookups.sh — lint guard for G-008.
#
# Fails CI if a Prisma findFirst / findUnique on a multi-tenant model uses a
# bare { id: ... } where-clause without tenantId. To intentionally exempt a
# call (e.g., admin/registry table, public HMAC-gated endpoint), put a
# `// safe: <reason>` comment on the same line or the line immediately above.
#
# Detects only single-line where blocks of the form `where: { id: ... }`;
# multi-line/computed where objects are out of scope here (use the
# documentary test in tests/e2e/gtm/security/cross-tenant-lookups.spec.ts).
set -e

cd "$(dirname "$0")/.."

# Match: .findFirst({ where: { id   OR  .findUnique({ where: { id
PATTERN='\.(findFirst|findUnique)\(\{[[:space:]]*where:[[:space:]]*\{[[:space:]]*id[^a-zA-Z_]'

hits=""
while IFS= read -r line; do
  # line format: file:lineno:content
  content=$(echo "$line" | cut -d: -f3-)
  # Skip if same line already has tenantId or // safe:
  if echo "$content" | grep -qE "tenantId|// safe:"; then
    continue
  fi
  # Check the line above for // safe:
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  prev=$((lineno - 1))
  if [ "$prev" -ge 1 ]; then
    prevline=$(sed -n "${prev}p" "$file")
    if echo "$prevline" | grep -q "// safe:"; then
      continue
    fi
  fi
  hits="${hits}${line}
"
done < <(grep -rnE "$PATTERN" plugins/agentbook-*/backend/src/*.ts 2>/dev/null || true)

if [ -n "$hits" ]; then
  echo "ERROR: bare-id lookup on possibly multi-tenant model (add tenantId or // safe: comment):"
  printf '%s' "$hits"
  exit 1
fi
echo "OK: no bare-id lookups on multi-tenant models"
