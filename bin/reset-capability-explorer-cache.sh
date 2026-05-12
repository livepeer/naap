#!/usr/bin/env bash
# Clear Capability Explorer warm cache and per-source snapshots so the next
# POST /api/v1/capability-explorer/refresh (or cron) does a full re-fetch.
# Does not delete user CapabilityQuery rows.
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set. Example: export DATABASE_URL=postgresql://..." >&2
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM plugin_capability_explorer."CapabilitySnapshot";
DELETE FROM plugin_capability_explorer."CapabilityMergedView";
UPDATE plugin_capability_explorer."CapabilityExplorerConfig"
SET
  "lastRefreshAt" = NULL,
  "lastRefreshStatus" = NULL
WHERE id = 'default';
COMMIT;
SQL

echo "Capability explorer cache cleared (snapshots + merged view; config refresh timestamps reset)."
