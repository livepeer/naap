# Scaling Implementation Guide

## Required Code Changes for 10K Users

Based on codebase analysis, here are the concrete implementations needed.

---

## 1. Redis Integration (Critical)

### 1.1 Install Dependencies

```bash
cd services/base-svc
npm install ioredis compression

cd ../../apps/shell-web
npm install swr
```

### 1.2 Create Redis Client

**File: `services/base-svc/src/lib/redis.ts`** (NEW)

```typescript
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  lazyConnect: true,
});

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});

redis.on('connect', () => {
  console.log('[Redis] Connected');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await redis.quit();
});
```

### 1.3 Create Caching Layer

**File: `services/base-svc/src/lib/cache.ts`** (NEW)

```typescript
import { redis } from './redis';

export interface CacheOptions {
  ttl?: number;  // seconds
  prefix?: string;
}

export const cache = {
  /**
   * Get cached value or fetch and cache
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const { ttl = 300, prefix = 'cache' } = options;
    const cacheKey = `${prefix}:${key}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      console.warn('[Cache] Redis get failed, fetching fresh:', err);
    }

    const data = await fetcher();

    try {
      await redis.setex(cacheKey, ttl, JSON.stringify(data));
    } catch (err) {
      console.warn('[Cache] Redis set failed:', err);
    }

    return data;
  },

  /**
   * Invalidate cache by key or pattern
   */
  async invalidate(pattern: string): Promise<void> {
    try {
      const keys = await redis.keys(`cache:${pattern}`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (err) {
      console.warn('[Cache] Invalidation failed:', err);
    }
  },

  /**
   * Invalidate all caches for a team
   */
  async invalidateTeam(teamId: string): Promise<void> {
    await this.invalidate(`team:${teamId}:*`);
  },

  /**
   * Invalidate all caches for a user
   */
  async invalidateUser(userId: string): Promise<void> {
    await this.invalidate(`user:${userId}:*`);
  }
};
```

---

## 2. Update Rate Limiter to Use Redis

**File: `services/base-svc/src/middleware/rateLimit.ts`** (MODIFY)

```typescript
import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis, RateLimiterMemory, IRateLimiterRes } from 'rate-limiter-flexible';
import { redis } from '../lib/redis';

// Fallback to memory if Redis unavailable
let rateLimiterBackend: RateLimiterRedis | RateLimiterMemory;

try {
  rateLimiterBackend = new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: 'rl',
    points: 100,
    duration: 60,
    blockDuration: 60,
  });
} catch {
  console.warn('[RateLimit] Redis unavailable, using in-memory fallback');
  rateLimiterBackend = new RateLimiterMemory({
    points: 100,
    duration: 60,
  });
}

// Rate limit tiers
const tiers = {
  strict: new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: 'rl:strict',
    points: 10,
    duration: 60,
    blockDuration: 300,
  }),
  standard: rateLimiterBackend,
  relaxed: new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: 'rl:relaxed',
    points: 500,
    duration: 60,
  }),
};

export function rateLimit(tier: 'strict' | 'standard' | 'relaxed' = 'standard') {
  const limiter = tiers[tier];

  return async (req: Request, res: Response, next: NextFunction) => {
    const key = (req as any).user?.id || req.ip || 'anonymous';

    try {
      const result = await limiter.consume(key);

      res.setHeader('X-RateLimit-Limit', limiter.points);
      res.setHeader('X-RateLimit-Remaining', result.remainingPoints);
      res.setHeader('X-RateLimit-Reset', Math.ceil(result.msBeforeNext / 1000));

      next();
    } catch (err) {
      const rateLimitErr = err as IRateLimiterRes;
      res.setHeader('Retry-After', Math.ceil(rateLimitErr.msBeforeNext / 1000));
      res.status(429).json({
        error: 'Too many requests',
        retryAfter: Math.ceil(rateLimitErr.msBeforeNext / 1000)
      });
    }
  };
}
```

---

## 3. Add Response Caching to High-Traffic Endpoints

### 3.1 Cache Middleware

**File: `services/base-svc/src/middleware/cacheResponse.ts`** (NEW)

```typescript
import { Request, Response, NextFunction } from 'express';
import { cache } from '../lib/cache';

interface CacheConfig {
  ttl: number;
  keyFn?: (req: Request) => string;
  condition?: (req: Request) => boolean;
}

export function cacheResponse(config: CacheConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip caching for non-GET or if condition fails
    if (req.method !== 'GET' || (config.condition && !config.condition(req))) {
      return next();
    }

    const cacheKey = config.keyFn
      ? config.keyFn(req)
      : `${req.path}:${JSON.stringify(req.query)}`;

    try {
      const cached = await cache.getOrSet(
        cacheKey,
        async () => {
          // Capture the response
          return new Promise((resolve) => {
            const originalJson = res.json.bind(res);
            res.json = (data: any) => {
              resolve(data);
              return originalJson(data);
            };
            next();
          });
        },
        { ttl: config.ttl }
      );

      // If we got cached data, return it directly
      if (cached !== undefined) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached);
      }
    } catch (err) {
      // On cache error, proceed without caching
      next();
    }
  };
}

// Pre-configured cache middleware
export const cacheShort = cacheResponse({ ttl: 60 });   // 1 minute
export const cacheMedium = cacheResponse({ ttl: 300 }); // 5 minutes
export const cacheLong = cacheResponse({ ttl: 600 });   // 10 minutes
```

### 3.2 Apply Caching to Routes

**File: `services/base-svc/src/routes/team.ts`** (MODIFY)

Add caching to read endpoints:

```typescript
import { cacheResponse, cache } from '../middleware/cacheResponse';

// GET /teams/:teamId/my-plugins - Cache for 1 minute per team
router.get('/:teamId/my-plugins',
  authenticateToken,
  cacheResponse({
    ttl: 60,
    keyFn: (req) => `team:${req.params.teamId}:plugins:${(req as any).user.id}`
  }),
  async (req, res) => {
    // existing handler
  }
);

// Invalidate cache on plugin install/uninstall
router.post('/:teamId/plugins/:pluginName/install', async (req, res) => {
  // ... existing install logic ...

  // Invalidate team plugin cache
  await cache.invalidateTeam(req.params.teamId);

  res.json(result);
});
```

**File: `services/base-svc/src/routes/plugins.ts`** (MODIFY)

```typescript
import { cacheLong } from '../middleware/cacheResponse';

// GET /plugins - Cache marketplace for 10 minutes
router.get('/', cacheLong, async (req, res) => {
  // existing handler
});
```

---

## 4. Add Compression Middleware

**File: `services/base-svc/src/index.ts`** (MODIFY)

```typescript
import compression from 'compression';

// Add before routes
app.use(compression({
  level: 6,
  threshold: 1024,  // Only compress > 1KB
  filter: (req, res) => {
    // Don't compress if client doesn't accept
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));
```

---

## 5. Add Cache-Control Headers

**File: `services/base-svc/src/middleware/cacheHeaders.ts`** (NEW)

```typescript
import { Request, Response, NextFunction } from 'express';

export function setCacheHeaders(maxAge: number = 0, isPrivate: boolean = true) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (maxAge > 0) {
      const directive = isPrivate ? 'private' : 'public';
      res.setHeader('Cache-Control', `${directive}, max-age=${maxAge}`);
    } else {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
    next();
  };
}

// Pre-configured
export const noCache = setCacheHeaders(0);
export const cachePrivate1m = setCacheHeaders(60, true);
export const cachePrivate5m = setCacheHeaders(300, true);
export const cachePublic1h = setCacheHeaders(3600, false);
```

---

## 6. Optimize N+1 Queries

### 6.1 Fix getMergedConfig

**File: `services/base-svc/src/services/teamPlugin.ts`** (MODIFY)

```typescript
// BEFORE: 3 separate queries
async getMergedConfig(teamId: string, pluginName: string, userId: string) {
  const install = await prisma.teamPluginInstall.findFirst({ ... });
  const access = await prisma.teamMemberPluginAccess.findFirst({ ... });
  // merge configs
}

// AFTER: Single query with joins
async getMergedConfig(teamId: string, pluginName: string, userId: string) {
  const result = await prisma.teamPluginInstall.findFirst({
    where: {
      teamId,
      deployment: {
        version: {
          package: { name: pluginName }
        }
      }
    },
    include: {
      deployment: {
        include: {
          version: {
            include: {
              package: true
            }
          }
        }
      },
      team: {
        include: {
          members: {
            where: { userId },
            include: {
              pluginAccess: {
                where: {
                  install: {
                    deployment: {
                      version: {
                        package: { name: pluginName }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  if (!result) return null;

  const sharedConfig = result.sharedConfig || {};
  const personalConfig = result.team.members[0]?.pluginAccess[0]?.personalConfig || {};

  return deepMerge(sharedConfig, personalConfig);
}

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] as any, source[key] as any);
    } else if (source[key] !== undefined) {
      result[key] = source[key] as any;
    }
  }
  return result;
}
```

---

## 7. Add Database Indexes

**File: `services/base-svc/prisma/migrations/YYYYMMDD_add_scaling_indexes/migration.sql`** (NEW)

```sql
-- User lookups (auth)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_users_email" ON "User"("email");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_users_provider" ON "User"("authProvider", "providerId");

-- Team member lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_team_members_user" ON "TeamMember"("userId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_team_members_team_role" ON "TeamMember"("teamId", "role");

-- Plugin queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_plugin_installs_team" ON "TeamPluginInstall"("teamId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_plugin_installs_deployment" ON "TeamPluginInstall"("deploymentId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_plugin_access_member" ON "TeamMemberPluginAccess"("teamMemberId");

-- Marketplace
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_packages_category_published"
  ON "PluginPackage"("category") WHERE "isPublished" = true;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_versions_package_created"
  ON "PluginVersion"("packageId", "createdAt" DESC);

-- Session/Token lookups (if using DB sessions)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_sessions_user" ON "Session"("userId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_sessions_expires" ON "Session"("expiresAt");
```

---

## 8. Graceful Shutdown for PM2

**File: `services/base-svc/src/index.ts`** (MODIFY)

```typescript
import { redis } from './lib/redis';
import { prisma } from './lib/prisma';

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down gracefully...`);

  // Stop accepting new connections
  server.close(async () => {
    console.log('HTTP server closed');

    // Close Redis connection
    try {
      await redis.quit();
      console.log('Redis connection closed');
    } catch (err) {
      console.error('Error closing Redis:', err);
    }

    // Close database connection
    try {
      await prisma.$disconnect();
      console.log('Database connection closed');
    } catch (err) {
      console.error('Error closing database:', err);
    }

    process.exit(0);
  });

  // Force close after 30s
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

---

## 9. PM2 Ecosystem Configuration

**File: `ecosystem.config.js`** (NEW - root directory)

```javascript
module.exports = {
  apps: [
    {
      name: 'base-svc',
      script: 'dist/index.js',
      cwd: './services/base-svc',
      instances: 'max',  // Use all CPU cores
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        REDIS_URL: 'redis://localhost:6379',
      },
      max_memory_restart: '500M',
      kill_timeout: 30000,  // 30s for graceful shutdown
      wait_ready: true,
      listen_timeout: 10000,
    },
    {
      name: 'plugin-server',
      script: 'dist/server.js',
      cwd: './services/plugin-server',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3100,
      },
      max_memory_restart: '256M',
    },
    {
      name: 'my-wallet-svc',
      script: 'dist/index.js',
      cwd: './plugins/my-wallet/backend',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 4008,
        REDIS_URL: 'redis://localhost:6379',
      },
      max_memory_restart: '300M',
    },
    {
      name: 'my-dashboard-svc',
      script: 'dist/index.js',
      cwd: './plugins/my-dashboard/backend',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 4009,
        REDIS_URL: 'redis://localhost:6379',
      },
      max_memory_restart: '300M',
    }
  ]
};
```

---

## 10. Frontend: Add SWR for Data Fetching

**File: `apps/shell-web/src/hooks/useApi.ts`** (NEW)

```typescript
import useSWR, { SWRConfiguration } from 'swr';
import { getApiHeaders } from '../config/api';

const fetcher = async (url: string) => {
  const res = await fetch(url, {
    headers: getApiHeaders(),
  });
  if (!res.ok) throw new Error('API error');
  return res.json();
};

const defaultConfig: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 60000,  // 1 minute dedup
  errorRetryCount: 3,
};

export function useTeamPlugins(teamId: string | null) {
  return useSWR(
    teamId ? `/api/v1/teams/${teamId}/my-plugins` : null,
    fetcher,
    {
      ...defaultConfig,
      refreshInterval: 300000,  // Background refresh every 5 min
    }
  );
}

export function useMarketplace() {
  return useSWR('/api/v1/marketplace', fetcher, {
    ...defaultConfig,
    refreshInterval: 600000,  // Background refresh every 10 min
  });
}

export function useTeam(teamId: string | null) {
  return useSWR(
    teamId ? `/api/v1/teams/${teamId}` : null,
    fetcher,
    defaultConfig
  );
}

export function useUserTeams() {
  return useSWR('/api/v1/teams', fetcher, defaultConfig);
}
```

---

## 11. Nginx Configuration

**File: `nginx/naap.conf`** (NEW)

```nginx
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

# Rate limiting zone
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=auth:10m rate=1r/s;

server {
    listen 80;
    server_name localhost;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1000;
    gzip_proxied any;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    # Security headers
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";

    # Shell-web static files
    location / {
        root /var/www/naap/shell-web/dist;
        try_files $uri $uri/ /index.html;

        # Cache static assets aggressively
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

    # Auth endpoints (strict rate limit)
    location /api/v1/auth/ {
        limit_req zone=auth burst=5 nodelay;

        proxy_pass http://base_svc;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # API endpoints
    location /api/ {
        limit_req zone=api burst=20 nodelay;

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

    # Health check (no rate limit)
    location /healthz {
        proxy_pass http://base_svc;
        access_log off;
    }
}
```

---

## Implementation Checklist

### Must-Have (Weeks 1-4)

| # | Task | File(s) | Priority |
|---|------|---------|----------|
| 1 | Create Redis client | `lib/redis.ts` | P0 |
| 2 | Create cache layer | `lib/cache.ts` | P0 |
| 3 | Update rate limiter to Redis | `middleware/rateLimit.ts` | P0 |
| 4 | Add compression middleware | `index.ts` | P0 |
| 5 | Add cache headers middleware | `middleware/cacheHeaders.ts` | P1 |
| 6 | Add response caching | `middleware/cacheResponse.ts` | P1 |
| 7 | Apply caching to routes | `routes/*.ts` | P1 |
| 8 | Add database indexes | `prisma/migrations/` | P0 |
| 9 | Fix N+1 in getMergedConfig | `services/teamPlugin.ts` | P1 |
| 10 | Add graceful shutdown | `index.ts` | P0 |
| 11 | Create PM2 config | `ecosystem.config.js` | P1 |
| 12 | Create Nginx config | `nginx/naap.conf` | P1 |

### Recommended (Weeks 5-6)

| # | Task | File(s) | Priority |
|---|------|---------|----------|
| 13 | Add SWR hooks | `hooks/useApi.ts` | P2 |
| 14 | Update PluginContext to use SWR | `context/PluginContext.tsx` | P2 |
| 15 | Add metrics endpoint | `routes/metrics.ts` | P2 |
| 16 | Add PgBouncer config | `pgbouncer.ini` | P2 |

---

## Quick Start Commands

```bash
# 1. Install Redis
brew install redis && brew services start redis  # macOS
# OR
sudo apt install redis-server && sudo systemctl start redis  # Ubuntu

# 2. Install dependencies
cd services/base-svc && npm install ioredis compression rate-limiter-flexible
cd ../../apps/shell-web && npm install swr

# 3. Run database migrations (after adding index migration)
cd services/base-svc && npx prisma migrate deploy

# 4. Build for production
npm run build

# 5. Install PM2 and start
npm install -g pm2
pm2 start ecosystem.config.js

# 6. Install Nginx and apply config
brew install nginx  # macOS
sudo cp nginx/naap.conf /usr/local/etc/nginx/servers/  # macOS
sudo nginx -s reload
```

---

## Environment Variables

Add to `.env.production`:

```bash
# Redis
REDIS_URL=redis://localhost:6379

# Database (through PgBouncer)
DATABASE_URL=postgresql://user:pass@localhost:6432/naap_base

# Node
NODE_ENV=production

# Cache TTLs (seconds)
CACHE_TTL_SHORT=60
CACHE_TTL_MEDIUM=300
CACHE_TTL_LONG=600
```
