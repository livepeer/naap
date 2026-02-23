# Simplified Plugin Development

This guide explains the **progressive disclosure** approach to NAAP plugin development. Start simple, add complexity only when you need it.

## The Three Paths

| Path | Command | What you get | Prerequisites |
|------|---------|-------------|---------------|
| **Frontend-only** (default) | `naap-plugin create my-plugin` | React UI plugin | Node.js only |
| **Simple full-stack** | `naap-plugin create my-plugin --template full-stack --simple` | React UI + Express API with in-memory storage | Node.js only |
| **Full-stack with database** | `naap-plugin create my-plugin --template full-stack` | React UI + Express API + PostgreSQL | Node.js + Docker |

## Recommended Workflow

### Start frontend-only

Most plugins begin as a UI. You can always add a backend later.

```bash
naap-plugin create my-widget
cd my-widget
naap-plugin dev
```

Edit `frontend/src/App.tsx` — your plugin is live.

### Need an API? Add a simple backend

When you need server-side logic but don't want Docker/Prisma overhead:

```bash
naap-plugin create my-service --template full-stack --simple
```

This gives you an Express server with in-memory CRUD routes — no Docker, no Prisma, no database setup. Swap in a real database when you're ready.

### Need persistence? Upgrade to full-stack

```bash
naap-plugin create my-app --template full-stack
```

This scaffolds Prisma schema, database client, and Docker configuration.

## Adding Features Incrementally

Instead of starting over, use `naap-plugin add` to extend your plugin:

```bash
# Add a new API endpoint (creates route file + wires into aggregator)
naap-plugin add endpoint users --crud

# Add a Prisma model to the unified schema (monorepo only)
naap-plugin add model Todo title:String done:Boolean
```

Both commands are idempotent — running them twice won't create duplicates.

## Key Concepts

- **`createPlugin()`** is the single canonical mount pattern. All scaffolded plugins use it.
- **`mount.tsx`** is the UMD entry point. It delegates to `App.tsx` — you rarely edit it.
- **`main.tsx`** is the standalone development entry for running outside the NAAP shell.
- **Route files** go in `backend/src/routes/`. See `routes/README.md` for the pattern.

## Migration Note

If you have automation that relied on the previous default (`full-stack`), update it to pass `--template full-stack` explicitly. The new default is `frontend-only`.
