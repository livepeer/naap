# Deployment Manager Plugin — Dual-Environment Architecture Plan

> **Goal**: Make the deployment-manager plugin work in **both** local development
> (standalone Express on port 4117) **and** Vercel production (Next.js API routes
> as serverless functions).

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Problem Statement](#2-problem-statement)
3. [Architecture Design](#3-architecture-design)
4. [Implementation Phases](#4-implementation-phases)
5. [Phase 1 — Service Layer Extraction](#phase-1--service-layer-extraction)
6. [Phase 2 — Database Persistence](#phase-2--database-persistence)
7. [Phase 3 — Next.js API Routes](#phase-3--nextjs-api-routes)
8. [Phase 4 — Background Jobs → Vercel Cron](#phase-4--background-jobs--vercel-cron)
9. [Phase 5 — Frontend + Plugin Registration](#phase-5--frontend--plugin-registration)
10. [Phase 6 — Integration Testing](#phase-6--integration-testing)
11. [Review Checklist](#review-checklist)

---

## 1. Current State Analysis

### What works today (local dev only)

| Component | File | How it works |
|---|---|---|
| Express server | `backend/src/server.ts` | Standalone on port 4117 |
| In-memory state | `DeploymentOrchestrator.ts` | `Map<string, DeploymentRecord>` |
| In-memory audit | `AuditService.ts` | Array of audit entries |
| In-memory health logs | `HealthMonitorService.ts` | Array + `setInterval` timer |
| In-memory rate limiter | `RateLimiter.ts` | `Map<string, RateLimitEntry>` |
| Version checker | `VersionCheckerService.ts` | `setInterval` (30 min) |
| Health monitor | `HealthMonitorService.ts` | `setInterval` (60s) |
| Provider adapters | `adapters/*.ts` | Proxy through service gateway (`SHELL_URL`) |
| Frontend hooks | `frontend/src/hooks/*.ts` | Fetch from `/api/v1/deployment-manager/*` |

### What breaks on Vercel

| Issue | Root cause |
|---|---|
| No backend server | Express server can't run as a long-lived process on Vercel |
| State lost on cold start | All data in `Map`/`Array` — wiped every invocation |
| No API routes | No Next.js route handler at `app/api/v1/deployment-manager/` |
| Background timers don't work | `setInterval` has no effect in serverless functions |
| Plugin not registered | `deployment-manager` missing from `PLUGIN_PORTS` in `@naap/plugin-sdk` |
| Rate limiter state lost | In-memory sliding window resets every cold start |

### What already works on both environments

| Component | Why it works |
|---|---|
| Provider adapters' gateway calls | Use `SHELL_URL` / service gateway which is the Next.js app itself on Vercel |
| Frontend API paths | Use relative `/api/v1/deployment-manager/*` — works with same-origin on Vercel |
| Service gateway proxy | `apps/web-next/src/app/api/v1/gw/[connector]/[...path]/route.ts` handles all provider proxying |
| `plugin.json` config | Declarative — already references correct paths and database schema |

---

## 2. Problem Statement

The deployment-manager backend is built as a **monolithic Express server with in-memory
state and timers**. This architecture is fundamentally incompatible with Vercel's serverless
model where:

- Each API route runs as an independent, stateless function
- Functions have a max duration (30-120s)
- There are no long-lived processes or persistent in-memory state
- Background work must use Vercel Cron or edge middleware

**Solution**: Extract pure business logic from the Express transport layer, persist state to
PostgreSQL via Prisma, and expose the same API surface through both Express (dev) and
Next.js API routes (production).

---

## 3. Architecture Design

### 3.1 Layered Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (React)                  │
│   hooks call /api/v1/deployment-manager/*            │
└─────────────────┬───────────────────────────────────┘
                  │
         ┌────────┴────────┐
         │  Transport Layer │ ← NEW: two implementations
         ├─────────────────┤
         │ Express (dev)   │  backend/src/server.ts  (port 4117)
         │ Next.js (prod)  │  apps/web-next/src/app/api/v1/deployment-manager/
         └────────┬────────┘
                  │
┌─────────────────┴───────────────────────────────────┐
│              Service Layer (shared)                  │
│  DeploymentOrchestrator  HealthMonitorService        │
│  AuditService            VersionCheckerService       │
│  ArtifactRegistry        ProviderAdapterRegistry     │
└─────────────────┬───────────────────────────────────┘
                  │
         ┌────────┴────────┐
         │  Storage Layer   │ ← NEW: replace in-memory
         ├─────────────────┤
         │ IDeploymentStore │  interface
         │ ├─ MemoryStore   │  for tests + dev (optional)
         │ └─ PrismaStore   │  for production + dev w/ DB
         └─────────────────┘
                  │
         ┌────────┴────────┐
         │   PostgreSQL     │  schema: plugin_deployment_manager
         │   (via Prisma)   │
         └─────────────────┘
```

### 3.2 Key Design Decisions

| Decision | Rationale |
|---|---|
| **Keep Express for local dev** | Hot reload, WebSocket support, fast iteration — don't break existing DX |
| **Add Next.js API routes for production** | Standard naap pattern, works with Vercel serverless |
| **Shared service layer** | Both transports import the same business logic — no duplication |
| **Prisma for persistence** | Already used by naap core, declared in `plugin.json`, handles migrations |
| **Vercel Cron for background jobs** | Replace `setInterval` health/version checks with `/api/v1/deployment-manager/cron/*` |
| **Keep in-memory store for tests** | Fast test execution, no DB dependency in unit tests |
| **Rate limiting via Prisma or Vercel KV** | Survives cold starts; alternatively use Upstash Redis if available |

### 3.3 File Structure (after changes)

```
plugins/deployment-manager/
├── backend/
│   ├── src/
│   │   ├── server.ts                      # Express dev server (unchanged entry point)
│   │   ├── adapters/                      # Provider adapters (unchanged)
│   │   │   ├── IProviderAdapter.ts
│   │   │   ├── FalAdapter.ts
│   │   │   ├── RunPodAdapter.ts
│   │   │   ├── SshBridgeAdapter.ts
│   │   │   ├── BasetenAdapter.ts
│   │   │   ├── ModalAdapter.ts
│   │   │   ├── ReplicateAdapter.ts
│   │   │   └── GithubReleasesAdapter.ts
│   │   ├── services/                      # Business logic (refactored)
│   │   │   ├── DeploymentOrchestrator.ts  # Uses IDeploymentStore instead of Map
│   │   │   ├── AuditService.ts            # Uses IAuditStore instead of Array
│   │   │   ├── HealthMonitorService.ts    # Uses IHealthStore; checkAll() is callable
│   │   │   ├── VersionCheckerService.ts   # checkAll() callable on-demand
│   │   │   ├── ArtifactRegistry.ts        # Unchanged
│   │   │   ├── ProviderAdapterRegistry.ts # Unchanged
│   │   │   └── RateLimiter.ts             # Add DB-backed option
│   │   ├── stores/                        # NEW: storage abstraction
│   │   │   ├── interfaces.ts              # IDeploymentStore, IAuditStore, IHealthStore
│   │   │   ├── MemoryStore.ts             # Current in-memory impl (for tests)
│   │   │   └── PrismaStore.ts             # DB-backed impl
│   │   ├── handlers/                      # NEW: shared request handlers
│   │   │   ├── deployments.handler.ts     # Pure functions: (services, req) → response
│   │   │   ├── providers.handler.ts
│   │   │   ├── artifacts.handler.ts
│   │   │   ├── health.handler.ts
│   │   │   ├── audit.handler.ts
│   │   │   └── cron.handler.ts            # Health check + version check handlers
│   │   ├── routes/                        # Express wrappers (call handlers)
│   │   │   ├── deployments.ts
│   │   │   ├── providers.ts
│   │   │   ├── artifacts.ts
│   │   │   ├── health.ts
│   │   │   ├── audit.ts
│   │   │   └── validation.ts
│   │   ├── types/
│   │   │   └── index.ts
│   │   ├── factory.ts                     # NEW: creates service instances
│   │   └── __tests__/
│   │       ├── orchestrator.test.ts
│   │       ├── adapters.test.ts
│   │       ├── health.test.ts
│   │       ├── handlers.test.ts           # NEW: handler unit tests
│   │       └── prisma-store.test.ts       # NEW: store integration tests
│   ├── prisma/
│   │   └── schema.prisma                  # NEW: Prisma schema
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
├── frontend/                              # Minimal changes
│   └── src/
│       └── hooks/                         # May add error handling improvements
├── nextjs/                                # NEW: Next.js API route handlers
│   ├── deployments/
│   │   ├── route.ts                       # GET (list), POST (create)
│   │   └── [id]/
│   │       ├── route.ts                   # GET, PUT, DELETE
│   │       ├── deploy/route.ts            # POST
│   │       ├── validate/route.ts          # POST
│   │       ├── deploy-and-validate/route.ts  # POST
│   │       ├── retry/route.ts             # POST
│   │       └── history/route.ts           # GET
│   ├── providers/
│   │   ├── route.ts                       # GET (list)
│   │   └── [slug]/
│   │       ├── route.ts                   # GET
│   │       └── gpu-options/route.ts       # GET
│   ├── artifacts/
│   │   ├── route.ts                       # GET (list)
│   │   └── [type]/
│   │       ├── route.ts                   # GET
│   │       ├── versions/route.ts          # GET
│   │       └── latest/route.ts            # GET
│   ├── health/
│   │   ├── summary/route.ts              # GET
│   │   └── [deploymentId]/
│   │       ├── route.ts                   # GET (logs)
│   │       └── check/route.ts             # POST
│   ├── audit/
│   │   └── route.ts                       # GET
│   ├── status/route.ts                    # GET
│   └── cron/
│       ├── health-check/route.ts          # Vercel Cron → calls healthMonitor.checkAll()
│       └── version-check/route.ts         # Vercel Cron → calls versionChecker.checkAll()
├── docs/
│   └── ARCHITECTURE_PLAN.md              # This document
└── plugin.json
```

---

## 4. Implementation Phases

Each phase follows the cycle: **Design → Implement → Test → Review**.

### Overview

| Phase | What | Key Deliverable | Test Criteria |
|---|---|---|---|
| 1 | Service Layer Extraction | `handlers/` + `factory.ts` | Existing tests still pass |
| 2 | Database Persistence | `stores/` + Prisma schema | Integration tests with DB |
| 3 | Next.js API Routes | `nextjs/` directory | curl tests against dev server |
| 4 | Background Jobs → Cron | Cron route handlers | Health/version checks work on Vercel |
| 5 | Frontend + Plugin Registration | Ports config, hooks update | E2E: frontend → API → DB |
| 6 | Integration Testing | Full test suite | Both environments verified |

---

## Phase 1 — Service Layer Extraction

### Goal
Separate transport-agnostic request handling from Express-specific code.

### Design

Create **handler functions** that take services + a generic request shape and return a
generic response shape. Both Express routes and Next.js routes call these handlers.

```typescript
// handlers/deployments.handler.ts

export interface HandlerContext {
  orchestrator: DeploymentOrchestrator;
  audit: AuditService;
  userId: string;
  teamId?: string;
}

export interface HandlerResponse<T = unknown> {
  status: number;
  body: { success: boolean; data?: T; error?: string; details?: unknown };
}

export async function handleListDeployments(
  ctx: HandlerContext,
  query: { status?: string; provider?: string; userId?: string; teamId?: string }
): Promise<HandlerResponse> {
  // ... business logic extracted from routes/deployments.ts
}

export async function handleCreateDeployment(
  ctx: HandlerContext,
  body: unknown
): Promise<HandlerResponse> {
  // ... validation + orchestrator.create()
}
```

### factory.ts — Service Instance Creation

```typescript
// factory.ts
export interface ServiceContainer {
  registry: ProviderAdapterRegistry;
  orchestrator: DeploymentOrchestrator;
  audit: AuditService;
  artifactRegistry: ArtifactRegistry;
  healthMonitor: HealthMonitorService;
  versionChecker: VersionCheckerService;
}

// Singleton for serverless (survives warm invocations)
let _container: ServiceContainer | null = null;

export function getServices(storeType: 'memory' | 'prisma' = 'prisma'): ServiceContainer {
  if (_container) return _container;

  const registry = new ProviderAdapterRegistry();
  registry.register(new RunPodAdapter());
  registry.register(new SshBridgeAdapter());
  registry.register(new FalAdapter());
  registry.register(new BasetenAdapter());
  registry.register(new ModalAdapter());
  registry.register(new ReplicateAdapter());

  const store = storeType === 'prisma' ? new PrismaStore() : new MemoryStore();
  const audit = new AuditService(store);
  const orchestrator = new DeploymentOrchestrator(registry, audit, store);
  // ... etc

  _container = { registry, orchestrator, audit, /* ... */ };
  return _container;
}
```

### Implementation Steps

1. Create `backend/src/handlers/` directory
2. Extract handler functions from each route file
3. Create `backend/src/factory.ts`
4. Refactor `routes/*.ts` to call handlers
5. Update `server.ts` to use factory

### Test

```bash
cd plugins/deployment-manager/backend
npm test  # All existing tests must pass
```

### Review Checklist
- [ ] No business logic remains in `routes/*.ts` — only Express req/res wiring
- [ ] Handler functions are pure (no Express types in signatures)
- [ ] `factory.ts` creates all services with proper dependency injection
- [ ] All 3 existing test files pass without modification
- [ ] Handler functions have their own unit tests

---

## Phase 2 — Database Persistence

### Goal
Replace in-memory `Map`/`Array` stores with Prisma-backed persistence.

### Design — Store Interfaces

```typescript
// stores/interfaces.ts

export interface IDeploymentStore {
  create(record: DeploymentRecord): Promise<DeploymentRecord>;
  get(id: string): Promise<DeploymentRecord | null>;
  update(id: string, data: Partial<DeploymentRecord>): Promise<DeploymentRecord>;
  delete(id: string): Promise<boolean>;
  list(filters?: DeploymentFilters): Promise<DeploymentRecord[]>;
}

export interface IStatusLogStore {
  append(entry: StatusLogEntry): Promise<void>;
  listByDeployment(deploymentId: string): Promise<StatusLogEntry[]>;
}

export interface IAuditStore {
  append(entry: AuditEntry): Promise<void>;
  query(filters: AuditFilters): Promise<{ data: AuditEntry[]; total: number }>;
}

export interface IHealthLogStore {
  append(entry: HealthLogEntry): Promise<void>;
  listByDeployment(deploymentId: string, limit?: number): Promise<HealthLogEntry[]>;
  evict(deploymentId: string, keepCount: number): Promise<void>;
}
```

### Design — Prisma Schema

```prisma
// backend/prisma/schema.prisma

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model DmDeployment {
  id                    String    @id @default(uuid())
  name                  String
  teamId                String?   @map("team_id")
  ownerUserId           String    @map("owner_user_id")
  providerSlug          String    @map("provider_slug")
  providerMode          String    @map("provider_mode")
  providerConfig        Json?     @map("provider_config")
  connectorId           String?   @map("connector_id")
  gpuModel              String    @map("gpu_model")
  gpuVramGb             Int       @map("gpu_vram_gb")
  gpuCount              Int       @default(1) @map("gpu_count")
  cudaVersion           String?   @map("cuda_version")
  artifactType          String    @map("artifact_type")
  artifactVersion       String    @map("artifact_version")
  dockerImage           String    @map("docker_image")
  artifactConfig        Json?     @map("artifact_config")
  status                String    @default("PENDING")
  healthStatus          String    @default("UNKNOWN") @map("health_status")
  providerDeploymentId  String?   @map("provider_deployment_id")
  endpointUrl           String?   @map("endpoint_url")
  sshHost               String?   @map("ssh_host")
  sshPort               Int?      @map("ssh_port")
  sshUsername            String?   @map("ssh_username")
  containerName         String?   @map("container_name")
  latestAvailableVersion String?  @map("latest_available_version")
  hasUpdate             Boolean   @default(false) @map("has_update")
  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")
  lastHealthCheck       DateTime? @map("last_health_check")
  deployedAt            DateTime? @map("deployed_at")

  statusLogs  DmStatusLog[]
  healthLogs  DmHealthLog[]
  auditLogs   DmAuditLog[]

  @@map("dm_deployments")
  @@schema("plugin_deployment_manager")
}

model DmStatusLog {
  id            String    @id @default(uuid())
  deploymentId  String    @map("deployment_id")
  fromStatus    String?   @map("from_status")
  toStatus      String    @map("to_status")
  reason        String?
  initiatedBy   String?   @map("initiated_by")
  metadata      Json?
  createdAt     DateTime  @default(now()) @map("created_at")

  deployment    DmDeployment @relation(fields: [deploymentId], references: [id], onDelete: Cascade)

  @@index([deploymentId, createdAt])
  @@map("dm_status_logs")
  @@schema("plugin_deployment_manager")
}

model DmHealthLog {
  id            String    @id @default(uuid())
  deploymentId  String    @map("deployment_id")
  status        String
  responseTime  Int?      @map("response_time")
  statusCode    Int?      @map("status_code")
  details       Json?
  createdAt     DateTime  @default(now()) @map("created_at")

  deployment    DmDeployment @relation(fields: [deploymentId], references: [id], onDelete: Cascade)

  @@index([deploymentId, createdAt])
  @@map("dm_health_logs")
  @@schema("plugin_deployment_manager")
}

model DmAuditLog {
  id            String    @id @default(uuid())
  deploymentId  String?   @map("deployment_id")
  action        String
  resource      String
  resourceId    String?   @map("resource_id")
  userId        String    @map("user_id")
  ipAddress     String?   @map("ip_address")
  userAgent     String?   @map("user_agent")
  details       Json?
  status        String
  errorMsg      String?   @map("error_msg")
  createdAt     DateTime  @default(now()) @map("created_at")

  deployment    DmDeployment? @relation(fields: [deploymentId], references: [id], onDelete: SetNull)

  @@index([deploymentId])
  @@index([userId])
  @@index([action])
  @@map("dm_audit_logs")
  @@schema("plugin_deployment_manager")
}
```

### Implementation Steps

1. Create `backend/src/stores/interfaces.ts` with all store interfaces
2. Create `backend/src/stores/MemoryStore.ts` — extract current in-memory logic
3. Create `backend/prisma/schema.prisma`
4. Run `npx prisma generate` to create client
5. Create `backend/src/stores/PrismaStore.ts` implementing all interfaces
6. Refactor `DeploymentOrchestrator` to accept `IDeploymentStore` + `IStatusLogStore`
7. Refactor `AuditService` to accept `IAuditStore`
8. Refactor `HealthMonitorService` to accept `IHealthLogStore`
9. Update `factory.ts` to wire stores based on environment

### Test

```bash
# Unit tests (memory store)
npm test

# Integration tests (requires DATABASE_URL)
DATABASE_URL=... npm run test:integration
```

### Review Checklist
- [ ] Store interfaces are minimal and don't leak Prisma types
- [ ] MemoryStore passes all existing unit tests
- [ ] PrismaStore has its own integration test suite
- [ ] Migrations are generated and applied cleanly
- [ ] `DeploymentOrchestrator` no longer has any `Map` or `Array` fields
- [ ] `AuditService` no longer has any `Array` fields
- [ ] `HealthMonitorService` no longer has any `Array` or `Map` fields

---

## Phase 3 — Next.js API Routes

### Goal
Create Next.js API route handlers that mirror the Express API surface.

### Design

Each Next.js route imports `getServices()` and the appropriate handler function:

```typescript
// nextjs/deployments/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServices } from '@/plugins/deployment-manager/backend/src/factory';
import {
  handleListDeployments,
  handleCreateDeployment,
} from '@/plugins/deployment-manager/backend/src/handlers/deployments.handler';
import { getAuthFromRequest } from '@/lib/api/auth';

export async function GET(request: NextRequest) {
  const auth = await getAuthFromRequest(request);
  if (!auth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { orchestrator, audit } = getServices();
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const result = await handleListDeployments(
    { orchestrator, audit, userId: auth.userId, teamId: auth.teamId },
    query,
  );
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthFromRequest(request);
  if (!auth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { orchestrator, audit } = getServices();
  const body = await request.json();
  const result = await handleCreateDeployment(
    { orchestrator, audit, userId: auth.userId, teamId: auth.teamId },
    body,
  );
  return NextResponse.json(result.body, { status: result.status });
}
```

### Route Placement Options

**Option A**: Place routes directly in `apps/web-next/src/app/api/v1/deployment-manager/`

- Pros: Standard Next.js pattern, auto-discovered
- Cons: Plugin code lives outside `plugins/` directory

**Option B**: Place route files in `plugins/deployment-manager/nextjs/` and symlink or
re-export from `apps/web-next/`

- Pros: Plugin is self-contained
- Cons: Symlinks can be fragile, import paths more complex

**Recommended: Option A** — Place routes in `apps/web-next/src/app/api/v1/deployment-manager/`.
This is consistent with how `gw/` and other API routes work. The handler logic still lives
in `plugins/deployment-manager/backend/src/handlers/` and is imported.

### Implementation Steps

1. Create `apps/web-next/src/app/api/v1/deployment-manager/` directory tree
2. Create route files for each endpoint (see file structure above)
3. Each route file: parse request → call handler → return NextResponse
4. Add auth middleware using existing `getAuthFromRequest` or `authorize`
5. Add Vercel function config (maxDuration) to `vercel.json`

### vercel.json Addition

```json
{
  "functions": {
    "app/api/v1/deployment-manager/**": {
      "maxDuration": 60
    },
    "app/api/v1/deployment-manager/cron/**": {
      "maxDuration": 120
    }
  }
}
```

### Test

```bash
# Start Next.js dev server
cd apps/web-next && npm run dev

# Test endpoints
curl http://localhost:3000/api/v1/deployment-manager/providers
curl http://localhost:3000/api/v1/deployment-manager/artifacts
curl http://localhost:3000/api/v1/deployment-manager/deployments
```

### Review Checklist
- [ ] Every Express endpoint has a corresponding Next.js route
- [ ] Auth is enforced on all mutating endpoints
- [ ] Rate limiting works (DB-backed, not in-memory)
- [ ] Response shapes are identical between Express and Next.js
- [ ] No Express/Node-specific APIs leak into handlers
- [ ] Function timeouts are set in `vercel.json`

---

## Phase 4 — Background Jobs → Vercel Cron

### Goal
Replace `setInterval`-based health monitoring and version checking with Vercel Cron-compatible
endpoints.

### Design

Create cron-specific route handlers that are:
- Called by Vercel Cron in production (configured in `vercel.json`)
- Called by `setInterval` in the Express dev server (unchanged behavior)

```typescript
// handlers/cron.handler.ts

export async function handleHealthCheckCron(
  services: ServiceContainer
): Promise<HandlerResponse> {
  const results = await services.healthMonitor.checkAll();
  return {
    status: 200,
    body: {
      success: true,
      data: { checked: results.length, timestamp: new Date().toISOString() },
    },
  };
}

export async function handleVersionCheckCron(
  services: ServiceContainer
): Promise<HandlerResponse> {
  await services.versionChecker.checkAll();
  return {
    status: 200,
    body: { success: true, data: { timestamp: new Date().toISOString() } },
  };
}
```

### vercel.json Cron Addition

```json
{
  "crons": [
    { "path": "/api/v1/deployment-manager/cron/health-check", "schedule": "* * * * *" },
    { "path": "/api/v1/deployment-manager/cron/version-check", "schedule": "*/30 * * * *" }
  ]
}
```

### Cron Route Security

Vercel Cron requests include a `CRON_SECRET` header. The route should verify this:

```typescript
// nextjs/cron/health-check/route.ts
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const services = getServices();
  const result = await handleHealthCheckCron(services);
  return NextResponse.json(result.body, { status: result.status });
}
```

### Express Dev Server Changes

In `server.ts`, the `setInterval` calls remain for local development. They call the
same `healthMonitor.checkAll()` and `versionChecker.checkAll()` methods. No change needed.

### Implementation Steps

1. Create `handlers/cron.handler.ts`
2. Refactor `HealthMonitorService.checkAll()` to return results (not void)
3. Refactor `VersionCheckerService.checkAll()` to return results
4. Remove timer start/stop dependency from the service constructors
5. In `server.ts`, keep timers that call `checkAll()` for dev
6. Create Next.js cron route files
7. Add cron config to `vercel.json`

### Test

```bash
# Test cron handlers locally
curl -X GET http://localhost:3000/api/v1/deployment-manager/cron/health-check \
  -H "Authorization: Bearer test-secret"
```

### Review Checklist
- [ ] Cron routes are protected with `CRON_SECRET`
- [ ] `checkAll()` methods return meaningful results
- [ ] Express dev server still runs health/version checks via timers
- [ ] Cron functions complete within 120s timeout
- [ ] No `setInterval` calls in production code paths

---

## Phase 5 — Frontend + Plugin Registration

### Goal
Register the plugin in the SDK port config and ensure frontend works in both environments.

### Design

#### 5.1 Register in PLUGIN_PORTS

Add to `packages/plugin-sdk/src/config/ports.ts`:

```typescript
export const PLUGIN_PORTS = {
  // ... existing entries
  'deployment-manager': 4117,
} as const;
```

And add to `API_PATHS`:

```typescript
export const API_PATHS = {
  // ... existing entries
  'deployment-manager': '/api/v1/deployment-manager',
} as const;
```

#### 5.2 Frontend Hook Updates

The frontend hooks currently use `const API_BASE = '/api/v1/deployment-manager'`.
This works in production (same-origin) but won't work in local dev if the frontend
runs on port 3117 and the backend on port 4117.

**Option**: Use `getPluginBackendUrl` from `@naap/plugin-sdk`:

```typescript
// hooks/useDeployments.ts
import { getPluginBackendUrl } from '@naap/plugin-sdk';

const API_BASE = getPluginBackendUrl('deployment-manager', {
  apiPath: '/api/v1/deployment-manager',
});
```

This resolves to:
- Dev: `http://localhost:4117/api/v1/deployment-manager`
- Prod: `/api/v1/deployment-manager` (same-origin)

### Implementation Steps

1. Add `deployment-manager` to `PLUGIN_PORTS` and `API_PATHS`
2. Update `useDeployments.ts` to use `getPluginBackendUrl`
3. Update `useProviders.ts` to use `getPluginBackendUrl`
4. Update `useHealthPolling.ts` to use `getPluginBackendUrl`
5. Verify frontend builds and connects to backend in both environments

### Test

```bash
# Dev: frontend on 3117, backend on 4117
cd plugins/deployment-manager/frontend && npm run dev
# Verify API calls go to localhost:4117

# Prod simulation: both on localhost:3000
cd apps/web-next && npm run dev
# Verify API calls go to same-origin
```

### Review Checklist
- [ ] `PLUGIN_PORTS` includes `deployment-manager: 4117`
- [ ] `API_PATHS` includes `deployment-manager`
- [ ] Frontend hooks use SDK URL resolution
- [ ] No hardcoded `localhost` URLs in frontend code
- [ ] Frontend works when loaded through shell (iframe)
- [ ] Frontend works standalone (Vite dev)

---

## Phase 6 — Integration Testing

### Goal
Verify the full stack works in both environments end-to-end.

### Test Plan

#### 6.1 Unit Tests (memory store, no DB)

```bash
cd plugins/deployment-manager/backend
npm test
```

Expected: All existing tests pass + new handler tests pass.

#### 6.2 Integration Tests (Prisma + test DB)

```bash
DATABASE_URL=postgresql://... npm run test:integration
```

Tests:
- Create deployment → persisted in DB
- List deployments → returns from DB
- Deploy → status transitions persisted
- Health check → logs stored in DB
- Audit log → entries persisted
- Version check → hasUpdate flag updated in DB

#### 6.3 Express Dev Server E2E

```bash
cd plugins/deployment-manager/backend
npm run dev

# In another terminal:
curl http://localhost:4117/healthz
curl http://localhost:4117/api/v1/deployment-manager/providers
curl http://localhost:4117/api/v1/deployment-manager/artifacts
curl -X POST http://localhost:4117/api/v1/deployment-manager/deployments \
  -H 'Content-Type: application/json' \
  -d '{"name":"test","providerSlug":"fal-ai","gpuModel":"A100","gpuVramGb":80,"gpuCount":1,"artifactType":"ai-runner","artifactVersion":"v0.14.1","dockerImage":"livepeer/ai-runner:v0.14.1"}'
```

#### 6.4 Next.js Dev Server E2E

```bash
cd apps/web-next
npm run dev

# Same curl tests but against localhost:3000
curl http://localhost:3000/api/v1/deployment-manager/providers
curl http://localhost:3000/api/v1/deployment-manager/artifacts
```

#### 6.5 Vercel Preview Deploy

```bash
git push  # triggers Vercel preview
# Test against preview URL
curl https://naap-xxx.vercel.app/api/v1/deployment-manager/providers
```

### Review Checklist
- [ ] Unit tests: all pass
- [ ] Integration tests: all pass
- [ ] Express dev server: all endpoints respond correctly
- [ ] Next.js dev server: all endpoints respond correctly
- [ ] Frontend → Express dev backend: works
- [ ] Frontend → Next.js dev backend: works
- [ ] Vercel preview: API routes respond
- [ ] Vercel cron: health check fires
- [ ] No regressions in other plugins

---

## Review Checklist (Final)

### Architecture
- [ ] Single source of truth for business logic (handlers/)
- [ ] Two transport layers (Express + Next.js) with zero logic duplication
- [ ] Storage abstraction with pluggable backends
- [ ] No in-memory state that survives requests in production

### Compatibility
- [ ] `npm run dev` in plugin still works (Express, port 4117)
- [ ] `npm run dev` in web-next serves deployment-manager API
- [ ] Vercel deployment has all routes
- [ ] Frontend works in shell (iframe) and standalone
- [ ] Gateway proxy (service-gateway) calls work from both environments

### Data
- [ ] Prisma migration creates all tables in `plugin_deployment_manager` schema
- [ ] Deployment CRUD persists to PostgreSQL
- [ ] Audit logs persisted
- [ ] Health logs persisted with eviction
- [ ] Status transitions logged with full history

### Operations
- [ ] Health monitoring works via cron (production) and setInterval (dev)
- [ ] Version checking works via cron (production) and setInterval (dev)
- [ ] Rate limiting survives cold starts
- [ ] Plugin registered in SDK port config

---

## Appendix: Environment Detection

The system determines which environment it's running in:

```typescript
function getEnvironment(): 'vercel' | 'local' {
  if (process.env.VERCEL === '1') return 'vercel';
  return 'local';
}

function getStoreType(): 'memory' | 'prisma' {
  if (process.env.DATABASE_URL) return 'prisma';
  return 'memory';
}
```

- **Local dev without DB**: Uses memory store (current behavior, zero setup)
- **Local dev with DB**: Uses Prisma store (set `DATABASE_URL`)
- **Vercel production**: Always uses Prisma store (`DATABASE_URL` from Vercel env)

This ensures backward compatibility — developers can still run the plugin locally
without a database for quick iteration.
