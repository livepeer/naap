# NaaP Platform Operations Runbook

## Quick Start

### Prerequisites
- Node.js 20+
- npm 9+
- Docker (for local databases)

### First-Time Setup

```bash
./bin/setup.sh          # Full setup from fresh clone
./bin/setup.sh --start  # Setup + start immediately
```

### Starting the Platform

```bash
./bin/start.sh start --all               # Everything
./bin/start.sh                           # Shell + core only
./bin/start.sh dev daydream-video        # Dev mode for one plugin
./bin/start.sh start gateway-manager     # Start specific plugin
```

### Stopping the Platform

```bash
./bin/start.sh stop              # Graceful stop all
./bin/start.sh stop --infra      # Stop all + Docker containers
./bin/start.sh stop my-dashboard # Stop one plugin
```

### Health Checks

```bash
./bin/start.sh validate          # Health-check all services
./bin/start.sh status            # Status dashboard
./bin/start.sh watch 5           # Live dashboard (5s refresh)
```

## Incident Response

### Service Not Responding

1. Check status: `./bin/start.sh status`
2. Check logs: `./bin/start.sh logs <service-name>`
3. Restart the service: `./bin/start.sh restart <plugin-name>`
4. If port is stuck: `lsof -i :<port>` then `kill <pid>`

### Database Issues

1. Check Docker: `docker ps | grep naap`
2. Check DB readiness: `docker exec naap-db pg_isready -U postgres`
3. View DB logs: `docker logs naap-db`
4. Reset database: `./bin/db-reset.sh`

### Plugin Not Loading

1. Check plugin is built: `ls plugins/<name>/frontend/dist/production/<name>.js`
2. Rebuild: `cd plugins/<name>/frontend && npm run build`
3. Check plugin-server: `curl http://localhost:3100/plugins/<name>/production/<name>.js`
4. Check browser console for CORS or loading errors

### Full Reset

```bash
./bin/start.sh stop --infra      # Stop everything including Docker
docker volume rm naap-db-data    # Delete database data
./bin/setup.sh --start           # Re-run full setup
```

## Port Reference

| Component | Port | Health URL |
|-----------|------|-----------|
| Shell (Next.js) | 3000 | http://localhost:3000 |
| Base Service | 4000 | http://localhost:4000/healthz |
| Plugin Server | 3100 | http://localhost:3100/healthz |
| Gateway Manager | 4001 | http://localhost:4001/healthz |
| Orchestrator Manager | 4002 | http://localhost:4002/healthz |
| Capacity Planner | 4003 | http://localhost:4003/healthz |
| Network Analytics | 4004 | http://localhost:4004/healthz |
| Marketplace | 4005 | http://localhost:4005/healthz |
| Community | 4006 | http://localhost:4006/healthz |
| Wallet | 4007 | http://localhost:4007/healthz |
| Dashboard | 4008 | http://localhost:4008/healthz |
| Daydream Video | 4010 | http://localhost:4010/healthz |

## Production Architecture

```
┌──────────────────────────────────┐
│         Vercel (Edge)            │
│  Next.js Shell + CDN Plugins     │
│  API Routes proxy to backends    │
└──────────┬───────────────────────┘
           │ HTTPS
┌──────────▼───────────────────────┐
│    Off-Vercel Services           │
│  docker-compose.production.yml    │
│  ┌──────────┐  ┌──────────────┐  │
│  │ base-svc │  │ plugin-server│  │
│  └─────┬────┘  └──────────────┘  │
│        │                          │
│  ┌─────▼────┐  ┌──────────┐     │
│  │ Postgres │  │  Redis   │     │
│  └──────────┘  └──────────┘     │
└──────────────────────────────────┘
```

### Production Deployment

```bash
# Build and start off-Vercel services
docker compose -f docker-compose.production.yml up -d

# Check health
docker compose -f docker-compose.production.yml ps
curl http://your-api-host:4000/healthz

# View logs
docker compose -f docker-compose.production.yml logs -f base-svc
```

### Production Checklist

- [ ] `.env.production` configured with real secrets
- [ ] `DB_PASSWORD` set (not default)
- [ ] `REDIS_PASSWORD` set
- [ ] `NEXTAUTH_SECRET` is random 32+ chars
- [ ] `ENCRYPTION_KEY` is random 32 bytes base64
- [ ] OAuth credentials configured for production domain
- [ ] CORS origins set to production URLs
- [ ] Rate limiting configured (`RATE_LIMIT_AUTH`, `RATE_LIMIT_API`)
- [ ] Sentry DSN configured for error tracking
- [ ] DNS configured for API subdomain
- [ ] SSL certificates configured
- [ ] Database backups configured
- [ ] Monitoring alerts configured

## API Conventions

All APIs follow: `/api/v1/{plugin}/{resource}`

Examples:
- `GET /api/v1/gateway-manager/gateways`
- `GET /api/v1/community/posts`
- `POST /api/v1/marketplace/packages`
