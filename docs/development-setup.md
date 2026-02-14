# Development Setup Guide

## Prerequisites

- **Node.js**: 20+
- **npm**: 10+
- **Docker**: 20.10+ (for local PostgreSQL)
- **Git**: 2.x+

> **Note:** NaaP uses **npm** as its package manager. Do not use pnpm or yarn.

## Quick Setup

```bash
# Clone and start (~30s after npm install)
git clone https://github.com/livepeer/naap.git
cd naap
./bin/start.sh
```

Open **http://localhost:3000** when setup completes.

## What Setup Does

The `start.sh` script automatically runs setup on first use:

| Step | What It Does |
|------|--------------|
| 1. Check Dependencies | Verifies Node.js 20+, npm, Git, Docker |
| 2. Environment Config | Creates `.env.local` and all plugin `.env` files |
| 3. Install Packages | Runs `npm install` for the monorepo + all workspaces |
| 4. Database Setup | Starts single PostgreSQL via Docker, creates schemas, seeds data |
| 5. Build Plugins | Builds all 12 plugin UMD bundles (with source hashing for future skip) |
| 6. Verification | Checks critical files and workspace links |

Setup runs automatically on first start. After that, `start.sh` handles everything.

## Architecture Overview

NaaP uses a **single PostgreSQL database** with **multi-schema isolation**:

- All models live in `packages/database/prisma/schema.prisma`
- Each plugin gets its own schema (e.g., `plugin_community`, `plugin_daydream`)
- All services/plugins import from `@naap/database`

There is **no Kafka**. Inter-service communication uses the in-app event bus.

## Daily Development

After first-time setup, use `start.sh` for all development. Smart start
is the default:

```bash
# Smart start (~6s) -- auto-detects which plugins you changed
./bin/start.sh

# Start a specific plugin + shell (~6s)
./bin/start.sh community

# Start multiple plugins (~8s)
./bin/start.sh gateway-manager community

# Everything (~10s warm, ~25s cold)
./bin/start.sh --all

# Stop everything (~2s)
./bin/stop.sh
```

### How smart start works

1. Skips `prisma db push` (trusts existing DB state)
2. Skips plugin CDN accessibility verification
3. Compares source hashes of all plugins against last build
4. Rebuilds only changed plugins (typically 0-1)
5. Starts shell + marketplace + changed plugin backends

If nothing has changed, it starts shell-only in ~6 seconds.

### Add `--timing` to see where time goes

```bash
./bin/start.sh --all --timing
# Output:
#   Infrastructure    1s
#   Plugin builds     0s   (all cached)
#   Core services     3s
#   Shell + backends  2s
#   Verification      1s
#   TOTAL             7s
```

### Working on a Plugin

```bash
# Option A: start shell + your plugin backend
./bin/start.sh my-plugin

# Option B: dev mode with HMR (frontend hot reload)
./bin/start.sh dev my-plugin

# Quick restart cycle
./bin/stop.sh && ./bin/start.sh my-plugin
```

### Database Changes

All schema operations run from the central `packages/database` directory:

```bash
cd packages/database

# Edit schema.prisma, then:
npx prisma generate    # Generate the typed client
npx prisma db push     # Push schema to database
npx prisma studio      # Open Prisma Studio (GUI)
```

### Reset Database

```bash
cd packages/database
npx prisma db push --force-reset
```

## Environment Variables

### Shell (`apps/web-next/.env.local`)

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/naap
NEXTAUTH_SECRET=dev-secret-change-me-in-production-min-32-chars
BASE_SVC_URL=http://localhost:4000
PLUGIN_SERVER_URL=http://localhost:3100
```

### Plugin Backends (`plugins/<name>/backend/.env`)

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap?schema=plugin_<schema>"
PORT=<plugin-port>
```

## Development URLs

| Service | URL | Description |
|---------|-----|-------------|
| Shell | http://localhost:3000 | Main application |
| Base Service | http://localhost:4000/healthz | Core API |
| Plugin Server | http://localhost:3100/plugins | Plugin asset server |

Plugin backends run on ports 4001-4012. Run `./bin/start.sh status` for the full list.

## Deployment

The platform deploys to **Vercel** as a single Next.js application. On Vercel:
- Plugin API routes are handled by Next.js API route handlers (no separate Express servers)
- Plugin UMD bundles are served via same-origin CDN routes
- Database is a managed PostgreSQL (e.g., Neon) connected via `DATABASE_URL`

See [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) for production deployment details.

## Troubleshooting

### Dev Stops Working or Pages 500 After Merge/Branch Switch

If you merged branches (especially with package.json or package-lock.json conflicts),
the `.next` cache can become corrupted, causing `MODULE_NOT_FOUND` or 500 errors:

```bash
# Full clean restart (clears .next, re-syncs DB)
./bin/stop.sh
./bin/start.sh --clean
```

If that doesn’t help, do a full dependency refresh:

```bash
./bin/stop.sh
rm -rf node_modules apps/*/node_modules packages/*/node_modules plugins/*/*/node_modules services/*/node_modules
npm install
./bin/start.sh --clean
```

### Port Already in Use

```bash
./bin/stop.sh              # cleans up all platform processes
# or manually:
lsof -ti:3000 | xargs kill -9
```

### Database Connection Failed

```bash
docker ps                  # Check naap-db container is running
docker logs naap-db        # Check DB logs
```

### Prisma Client Not Found

```bash
cd packages/database
npx prisma generate
```

### Service Not Starting

```bash
./bin/start.sh status      # See what is running
./bin/start.sh logs base-svc  # Check logs
./bin/start.sh validate    # Full health check (49 checks)
```

## IDE Setup

### VS Code / Cursor (Recommended)

Install recommended extensions:
- **Prisma** — Database schema support
- **ESLint** — Linting
- **Tailwind CSS IntelliSense** — Tailwind autocomplete
- **TypeScript** — Type checking

## Next Steps

- Read [Database Guide](./database.md) for database architecture
- Read [Architecture](./architecture.md) for system overview
- Follow the [Plugin Development Guide](/docs/guides/your-first-plugin) to build a plugin
