# NAAP Platform Deployment Guide

This guide covers deploying the NaaP platform to Vercel.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        VERCEL                                    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Next.js 15 Application                      │    │
│  │                                                          │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │    │
│  │  │  Shell UI    │  │  API Routes  │  │  Plugin CDN  │  │    │
│  │  │  (pages)     │  │  /api/v1/*   │  │  /cdn/...    │  │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │    │
│  └──────────────────────────┬──────────────────────────────┘    │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │    PostgreSQL       │
                    │    (Neon/RDS)       │
                    │  Single DB, multi-  │
                    │  schema isolation   │
                    └─────────────────────┘
```

### What Runs on Vercel

| Component | Path | Description |
|-----------|------|-------------|
| Shell UI | `/`, `/plugins/*`, `/teams` | Next.js 15 App Router pages |
| API Routes | `/api/v1/{plugin-name}/*` | 46+ route handlers for all plugins |
| Plugin CDN | `/cdn/plugins/:name/:ver/*` | UMD bundles served same-origin |
| Health | `/api/health` | Database + environment checks |

**There are no separate backend servers in production.** All plugin API logic runs as Next.js API route handlers.

## Prerequisites

### Required Accounts

- **Vercel** — Frontend + API hosting
- **Neon** (or any PostgreSQL provider) — Database
- **GitHub** — Source control + CI/CD

### Optional Services

- **Ably** — Realtime messaging
- **Sentry** — Error tracking
- **Google/GitHub OAuth** — Authentication providers

## Deployment Steps

### 1. Connect Repository to Vercel

```bash
npm i -g vercel
vercel link
```

### 2. Set Environment Variables

In Vercel Dashboard → Project Settings → Environment Variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (Neon pooled) |
| `NEXTAUTH_SECRET` | Yes | Session encryption key (`openssl rand -base64 32`) |
| `NEXT_PUBLIC_APP_URL` | Yes | Production URL (e.g., `https://naap.livepeer.org`) |

### 3. Deploy

```bash
vercel --prod
```

Or push to `main` — Vercel auto-deploys from the connected repository.

### 4. Verify

```bash
curl https://your-app.vercel.app/api/health
```

## Database Setup (Neon)

1. Create a project at [neon.tech](https://neon.tech)
2. Get the pooled connection string
3. Set `DATABASE_URL` in Vercel
4. Run migrations:
   ```bash
   cd packages/database
   DATABASE_URL="postgres://..." npx prisma db push
   ```

## Build Configuration

The project uses a custom build script at `bin/vercel-build.sh`:
- Builds all 11 plugin UMD bundles
- Builds the Next.js application
- Outputs to `apps/web-next/.next`

The `vercel.json` at the repo root configures:
- Build command and output directory
- CORS and security headers
- `Permissions-Policy` for camera/microphone (plugin support)
- CSP headers for API routes

## Local Development vs Production

| Aspect | Local Dev | Vercel (Production) |
|--------|-----------|---------------------|
| Plugin APIs | Express servers on ports 4101-4211 | Next.js API route handlers |
| Plugin assets | Plugin server on port 3100 | Same-origin CDN route |
| Database | Docker PostgreSQL on port 5432 | Neon managed PostgreSQL |
| Auth | Dev defaults | OAuth providers |

## Health Monitoring

### Health Endpoint

```bash
curl https://your-app.vercel.app/api/health
# Returns: { "status": "ok", "database": "connected", ... }
```

### Local Health Check Script

```bash
./bin/health-check.sh           # Check all services
./bin/health-check.sh --json    # JSON output
./bin/health-check.sh base-svc  # Check specific service
```

## Troubleshooting

### Database Connection Errors
- Verify `DATABASE_URL` is set correctly in Vercel
- For Neon, ensure the project is not paused
- Use the pooled connection string (with `?pgbouncer=true`)

### Plugin Loading Errors
- Check that plugin UMD bundles were built during deployment
- Verify `/cdn/plugins/` route returns assets
- Check browser console for CORS or CSP errors

### Build Failures
- Check `bin/vercel-build.sh` output in Vercel build logs
- Common: missing env vars, PostCSS config conflicts, TypeScript errors

## Production Checklist

- [ ] `DATABASE_URL` set in Vercel (pooled connection)
- [ ] `NEXTAUTH_SECRET` set (min 32 chars)
- [ ] `NEXT_PUBLIC_APP_URL` matches production domain
- [ ] Database schemas created and migrated
- [ ] OAuth providers configured (if using)
- [ ] Health endpoint returns OK
- [ ] All plugin pages load correctly
- [ ] API routes return proper envelope responses
