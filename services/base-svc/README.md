# base-svc — NaaP Platform Core Service

> The central backend service for the NaaP platform: authentication, plugin registry,
> RBAC, multi-tenancy, lifecycle management, and more.

## Architecture Overview

`base-svc` uses a **modular route architecture** where every API domain lives in its
own route module under `src/routes/`. The main `server.ts` file is a lean
**composition root** (~380 lines) that wires middleware, services, and route modules
together.

```
services/base-svc/src/
  server.ts                  # Composition root — middleware, services, route mounting
  db/client.ts               # Prisma database client
  middleware/
    auth.ts                  # JWT + API token authentication
    tenantContext.ts          # Multi-tenant middleware
  routes/
    auth.ts                  # Email/password + OAuth authentication
    base.ts                  # CSP, legacy auth, features, jobs, stats, plugins, prefs
    lifecycle.ts             # Plugin install/uninstall, integrations, lifecycle events
    metadata.ts              # Plugin config, metrics, health, validation, versions
    rbac.ts                  # RBAC roles, permissions, admin, plugin admin
    registry.ts              # Marketplace, reviews, publishers, publishing
    secrets.ts               # Secret vault, API key mappings
    tenant.ts                # Multi-tenant installations, deployments
    tokens-webhooks.ts       # API tokens, JWT tokens, GitHub webhooks
    team.ts                  # Team/organization management
    admin/
      tenants.ts             # Admin tenant management
  services/                  # Business logic services (lifecycle, rbac, secrets, etc.)
  utils/
    getUserId.ts             # Shared user ID extraction utility
  test/
    helpers.ts               # Mock factories for db, services, Express test app
    routes/
      base.test.ts           # 24 contract tests
      lifecycle.test.ts      # Contract tests for lifecycle routes
      metadata.test.ts       # Contract tests for metadata routes
      rbac.test.ts           # Contract tests for RBAC routes
      registry.test.ts       # Contract tests for registry routes
      secrets.test.ts        # Contract tests for secrets routes
      tenant.test.ts         # 24 contract tests
      tokens-webhooks.test.ts# Contract tests for tokens/webhooks routes
```

### Key Numbers

| Metric | Value |
|--------|-------|
| Route modules | 10 (+ 1 admin sub-module) |
| Route handlers | ~106 across all modules |
| Test files | 8 route test files |
| Test cases | 319 total (passing) |
| `server.ts` size | ~380 lines (composition root) |

---

## Route Module Pattern

Every route module follows the **factory pattern** with explicit dependency injection.
This makes modules testable in isolation and keeps `server.ts` free of business logic.

### Factory Function Signature

```typescript
// routes/domain.ts
import { Router, Request, Response } from 'express';

interface DomainRouteDeps {
  db: any;
  someService: {
    doThing: (id: string) => Promise<unknown>;
  };
}

export function createDomainRoutes(deps: DomainRouteDeps) {
  const { db, someService } = deps;
  const router = Router();

  router.get('/domain/items', async (req: Request, res: Response) => {
    try {
      const items = await someService.doThing('all');
      res.json({ items });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
```

### Mounting in server.ts

```typescript
// server.ts
import { createDomainRoutes } from './routes/domain';

const domainRoutes = createDomainRoutes({ db, someService });
app.use('/api/v1', domainRoutes);
```

### Why This Pattern?

| Benefit | Explanation |
|---------|-------------|
| **Testability** | Mock every dependency, test routes with `supertest` in <1s |
| **No global state** | Each module receives only what it needs — no hidden coupling |
| **Composition root** | `server.ts` is the single place where everything is wired |
| **Type safety** | Dependency interfaces document the contract explicitly |
| **Refactoring safety** | Change a service signature → TS catches every caller |

---

## Route Module Reference

### `routes/auth.ts` — Authentication (Email/Password + OAuth)
- **Factory:** `createAuthRoutes({ db, lifecycleService })`
- **Endpoints:** Login, register, logout, session validation, password reset, OAuth callbacks
- **Notes:** Returns both `router` and `authService` for lazy binding in `server.ts`

### `routes/base.ts` — Core Application Routes
- **Factory:** `createBaseRoutes({ db, requireToken, getCacheStats })`
- **Endpoints:** CSP reporting, legacy wallet auth, feature flags, job feeds, historical stats, workflow plugin CRUD, user preferences, debug console access, personalized plugins
- **Notes:** In-memory CSP violation store scoped to the module

### `routes/lifecycle.ts` — Plugin Lifecycle & Integrations
- **Factory:** `createLifecycleRoutes({ db, lifecycleService, secretVaultService })`
- **Endpoints:** Plugin install/uninstall, integration config/proxy, lifecycle events, audit logs
- **Notes:** Contains private helper functions for integration call execution (OpenAI, generic REST)

### `routes/metadata.ts` — Plugin Config & Metrics
- **Factory:** `createMetadataRoutes({ db, publishMetrics, artifactHealth, manifestValidator, versionManager })`
- **Endpoints:** Personal plugin config, publish metrics, artifact health, manifest validation, version management

### `routes/rbac.ts` — Access Control
- **Factory:** `createRbacRoutes({ rbacService, delegationService, lifecycleService, getUserIdFromRequest })`
- **Endpoints:** Role CRUD, permission checks, platform admin, plugin admin delegation

### `routes/registry.ts` — Marketplace & Publishing
- **Factory:** `createRegistryRoutes({ db, getUserIdFromRequest, lifecycleService, authService, requireToken, generateApiToken, verifyPublish })`
- **Endpoints:** Package browsing, reviews/ratings, publisher management, package publishing

### `routes/secrets.ts` — Secret Management
- **Factory:** `createSecretsRoutes({ secretVaultService, lifecycleService })`
- **Endpoints:** Secret vault CRUD, API key mapping management

### `routes/tenant.ts` — Multi-Tenant Plugin Management
- **Factory:** `createTenantRoutes({ db, tenantService, deploymentService, rbacService, lifecycleService, getUserIdFromRequest, csrfProtection, tenantMiddleware, forwardTenantHeaders })`
- **Endpoints:** Tenant installations CRUD, preferences, config, deployment management (admin)

### `routes/tokens-webhooks.ts` — API Tokens & Webhooks
- **Factory:** `createTokensWebhooksRoutes({ db, lifecycleService, getUserIdFromRequest, generateApiToken, hashToken, requireToken, verifyGitHubWebhook })`
- **Endpoints:** API token management, JWT session tokens, GitHub webhook config

---

## Developer Guide: Adding a New Route Module

This step-by-step tutorial shows how to add a new domain of API endpoints.

### Step 1: Create the Route File

```typescript
// src/routes/notifications.ts
import { Router, Request, Response } from 'express';

// 1. Define dependency interface — only what this module needs
interface NotificationRouteDeps {
  db: any;
  getUserIdFromRequest: (req: Request) => Promise<string | null>;
  notificationService: {
    list: (userId: string, limit: number) => Promise<unknown[]>;
    markRead: (userId: string, notificationId: string) => Promise<void>;
    getUnreadCount: (userId: string) => Promise<number>;
  };
}

// 2. Factory function — pure, no side effects
export function createNotificationRoutes(deps: NotificationRouteDeps) {
  const { db, getUserIdFromRequest, notificationService } = deps;
  const router = Router();

  // 3. Define handlers — each with try/catch and consistent error shape
  router.get('/notifications', async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const notifications = await notificationService.list(userId, limit);
      res.json({ notifications });
    } catch (error) {
      console.error('Error listing notifications:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/notifications/unread-count', async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const count = await notificationService.getUnreadCount(userId);
      res.json({ count });
    } catch (error) {
      console.error('Error getting unread count:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/notifications/:id/read', async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      await notificationService.markRead(userId, req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error marking notification read:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
```

### Step 2: Write Contract Tests (BEFORE wiring into server.ts)

```typescript
// src/test/routes/notifications.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createTestApp, createMockDb } from '../helpers';
import { createNotificationRoutes } from '../../routes/notifications';

let db: ReturnType<typeof createMockDb>;
let app: ReturnType<typeof createTestApp>;

const mockGetUserId = vi.fn().mockResolvedValue('user-1');
const mockNotificationService = {
  list: vi.fn().mockResolvedValue([]),
  markRead: vi.fn().mockResolvedValue(undefined),
  getUnreadCount: vi.fn().mockResolvedValue(0),
};

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  app = createTestApp();
  app.use('/api/v1', createNotificationRoutes({
    db,
    getUserIdFromRequest: mockGetUserId,
    notificationService: mockNotificationService,
  }));
});

describe('Notifications', () => {
  it('GET /notifications returns 401 when not authenticated', async () => {
    mockGetUserId.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });

  it('GET /notifications returns list', async () => {
    mockNotificationService.list.mockResolvedValue([{ id: 'n-1', message: 'Hello' }]);
    const res = await request(app).get('/api/v1/notifications');
    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(1);
  });

  it('GET /notifications/unread-count returns count', async () => {
    mockNotificationService.getUnreadCount.mockResolvedValue(5);
    const res = await request(app).get('/api/v1/notifications/unread-count');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(5);
  });

  it('POST /notifications/:id/read marks as read', async () => {
    const res = await request(app).post('/api/v1/notifications/n-1/read');
    expect(res.status).toBe(200);
    expect(mockNotificationService.markRead).toHaveBeenCalledWith('user-1', 'n-1');
  });
});
```

### Step 3: Run Tests

```bash
cd services/base-svc
npx vitest run src/test/routes/notifications.test.ts
```

### Step 4: Mount in server.ts

Add the import and mount call alongside the other route modules:

```typescript
// In the route mounting section of server.ts
import { createNotificationRoutes } from './routes/notifications';

const notificationRoutes = createNotificationRoutes({
  db, getUserIdFromRequest, notificationService,
});
app.use('/api/v1', notificationRoutes);
```

### Step 5: Run Full Test Suite

```bash
npx vitest run          # All 319+ tests must pass
npx tsc --noEmit        # No new type errors
```

---

## Testing Guide

### Test Infrastructure

All route tests use shared helpers from `src/test/helpers.ts`:

| Helper | Purpose |
|--------|---------|
| `createMockDb()` | Full Prisma mock with all models (findUnique, findMany, create, update, etc.) |
| `createMockLifecycleService()` | Mock lifecycle service (audit, install, uninstall, events) |
| `createMockSecretVaultService()` | Mock secret vault (store, list, delete, rotate) |
| `createMockRbacService()` | Mock RBAC (roles, permissions, hasRole) |
| `createMockTenantService()` | Mock tenant service (installations, config, preferences) |
| `createMockDeploymentService()` | Mock deployment service (create, start, complete, cleanup) |
| `createTestApp()` | Minimal Express app with JSON parsing for `supertest` |

### Writing Effective Tests

```typescript
// Pattern: arrange → act → assert
it('returns 404 when resource not found', async () => {
  // Arrange: configure mock to return null
  db.pluginPackage.findUnique.mockResolvedValue(null);

  // Act: make HTTP request
  const res = await request(app).get('/api/v1/registry/packages/nonexistent');

  // Assert: check status and body
  expect(res.status).toBe(404);
  expect(res.body.error).toBeDefined();
});
```

### Running Tests

```bash
# All tests
npx vitest run

# Single file
npx vitest run src/test/routes/base.test.ts

# Watch mode (re-runs on save)
npx vitest --watch

# With coverage
npx vitest run --coverage
```

---

## server.ts Composition Root

The `server.ts` file has a clear sequential flow:

```
1. Imports
2. App creation + global middleware (CORS, compression, JSON, CSRF, rate limiting)
3. Health check endpoint (/healthz — root level, not /api/v1)
4. Auth route lazy-binding (needs lifecycleService)
5. Registry route lazy-binding (needs authService)
6. Service instantiation (lifecycle, secrets, rbac, delegation, tenant, deployment)
7. Auth init → Registry init
8. Route module mounting (base, tenant, lifecycle, secrets, rbac, metadata)
9. Team + admin route mounting
10. WebSocket server
11. Graceful shutdown handler
12. Server start + startup tasks
```

### Adding a New Service Dependency

If your route module needs a new service:

1. Create the service in `src/services/`
2. Instantiate it in the "Service Initialization" section of `server.ts`
3. Pass it as a dependency when creating the route module

---

## Quick Reference

### Running the Service

```bash
# Development (hot reload)
cd services/base-svc
npm run dev

# Or from project root
./bin/start.sh --services
```

### Health Check

```bash
curl http://localhost:4000/healthz
```

### API Base URL

```
http://localhost:4000/api/v1/
```

### Common API Paths

| Path | Module | Description |
|------|--------|-------------|
| `/api/v1/auth/*` | auth.ts | Login, register, OAuth |
| `/api/v1/base/*` | base.ts | Features, plugins, preferences |
| `/api/v1/registry/*` | registry.ts | Marketplace, publishing |
| `/api/v1/plugins/*/install` | lifecycle.ts | Plugin installation |
| `/api/v1/rbac/*` | rbac.ts | Roles and permissions |
| `/api/v1/secrets/*` | secrets.ts | Secret vault |
| `/api/v1/tenant/*` | tenant.ts | Multi-tenant installations |
| `/api/v1/tokens/*` | tokens-webhooks.ts | API tokens |
| `/api/v1/teams/*` | team.ts | Team management |
| `/api/v1/deployments/*` | tenant.ts | Deployment management |
