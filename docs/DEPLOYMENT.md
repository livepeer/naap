# NAAP Platform Deployment Guide

This guide covers deploying the NAAP platform in production using a hybrid architecture with Vercel and off-Vercel services.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Vercel Deployment](#vercel-deployment)
- [Backend Services Deployment](#backend-services-deployment)
- [Database Setup](#database-setup)
- [Environment Configuration](#environment-configuration)
- [Health Monitoring](#health-monitoring)
- [Troubleshooting](#troubleshooting)
- [Production Checklist](#production-checklist)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              VERCEL (Edge)                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                        Next.js Application                               ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐  ││
│  │  │   Pages &    │  │   API Routes │  │     Plugin CDN               │  ││
│  │  │  Components  │  │   /api/v1/*  │  │  /cdn/plugins/:name/:ver     │  ││
│  │  └──────────────┘  └──────┬───────┘  └──────────────────────────────┘  ││
│  └───────────────────────────┼──────────────────────────────────────────────┘│
└──────────────────────────────┼──────────────────────────────────────────────┘
                               │ Proxy
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        OFF-VERCEL SERVICES                                   │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Core Services                                  │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │  │
│  │  │ base-svc │ │livepeer- │ │ pipeline │ │ storage- │ │infrastructure│  │  │
│  │  │  :4000   │ │   svc    │ │ gateway  │ │   svc    │ │    svc     │  │  │
│  │  │          │ │  :4010   │ │  :4020   │ │  :4050   │ │   :4060    │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                        Plugin Backends                                 │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │  │
│  │  │ gateway- │ │orchestr- │ │ capacity │ │ network- │ │marketplace│   │  │
│  │  │ manager  │ │ manager  │ │ planner  │ │analytics │ │  :4005   │   │  │
│  │  │  :4001   │ │  :4002   │ │  :4003   │ │  :4004   │ │          │   │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │  │
│  │  │community │ │my-wallet │ │   my-    │ │daydream- │ │developer-│   │  │
│  │  │  :4006   │ │  :4007   │ │dashboard │ │  video   │ │   api    │   │  │
│  │  │          │ │          │ │  :4008   │ │  :4009   │ │  :4011   │   │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA LAYER                                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │   PostgreSQL     │  │      Redis       │  │     Vercel Blob          │  │
│  │   (Neon/RDS)     │  │ (Upstash/Cache)  │  │     (Storage)            │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Hosted On | Purpose |
|-----------|-----------|---------|
| Next.js App | Vercel | UI, API gateway, auth, plugin CDN |
| base-svc | Docker/K8s | Auth, teams, plugins, RBAC, secrets |
| livepeer-svc | Docker/K8s | Livepeer protocol integration |
| pipeline-gateway | Docker/K8s | AI/video pipeline management |
| storage-svc | Docker/K8s | Plugin artifact storage |
| infrastructure-svc | Docker/K8s | Container orchestration |
| Plugin backends | Docker/K8s | Plugin-specific business logic |

---

## Prerequisites

### Required Accounts

- [ ] **Vercel** - Frontend hosting (free tier available)
- [ ] **Neon** or **PostgreSQL provider** - Database
- [ ] **GitHub** - Source control

### Optional Services

- [ ] **Upstash** - Redis caching (recommended)
- [ ] **Ably** - Realtime messaging
- [ ] **Sentry** - Error tracking
- [ ] **Google Cloud** - OAuth provider
- [ ] **GitHub OAuth** - OAuth provider

### Local Tools

```bash
# Required
node >= 20.0.0
npm >= 10.0.0
docker >= 24.0.0
docker-compose >= 2.0.0

# Recommended
pnpm >= 8.0.0
vercel-cli
```

---

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/your-org/naap.git
cd naap
npm install
```

### 2. Configure Environment

```bash
# Copy example env file
cp .env.example apps/web-next/.env.local

# Edit with your values
vim apps/web-next/.env.local
```

### 3. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

### 4. Deploy Backend Services

```bash
# Start all services
docker-compose -f docker-compose.production.yml up -d

# Check health
./bin/health-check.sh
```

---

## Vercel Deployment

### Initial Setup

1. **Connect Repository**
   ```bash
   vercel link
   ```

2. **Configure Build Settings**
   - Framework: Next.js
   - Build Command: `cd apps/web-next && npm run build`
   - Output Directory: `apps/web-next/.next`
   - Install Command: `npm install`

3. **Set Environment Variables**

   Go to Project Settings → Environment Variables and add:

   | Variable | Required | Description |
   |----------|----------|-------------|
   | `DATABASE_URL` | Yes | PostgreSQL connection string |
   | `NEXTAUTH_SECRET` | Yes | Session encryption key |
   | `NEXT_PUBLIC_APP_URL` | Yes | Production URL |
   | `BASE_SVC_URL` | Yes | Backend service URL |
   | `BLOB_READ_WRITE_TOKEN` | No | Vercel Blob token |
   | `ABLY_API_KEY` | No | Realtime features |
   | `GOOGLE_CLIENT_ID` | No | Google OAuth |
   | `GOOGLE_CLIENT_SECRET` | No | Google OAuth |
   | `GITHUB_CLIENT_ID` | No | GitHub OAuth |
   | `GITHUB_CLIENT_SECRET` | No | GitHub OAuth |

### Domain Configuration

1. Add your custom domain in Vercel Dashboard
2. Configure DNS records as instructed
3. Enable HTTPS (automatic)
4. Update `NEXT_PUBLIC_APP_URL` to match your domain

### Preview Deployments

Preview deployments are created for each PR. Configure preview environment:

```bash
# Set preview-specific variables
vercel env add DATABASE_URL preview
vercel env add BASE_SVC_URL preview
```

---

## Backend Services Deployment

### Option 1: Docker Compose (Simple)

Best for: Single server, small deployments

```bash
# Create .env file with production values
cat > .env << EOF
DATABASE_URL=postgres://...
REDIS_URL=redis://...
NEXTAUTH_SECRET=...
ENCRYPTION_KEY=...
EOF

# Start services
docker-compose -f docker-compose.production.yml up -d

# View logs
docker-compose -f docker-compose.production.yml logs -f base-svc
```

### Option 2: Kubernetes (Scalable)

Best for: Production, high availability

```bash
# Apply Kubernetes manifests
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/services/
kubectl apply -f k8s/plugins/

# Check status
kubectl get pods -n naap
```

### Option 3: Railway/Render (Managed)

For each service:

1. Create new service in Railway/Render
2. Connect to GitHub repository
3. Set root directory (e.g., `services/base-svc`)
4. Configure environment variables
5. Deploy

---

## Database Setup

### Neon (Recommended for Vercel)

1. Create Neon project at [neon.tech](https://neon.tech)
2. Get connection strings:
   - **Pooled** (for app): `postgres://...?pgbouncer=true`
   - **Unpooled** (for migrations): `postgres://...`

3. Run migrations:
   ```bash
   # Set unpooled URL for migrations
   export DATABASE_URL_UNPOOLED="postgres://..."

   # Run Prisma migrations
   cd apps/web-next
   npx prisma migrate deploy
   ```

### Connection Pooling

For production, use connection pooling:

```
DATABASE_URL=postgres://user:pass@host/db?sslmode=require&pgbouncer=true&connection_limit=10
```

---

## Environment Configuration

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL URL with pooling | `postgres://...?pgbouncer=true` |
| `NEXTAUTH_SECRET` | Min 32 char secret | `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_URL` | Public app URL | `https://app.example.com` |
| `BASE_SVC_URL` | Backend API URL | `https://api.example.com` |

### Generate Secrets

```bash
# NEXTAUTH_SECRET
openssl rand -base64 32

# ENCRYPTION_KEY
openssl rand -base64 32
```

### Service URL Configuration

Configure backend service URLs in Vercel:

```bash
BASE_SVC_URL=https://api.your-domain.com
LIVEPEER_SVC_URL=https://livepeer.your-domain.com
PIPELINE_GATEWAY_URL=https://pipelines.your-domain.com
PLUGIN_SERVER_URL=https://plugins.your-domain.com
```

---

## Health Monitoring

### Health Check Endpoints

Each service exposes a health endpoint:

| Service | Endpoint | Expected Response |
|---------|----------|-------------------|
| Vercel App | `/api/health` | `{"status": "ok"}` |
| base-svc | `/healthz` | `{"status": "healthy"}` |
| plugin-server | `/healthz` | `{"status": "healthy"}` |
| livepeer-svc | `/healthz` | `{"status": "healthy"}` |
| All plugins | `/healthz` | `{"status": "healthy"}` |

### Using the Health Check Script

```bash
# Check all services
./bin/health-check.sh

# Check specific service
./bin/health-check.sh base-svc

# JSON output
./bin/health-check.sh --json
```

### Monitoring Setup

#### Vercel Analytics

Enable in Vercel Dashboard → Analytics

#### External Monitoring

Configure uptime monitoring with:
- **UptimeRobot** (free)
- **Checkly** (advanced)
- **Datadog** (enterprise)

Monitor these endpoints:
- `https://your-app.vercel.app/api/health`
- `https://api.your-domain.com/healthz`

#### Alerting

Set up alerts for:
- Response time > 2s
- 5xx error rate > 1%
- Health check failures

---

## Troubleshooting

### Common Issues

#### 1. Database Connection Errors

```
Error: Connection refused
```

**Solution:**
- Verify `DATABASE_URL` is correct
- Check if database allows connections from your IP
- For Neon, ensure project is not paused

#### 2. CORS Errors

```
Access-Control-Allow-Origin header missing
```

**Solution:**
- Verify backend URL is correct in Vercel env
- Check `vercel.json` headers configuration
- Ensure backend CORS middleware is configured

#### 3. Health Check Failures

```
Service unhealthy: base-svc
```

**Solution:**
```bash
# Check service logs
docker-compose -f docker-compose.production.yml logs base-svc

# Restart service
docker-compose -f docker-compose.production.yml restart base-svc
```

#### 4. Plugin Loading Errors

```
Failed to load plugin: network error
```

**Solution:**
- Check `PLUGIN_SERVER_URL` is accessible
- Verify plugin is published to registry
- Check plugin-server logs

### Debug Mode

Enable debug logging:

```bash
# In .env
DEBUG=true
LOG_LEVEL=debug
```

### Logs

```bash
# Vercel logs
vercel logs --follow

# Docker logs
docker-compose -f docker-compose.production.yml logs -f

# Specific service
docker-compose -f docker-compose.production.yml logs -f base-svc
```

---

## Production Checklist

### Before Go-Live

- [ ] **Security**
  - [ ] All secrets are set in Vercel env (not in code)
  - [ ] HTTPS enabled for all endpoints
  - [ ] CORS configured correctly
  - [ ] Rate limiting enabled
  - [ ] CSP headers configured

- [ ] **Database**
  - [ ] Migrations applied
  - [ ] Connection pooling enabled
  - [ ] Backups configured
  - [ ] Read replicas (if needed)

- [ ] **Performance**
  - [ ] Caching configured (Redis)
  - [ ] CDN enabled for static assets
  - [ ] Image optimization enabled
  - [ ] Compression enabled

- [ ] **Monitoring**
  - [ ] Health checks configured
  - [ ] Error tracking (Sentry)
  - [ ] Uptime monitoring
  - [ ] Alerting configured

- [ ] **Reliability**
  - [ ] Services auto-restart on failure
  - [ ] Resource limits set
  - [ ] Graceful shutdown handling
  - [ ] Circuit breakers configured

### Post-Deployment

1. Run health check script
2. Verify all endpoints respond
3. Test authentication flow
4. Test plugin loading
5. Monitor for first hour

---

## Support

- **Documentation**: `/docs`
- **Issues**: GitHub Issues
- **Discord**: [Community Server]

---

*Last updated: 2024*
