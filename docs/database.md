# Database Architecture Guide

## Overview

The NAAP Platform uses a **single database, multi-schema** architecture. One PostgreSQL instance hosts all data, with each plugin and service isolated into its own [PostgreSQL schema](https://www.postgresql.org/docs/current/ddl-schemas.html).

Benefits:
- **Data isolation**: Each plugin's tables are in a separate schema (e.g., `plugin_community`, `plugin_daydream`)
- **Single connection**: All services share one connection pool via `@naap/database`
- **Cross-schema queries**: Prisma supports cross-schema relations when needed
- **Simplified ops**: One DB to back up, monitor, and manage

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  Service / Plugin Layer                    │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────┐     │
│  │ base-svc │  │ community    │  │ daydream-video │ ... │
│  └────┬─────┘  └────┬─────────┘  └────┬───────────┘     │
│       │              │                  │                  │
│       └──────────────┼──────────────────┘                  │
│                      │                                     │
│       ┌──────────────▼──────────────┐                      │
│       │   @naap/database            │                      │
│       │   - Singleton Prisma Client │                      │
│       │   - Connection Pool         │                      │
│       │   - Health Checks           │                      │
│       │   - Transaction Helpers     │                      │
│       └──────────────┬──────────────┘                      │
└──────────────────────┼─────────────────────────────────────┘
                       │
               ┌───────▼────────┐
               │  naap-db       │
               │  PostgreSQL 16 │
               │                │
               │  ┌───────────┐ │
               │  │ public    │ │ ← Core platform (User, Auth, RBAC, etc.)
               │  ├───────────┤ │
               │  │ plugin_   │ │ ← Community Hub
               │  │ community │ │
               │  ├───────────┤ │
               │  │ plugin_   │ │ ← Daydream Video
               │  │ daydream  │ │
               │  ├───────────┤ │
               │  │ plugin_   │ │ ← My Wallet, My Dashboard, Gateway, etc.
               │  │ wallet..  │ │
               │  └───────────┘ │
               └────────────────┘
```

## Schemas

| Schema               | Owner            | Description                          |
|----------------------|------------------|--------------------------------------|
| `public`             | base-svc         | Core: User, Auth, Plugin, Team, RBAC |
| `plugin_community`   | community plugin | Posts, Comments, Votes, Badges       |
| `plugin_wallet`      | my-wallet plugin | WalletConnection, Transactions       |
| `plugin_dashboard`   | my-dashboard     | Dashboard, Preferences               |
| `plugin_daydream`    | daydream-video   | DaydreamSettings, DaydreamSession    |
| `plugin_gateway`     | gateway-manager  | Gateway, Connections, Metrics        |
| `plugin_capacity`    | capacity-planner | CapacityRequest, SoftCommit          |
| `plugin_developer_api` | developer-api  | AIModel, GatewayOffer, ApiKey        |

## Connection

All services and plugins use the same connection string:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap"
```

This is set in each backend's `.env` file and in `packages/database/.env`.

## Prisma Configuration

### Unified Schema

The single source of truth for all database models lives in:

```
packages/database/prisma/schema.prisma
```

Key configuration:

```prisma
generator client {
  provider        = "prisma-client-js"
  output          = "../src/generated/client"
  previewFeatures = ["multiSchema"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["public", "plugin_community", "plugin_wallet", ...]
}

model CommunityPost {
  id    String @id @default(uuid())
  title String
  // ...
  @@schema("plugin_community")
}
```

### Using the Client

Every plugin and service imports from `@naap/database`:

```typescript
// In plugin db/client.ts:
import { prisma } from '@naap/database';
export const db = prisma;

// In plugin server.ts:
import { db } from './db/client.js';
const posts = await db.communityPost.findMany();
```

## Adding a New Plugin Schema

### Step 1: Add Schema Name

Add to three places:

1. **`docker/init-schemas.sql`**:
   ```sql
   CREATE SCHEMA IF NOT EXISTS plugin_your_plugin;
   ```

2. **`packages/database/prisma/schema.prisma`** — `schemas` array:
   ```prisma
   schemas = ["public", ..., "plugin_your_plugin"]
   ```

3. **`bin/start.sh`** — `PLUGIN_SCHEMAS` array:
   ```bash
   PLUGIN_SCHEMAS=(
     ...
     "plugin_your_plugin"
   )
   ```

### Step 2: Add Models

Add your models to `packages/database/prisma/schema.prisma`:

```prisma
model YourPluginWidget {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@schema("plugin_your_plugin")
}
```

### Step 3: Generate and Push

```bash
cd packages/database
npx prisma generate
npx prisma db push
```

### Step 4: Use in Plugin

```typescript
// plugins/your-plugin/backend/src/db/client.ts
import { prisma } from '@naap/database';
export const db = prisma;

// plugins/your-plugin/backend/src/server.ts
import { db } from './db/client.js';
const widgets = await db.yourPluginWidget.findMany();
```

### Step 5: Add `@naap/database` dependency

```json
{
  "dependencies": {
    "@naap/database": "workspace:*"
  }
}
```

## Development Workflow

### Start database

```bash
./bin/start.sh start --infra
# or:
docker-compose up -d database
```

### Push schema changes

```bash
cd packages/database
npx prisma db push
```

### Generate client after schema changes

```bash
cd packages/database
npx prisma generate
```

### Open Prisma Studio

```bash
cd packages/database
npx prisma studio
```

### Validate everything

```bash
./bin/start.sh validate
```

## Troubleshooting

### "Table does not exist" errors

The schema hasn't been pushed. Run:
```bash
cd packages/database && npx prisma db push
```

### "Schema does not exist" errors

The PostgreSQL schemas weren't created. Either:
1. Recreate the container: `docker-compose down -v && docker-compose up -d database`
2. Or manually create: `docker exec naap-db psql -U postgres -d naap -c "CREATE SCHEMA IF NOT EXISTS plugin_xxx;"`

### Connection refused

Check the container is running:
```bash
docker-compose ps
docker exec naap-db pg_isready -U postgres
```

### Wrong DATABASE_URL

All `.env` files must point to the unified database:
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap"
```

Run `./bin/start.sh validate` to check all configs.

## Best Practices

1. **Never create per-plugin database containers** — all data goes in the unified DB
2. **Always use `@@schema("plugin_xxx")`** on every model to ensure table isolation
3. **Import from `@naap/database`** — never create local PrismaClient instances
4. **Use the unified schema** in `packages/database/prisma/schema.prisma` as the single source of truth
5. **Run `prisma generate`** from `packages/database` after any schema change
6. **Add new schemas** to all three locations (SQL init, Prisma schema, start.sh)

## Security

- Never commit `.env` files with production credentials
- Use strong passwords in production (`docker-compose.production.yml` uses env vars)
- Limit database access to the Docker network
- PostgreSQL schemas provide logical isolation, not security boundaries
