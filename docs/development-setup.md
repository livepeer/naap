# Development Setup Guide

## Prerequisites

- **Node.js**: 20+
- **npm**: 10+
- **Docker**: 20.10+ (for local PostgreSQL)
- **Git**: 2.x+

> **Note:** NaaP uses **npm** as its package manager. Do not use pnpm or yarn.

## Quick Setup

```bash
# Clone repository
git clone https://github.com/livepeer/naap.git
cd naap

# Run the automated setup (installs deps, starts DB, builds plugins)
./bin/setup.sh

# Start the platform
./bin/start.sh
```

Or all in one line:

```bash
git clone https://github.com/livepeer/naap.git && cd naap && ./bin/setup.sh --start
```

Open **http://localhost:3000** when setup completes.

## What Setup Does

The `setup.sh` script automates:

| Step | What It Does |
|------|--------------|
| 1. Check Dependencies | Verifies Node.js 20+, npm, Git, Docker |
| 2. Environment Config | Creates `.env.local` and all plugin `.env` files |
| 3. Install Packages | Runs `npm install` for the monorepo + all workspaces |
| 4. Database Setup | Starts single PostgreSQL via Docker, creates schemas, seeds data |
| 5. Build Plugins | Builds all 11 plugin UMD bundles for CDN serving |
| 6. Verification | Checks critical files and workspace links |

## Architecture Overview

NaaP uses a **single PostgreSQL database** with **multi-schema isolation**:

- All models live in `packages/database/prisma/schema.prisma`
- Each plugin gets its own schema (e.g., `plugin_community`, `plugin_daydream`)
- All services/plugins import from `@naap/database`

There is **no Kafka**. Inter-service communication uses the in-app event bus.

## Development Workflow

### Starting the Platform

```bash
# Shell + core only (fastest startup)
./bin/start.sh

# Everything including all plugin backends
./bin/start.sh start --all

# Develop a specific plugin with hot reload
./bin/start.sh dev my-dashboard
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

### Working on a Plugin

1. Start the platform: `./bin/start.sh`
2. Start the plugin in dev mode: `./bin/start.sh dev my-plugin`
3. Make changes — hot reload is automatic
4. Test with `./bin/start.sh validate`

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

### Port Already in Use

```bash
lsof -ti:3000 | xargs kill -9
```

### Database Connection Failed

```bash
docker-compose ps          # Check container is running
docker-compose logs database  # Check DB logs
```

### Prisma Client Not Found

```bash
cd packages/database
npx prisma generate
```

### Service Not Starting

```bash
npm install                # Reinstall dependencies
./bin/start.sh validate    # Check platform health
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
