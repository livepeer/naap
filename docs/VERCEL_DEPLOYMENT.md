# NaaP Vercel Deployment

## Architecture

NaaP deploys to **Vercel** as a single Next.js 15 application. There are no separate backend servers in production — all plugin API logic runs as Next.js API route handlers.

```
┌──────────────────────────────────────────────────────────┐
│                     Vercel                                │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │           apps/web-next (Next.js 15)               │  │
│  │                                                     │  │
│  │  Pages:  /, /plugins/:name, /teams                 │  │
│  │  API:    /api/v1/auth/*, /api/v1/teams/*           │  │
│  │  API:    /api/v1/{plugin-name}/* (46+ routes)      │  │
│  │  CDN:    /cdn/plugins/:name/:version/*             │  │
│  │  Health: /api/health                               │  │
│  └──────────────────────┬─────────────────────────────┘  │
└─────────────────────────┼────────────────────────────────┘
                          │
               ┌──────────▼──────────┐
               │   PostgreSQL        │
               │   (Neon / managed)  │
               │   Single DB with    │
               │   multi-schema      │
               │   isolation          │
               └─────────────────────┘
```

## What Runs on Vercel

| Component | Path | Description |
|-----------|------|-------------|
| Shell UI | `apps/web-next` | Next.js 15 App Router (pages, layouts, components) |
| Plugin frontends | `/plugins/:name` | UMD bundles loaded at runtime |
| API route handlers | `/api/v1/{plugin-name}/*` | All plugin backends as serverless functions |
| Plugin CDN | `/cdn/plugins/:name/:version/*` | Same-origin plugin asset serving |
| Health check | `/api/health` | Database + environment checks |

## Environment Variables

Set in Vercel Dashboard → Project Settings → Environment Variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `DATABASE_URL_UNPOOLED` | Yes | Non-pooled connection (for Prisma migrations) |
| `NEXTAUTH_SECRET` | Yes | Session encryption key |
| `NEXT_PUBLIC_APP_URL` | Yes | Production URL |
| `BLOB_READ_WRITE_TOKEN` | No | Vercel Blob for plugin storage |
| `ABLY_API_KEY` | No | Realtime features |
| `GOOGLE_CLIENT_ID` | No | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth |
| `GITHUB_CLIENT_ID` | No | GitHub OAuth |
| `GITHUB_CLIENT_SECRET` | No | GitHub OAuth |

### Database Environment Variables (Neon Branching)

NaaP uses **Neon database branching** to separate preview from production data.
Each Vercel environment (Production, Preview) must have its own `DATABASE_URL`
pointing to the correct Neon branch.

#### Setup Steps

1. **Neon Console**: Go to your Neon project. You should have two branches:
   - `main` — production data (default branch)
   - `preview` — isolated branch for PR preview deployments

2. **Get connection strings**: For each branch, copy the pooled and unpooled
   connection strings from Neon Console → Branch → Connection Details.

3. **Vercel Dashboard** → Project Settings → Environment Variables:

   **Scope existing database vars to Production only:**
   - Edit `DATABASE_URL` → set scope to **Production** only → use the Neon `main` branch pooled URL
   - Edit `DATABASE_URL_UNPOOLED` → set scope to **Production** only → use the Neon `main` branch unpooled URL
   - Edit all `POSTGRES_*` and `PG*` variables → set scope to **Production** only

   **Add preview-scoped database vars:**
   - Add `DATABASE_URL` → set scope to **Preview** only → use the Neon `preview` branch pooled URL
   - Add `DATABASE_URL_UNPOOLED` → set scope to **Preview** only → use the Neon `preview` branch unpooled URL

   Example (the compute endpoint hostname differs per branch):
   ```
   # Production (Neon main branch)
   DATABASE_URL=postgresql://neondb_owner:***@ep-frosty-pine-aiybl1uq-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require
   DATABASE_URL_UNPOOLED=postgresql://neondb_owner:***@ep-frosty-pine-aiybl1uq.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require

   # Preview (Neon preview branch — different compute endpoint)
   DATABASE_URL=postgresql://neondb_owner:***@ep-<preview-endpoint>-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require
   DATABASE_URL_UNPOOLED=postgresql://neondb_owner:***@ep-<preview-endpoint>.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```

4. **GitHub Secrets** (for the preview branch reset workflow):
   - `NEON_API_KEY` — Neon API key ([create one here](https://neon.tech/docs/manage/api-keys))
   - `NEON_PROJECT_ID` — Your Neon project ID (visible in project settings)
   - `NEON_PREVIEW_BRANCH_ID` — The branch ID of the `preview` branch (format: `br-xxx-xxx-xxxxxxxx`, visible in Neon Console → Branches)

#### How It Works

```
PR created/updated
  → Vercel preview build
  → DATABASE_URL resolves to Neon "preview" branch (via Preview-scoped env var)
  → prisma db push applies schema to preview branch
  → Preview deployment runs against isolated preview data

PR merged to main
  → Vercel production build
  → DATABASE_URL resolves to Neon "main" branch (via Production-scoped env var)
  → prisma db push promotes schema changes to production
  → Reset Preview DB workflow resets preview branch to match main
```

## Build Process

The `vercel.json` at the repo root configures:
- **Build command**: `./bin/vercel-build.sh` — builds all plugin UMD bundles then the Next.js app
- **Output directory**: `apps/web-next/.next`

### vercel.json Headers

Key headers configured:
- `Permissions-Policy: camera=(self), microphone=(self), display-capture=(self)` — for plugins like Daydream Video
- `Content-Security-Policy` — for API routes
- `X-Content-Type-Options: nosniff`

## Local Development vs Production

| Aspect | Local Dev | Vercel (Production) |
|--------|-----------|---------------------|
| Plugin APIs | Express servers (ports 4101-4211) | Next.js API route handlers |
| Plugin assets | Plugin server (port 3100) | Same-origin CDN route |
| Database | Docker PostgreSQL (port 5432) | Neon managed PostgreSQL |
| Auth | Dev defaults | OAuth providers |
| URL resolution | `getPluginBackendUrl()` resolves to localhost | Same-origin `/api/v1/...` |

## Observability

Every request through the middleware gets:
- `x-request-id`: Unique request identifier
- `x-trace-id`: Distributed trace ID
- `x-request-start`: Timestamp when request entered middleware

## Deployment Workflow

NaaP uses a **feature-branch-off-main** (trunk-based) model. There is no
separate staging branch -- Vercel PR previews serve as staging.

### Preview (PR-based staging)

Every pull request targeting `main` gets a Vercel preview deployment
automatically. This serves as the staging environment:

- Each PR gets a unique preview URL (e.g., `naap-<hash>.vercel.app`)
- Preview builds use the same `./bin/vercel-build.sh` as production
- Preview deployments use the Neon `preview` database branch (isolated from production)
- Schema changes are auto-applied to the preview DB via `prisma db push`
- Teams can test their changes — including schema changes — without risking production data
- No shared staging branch means no merge conflicts between teams

### Production

Merge to `main` triggers production deployment:
1. Vercel builds with `./bin/vercel-build.sh`
2. Deploys to production URL (`naap-platform.vercel.app`)
3. Automated health check at `/api/health`
4. Automatic rollback if health check fails

### Rollback

If production issues are detected post-deploy:
1. Trigger the **Deploy** workflow with `rollback` action, or
2. Vercel auto-rolls back if the health check fails during deployment

## Troubleshooting

### Common Build Errors

1. **`Cannot find module 'tailwindcss'`** — Delete `postcss.config.js` from your plugin. PostCSS is configured in the shared `@naap/plugin-build` Vite config.
2. **`isProductionHost is not exported`** — Use `getPluginBackendUrl()` from `@naap/plugin-sdk` instead.
3. **`Prisma Client could not locate the Query Engine`** — Check `next.config.js` has PrismaPlugin and `outputFileTracingRoot` configured.

### Common Runtime Errors

1. **Port number in URL** — Hardcoded `localhost:PORT`. Fix: use `getPluginBackendUrl()`.
2. **CORS errors** — Should not happen on Vercel (same-origin). Check `vercel.json` headers.
3. **Permissions-Policy violation** — Camera/microphone blocked. Check `vercel.json` `Permissions-Policy` header.
