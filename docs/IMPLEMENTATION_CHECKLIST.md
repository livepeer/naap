# NaaP Production Readiness - Implementation Checklist
**Version:** 1.0  
**Last Updated:** January 28, 2026

This checklist provides a step-by-step guide for implementing the production readiness plan.

---

## Pre-Work Setup

### Team Setup
- [ ] Allocate 2 senior full-stack developers for 10 weeks
- [ ] Set up daily standups (15 min) for remediation team
- [ ] Create Slack channel: `#naap-production-ready`
- [ ] Schedule weekly stakeholder sync (30 min)

### Technical Setup
- [ ] Create feature branch: `feature/production-ready-2026`
- [ ] Set up CI/CD pipeline with security scanning
- [ ] Configure staging environment
- [ ] Set up error tracking (Sentry/Rollbar)
- [ ] Install security scanning tools (Snyk/OWASP)

### Documentation
- [ ] Create `CHANGELOG.md` for tracking changes
- [ ] Create `MIGRATION_GUIDE.md` for plugin developers
- [ ] Set up internal wiki page

---

## Phase 1: Security Hardening (Week 1-2)

### Week 1: Authentication & Validation

#### Monday-Tuesday: Add Authentication Middleware

**gateway-manager-svc:**
- [ ] Copy auth middleware from `base-svc/src/middleware/auth.ts`
- [ ] Add to all routes in `gateway-manager-svc/src/server.ts`
- [ ] Test: Verify 401 without token
- [ ] Test: Verify 200 with valid token

**developer-svc:**
- [ ] Add auth middleware
- [ ] Protect all API key endpoints
- [ ] Test authentication

**infrastructure-svc:**
- [ ] Add auth middleware
- [ ] Protect container/database endpoints
- [ ] Test authentication

**storage-svc:**
- [ ] Add auth to delete endpoints
- [ ] Verify upload endpoints protected
- [ ] Test authentication

**Verification:**
```bash
# Test without token (should get 401)
curl -X POST http://localhost:4010/api/v1/gateway-manager/gateways

# Test with token (should work)
curl -X POST http://localhost:4010/api/v1/gateway-manager/gateways \
  -H "Authorization: Bearer $TOKEN"
```

#### Wednesday-Friday: Input Validation

- [ ] Install Zod: `npm install zod`
- [ ] Create `services/base-svc/src/validators/` directory
- [ ] Create validation schemas:
  - [ ] `validators/auth.ts` - login, register, password reset
  - [ ] `validators/team.ts` - create team, update team, invite member
  - [ ] `validators/plugin.ts` - install, uninstall, configure
  - [ ] `validators/user.ts` - update profile, change password
- [ ] Create validation middleware: `middleware/validation.ts`
- [ ] Apply to all endpoints in `base-svc`
- [ ] Apply to all endpoints in `gateway-manager-svc`
- [ ] Apply to all endpoints in `developer-svc`
- [ ] Apply to all endpoints in `infrastructure-svc`

**Example:**
```typescript
// validators/team.ts
import { z } from 'zod';

export const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(1).max(50),
});

// routes/team.ts
import { validate } from '../middleware/validation';
import { createTeamSchema } from '../validators/team';

router.post('/teams', validate(createTeamSchema), async (req, res) => {
  // req.body is now validated and typed
});
```

**Testing:**
```bash
# Test with invalid data (should get 400)
curl -X POST http://localhost:4000/api/v1/base/teams \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": ""}'  # Invalid: empty name

# Test with valid data (should get 201)
curl -X POST http://localhost:4000/api/v1/base/teams \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Team", "slug": "test-team"}'
```

---

### Week 2: Auth Unification & Rate Limiting

#### Monday-Wednesday: Unify Auth State

**Goal:** Single source of truth for authentication

**Steps:**
1. **Remove AuthService from ShellContext**
   - [ ] File: `apps/shell-web/src/context/ShellContext.tsx`
   - [ ] Remove line 80: `const authService = useMemo(() => new AuthService(), []);`
   - [ ] Update `ShellContext` type to remove `auth: IAuthService`
   - [ ] Search codebase for `shell.auth` usage, replace with `useAuth()` from `AuthContext`

2. **Make AuthContext the Single Source**
   - [ ] File: `apps/shell-web/src/context/AuthContext.tsx`
   - [ ] Export `getAuthToken()` function
   - [ ] Export `getAuthUser()` function
   - [ ] Add session expiry tracking
   - [ ] Add session refresh logic

3. **Update Plugin SDK**
   - [ ] File: `packages/plugin-sdk/src/hooks/useShell.ts`
   - [ ] Rename `useAuth()` in ShellContext to `useAuthService()`
   - [ ] Document that plugins should use `useAuth()` from SDK
   - [ ] Update all plugin examples

4. **Testing**
   - [ ] Unit tests for `AuthContext`
   - [ ] Integration test: Login, verify token, verify user
   - [ ] Integration test: Logout, verify token cleared
   - [ ] Integration test: Token refresh

**Files to Update:**
```
apps/shell-web/src/context/ShellContext.tsx
apps/shell-web/src/context/AuthContext.tsx
packages/plugin-sdk/src/hooks/useShell.ts
packages/plugin-sdk/src/hooks/index.ts
```

#### Wednesday-Thursday: Fix Team State Sync

**Goal:** TeamContextManager as single source of truth

**Steps:**
1. **Simplify ShellContext**
   - [ ] File: `apps/shell-web/src/context/ShellContext.tsx`
   - [ ] Remove duplicate team state (lines 114-155)
   - [ ] Use `teamContext` directly from `TeamContextManager`
   - [ ] Remove `setCurrentTeam` - use `teamContext.setTeam()` instead

2. **Fix PluginContext**
   - [ ] File: `apps/shell-web/src/context/PluginContext.tsx`
   - [ ] Remove circular sync logic (lines 470-490)
   - [ ] Subscribe to team change events only
   - [ ] Remove `loadingTeamIdRef` hack (use proper state machine)

3. **Testing**
   - [ ] Unit test: Team change propagates correctly
   - [ ] Integration test: Switch team, verify plugins reload
   - [ ] Integration test: Multiple rapid team switches

#### Thursday-Friday: Rate Limiting & In-Memory Storage

**Rate Limiting:**
- [ ] Install Redis rate limiter: `npm install rate-limiter-flexible ioredis`
- [ ] Create `middleware/rate-limit.ts`
- [ ] Add rate limiting to:
  - [ ] Auth endpoints (10 requests per 15 min)
  - [ ] File upload (5 uploads per minute)
  - [ ] API endpoints (100 requests per minute)
  - [ ] Public endpoints (50 requests per minute)

**Replace In-Memory Storage:**
- [ ] Add API keys table to Prisma schema
- [ ] Migrate `developer-svc` to use database
- [ ] Test API key CRUD operations
- [ ] Test service restart (keys should persist)

**Testing:**
```bash
# Test rate limiting
for i in {1..150}; do
  curl http://localhost:4000/api/v1/base/user/profile \
    -H "Authorization: Bearer $TOKEN"
done
# Should get 429 after 100 requests
```

---

### Phase 1 Verification Checklist

Before moving to Phase 2:

- [ ] **All services have authentication**
  - [ ] gateway-manager-svc returns 401 without auth
  - [ ] developer-svc returns 401 without auth
  - [ ] infrastructure-svc returns 401 without auth
  - [ ] storage-svc returns 401 without auth

- [ ] **All endpoints have input validation**
  - [ ] Test with invalid data returns 400 with details
  - [ ] Test with valid data returns success
  - [ ] TypeScript types match validation schemas

- [ ] **Single auth source of truth**
  - [ ] No `AuthService` in ShellContext
  - [ ] All code uses `AuthContext`
  - [ ] Tests pass

- [ ] **Team state unified**
  - [ ] No duplicate team state
  - [ ] Team switching works correctly
  - [ ] No race conditions

- [ ] **Rate limiting active**
  - [ ] Test exceeding limits returns 429
  - [ ] Redis connected and working

- [ ] **No in-memory storage**
  - [ ] API keys persist across restarts
  - [ ] Database tests pass

- [ ] **Security scan passes**
  - [ ] Run: `npm run security:scan`
  - [ ] 0 critical vulnerabilities
  - [ ] 0 high vulnerabilities

---

## Phase 2: Architecture Refactor (Week 3-4)

### Week 3: Split PluginContext & Fix Race Conditions

#### Monday-Tuesday: Extract Services from PluginContext

**Goal:** PluginContext < 300 lines

**Create New Services:**

1. **PluginApiService**
   ```typescript
   // File: apps/shell-web/src/services/PluginApiService.ts
   export class PluginApiService {
     async fetchPersonalPlugins(): Promise<Plugin[]>
     async fetchTeamPlugins(teamId: string): Promise<Plugin[]>
     async fetchWithRetry(url: string, options: RequestInit): Promise<Response>
   }
   ```

2. **PluginValidationService**
   ```typescript
   // File: apps/shell-web/src/services/PluginValidationService.ts
   export class PluginValidationService {
     validatePluginsResponse(data: unknown): Plugin[]
     validateDevPluginUrl(url: string): boolean
     validateTeamAccess(userId: string, plugin: Plugin): boolean
   }
   ```

3. **DependencyResolver**
   ```typescript
   // File: apps/shell-web/src/services/DependencyResolver.ts
   export class DependencyResolver {
     resolveDependencies(plugins: Plugin[]): Plugin[]
     detectCircularDeps(plugins: Plugin[]): string[]
     validateVersions(plugins: Plugin[]): ValidationResult
   }
   ```

**Refactor PluginContext:**
- [ ] Move fetching logic to `PluginApiService`
- [ ] Move validation logic to `PluginValidationService`
- [ ] Move dependency resolution to `DependencyResolver`
- [ ] Keep only orchestration logic in `PluginContext`

**Testing:**
- [ ] Unit tests for each service (>80% coverage)
- [ ] Integration test: Plugin loading end-to-end
- [ ] PluginContext < 300 lines

#### Wednesday-Thursday: Fix Race Conditions

**Remove Band-Aids:**
- [ ] Remove `abortControllerRef` (use proper state machine)
- [ ] Remove `isRefreshingRef` (use state)
- [ ] Remove `loadingTeamIdRef` (use state)
- [ ] Remove `refreshPluginsRef` wrapper (fix root cause)

**Implement State Machine:**
```typescript
type PluginLoadState = 
  | { status: 'idle' }
  | { status: 'loading'; request: Promise<Plugin[]> }
  | { status: 'loaded'; plugins: Plugin[] }
  | { status: 'error'; error: string };
```

**Testing:**
- [ ] Test concurrent `refreshPlugins()` calls
- [ ] Test team switching during load
- [ ] Test abort during load
- [ ] No race conditions in stress test

#### Friday: Standardize Error Handling

**Create Error System:**
```typescript
// File: apps/shell-web/src/utils/errors.ts
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export class AuthError extends AppError {}
export class NetworkError extends AppError {}
export class ValidationError extends AppError {}
```

**Apply to All Contexts:**
- [ ] AuthContext throws typed errors
- [ ] PluginContext throws typed errors
- [ ] ShellContext throws typed errors
- [ ] Error boundaries catch and display

---

### Week 4: Resolve Conflicts & Clean Up

#### Monday-Tuesday: Resolve useAuth Conflict

**Steps:**
1. **Rename in ShellContext**
   - [ ] `ShellContext.useAuth()` → `ShellContext.useAuthService()`
   - [ ] Update all references

2. **Keep AuthContext.useAuth() as Primary**
   - [ ] Document as recommended hook
   - [ ] Add migration guide

3. **Update SDK**
   - [ ] Export only `useAuth()` from SDK
   - [ ] Update examples

#### Wednesday: Clean Up V1/V2 Compatibility

**Remove Deprecated:**
- [ ] Remove `useShellV2` export
- [ ] Remove `ShellProviderV2` export  
- [ ] Remove `ShellContextV3` export
- [ ] Remove `AuthProvider` no-op in SDK
- [ ] Update all imports

**Documentation:**
- [ ] Create `MIGRATION.md`
- [ ] Document breaking changes
- [ ] Provide examples

#### Thursday-Friday: Testing & Cleanup

- [ ] Run full test suite
- [ ] Fix any regressions
- [ ] Code review
- [ ] Update documentation

---

### Phase 2 Verification Checklist

- [ ] **PluginContext simplified**
  - [ ] < 300 lines
  - [ ] Only orchestration logic
  - [ ] Services extracted with tests

- [ ] **No race conditions**
  - [ ] Stress test passes
  - [ ] Concurrent operations safe
  - [ ] No mitigation hacks needed

- [ ] **Consistent error handling**
  - [ ] All contexts use AppError
  - [ ] Error boundaries work
  - [ ] Clear error messages

- [ ] **No naming conflicts**
  - [ ] Only one `useAuth` hook
  - [ ] Clear documentation

- [ ] **No deprecated code**
  - [ ] V1/V2 references removed
  - [ ] Migration guide complete

---

## Phase 3: Backend Standardization (Week 5-6)

### Week 5: API Response Standardization

#### Monday-Tuesday: Define Standard Format

**Standard Response:**
```typescript
// File: services/base-svc/src/types/api.ts
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    requestId: string;
    timestamp: string;
  };
}
```

**Create Helpers:**
```typescript
// File: services/base-svc/src/utils/response.ts
export function success<T>(data: T, meta?: object): ApiResponse<T> {
  return {
    success: true,
    data,
    meta: {
      requestId: req.id,
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}

export function error(code: string, message: string, details?: unknown): ApiResponse {
  return {
    success: false,
    error: { code, message, details },
    meta: {
      requestId: req.id,
      timestamp: new Date().toISOString(),
    },
  };
}
```

#### Wednesday-Friday: Update All Endpoints

**Services to Update:**
- [ ] base-svc (all routes)
- [ ] gateway-manager-svc
- [ ] developer-svc
- [ ] infrastructure-svc
- [ ] storage-svc
- [ ] All workflow services

**Example:**
```typescript
// Before
res.json({ id: user.id, name: user.name });

// After
res.json(success({ id: user.id, name: user.name }));
```

**Testing:**
- [ ] All responses match format
- [ ] Error responses include requestId
- [ ] Frontend can parse responses

---

### Week 6: CSRF, Errors, Types

#### Monday: Add CSRF Protection

- [ ] Install `csurf` middleware
- [ ] Add to gateway-manager-svc
- [ ] Add to developer-svc
- [ ] Add to infrastructure-svc
- [ ] Test with frontend

#### Tuesday-Wednesday: Improve Error Handling

**Add Request Correlation IDs:**
```typescript
// middleware/request-id.ts
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
});
```

**Structured Logging:**
```typescript
console.log(JSON.stringify({
  level: 'error',
  requestId: req.id,
  userId: req.user?.id,
  message: error.message,
  stack: error.stack,
  timestamp: new Date().toISOString(),
}));
```

#### Thursday-Friday: Fix Type Safety

**Remove `as any`:**
- [ ] Add proper request types
- [ ] Type middleware correctly
- [ ] Add response types
- [ ] Enable TypeScript strict mode

**Example:**
```typescript
// Before
function getUserId(req: Request): string | undefined {
  return (req as any).user?.id;  // ❌
}

// After
interface AuthRequest extends Request {
  user?: { id: string; email: string };
}

function getUserId(req: AuthRequest): string | undefined {
  return req.user?.id;  // ✅
}
```

---

### Phase 3 Verification Checklist

- [ ] **Standard API format**
  - [ ] 100% of endpoints use format
  - [ ] Error responses include details
  - [ ] Frontend integration works

- [ ] **CSRF protection**
  - [ ] All services protected
  - [ ] Test passes

- [ ] **Error handling**
  - [ ] Request IDs in all logs
  - [ ] Structured logging
  - [ ] Meaningful error messages

- [ ] **Type safety**
  - [ ] No `as any` casts
  - [ ] TypeScript strict mode enabled
  - [ ] Compilation with no errors

---

## Phase 4: SDK Enhancement (Week 7-8)

### Week 7: Type Fixes & API Client

#### Monday: Resolve Type Conflicts

**Steps:**
1. **Consolidate Types**
   - [ ] Choose `types/services.ts` as source of truth
   - [ ] Remove duplicates from `types/integrations.ts`
   - [ ] Update `types/index.ts` exports

2. **Test Compilation**
   - [ ] SDK compiles with no errors
   - [ ] Example plugin compiles
   - [ ] No duplicate type errors

#### Tuesday-Wednesday: Add useApiClient Hook

**Create Hook:**
```typescript
// File: packages/plugin-sdk/src/hooks/useApiClient.ts
export function useApiClient(pluginName?: string) {
  const shell = useShell();
  
  const client = useMemo(() => ({
    async get<T>(path: string): Promise<T> {
      const url = pluginName 
        ? `${getBackendUrl(pluginName)}${path}`
        : `${shell.config.apiBaseUrl}${path}`;
      
      const response = await shell.api.fetch(url);
      if (!response.ok) throw new Error('Request failed');
      return response.json();
    },
    
    async post<T>(path: string, data: unknown): Promise<T> {
      // ...
    },
    
    // ... put, delete, patch
  }), [shell, pluginName]);
  
  return client;
}
```

**Usage:**
```typescript
// In plugin
const api = useApiClient('my-wallet');
const balance = await api.get<{ balance: number }>('/balance');
```

#### Thursday-Friday: Add Missing Utilities

**Create Utilities:**
```typescript
// utils/config.ts
export function getBackendUrl(pluginName: string): string {
  const shell = getShellContext();
  return shell.config.plugins[pluginName]?.backendUrl 
    || `http://localhost:${getDefaultPort(pluginName)}`;
}

// utils/auth.ts
export async function createAuthHeaders(): Promise<Record<string, string>> {
  const shell = getShellContext();
  const token = await shell.auth.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
  };
}
```

---

### Week 8: Config, Docs, Plugin Refactor

#### Monday-Tuesday: Unify Config Hooks

**Single Hook:**
```typescript
export function usePluginConfig<T = Record<string, unknown>>() {
  const shell = useShell();
  const teamContext = useTeamContext();
  
  // Merge tenant, team, and user config
  // Team config overrides tenant config
  // Returns merged config
}
```

#### Wednesday: Documentation

- [ ] Add JSDoc to all SDK exports
- [ ] Create plugin development guide
- [ ] Add API reference
- [ ] Create example plugins
- [ ] Document common patterns
- [ ] Document anti-patterns to avoid

#### Thursday-Friday: Refactor Existing Plugins

**Update Plugins:**
- [ ] my-wallet: Use `useApiClient()`
- [ ] my-wallet: Remove duplicated helpers
- [ ] my-dashboard: Use SDK utilities
- [ ] marketplace: Remove localStorage access
- [ ] Test all plugins work

---

### Phase 4 Verification Checklist

- [ ] **No type conflicts**
  - [ ] SDK compiles clean
  - [ ] Plugins compile clean

- [ ] **useApiClient available**
  - [ ] Works with and without plugin name
  - [ ] Auto-configures URLs
  - [ ] Handles auth automatically

- [ ] **Utilities available**
  - [ ] `getBackendUrl()` works
  - [ ] `createAuthHeaders()` works

- [ ] **Config unified**
  - [ ] Single `usePluginConfig()` hook
  - [ ] Merges configs correctly

- [ ] **Documentation complete**
  - [ ] All APIs documented
  - [ ] Examples provided
  - [ ] Guide published

- [ ] **Plugins refactored**
  - [ ] No duplicated code
  - [ ] Use SDK helpers
  - [ ] All tests pass

---

## Phase 5: Production Hardening (Week 9-10)

### Week 9: Auth, Pooling, Caching

#### Monday-Tuesday: Service-to-Service Auth

- [ ] Generate service JWT tokens
- [ ] Add service accounts
- [ ] Update all inter-service calls
- [ ] Test authentication

#### Wednesday: Database Pooling

**Configure Prisma:**
```typescript
// prisma/client.ts
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  log: ['error', 'warn'],
  pool: {
    max: 20,
    min: 5,
    acquireTimeoutMs: 30000,
  },
});
```

#### Thursday-Friday: Caching Strategy

**Identify Cacheable:**
- [ ] User profile lookups
- [ ] Team lookups
- [ ] Plugin manifests
- [ ] Config values

**Implement Cache:**
```typescript
// cache/redis.ts
const redis = new Redis(process.env.REDIS_URL);

export async function cached<T>(
  key: string,
  ttl: number,
  fn: () => Promise<T>
): Promise<T> {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);
  
  const value = await fn();
  await redis.setex(key, ttl, JSON.stringify(value));
  return value;
}
```

---

### Week 10: Circuit Breakers, Health, Monitoring

#### Monday-Tuesday: Circuit Breakers

**Install:**
```bash
npm install cockatiel
```

**Add to Services:**
```typescript
import { circuitBreaker, handleAll, ConsecutiveBreaker } from 'cockatiel';

const breaker = circuitBreaker(handleAll, {
  halfOpenAfter: 10_000,
  breaker: new ConsecutiveBreaker(5),
});

const result = await breaker.execute(() =>
  fetch('http://other-service/api')
);
```

#### Wednesday: Health Checks

**Standardize:**
```typescript
// All services
app.get('/healthz', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'base-svc',
    version: process.env.VERSION,
    checks: {
      database: await checkDatabase(),
      redis: await checkRedis(),
    },
  };
  
  const isHealthy = Object.values(health.checks).every(c => c === 'ok');
  res.status(isHealthy ? 200 : 503).json(health);
});
```

#### Thursday-Friday: APM Integration

**Install Datadog/New Relic:**
```bash
npm install dd-trace  # or newrelic
```

**Configure:**
```typescript
// server.ts
import tracer from 'dd-trace';
tracer.init({
  service: 'base-svc',
  env: process.env.NODE_ENV,
});
```

**Add Custom Metrics:**
```typescript
tracer.increment('plugin.load', 1, { plugin: pluginName });
tracer.histogram('plugin.load.time', loadTime);
```

---

### Phase 5 Verification Checklist

- [ ] **Service auth**
  - [ ] All inter-service calls authenticated
  - [ ] Test passes

- [ ] **Database pooling**
  - [ ] Connection pool configured
  - [ ] Connections reused
  - [ ] No connection leaks

- [ ] **Caching active**
  - [ ] Key queries cached
  - [ ] Cache invalidation works
  - [ ] Hit rate >70%

- [ ] **Circuit breakers**
  - [ ] Protect external calls
  - [ ] Test failure scenarios

- [ ] **Health checks**
  - [ ] All services have /healthz
  - [ ] Aggregated health endpoint

- [ ] **APM active**
  - [ ] Traces visible
  - [ ] Metrics collected
  - [ ] Dashboards configured

- [ ] **Load test passes**
  - [ ] 10K concurrent users
  - [ ] Response time p95 < 200ms
  - [ ] No errors
  - [ ] Stable for 1 hour

---

## Final Production Readiness Checklist

Before deploying to production:

### Security
- [ ] All endpoints require authentication
- [ ] Input validation on 100% of endpoints
- [ ] Rate limiting active
- [ ] CSRF protection on all services
- [ ] Secrets encrypted at rest
- [ ] External security audit passed

### Architecture
- [ ] Single auth source of truth
- [ ] Single team source of truth
- [ ] No God objects
- [ ] Test coverage >80% on critical paths

### Backend
- [ ] Consistent API response format
- [ ] No `as any` casts
- [ ] Request correlation IDs
- [ ] Structured logging
- [ ] Error tracking active

### SDK/DX
- [ ] No type conflicts
- [ ] `useApiClient()` available
- [ ] Documentation complete
- [ ] Developer satisfaction >8/10

### Production
- [ ] Service-to-service auth
- [ ] Database pooling configured
- [ ] Caching strategy implemented
- [ ] Circuit breakers active
- [ ] Health checks standardized
- [ ] APM monitoring active
- [ ] Load test passed
- [ ] Disaster recovery tested

### Documentation
- [ ] CHANGELOG.md updated
- [ ] MIGRATION_GUIDE.md complete
- [ ] API documentation published
- [ ] Plugin developer guide complete

### Deployment
- [ ] Staging environment stable for 2 weeks
- [ ] All stakeholders signed off
- [ ] Rollback plan documented
- [ ] On-call schedule set

---

## Emergency Contacts

- **Engineering Lead:** [Name] - [Phone]
- **Security Lead:** [Name] - [Phone]
- **DevOps Lead:** [Name] - [Phone]
- **On-Call:** [PagerDuty/Opsgenie]

---

## Useful Commands

### Run Tests
```bash
npm test                     # All tests
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests
npm run test:e2e            # E2E tests
```

### Security Scanning
```bash
npm run security:scan       # Snyk scan
npm audit                   # npm audit
```

### Code Quality
```bash
npm run lint                # ESLint
npm run typecheck           # TypeScript
npm run format              # Prettier
```

### Local Development
```bash
npm run dev                 # Start all services
npm run dev:shell           # Shell only
npm run dev:plugin          # Plugin dev mode
```

### Database
```bash
npm run db:migrate          # Run migrations
npm run db:seed             # Seed data
npm run db:studio           # Prisma Studio
```

---

**Last Updated:** January 28, 2026  
**Version:** 1.0  
**Next Review:** After Phase 1 completion
