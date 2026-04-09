# Experimental Plugin Preview Workflow

This guide covers how to develop, test, and graduate experimental plugins without exposing them to all users. The workflow works identically on local dev and Vercel preview deployments.

## Overview

Experimental plugins are hidden by default. Only admins and explicitly added preview testers can see them. This is controlled by three `PluginPackage` fields:

| Field | Purpose |
|---|---|
| `isCore` | When `true`, auto-installs for all users (shows in sidebar without marketplace install) |
| `visibleToUsers` | When `false`, hidden from non-admin users |
| `previewTesterUserIds` | User IDs or emails of users who can see the plugin even when hidden |

## Quick Start

### 1. Mark the plugin as experimental

Add `"experimental": true` to your `plugin.json`:

```json
{
  "name": "my-new-plugin",
  "displayName": "My New Plugin",
  "experimental": true,
  ...
}
```

When the plugin is registered for the first time (via `sync-plugin-registry.ts`), it will automatically set `visibleToUsers: false`. Subsequent syncs do not overwrite this, so admin changes are preserved.

### 2. Local testing

```bash
# Start the dev server with your plugin
SHELL_PORT=3030 ./bin/start.sh dev my-new-plugin

# Add yourself as a preview tester (auto-syncs DB + configures visibility)
./bin/preview-plugin.sh my-new-plugin --testers "you@email.com"
```

The plugin will now appear in your sidebar at `http://localhost:3030/plugins/my-new-plugin`.

### 3. Vercel preview testing

Push your feature branch. The Vercel preview build will:
1. Build the plugin's UMD bundle
2. Push the Prisma schema to the **preview** Neon DB branch
3. Run `sync-plugin-registry.ts` which creates `WorkflowPlugin` + `PluginPackage` rows
4. Because `experimental: true`, the plugin is created with `visibleToUsers: false`

Then configure testers against the preview URL:

```bash
./bin/preview-plugin.sh my-new-plugin \
  --url "https://naap-git-feat-xxx-livepeer.vercel.app" \
  --token "<admin-session-token>" \
  --testers "tester@email.com"
```

Production is completely unaffected — preview deployments use a separate Neon DB branch.

### 4. Graduate to public

When the plugin is ready for all users:

```bash
# Option A: Use the helper script
./bin/preview-plugin.sh my-new-plugin --publish

# Option B: Remove "experimental": true from plugin.json
# The next sync/deploy will register it as visibleToUsers: true
```

## Helper Script Reference

`bin/preview-plugin.sh` automates the full workflow:

```
Usage: ./bin/preview-plugin.sh <plugin-name> [options]

Options:
  --testers "id1,email@example.com"   Add preview testers (makes core + hidden)
  --hide                              Hide from all non-admin users (clear testers)
  --publish                           Make visible to all users (graduate)
  --status                            Show current visibility status
  --url <base-url>                    Target URL (default: http://localhost:3000)
  --token <session-token>             Admin session token (required for remote)
```

**Local examples:**

```bash
# Check current state
./bin/preview-plugin.sh orchestrator-leaderboard --status

# Add testers (auto-syncs DB, auto-authenticates locally)
./bin/preview-plugin.sh orchestrator-leaderboard --testers "admin@livepeer.org"

# Hide from everyone except admins
./bin/preview-plugin.sh orchestrator-leaderboard --hide

# Graduate: make visible to all
./bin/preview-plugin.sh orchestrator-leaderboard --publish
```

**Remote (Vercel preview) examples:**

```bash
PREVIEW_URL="https://naap-git-feat-orchestrator-leaderboard-livepeer.vercel.app"

# Check state on preview deployment
./bin/preview-plugin.sh orchestrator-leaderboard \
  --url "$PREVIEW_URL" --token "$TOKEN" --status

# Add testers on preview deployment
./bin/preview-plugin.sh orchestrator-leaderboard \
  --url "$PREVIEW_URL" --token "$TOKEN" \
  --testers "tester@email.com"
```

## Admin API Reference

The underlying API endpoint is `PUT /api/v1/admin/plugins/core`:

```bash
curl -X PUT $BASE_URL/api/v1/admin/plugins/core \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "corePluginNames": ["marketplace", "community", "myNewPlugin"],
    "hiddenPluginNames": ["myNewPlugin"],
    "previewTesterUserIdsByPlugin": {
      "myNewPlugin": ["user-id-or-email"]
    }
  }'
```

## How It Works Internally

```
plugin.json ("experimental": true)
  └─→ plugin-discovery.ts reads the flag
       └─→ sync-plugin-registry.ts
            ├─ First create: sets visibleToUsers=false
            └─ Subsequent updates: preserves admin-configured visibility
                 └─→ Admin configures via API/script
                      └─→ Personalized API filters by user ID / preview testers
                           └─→ Sidebar shows plugin only to allowed users
```

### Database isolation

| Environment | Database | Plugin cleanup |
|---|---|---|
| Production | Neon `main` branch | Full cleanup (unlists removed plugins) |
| Preview | Neon preview branch | No cleanup (skipped to avoid cross-PR interference) |
| Local dev | Local PostgreSQL | Full cleanup |

This means experimental plugins on preview deployments are completely isolated from production data.
