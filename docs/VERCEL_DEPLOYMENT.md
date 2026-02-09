# NaaP Hybrid Deployment on Vercel

## Architecture Overview

NaaP uses a **hybrid deployment model**: the Next.js frontend and API gateway run on Vercel (serverless/edge), while long-running backend services run off-Vercel.

```
┌─────────────────────────────────────────────────────────┐
│                    Vercel (Serverless)                    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │             apps/web-next (Next.js 15)            │   │
│  │                                                    │   │
│  │  Pages:  /, /dashboard, /plugins/:name, /teams    │   │
│  │  API:    /api/v1/auth/*, /api/v1/teams/*          │   │
│  │  API:    /api/v1/plugins/*, /api/v1/secrets/*     │   │
│  │  CDN:    /cdn/plugins/:name/:version/*            │   │
│  │                                                    │   │
│  │  Gateway Proxies (to off-Vercel services):        │   │
│  │    /api/v1/base/*      → base-svc                 │   │
│  │    /api/v1/livepeer/*  → livepeer-svc             │   │
│  │    /api/v1/pipelines/* → pipeline-gateway         │   │
│  │    /api/v1/:plugin/*   → plugin backends          │   │
│  └──────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────┘
                     │ HTTPS (proxy)
┌────────────────────▼────────────────────────────────────┐
│              Off-Vercel (Long-Running Services)          │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐  │
│  │  base-svc   │  │livepeer-svc │  │pipeline-gateway│  │
│  │  :4000      │  │  :4010      │  │  :4020         │  │
│  └─────────────┘  └─────────────┘  └────────────────┘  │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐  │
│  │plugin-server│  │ storage-svc │  │infrastructure  │  │
│  │  :3100      │  │  :4050      │  │  -svc :4060    │  │
│  └─────────────┘  └─────────────┘  └────────────────┘  │
│                                                          │
│  ┌─────────────┐                                        │
│  │ PostgreSQL  │  Redis, Kafka (as needed)              │
│  │  :5432      │                                        │
│  └─────────────┘                                        │
└─────────────────────────────────────────────────────────┘
```

## What Runs Where

### On Vercel (serverless / edge)

| Component | Path | Description |
|-----------|------|-------------|
| Shell UI | `apps/web-next` | Next.js 15 app (pages, layouts, components) |
| Plugin frontends | `/plugins/:name` | Loaded dynamically via UMD or CDN |
| API routes | `/api/v1/auth/*`, `/api/v1/teams/*`, etc. | Direct database access via Prisma |
| Gateway proxies | `/api/v1/base/*`, `/api/v1/livepeer/*`, `/api/v1/pipelines/*` | Proxy to off-Vercel services |
| Plugin CDN | `/cdn/plugins/:name/:version/*` | Serves plugin assets from Vercel Blob |
| Health check | `/api/health` | Database + environment checks |

### Off-Vercel (long-running services)

| Service | Default Port | Description |
|---------|-------------|-------------|
| `base-svc` | 4000 | Auth, plugin registry, lifecycle, teams, RBAC, secrets |
| `livepeer-svc` | 4010 | Livepeer node proxy, staking, orchestrators, protocol (Phase 4) |
| `pipeline-gateway` | 4020 | AI pipelines, live video, BYOC (Phase 5) |
| `plugin-server` | 3100 | Serves plugin frontend assets (dev/legacy) |
| `storage-svc` | 4050 | Artifact storage for plugin publishing |
| `infrastructure-svc` | 4060 | Container/DB/port provisioning |
| Plugin backends | 4001-4012 | Individual plugin backend services |

## Environment Matrix

| Variable | Development | Staging (Preview) | Production |
|----------|-------------|-------------------|------------|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | `https://<branch>.vercel.app` | `https://naap.dev` |
| `DATABASE_URL` | `postgresql://...localhost:5432/naap` | Neon preview branch | Neon production |
| `BASE_SVC_URL` | `http://localhost:4000` | `https://staging-api.naap.dev` | `https://api.naap.dev` |
| `LIVEPEER_SVC_URL` | `http://localhost:4010` | `https://staging-livepeer.naap.dev` | `https://livepeer.naap.dev` |
| `PIPELINE_GATEWAY_URL` | `http://localhost:4020` | `https://staging-pipelines.naap.dev` | `https://pipelines.naap.dev` |
| `DEPLOY_ENV` | `development` | `staging` | `production` |
| `VERCEL_ENV` | (not set) | `preview` | `production` |

## Observability

Every request through the Vercel gateway gets:

- **`x-request-id`**: Unique request identifier (generated in middleware if not present)
- **`x-trace-id`**: Distributed trace ID (generated in middleware if not present)
- **`x-request-start`**: Timestamp when the request entered the middleware

These headers are forwarded to all off-Vercel services and returned in responses, enabling end-to-end request tracing.

## Deployment

### Preview (PR-based)

Every pull request automatically gets a Vercel preview deployment:

1. GitHub Actions runs CI checks (lint, typecheck, test, build)
2. Vercel CLI builds and deploys to a unique preview URL
3. Preview URL is commented on the PR

### Production

Production deployments are triggered manually via GitHub Actions:

1. Workflow dispatch with `environment: production`
2. Vercel CLI builds with `--prod` flag
3. Health check at `https://naap.dev/api/health`
4. Auto-rollback if health check fails

### Off-Vercel Services

Off-Vercel services are deployed separately using PM2 or container orchestration:

```bash
# Start all services
pm2 start ecosystem.config.cjs

# Or individual service
cd services/base-svc && npm start
```

## Configuration

### vercel.json

The root `vercel.json` configures:
- Build command and output directory for `apps/web-next`
- CORS and security headers for API routes
- Plugin page permissions (camera, microphone for UMD plugins)
- Plugin asset rewrites

### next.config.js

The Next.js config handles:
- Monorepo package transpilation (`@naap/*`)
- Image optimization for Vercel storage
- CORS headers for API routes
- Plugin asset proxy rewrites
- Standalone output for Vercel
