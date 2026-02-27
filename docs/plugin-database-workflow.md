# Plugin Database Workflow Guide

## Overview

This guide covers the day-to-day workflow for making database changes in a NAAP plugin, how those changes get applied, and how to debug database issues.

For the full database architecture (schemas, connection model, adding new schemas), see [database.md](./database.md).

---

## How Plugin Database Changes Work

### Single Source of Truth

All database models for every plugin live in one file:

```
packages/database/prisma/schema.prisma
```

Plugins do **not** have their own Prisma schemas. They share a single PostgreSQL instance (`naap-db`) and are isolated via PostgreSQL schemas (e.g., `plugin_community`, `plugin_capacity`).

### What Happens When You Edit the Schema

When you modify `packages/database/prisma/schema.prisma` — adding a field, a model, changing a type — two things need to happen:

1. **Prisma Client regeneration** (`prisma generate`) — updates the TypeScript types in `packages/database/src/generated/client/`
2. **Database sync** (`prisma db push`) — applies the schema change to the running PostgreSQL database

### Automatic: `start.sh` Handles It

When you run `./bin/start.sh --all`, the `sync_unified_database()` function:

1. Computes an MD5 hash of `schema.prisma`
2. Compares it to the cached hash in `.prisma-synced`
3. If changed (or first run):
   - Runs `npx prisma generate`
   - Runs `DATABASE_URL=... npx prisma db push --skip-generate --accept-data-loss`
4. If unchanged, skips the sync entirely (saves ~3-5s)

**You don't need to do anything manually if you restart via `start.sh`.**

### Manual: Apply Without Restarting

If you want to apply schema changes without a full restart:

```bash
cd packages/database
npx prisma generate        # Regenerate TypeScript client
npx prisma db push         # Push changes to the running database
```

Or using npm scripts:

```bash
cd packages/database
npm run db:generate
npm run db:push
```

Then restart only the affected plugin backend(s).

### Formal Migrations (Production)

For development, `prisma db push` is the default (no migration files, fast iteration). For production deployments:

```bash
cd packages/database
npx prisma migrate dev --name "describe_your_change"   # Creates a migration file
npx prisma migrate deploy                               # Applies pending migrations
```

### Important Caveats

- **`--accept-data-loss`**: `start.sh` passes this flag, so destructive changes (dropping columns, changing types) will go through without prompting. Fine for dev; be careful with production data.
- **New PostgreSQL schema**: If your plugin needs a brand-new schema namespace (e.g., `plugin_my_new_thing`), you must update three places:
  1. `packages/database/prisma/schema.prisma` → `schemas` array in `datasource db`
  2. `bin/start.sh` → `PLUGIN_SCHEMAS` array
  3. `docker/init-schemas.sql` → `CREATE SCHEMA IF NOT EXISTS plugin_my_new_thing;`

---

## Debugging Database Issues

### Check Plugin Backend Logs

All plugin backend logs are written to `logs/<plugin-name>-svc.log`. Look for Prisma errors:

```bash
grep -i "prisma\|error\|unknown.*field\|column\|table" logs/<plugin-name>-svc.log | tail -20
```

### Enable Prisma Query Logging

The Prisma client in `packages/database/src/index.ts` already enables query logging in development:

```typescript
new GeneratedPrismaClient({
  log:
    process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
  // ...
});
```

To see every SQL query being executed, ensure `NODE_ENV=development` is set (the default for local dev). You'll see output like:

```
prisma:query SELECT "plugin_community"."CommunityPost"."id", ...
```

### Add Logging in Your Plugin's Route Handlers

Wrap your database calls with try/catch and log the full Prisma error:

```typescript
import { db } from './db/client.js';

app.get('/api/items', async (req, res) => {
  try {
    const items = await db.yourPluginItem.findMany();
    res.json(items);
  } catch (error) {
    // Log the full error — Prisma errors include the error code and meta
    console.error(`[your-plugin] DB error on GET /api/items:`, error);

    // If it's a known Prisma error, log extra details
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error(`  Prisma code: ${error.code}`);
      console.error(`  Meta:`, error.meta);
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### Common Prisma Error Codes

| Code   | Meaning                                   | Fix                                                                 |
|--------|-------------------------------------------|---------------------------------------------------------------------|
| P2002  | Unique constraint violation               | Check for duplicate data; add a `where` guard or use `upsert`       |
| P2003  | Foreign key constraint failure            | Ensure related record exists before creating                        |
| P2025  | Record not found (for update/delete)      | Check the record exists; use `findFirst` before mutating            |
| P2024  | Timed out waiting for connection pool     | Increase pool size or check for connection leaks                    |
| P2021  | Table does not exist                      | Run `cd packages/database && npx prisma db push`                    |
| P2022  | Column does not exist                     | Schema is out of sync — run `prisma generate && prisma db push`     |
| P1001  | Can't reach database server               | Check Docker: `docker ps \| grep naap-db`                           |
| P1003  | Database does not exist                   | Recreate: `docker compose down -v && docker compose up -d database` |

### Inspect the Database Directly

```bash
# Open Prisma Studio (visual browser)
cd packages/database && npx prisma studio

# Or connect via psql
docker exec -it naap-db psql -U postgres -d naap

# List schemas
\dn

# List tables in a plugin schema
\dt plugin_community.*

# Run a query
SELECT * FROM plugin_community."CommunityPost" LIMIT 5;
```

### Validate the Full Setup

```bash
# Checks DB connectivity, schema existence, and table counts
./bin/start.sh validate
```

### Nuclear Option: Full Reset

If the database is in a bad state and you want to start fresh:

```bash
docker compose down -v          # Remove containers and volumes
docker compose up -d database   # Recreate a clean database
cd packages/database
npx prisma db push              # Recreate all tables
npx tsx prisma/seed.ts          # Re-seed data
```

---

## AI Prompt: Debug Database Issues for Plugin `xxx`

Copy and paste the prompt below into your AI assistant (Cursor, Copilot, etc.), replacing `xxx` with your actual plugin name.

---

````
I'm developing a NAAP platform plugin called `xxx` and I'm having database issues.

**Project context:**
- Monorepo with a unified database: all plugins share one PostgreSQL instance (`naap-db`)
- Single Prisma schema at `packages/database/prisma/schema.prisma`
- Plugin tables use a dedicated PostgreSQL schema (e.g., `plugin_xxx`) with `@@schema("plugin_xxx")` on every model
- All plugins import the Prisma client from `@naap/database`: `import { prisma } from '@naap/database';`
- Plugin backend code is at `plugins/xxx/backend/src/`
- Logs are at `logs/xxx-svc.log`

**What I need you to do:**

1. **Read the Prisma schema** (`packages/database/prisma/schema.prisma`) and find all models tagged with `@@schema("plugin_xxx")`.

2. **Read my plugin's backend server** (`plugins/xxx/backend/src/server.ts`) and identify all database calls (e.g., `db.modelName.findMany()`, `db.modelName.create()`, etc.).

3. **Check for mismatches** between:
   - Model/field names in the schema vs. what the backend code references
   - Missing `@@schema("plugin_xxx")` annotations
   - Missing relations or foreign keys
   - Fields used in `where`/`orderBy` clauses that are not indexed

4. **Add structured error logging** to every route handler that touches the database:
   - Wrap each DB call in try/catch
   - Log the route, method, and full Prisma error (including `error.code` and `error.meta` for `PrismaClientKnownRequestError`)
   - Return a generic 500 to the client (don't leak internals)

5. **Verify the schema is synced** — tell me what commands to run:
   - `cd packages/database && npx prisma generate && npx prisma db push`
   - How to check the tables exist: `docker exec naap-db psql -U postgres -d naap -c "\dt plugin_xxx.*"`

6. **If there are errors**, diagnose the root cause using the Prisma error code table:
   - P2021 = table missing → need `db push`
   - P2022 = column missing → schema out of sync
   - P2002 = unique constraint → duplicate data
   - P2025 = record not found → check ID/query
   - P1001 = connection refused → Docker not running

Give me the fixed code and the exact shell commands to resolve the issue.
````

---

## Quick Reference

| Task                              | Command                                                        |
|-----------------------------------|----------------------------------------------------------------|
| Regenerate Prisma client          | `cd packages/database && npx prisma generate`                  |
| Push schema to database           | `cd packages/database && npx prisma db push`                   |
| Create a formal migration         | `cd packages/database && npx prisma migrate dev --name "desc"` |
| Open visual database browser      | `cd packages/database && npx prisma studio`                    |
| Check plugin tables exist         | `docker exec naap-db psql -U postgres -d naap -c "\dt plugin_xxx.*"` |
| Full restart with auto-sync       | `./bin/start.sh --all`                                         |
| Validate DB health                | `./bin/start.sh validate`                                      |
| Full database reset               | `docker compose down -v && docker compose up -d database && cd packages/database && npx prisma db push` |
