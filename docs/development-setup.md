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
npm install
npm run dev
```

Open **http://localhost:3000** when setup completes (port may vary if 3000 is in use).

## What Setup Does

The dev runner automatically runs setup on first use:

| Step | What It Does |
|------|--------------|
| 1. Check Dependencies | Verifies Node.js 20+, npm, Git, Docker |
| 2. Environment Config | Creates `.env.local` and all plugin `.env` files |
| 3. Install Packages | Runs `npm install` for the monorepo + all workspaces |
| 4. Database Setup | Starts single PostgreSQL via Docker, creates schemas, seeds data |
| 5. Build Plugins | Builds all 12 plugin UMD bundles (with source hashing for future skip) |
| 6. Verification | Checks critical files and workspace links |

Setup runs automatically on first start. After that, `npm run dev` handles everything.

## Architecture Overview

NaaP uses a **single PostgreSQL database** with **multi-schema isolation**:

- All models live in `packages/database/prisma/schema.prisma`
- Each plugin gets its own schema (e.g., `plugin_community`, `plugin_daydream`)
- All services/plugins import from `@naap/database`

There is **no Kafka**. Inter-service communication uses the in-app event bus.

## Daily Development

After first-time setup, use `npm run dev` for development:

```bash
# Start shell + base-svc + plugin-server (ports auto-selected)
npm run dev

# Stop: Ctrl+C in the terminal where dev is running

# Or stop orphaned processes by port
npm run stop
```

Console logs from all services appear in the terminal with prefixed output (`[shell]`, `[base-svc]`, `[plugin-server]`). Ports are allocated dynamically from conventional ranges (3000, 4000, 3100) when free; otherwise the next available port is used.

### Status and Validation

```bash
npm run status    # Show running services and health
npm run validate  # Health-check all services
npm run plugin:list  # List available plugins
```

### Working on a Plugin

For full plugin development (frontend HMR + backend), use the legacy start script:

```bash
./bin/legacy/start.sh.deprecated dev my-plugin
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
SUBGRAPH_API_KEY=<your-key>
# optional
SUBGRAPH_ID=<your-subgraph-id>
# Required for /api/v1/protocol-block (Livepeer round progress)
L1_RPC_URL=<your-l1-rpc-url>
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
- Database is a managed PostgreSQL (Neon) connected via `DATABASE_URL`

See [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) for production deployment details.

### Preview vs Production Database

NaaP uses **Neon database branching** to isolate preview deployments from production:

| Environment | Neon Branch | When Used |
|-------------|-------------|-----------|
| Production  | `main`      | Merges to `main` (production deploys) |
| Preview     | `preview`   | All PR preview deployments |
| Development | Local Docker | `./bin/start.sh` (local dev) |

**How it works:**

1. **PR created** — Vercel auto-deploys a preview build. The preview build runs
   `prisma db push` against the Neon `preview` branch (isolated from production).
2. **PR merged to main** — Vercel deploys to production. The production build runs
   `prisma db push` against the Neon `main` branch, promoting schema changes.
3. **After production deploy** — The `Reset Preview DB` workflow automatically
   resets the Neon `preview` branch to match `main`, so the next PR starts clean.

All open PRs share a single `preview` branch. If two PRs modify the schema
concurrently, the last-deployed PR's schema wins on the preview branch. This
is acceptable for typical workflows where schema-changing PRs are reviewed
and merged sequentially.

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
