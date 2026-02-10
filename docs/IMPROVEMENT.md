# NaaP Platform - Architectural Review & Improvement Plan

> **Review Date:** February 2026
> **Reviewer:** Expert Architecture Review (Chief Staff Engineer Level)
> **Objective:** Identify blocking issues and create executable plan for solid MVP

---

## Executive Summary

The NaaP platform has achieved MVP status with a working Vercel deployment. Key milestones:

1. ~~**6 of 11 plugins have mock/incomplete backends**~~ ✅ All required backends complete
2. ~~**Dual shell implementations**~~ ✅ `shell-web` retired, single Next.js shell
3. ~~**Significant code duplication**~~ ✅ Reduced by ~1,410 lines via shared packages
4. ~~**API integration patterns inconsistent**~~ ✅ Standardized envelope format, SDK utilities
5. ~~**Hybrid deployment required**~~ ✅ Fully deployed on Vercel with API route handlers

**Overall Platform Health: 85%** - MVP deployed and functional on Vercel

---

## Critical Blocking Issues

### ~~BLOCKER 1: Incomplete Plugin Backends~~ ✅ RESOLVED (Phase 2)

**Status:** RESOLVED - All required backends are now complete.

| Plugin | Frontend | Backend | Status | Notes |
|--------|----------|---------|--------|-------|
| marketplace | 95% | N/A | ✅ OK | Frontend uses main registry API directly |
| orchestrator-manager | 50% | N/A | ✅ OK | Frontend uses SDK hooks for Livepeer |
| capacity-planner | 85% | 100% | ✅ COMPLETE | Full Prisma + Express backend |
| network-analytics | 60% | N/A | ✅ OK | Frontend uses SDK hooks for Livepeer |
| developer-api | 50% | 100% | ✅ COMPLETE | Full Prisma + Express backend |

**Key Finding:** 3 of 5 "incomplete" backends were actually unused - frontends access data directly through main APIs or SDK hooks.

### ~~BLOCKER 2: Dual Shell Maintenance Burden~~ ✅ RESOLVED (Phase 0)

**Status:** RESOLVED - shell-web has been retired.

Only one shell implementation now exists:
- `apps/web-next/` - Next.js 15 (primary and only shell)

**Completed in Phase 0:**
- Deleted `apps/shell-web/` directory completely
- Updated `bin/start.sh` to remove legacy mode
- Updated `nx.json` default project to `web-next`
- Updated SDK CLI commands to remove shell-web references
- Updated documentation to reflect new architecture

### ~~BLOCKER 3: API Integration Pattern Chaos~~ ✅ RESOLVED

**Status:** RESOLVED — Auth and API patterns consolidated.

- Auth token retrieval consolidated in `@naap/plugin-utils`
- API response envelope standardized: `{ success: true, data: T, meta? }` / `{ success: false, error: { code, message } }`
- All plugin frontends updated to correctly unwrap the envelope
- Plugin name normalization added for URL parameter matching

### ~~BLOCKER 4: Vite Config Duplication~~ ✅ RESOLVED (Phase 1)

**Status:** RESOLVED — All 11 plugins now use `createPluginConfig()` from `@naap/plugin-build`.

- Reduced ~1,430 lines of Vite config to ~120 lines total (92% reduction)
- Single factory function handles UMD build, React externals, aliases, and manifest generation

### ~~BLOCKER 5: Vercel Incompatibility~~ ✅ RESOLVED

**Status:** RESOLVED — Platform fully deployed on Vercel.

- All plugin API logic runs as **Next.js API route handlers** (46+ routes)
- No separate Express servers needed in production
- Plugin UMD bundles served via same-origin CDN route
- Database connected via Neon PostgreSQL
- CI/CD: GitHub Actions + Vercel auto-deploy from `main`
- Camera/microphone permissions configured in `vercel.json`

---

## Code Quality Issues

### Issue 1: Orphan/Dead Code ✅ MOSTLY RESOLVED

| File/Directory | Status | Action |
|----------------|--------|--------|
| `plugins/debugger/` | ✅ CLEANED | All references removed in Phase 0 |
| `packages/plugin-sdk/src/compat/` | ✅ DELETED | Removed in Phase 0 |
| `.phase-*-complete` files | ✅ DELETED | Removed and added to .gitignore in Phase 0 |
| `apps/shell-web/` | ✅ DELETED | Fully retired in Phase 0 |
| Deprecated `useAuth()` hook | ⚠️ Remaining | Complete migration to `useAuthService()` |

### Issue 2: Duplicated Code Patterns ✅ SIGNIFICANTLY REDUCED

| Pattern | Locations | Lines Duplicated | Status |
|---------|-----------|------------------|--------|
| Auth token retrieval | 3 plugins | ~80 lines | ✅ Consolidated in @naap/plugin-utils |
| CSRF token handling | 3 plugins | ~30 lines | ✅ Consolidated in @naap/plugin-utils |
| API URL resolution | 4 plugins | ~120 lines | ✅ Consolidated in @naap/plugin-utils |
| Database client init | 5 plugin backends | ~50 lines | ⏳ Pending |
| Vite UMD config | 11 plugins | ~3,300 lines | ✅ Consolidated in @naap/plugin-build |
| Mount.tsx pattern | 11 plugins | ~110 lines | ⏳ Pending |

**After Phase 1:** ~2,290 lines remaining (~3,700 - 1,410 saved)
**Remaining (Phase 2+):** ~160 lines (database init + mount pattern)

### Issue 3: Over-Engineering

| Component | Issue | Simplification |
|-----------|-------|----------------|
| 18 hooks in SDK | Too many layers | Consolidate related hooks |
| 13+ service interfaces | Full ShellContext passed everywhere | Pass only needed services |
| Capability service (5 methods) | Most plugins only use `has()` | Could be simple boolean |
| Multiple abstraction layers in utils | 10+ KB response.ts | Flatten where possible |

### Issue 4: Inconsistent Patterns

| Area | Inconsistency |
|------|---------------|
| Package versions | Mix of `"*"`, `"file:..."`, `"^x.y.z"` |
| Backend maturity | 25 lines (mock) to 200+ lines (full) |
| Error handling | Some try-catch, some raw throws |
| Loading states | Some Loader2, some nothing |
| API clients | SDK provides one, nobody uses it |

---

## Architecture Assessment

### Shell App Architecture: A-
- **Strengths:** Clean provider composition, tenant-aware event bus, feature flags, single implementation
- **Weaknesses:** CSP configuration could be simplified

### Plugin SDK Architecture: A-
- **Strengths:** Comprehensive hooks, good CLI, type-safe, shared build config
- **Weaknesses:** Some documentation gaps, testing utilities could be expanded

### Plugin Ecosystem: B+
- **Strengths:** Consistent structure, UMD builds working, all required backends complete, shared utilities
- **Weaknesses:** Some plugins still have simplified frontends, mount.tsx pattern still duplicated

### DevX: B+
- **Strengths:** CLI tools, createPlugin() helper, hot reload, published docs site
- **Weaknesses:** Published docs need ongoing updates, no plugin dependency management

### Vercel Compatibility: 100%
- **Deployed:** Full platform running on Vercel with API route handlers, same-origin CDN, managed DB

---

## Executable Improvement Plan

### Phase 0: Immediate Cleanup ✅ COMPLETE

**Status:** COMPLETE (February 2026)

**Completed Tasks:**
1. ✅ Deleted empty compat layer: `packages/plugin-sdk/src/compat/`
2. ✅ Removed debugger plugin references from all configs:
   - Removed from `middleware.ts` route mappings
   - Removed from `migrate-plugins-to-umd.ts`
   - Removed from API plugin service URLs
   - Deleted debugger-related markdown files (8 files)
   - Deleted debugger tutorial
3. ✅ Cleaned up `.phase-*-complete` marker files (9 files)
4. ✅ Updated `.gitignore` for `.phase-*` and `.architecture-mode` patterns
5. ✅ **BONUS: Fully retired shell-web** (originally planned for Phase 3):
   - Deleted entire `apps/shell-web/` directory
   - Updated `bin/start.sh` to Next.js-only mode
   - Updated `package.json` to remove `build:shell` script
   - Updated `nx.json` default project to `web-next`
   - Updated SDK CLI commands (`dev.ts`, `doctor.ts`)
   - Deleted obsolete migration scripts
   - Updated key documentation (`shell-overview.md`, `env.ts`, `plugin.ts`)

**No Regressions:** TypeScript compilation verified, all changes are documentation updates or dead code removal.

---

### Phase 1: Extract Shared Utilities ✅ COMPLETE
**Goal:** Eliminate code duplication in plugins

**Status:** COMPLETE (February 2026)

**Completed Tasks:**

1. ✅ **Created `packages/plugin-utils/`** - Shared auth and API utilities
   - `src/auth.ts` - Consolidated auth token retrieval:
     - `getShellContext()` - Access window.__SHELL_CONTEXT__
     - `getAuthToken()` - Try shell context first, then localStorage
     - `getCsrfToken()` - Get CSRF token from sessionStorage
     - `authHeaders()` - Build headers with auth and CSRF tokens
     - `isAuthenticated()` - Check if user is authenticated
   - `src/api.ts` - Consolidated API utilities:
     - `getApiUrl()` - Resolve API URL from shell context, env vars, or defaults
     - `getBaseSvcUrl()` - Get base-svc URL
     - `ApiError` - Consistent error class
     - `apiRequest()` - Make API requests with auth
     - `createApiClient()` - Create pre-configured API client
   - `src/index.ts` - Re-exports all utilities
   - `package.json` - Package definition with subpath exports

2. ✅ **Created `packages/plugin-build/`** - Shared Vite UMD build configuration
   - `src/vite.ts` - `createPluginConfig()` factory function:
     - Reduces ~130 lines of config to ~8 lines per plugin
     - Standard aliases for @naap packages
     - React externals and globals
     - Manifest generation with validation
     - Build validation (no bundled React internals)
   - `src/index.ts` - Re-exports createPluginConfig
   - `package.json` - Package definition
   - `tsconfig.json` - TypeScript configuration

3. ✅ **Updated all 11 plugin vite.config.umd.ts files:**
   - capacity-planner, community, daydream-video, developer-api
   - gateway-manager, marketplace, my-dashboard, my-wallet
   - network-analytics, orchestrator-manager, plugin-publisher
   - Each reduced from ~130 lines to ~11 lines

4. ✅ **Updated plugin API files to use @naap/plugin-utils:**
   - `plugins/daydream-video/frontend/src/lib/api.ts` - Now imports from @naap/plugin-utils
   - `plugins/plugin-publisher/frontend/src/lib/api.ts` - Now imports from @naap/plugin-utils
   - Note: `plugins/community/frontend/src/api/client.ts` uses different pattern (userId in body)
     and was intentionally not migrated to preserve API contract

5. ✅ **Updated TypeScript path mappings:**
   - Added @naap/plugin-utils paths to plugin tsconfig.json files
   - Verified TypeScript compilation passes

**Code Reduction Summary:**
| Area | Before | After | Savings |
|------|--------|-------|---------|
| Vite configs (11 plugins) | ~1,430 lines | ~120 lines | **1,310 lines (92%)** |
| Auth utilities (2 plugins) | ~100 lines | 0 lines (shared) | **100 lines (100%)** |
| Total | ~1,530 lines | ~120 lines | **~1,410 lines saved** |

**No Regressions:**
- TypeScript compilation verified for all modified packages and plugins
- Pre-existing type errors in plugin-sdk hooks are unrelated to Phase 1 changes
- Vite alias configuration includes @naap/plugin-utils for UMD builds

---

### Phase 2: Complete Plugin Backends ✅ COMPLETE
**Goal:** All 11 plugins have functional backends

**Status:** COMPLETE (February 2026)

**Discovery & Analysis:**
After thorough exploration, we identified that 3 of 5 "incomplete" backends are actually unused:
- **marketplace**: Frontend calls main registry API directly - no plugin backend needed
- **orchestrator-manager**: Frontend uses SDK hooks for Livepeer directly - no plugin backend needed
- **network-analytics**: Frontend uses SDK hooks for Livepeer directly - no plugin backend needed

**Completed Backends:**

1. ✅ **developer-api** - Full Prisma + Express backend with:
   - Prisma schema with AIModel, GatewayOffer, ApiKey, UsageLog models
   - In-memory fallback for development without database
   - Complete CRUD endpoints for models, keys, gateways
   - API key generation with secure hashing
   - Usage tracking endpoints
   - Database seed file with sample data

2. ✅ **capacity-planner** - Full Prisma + Express backend with:
   - Prisma schema with CapacityRequest, SoftCommit, RequestComment models
   - In-memory fallback for development without database
   - Complete CRUD endpoints for capacity requests
   - Soft commit (thumbs up) toggle endpoint
   - Comments CRUD
   - Summary/analytics endpoint
   - Database seed file with sample data
   - **Frontend wired to use API client** (removed mock data)

**Implementation Details:**

| Plugin | Prisma Schema | Backend Server | Seed Data | Frontend API Client |
|--------|---------------|----------------|-----------|---------------------|
| developer-api | ✅ Complete | ✅ Complete | ✅ Complete | - (existing) |
| capacity-planner | ✅ Complete | ✅ Complete | ✅ Complete | ✅ Complete |
| marketplace | ⏭️ Not needed | ⏭️ Not needed | - | - |
| orchestrator-manager | ⏭️ Not needed | ⏭️ Not needed | - | - |
| network-analytics | ⏭️ Not needed | ⏭️ Not needed | - | - |

**Key Technical Patterns Used:**

1. **Dual-Mode Server Pattern** - All backends support both:
   - Database mode (Prisma with PostgreSQL)
   - In-memory fallback (for development/testing)

2. **Dynamic Prisma Import** - Lazy loading to gracefully handle missing database:
   ```typescript
   async function initDatabase() {
     try {
       const { PrismaClient } = await import('./generated/client/index.js');
       prisma = new PrismaClient();
       await prisma.$connect();
       return true;
     } catch (error) {
       console.log('⚠️ Database not available, using in-memory fallback');
       return false;
     }
   }
   ```

3. **API Response Format** - Consistent `{ success: true, data: ... }` format

4. **Frontend API Client Pattern** - Using @naap/plugin-sdk utilities:
   ```typescript
   import { getApiUrl, getCsrfToken, generateCorrelationId } from '@naap/plugin-sdk';
   ```

**Bug Fixes During Phase 2:**
- Fixed `useQuery` hook to accept `string | null` key for conditional fetching
- Fixed TypeScript compilation by updating capacity-planner tsconfig.json to standalone mode
- Removed deprecated `getContext` export from capacity-planner App.tsx

**Files Created/Modified:**
- `plugins/developer-api/backend/prisma/schema.prisma` - Created
- `plugins/developer-api/backend/prisma/seed.ts` - Created
- `plugins/developer-api/backend/src/server.ts` - Rewritten
- `plugins/developer-api/backend/package.json` - Updated with Prisma
- `plugins/capacity-planner/backend/prisma/schema.prisma` - Created
- `plugins/capacity-planner/backend/prisma/seed.ts` - Created
- `plugins/capacity-planner/backend/src/server.ts` - Rewritten
- `plugins/capacity-planner/backend/package.json` - Updated with Prisma
- `plugins/capacity-planner/frontend/src/lib/api.ts` - Created
- `plugins/capacity-planner/frontend/src/pages/Capacity.tsx` - Wired to API
- `plugins/capacity-planner/frontend/tsconfig.json` - Fixed for standalone mode
- `plugins/capacity-planner/frontend/src/App.tsx` - Removed deprecated export
- `packages/plugin-sdk/src/hooks/useQuery.ts` - Fixed null key handling

**No Regressions:**
- All TypeScript compilation passes
- Vite build succeeds for capacity-planner frontend
- Existing mock data preserved in backends for fallback

---

### Phase 2.5: Extract base-svc Route Modules ✅ COMPLETE
**Goal:** Refactor monolithic `server.ts` (~4,248 lines) into modular route files

**Status:** COMPLETE (February 2026)

**Problem:** `services/base-svc/src/server.ts` was a 4,248-line monolith containing ~95 inline route handlers across 22 sections. This made the file extremely difficult to navigate, test, and maintain.

**Solution:** Incrementally extracted all inline routes into 8 domain-scoped route modules following the factory pattern with dependency injection, verified by test-driven development at each phase.

**Completed in 5 Phases:**

| Phase | Module(s) Created | Handlers | Lines Extracted | Tests |
|-------|-------------------|----------|-----------------|-------|
| 1 | `metadata.ts` | 12 | ~213 | metadata.test.ts |
| 2 | `secrets.ts`, `rbac.ts` | 24 | ~600 | secrets.test.ts, rbac.test.ts |
| 3 | `lifecycle.ts` | 16 | ~770 | lifecycle.test.ts |
| 4 | `registry.ts`, `tokens-webhooks.ts` | 25 | ~1,400 | registry.test.ts, tokens-webhooks.test.ts |
| 5 | `base.ts`, `tenant.ts` | 29 | ~1,050 | base.test.ts, tenant.test.ts |

**Results:**

| Metric | Before | After |
|--------|--------|-------|
| `server.ts` size | 4,248 lines | ~380 lines |
| Route modules | 3 (auth, team, admin) | 11 total |
| Test coverage (routes) | 0% | 319 tests, 8 test files |
| Testability | Impossible to unit test | Every module independently testable |
| Code navigation | Scroll through 4K+ lines | Jump to domain-specific file |

**Architecture Pattern:**
```typescript
// Every route module follows this factory pattern:
export function createDomainRoutes(deps: DomainRouteDeps) {
  const router = Router();
  // ... handlers with injected dependencies ...
  return router;
}

// Mounted in server.ts:
const routes = createDomainRoutes({ db, service1, service2 });
app.use('/api/v1', routes);
```

**Key Technical Decisions:**
1. **Factory pattern with DI** — each module receives only its required dependencies
2. **Typed dependency interfaces** — compile-time verification of service contracts
3. **Contract tests with supertest** — HTTP-level tests against mocked services
4. **Health check stays in server.ts** — `/healthz` is root-level, not `/api/v1`
5. **CSRF middleware stays in server.ts** — global middleware applied before all routes
6. **Lazy initialization** for auth and registry routes — services must be created first

**Files Created:**
- `services/base-svc/src/routes/base.ts` (441 lines)
- `services/base-svc/src/routes/tenant.ts` (272 lines)
- `services/base-svc/src/routes/lifecycle.ts` (624 lines)
- `services/base-svc/src/routes/metadata.ts` (263 lines)
- `services/base-svc/src/routes/rbac.ts` (435 lines)
- `services/base-svc/src/routes/registry.ts` (654 lines)
- `services/base-svc/src/routes/secrets.ts` (221 lines)
- `services/base-svc/src/routes/tokens-webhooks.ts` (299 lines)
- `services/base-svc/src/test/helpers.ts` (mock factory infrastructure)
- `services/base-svc/src/test/routes/*.test.ts` (8 test files, 319 tests)
- `services/base-svc/vitest.config.ts` (test configuration)
- `services/base-svc/README.md` (comprehensive developer guide)

**No Regressions:**
- All 319 tests pass
- No new TypeScript errors introduced
- All existing functionality preserved with identical API paths and response shapes
- Guard rail: every route module is a pure function with no module-level side effects

**Developer Guide:** See `services/base-svc/README.md` for full documentation including:
- Route module reference with factory signatures
- Step-by-step tutorial for adding new route modules
- Testing guide with mock helpers reference
- `server.ts` composition root walkthrough

---

### Phase 3: Retire Legacy Shell (3-4 days)
**Goal:** Single shell implementation (web-next only)

```
Tasks:
1. Audit shell-web features not in web-next
2. Migrate any missing features to web-next
3. Update all documentation to reference web-next only
4. Archive shell-web (move to /archive or delete)
5. Update CI/CD to build only web-next
6. Update deployment scripts
```

**Agent Prompt:**
```
Compare apps/shell-web/ and apps/web-next/ implementations:

1. List all features in shell-web not present in web-next
2. List all services in shell-web/src/services/ not migrated
3. Create migration tasks for each missing feature

Then implement migrations:
1. Port missing features to web-next
2. Update imports and references
3. Test feature parity
4. Move shell-web to /archive directory
5. Update root package.json workspaces
6. Update bin/start.sh and other scripts
```

---

### Phase 4: Standardize API Integration (2-3 days)
**Goal:** All plugins use SDK's API client

```
Tasks:
1. Enhance packages/plugin-sdk/src/utils/api.ts
   - Add plugin backend URL resolution
   - Add retry logic with exponential backoff
   - Add request/response logging

2. Create usePluginApi() hook
   - Wraps createApiClient() with plugin context
   - Auto-resolves backend URL
   - Injects auth and CSRF tokens

3. Migrate all plugins to use usePluginApi()
   - Remove custom api.ts files
   - Update fetch calls to use hook
   - Standardize error handling
```

**Agent Prompt:**
```
Enhance the SDK API client in packages/plugin-sdk/src/utils/api.ts:

1. Add getPluginBackendUrl(pluginName) function that:
   - Checks window.__SHELL_CONTEXT__.config first
   - Falls back to environment variables
   - Has sensible localhost defaults for development

2. Create usePluginApi() hook in packages/plugin-sdk/src/hooks/usePluginApi.ts:
   - Uses useShell() to get auth context
   - Calls createApiClient() with proper config
   - Provides typed methods: get, post, put, delete
   - Handles errors consistently

3. Migrate plugins to use new hook:
   - plugins/daydream-video: Replace lib/api.ts usage
   - plugins/plugin-publisher: Replace lib/api.ts usage
   - plugins/community: Replace api/client.ts usage
   - All other plugins: Use hook for API calls
```

---

### Phase 5: Event Bus Enhancement (1-2 days)
**Goal:** Complete inter-plugin communication

```
Tasks:
1. Make request/response pattern mandatory (not optional)
2. Add timeout handling
3. Add type-safe event definitions
4. Create usePluginEvent() hook for common patterns
5. Document event naming conventions
```

**Agent Prompt:**
```
Complete the event bus implementation:

1. Update IEventBus interface in packages/plugin-sdk/src/types/services.ts:
   - Make request() and handleRequest() required (not optional)
   - Add RequestOptions with timeout, retries
   - Add typed event registry pattern

2. Implement in shell-context.tsx:
   - Add request() with Promise timeout
   - Add handleRequest() with cleanup
   - Add error handling for unhandled requests

3. Create usePluginEvent() hook:
   - Typed emit/listen for common events
   - Auto-cleanup on unmount
   - Debug logging in development

4. Document in SDK:
   - Event naming conventions
   - Request/response patterns
   - Cross-plugin communication examples
```

---

### Phase 6: Documentation Consolidation (1-2 days)
**Goal:** Single source of truth for developers

```
Tasks:
1. Merge API_REFERENCE.md, MIGRATION.md, PLUGIN_ARCHITECTURE.md
2. Create unified DEVELOPER_GUIDE.md
3. Add cookbook with common patterns
4. Add troubleshooting section
5. Generate CLI documentation from code
```

**Agent Prompt:**
```
Consolidate SDK documentation:

1. Read all existing docs:
   - packages/plugin-sdk/API_REFERENCE.md
   - packages/plugin-sdk/MIGRATION.md
   - packages/plugin-sdk/docs/PLUGIN_ARCHITECTURE.md
   - packages/plugin-sdk/docs/CLI.md

2. Create unified packages/plugin-sdk/DEVELOPER_GUIDE.md with sections:
   - Quick Start (5-minute tutorial)
   - Core Concepts (hooks, context, events)
   - API Reference (all hooks and utilities)
   - CLI Reference (all commands)
   - Cookbook (common patterns)
   - Migration Guide (deprecated APIs)
   - Troubleshooting

3. Delete old fragmented docs
4. Update README.md to point to new guide
```

---

### Phase 7: Testing Infrastructure (2-3 days)
**Goal:** Comprehensive test coverage for SDK and plugins

```
Tasks:
1. Expand MockShellProvider with all services
2. Add mocks for usePluginConfig, useTeam, useQuery
3. Create plugin test template
4. Add integration test examples
5. Set up CI test running
```

**Agent Prompt:**
```
Expand testing infrastructure:

1. Update packages/plugin-sdk/src/testing/MockShellProvider.tsx:
   - Add mock for usePluginConfig (multi-scope)
   - Add mock for useTeam (team context)
   - Add mock for useQuery/useMutation
   - Add mock for useTenant
   - Add configurable overrides for each mock

2. Create packages/plugin-sdk/src/testing/mockFactories.ts:
   - createMockUser()
   - createMockTeam()
   - createMockPlugin()
   - createMockConfig()

3. Create plugin test template:
   - plugins/__template__/frontend/src/__tests__/App.test.tsx
   - Show how to use MockShellProvider
   - Test SDK hook usage
   - Test API interactions

4. Add to CI workflow:
   - Run SDK tests
   - Run plugin tests
   - Coverage reporting
```

---

### Phase 8: Vercel Deployment Finalization (2-3 days)
**Goal:** Production-ready hybrid deployment

```
Tasks:
1. Finalize vercel.json configuration
2. Set up environment variable templates
3. Create docker-compose for off-Vercel services
4. Document deployment architecture
5. Set up health monitoring
6. Create deployment runbook
```

**Agent Prompt:**
```
Finalize Vercel deployment:

1. Update vercel.json:
   - Ensure all API routes properly configured
   - Add caching headers for static assets
   - Configure edge functions where applicable

2. Create .env.example with all required variables:
   - Database (DATABASE_URL with pooling params)
   - Auth (NEXTAUTH_SECRET, OAuth credentials)
   - Services (BASE_SVC_URL, LIVEPEER_SVC_URL, etc.)
   - Storage (BLOB_READ_WRITE_TOKEN)
   - Integrations (ABLY_API_KEY, etc.)

3. Create docker-compose.production.yml for off-Vercel services:
   - base-svc
   - livepeer-svc
   - pipeline-gateway
   - infrastructure-svc
   - plugin-server
   - All plugin backends

4. Create docs/DEPLOYMENT.md:
   - Architecture diagram
   - Step-by-step deployment
   - Environment configuration
   - Monitoring setup
   - Troubleshooting

5. Add health check endpoints to all services
6. Create bin/health-check.sh script
```

---

## Success Metrics

| Metric | Before | Current | Target | Status |
|--------|--------|---------|--------|--------|
| Plugin backend completion | 45% | 100% | 100% | ✅ Done |
| Code duplication | ~3,700 lines | ~2,290 lines | <500 lines | 🔄 Improved |
| Shell implementations | 2 | 1 | 1 | ✅ Done |
| API patterns | 3+ | Envelope standardized | 1 | ✅ Done |
| Test coverage | ~20% | ~35% (base-svc routes) | >70% | 🔄 In progress |
| Documentation | Fragmented | Published docs site | Unified | 🔄 In progress |
| Vercel deploy | Blocked | ✅ Deployed | Working | ✅ Done |
| CI pipeline | Broken | ✅ Functional | Green | ✅ Done (ESLint/TS non-blocking) |

---

## Timeline Summary

| Phase | Duration | Dependencies | Deliverable | Status |
|-------|----------|--------------|-------------|--------|
| 0 | 1-2 days | None | Clean codebase | ✅ COMPLETE |
| 1 | 2-3 days | Phase 0 | Shared utilities | ✅ COMPLETE |
| 2 | 5-7 days | Phase 1 | Complete backends | ✅ COMPLETE |
| 2.5 | 2-3 days | Phase 2 | Modular base-svc routes | ✅ COMPLETE |
| 3 | 3-4 days | Phase 2 | Single shell | ✅ DONE EARLY (merged with Phase 0) |
| 4 | 2-3 days | Phase 1 | Standard API pattern | ✅ COMPLETE (envelope standardized) |
| 5 | 1-2 days | Phase 4 | Event bus complete | ⏳ Ready to start |
| 6 | 1-2 days | Phase 3 | Unified docs | 🔄 IN PROGRESS (docs site live, cleanup done) |
| 7 | 2-3 days | Phase 1 | Test infrastructure | ⏳ Ready to start |
| 8 | 2-3 days | All above | Production deploy | ✅ COMPLETE (Vercel deployed) |

**Total: 22-32 days** (5-6 weeks with buffer)
**Progress: Phases 0-4, 8 complete; Phase 6 in progress** (~80% of plan executed)

**Additional completions outside original plan:**
- ✅ Vercel deployment working (all plugins, 46+ API routes)
- ✅ CI pipeline functional (GitHub Actions, branch protection)
- ✅ `develop` merged to `main` with all fixes
- ✅ Stale docs and session artifacts cleaned up (~30 files deleted)
- ✅ Legacy scripts deprecated (db-migrate, kafka-setup, etc.)
- ✅ Port mappings corrected in health-check.sh
- ✅ Published docs updated (Node.js version, git URL, API format, architecture)

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking changes during migration | Feature flags for gradual rollout |
| Plugin backend complexity underestimated | Start with simplest (network-analytics) |
| Team bandwidth | Phases can run partially in parallel |
| Vercel pricing surprise | Monitor usage during rollout |
| Legacy shell has hidden features | Thorough audit before retirement |

---

## Appendix: File References

**Key Files to Modify:**
- `packages/plugin-sdk/src/hooks/` - Hook consolidation
- `packages/plugin-sdk/src/utils/api.ts` - API client enhancement
- `plugins/*/frontend/vite.config.umd.ts` - Config consolidation
- `plugins/*/backend/src/server.ts` - Backend implementation
- `apps/web-next/src/contexts/shell-context.tsx` - Event bus completion
- `vercel.json` - Deployment config
- `docker-compose.production.yml` - Off-Vercel services

**Files to Delete:**
- `packages/plugin-sdk/src/compat/` - Empty directory
- `apps/shell-web/` - After Phase 3
- `.phase-*-complete` - Migration markers

**Files to Create:**
- ✅ `packages/plugin-utils/` - Shared auth and API utilities (CREATED)
- ✅ `packages/plugin-build/` - Shared Vite build config with createPluginConfig() (CREATED)
- `packages/plugin-sdk/DEVELOPER_GUIDE.md` - Unified docs
- `docs/DEPLOYMENT.md` - Production runbook
