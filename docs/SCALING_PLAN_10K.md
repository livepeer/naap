# Scaling Plan: 10,000 Users

## Target Metrics

| Metric | Value | Calculation |
|--------|-------|-------------|
| Total Users | 10,000 | Target |
| Peak Concurrent Users | 1,000 | ~10% of total |
| Requests/Second (peak) | 200 | 1000 users × 12 req/min ÷ 60 |
| Database Connections | 100 | Pooled |
| Response Time (p95) | < 500ms | Target |

---

## Current Architecture Bottlenecks

```
┌─────────────────────────────────────────────────────────────────┐
│ CURRENT STATE (handles ~500 concurrent users)                   │
└─────────────────────────────────────────────────────────────────┘

  Browser ──▶ Vite Dev Server ──▶ Single Node.js ──▶ PostgreSQL
                  (no cache)        (1 process)      (no pooling)

  Problems:
  ✗ Single-threaded Node.js (CPU bound at ~300 req/s)
  ✗ No caching (every request hits DB)
  ✗ No connection pooling (connection overhead)
  ✗ Static assets served by app server
  ✗ In-memory rate limiting (not shared)
  ✗ No request queuing (drops under load)
```

---

## Phase 1: Quick Wins (Week 1-2)

**Goal**: Handle 2,000 concurrent users with minimal code changes

### 1.1 Add Redis for Caching & Sessions

**Cost**: Free (Redis on same server) or ~$15/mo (managed)

```bash
# Install Redis locally
brew install redis  # macOS
# or
sudo apt install redis-server  # Ubuntu
```

**Implementation**:

```typescript
// services/base-svc/src/lib/cache.ts
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  },

  async set(key: string, value: any, ttlSeconds = 300): Promise<void> {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  },

  async invalidate(pattern: string): Promise<void> {
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  }
};
```

**Cache these high-traffic endpoints**:

| Endpoint | TTL | Cache Key |
|----------|-----|-----------|
| `GET /api/v1/plugins` | 5 min | `plugins:list` |
| `GET /api/v1/teams/:id/my-plugins` | 1 min | `team:${teamId}:plugins` |
| `GET /api/v1/user/profile` | 5 min | `user:${userId}:profile` |
| `GET /api/v1/marketplace` | 10 min | `marketplace:packages` |

**Expected Impact**: 60-70% reduction in database queries

---

### 1.2 Add Database Connection Pooling

**Cost**: Free (PgBouncer)

```bash
# Install PgBouncer
brew install pgbouncer  # macOS
sudo apt install pgbouncer  # Ubuntu
```

**Configuration** (`/etc/pgbouncer/pgbouncer.ini`):

```ini
[databases]
naap_base = host=localhost port=5432 dbname=naap_base
naap_my_wallet = host=localhost port=5432 dbname=naap_my_wallet
naap_my_dashboard = host=localhost port=5432 dbname=naap_my_dashboard

[pgbouncer]
listen_addr = 127.0.0.1
listen_port = 6432
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 20
min_pool_size = 5
reserve_pool_size = 5
```

**Update connection strings**:
```bash
# Before
DATABASE_URL="postgresql://user:pass@localhost:5432/naap_base"

# After (through PgBouncer)
DATABASE_URL="postgresql://user:pass@localhost:6432/naap_base"
```

**Expected Impact**: Handle 10x more concurrent connections

---

### 1.3 Enable Gzip Compression

**Cost**: Free

```typescript
// services/base-svc/src/index.ts
import compression from 'compression';

app.use(compression({
  level: 6,
  threshold: 1024,  // Only compress responses > 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));
```

**Expected Impact**: 60-80% reduction in response size

---

### 1.4 Add Response Caching Headers

**Cost**: Free

```typescript
// services/base-svc/src/middleware/cacheHeaders.ts
export function cacheHeaders(maxAge: number = 0) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (maxAge > 0) {
      res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  };
}

// Usage
app.get('/api/v1/plugins', cacheHeaders(300), getPlugins);  // 5 min cache
app.get('/api/v1/marketplace', cacheHeaders(600), getMarketplace);  // 10 min
```

---

## Phase 2: Process Scaling (Week 3-4)

**Goal**: Handle 5,000 concurrent users

### 2.1 PM2 Cluster Mode

**Cost**: Free

```bash
npm install -g pm2
```

**Configuration** (`ecosystem.config.js`):

```javascript
module.exports = {
  apps: [
    {
      name: 'base-svc',
      script: 'dist/index.js',
      instances: 'max',  // Use all CPU cores
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 4000
      },
      max_memory_restart: '500M',
      error_file: './logs/base-svc-error.log',
      out_file: './logs/base-svc-out.log',
      merge_logs: true
    },
    {
      name: 'my-wallet-svc',
      script: 'dist/index.js',
      cwd: './plugins/my-wallet/backend',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 4008
      }
    },
    {
      name: 'my-dashboard-svc',
      script: 'dist/index.js',
      cwd: './plugins/my-dashboard/backend',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 4009
      }
    },
    {
      name: 'plugin-server',
      script: 'dist/server.js',
      cwd: './services/plugin-server',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3100
      }
    }
  ]
};
```

**Start with PM2**:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Auto-start on reboot
```

**Expected Impact**: 4-8x throughput increase (depending on CPU cores)

---

### 2.2 Nginx Reverse Proxy

**Cost**: Free

```nginx
# /etc/nginx/sites-available/naap
upstream base_svc {
    least_conn;
    server 127.0.0.1:4000;
    keepalive 64;
}

upstream plugin_server {
    least_conn;
    server 127.0.0.1:3100;
    keepalive 32;
}

server {
    listen 80;
    server_name your-domain.com;

    # Gzip
    gzip on;
    gzip_types text/plain application/json application/javascript text/css;
    gzip_min_length 1000;

    # Static assets (shell-web build)
    location / {
        root /var/www/naap/shell-web/dist;
        try_files $uri $uri/ /index.html;

        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # Plugin assets
    location /plugins/ {
        proxy_pass http://plugin_server;
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        # Cache plugin bundles
        expires 1d;
        add_header Cache-Control "public";
    }

    # API
    location /api/ {
        proxy_pass http://base_svc;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

**Expected Impact**: Better load distribution, static asset caching

---

### 2.3 Redis-Based Rate Limiting

**Cost**: Free (uses existing Redis)

```typescript
// services/base-svc/src/middleware/rateLimiter.ts
import { RateLimiterRedis } from 'rate-limiter-flexible';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

const rateLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl',
  points: 100,      // 100 requests
  duration: 60,     // per 60 seconds
  blockDuration: 60 // block for 60 seconds if exceeded
});

export async function rateLimit(req: Request, res: Response, next: NextFunction) {
  try {
    const key = req.user?.id || req.ip;
    await rateLimiter.consume(key);
    next();
  } catch (err) {
    res.status(429).json({ error: 'Too many requests' });
  }
}
```

---

## Phase 3: Frontend Optimization (Week 5-6)

**Goal**: Reduce load on servers, improve perceived performance

### 3.1 CloudFlare CDN (Free Tier)

**Cost**: Free

1. Sign up at cloudflare.com
2. Add your domain
3. Update DNS nameservers
4. Enable these settings:
   - **Caching**: Cache Everything for `/plugins/*`
   - **Minify**: JS, CSS, HTML
   - **Brotli**: Enable
   - **Early Hints**: Enable

**Cache Rules**:
```
URL: /plugins/*
Edge TTL: 1 day
Browser TTL: 1 day

URL: /api/*
Edge TTL: Bypass (don't cache API)
```

**Expected Impact**: 50-70% reduction in origin requests

---

### 3.2 Optimize Plugin Bundle Sizes

**Current Problem**: Large plugin bundles slow initial load

**Solution**: Aggressive code splitting

```typescript
// vite.config.ts for each plugin
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate vendor chunks
          'vendor-react': ['react', 'react-dom'],
          'vendor-ui': ['lucide-react', 'framer-motion'],
        }
      }
    },
    // Target smaller chunks
    chunkSizeWarningLimit: 200,  // 200KB warning
  }
});
```

**Bundle Size Targets**:

| Plugin | Current | Target | Action |
|--------|---------|--------|--------|
| my-wallet | ~400KB | <200KB | Lazy load charts |
| my-dashboard | ~600KB | <300KB | Lazy load Metabase embed |
| marketplace | ~300KB | <150KB | Virtualize list |

---

### 3.3 Implement Stale-While-Revalidate

```typescript
// apps/shell-web/src/hooks/useSWR.ts
import useSWR from 'swr';

export function usePlugins(teamId: string) {
  return useSWR(
    teamId ? `/api/v1/teams/${teamId}/my-plugins` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 60000,  // 1 minute
      refreshInterval: 300000,  // 5 minutes background refresh
    }
  );
}
```

---

## Phase 4: Database Optimization (Week 7-8)

**Goal**: Handle 10,000 concurrent users

### 4.1 Add Database Indexes

```sql
-- High-impact indexes for common queries

-- User lookups
CREATE INDEX CONCURRENTLY idx_users_email ON "User"(email);
CREATE INDEX CONCURRENTLY idx_users_provider ON "User"("authProvider", "providerId");

-- Team queries
CREATE INDEX CONCURRENTLY idx_team_members_user ON "TeamMember"("userId");
CREATE INDEX CONCURRENTLY idx_team_members_team ON "TeamMember"("teamId");
CREATE INDEX CONCURRENTLY idx_team_members_role ON "TeamMember"("teamId", "role");

-- Plugin queries
CREATE INDEX CONCURRENTLY idx_plugin_installs_team ON "TeamPluginInstall"("teamId");
CREATE INDEX CONCURRENTLY idx_plugin_installs_deployment ON "TeamPluginInstall"("deploymentId");
CREATE INDEX CONCURRENTLY idx_plugin_access_user ON "TeamMemberPluginAccess"("teamMemberId");

-- Marketplace
CREATE INDEX CONCURRENTLY idx_packages_category ON "PluginPackage"("category") WHERE "isPublished" = true;
CREATE INDEX CONCURRENTLY idx_versions_package ON "PluginVersion"("packageId", "createdAt" DESC);
```

**Expected Impact**: 10x faster queries on indexed columns

---

### 4.2 Query Optimization

**Problem Query** (N+1):
```typescript
// BAD: Fetches team, then each member, then each user
const team = await prisma.team.findUnique({ where: { id } });
const members = await prisma.teamMember.findMany({ where: { teamId: id } });
for (const member of members) {
  member.user = await prisma.user.findUnique({ where: { id: member.userId } });
}
```

**Optimized**:
```typescript
// GOOD: Single query with joins
const team = await prisma.team.findUnique({
  where: { id },
  include: {
    members: {
      include: { user: true },
      take: 100  // Pagination
    }
  }
});
```

---

### 4.3 Read Replica (Optional - $20-50/mo)

If database becomes bottleneck:

```typescript
// services/base-svc/src/lib/db.ts
import { PrismaClient } from '@prisma/client';

// Primary for writes
export const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } }
});

// Replica for reads (if configured)
export const prismaRead = process.env.DATABASE_REPLICA_URL
  ? new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_REPLICA_URL } }
    })
  : prisma;

// Usage
const plugins = await prismaRead.pluginPackage.findMany();  // Read from replica
await prisma.user.create({ data });  // Write to primary
```

---

## Implementation Checklist

### Phase 1: Quick Wins (Must-Have)
- [ ] Install and configure Redis
- [ ] Add caching to high-traffic endpoints
- [ ] Install PgBouncer for connection pooling
- [ ] Enable gzip compression
- [ ] Add cache headers to responses

### Phase 2: Process Scaling (Must-Have)
- [ ] Install PM2
- [ ] Create ecosystem.config.js
- [ ] Configure Nginx reverse proxy
- [ ] Implement Redis-based rate limiting
- [ ] Build production assets

### Phase 3: Frontend Optimization (Recommended)
- [ ] Set up CloudFlare CDN
- [ ] Optimize plugin bundle sizes
- [ ] Implement SWR for data fetching
- [ ] Add loading skeletons

### Phase 4: Database Optimization (Must-Have)
- [ ] Add database indexes
- [ ] Fix N+1 queries
- [ ] Add query timeouts
- [ ] Consider read replica if needed

---

## Cost Summary

| Item | Monthly Cost | Priority |
|------|-------------|----------|
| Redis (local) | $0 | Must-Have |
| PgBouncer | $0 | Must-Have |
| PM2 | $0 | Must-Have |
| Nginx | $0 | Must-Have |
| CloudFlare (Free) | $0 | Recommended |
| **Total** | **$0** | |

**Optional additions**:
| Item | Monthly Cost | When Needed |
|------|-------------|-------------|
| Managed Redis | $15-30 | If local Redis insufficient |
| DB Read Replica | $20-50 | If DB is bottleneck |
| CloudFlare Pro | $20 | For advanced caching rules |

---

## Performance Monitoring

### Key Metrics to Track

```typescript
// services/base-svc/src/middleware/metrics.ts
import { performance } from 'perf_hooks';

const metrics = {
  requests: 0,
  errors: 0,
  latencies: [] as number[],
};

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = performance.now();

  res.on('finish', () => {
    metrics.requests++;
    metrics.latencies.push(performance.now() - start);
    if (res.statusCode >= 500) metrics.errors++;

    // Keep only last 1000 latencies
    if (metrics.latencies.length > 1000) {
      metrics.latencies = metrics.latencies.slice(-1000);
    }
  });

  next();
}

// Expose metrics endpoint
app.get('/metrics', (req, res) => {
  const sorted = [...metrics.latencies].sort((a, b) => a - b);
  res.json({
    requests: metrics.requests,
    errors: metrics.errors,
    latency: {
      p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
      p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
      p99: sorted[Math.floor(sorted.length * 0.99)] || 0,
    }
  });
});
```

### Health Dashboard

Simple health check script:
```bash
#!/bin/bash
# bin/health-check.sh

echo "=== NAAP Health Check ==="
echo ""

# Check services
check_service() {
  if curl -s --max-time 2 "$1" > /dev/null; then
    echo "✓ $2"
  else
    echo "✗ $2 - DOWN"
  fi
}

check_service "http://localhost:4000/healthz" "Base Service"
check_service "http://localhost:3100/healthz" "Plugin Server"
check_service "http://localhost:3000" "Shell Web"

# Check Redis
if redis-cli ping > /dev/null 2>&1; then
  echo "✓ Redis"
else
  echo "✗ Redis - DOWN"
fi

# Check PostgreSQL
if pg_isready -q; then
  echo "✓ PostgreSQL"
else
  echo "✗ PostgreSQL - DOWN"
fi

# PM2 status
echo ""
echo "=== Process Status ==="
pm2 jlist 2>/dev/null | jq -r '.[] | "\(.name): \(.pm2_env.status) (restarts: \(.pm2_env.restart_time))"'
```

---

## Expected Results

| Phase | Concurrent Users | Requests/sec | Implementation Effort |
|-------|------------------|--------------|----------------------|
| Current | 500 | 50 | - |
| Phase 1 | 2,000 | 150 | 1-2 weeks |
| Phase 2 | 5,000 | 400 | 1-2 weeks |
| Phase 3 | 7,000 | 600 | 1-2 weeks |
| Phase 4 | 10,000+ | 800+ | 1-2 weeks |

---

## When to Consider Major Infrastructure

Move to Kubernetes/Cloud-native when:
- You exceed 10,000 concurrent users consistently
- You need multi-region deployment
- You need automatic failover
- You're spending more time on ops than features
- Cost of managed services < cost of your time

Until then, this plan should handle 10K users on a **single $50-100/month VPS**.
