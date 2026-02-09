# NAAP Production Readiness Report v2
**Date:** January 29, 2026  
**Review Type:** Principal Engineer + Staff DX Architect Assessment  
**Focus:** Developer Experience for Plugin Authors (TOP PRIORITY)

---

## 1. Executive Summary (1 page)

### Overall Readiness: **MOSTLY READY**

The NAAP platform demonstrates solid architectural foundations with a well-designed plugin SDK, comprehensive manifest schema, and robust lifecycle management. However, several security and DevX gaps must be addressed before production deployment.

### Top 5 Critical Risks

1. **No CSP Headers** - Missing Content-Security-Policy allows XSS attacks and plugin code injection
2. **Same-Context Plugin Execution** - Plugins run in host JS context; a malicious plugin can access all host state
3. **Dev Plugin Registration Friction** - Manual localStorage manipulation required; error-prone onboarding
4. **Inconsistent API Response Formats** - Three different response shapes across services break error handling
5. **Type Conflicts in SDK** - Duplicate `StorageUploadOptions`, `AICompletionOptions` cause compilation errors

### Ship Blockers (Must-Fix Before Release)

| Issue | Severity | Effort | Category |
|-------|----------|--------|----------|
| Add CSP headers to nginx config | Blocker | 1 day | Security |
| Document same-context execution risks; add opt-in sandboxing | Blocker | 2 days | Security |
| Auto-register dev plugins via CLI flag | Blocker | 1 day | DevX |
| Consolidate duplicate types in SDK | Blocker | 2 days | DevX |
| Standardize API response format | High | 3 days | Reliability |

**Estimated Time to "Ready": 2-3 weeks with 2 engineers**

---

## 2. Critical Issues (Ranked)

### Issue #1: No Content-Security-Policy Headers

- **Title:** Missing CSP Headers in Nginx Configuration
- **Severity:** Blocker
- **Category:** Security

**Evidence:**

```nginx:64-67:nginx/naap.conf
# Security headers
add_header X-Frame-Options SAMEORIGIN;
add_header X-Content-Type-Options nosniff;
add_header X-XSS-Protection "1; mode=block";
# NOTE: No Content-Security-Policy header
```

**Why this must be addressed:**
- Without CSP, any XSS vulnerability allows arbitrary script execution
- Plugin publishers could inject malicious inline scripts
- No defense-in-depth against supply chain attacks

**Impact on plugin authors (DevX):**
- Plugin authors won't know what CSP restrictions to expect
- Testing in dev (no CSP) vs production (with CSP) causes surprise failures

**Recommended fix:**
Add CSP header with script-src, style-src, connect-src directives. Start with report-only mode.

**Minimal patch approach:**
```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://plugins.naap.io; connect-src 'self' https://api.naap.io; report-uri /csp-report" always;
```

**Follow-up hardening:**
- Remove `'unsafe-inline'` after migrating to nonce-based scripts
- Add `require-trusted-types-for 'script'`

**Test(s) to add:**
- E2E: Verify plugin loads correctly under CSP
- Unit: CSP report endpoint captures violations

**Rollout plan:**
1. Deploy with `Content-Security-Policy-Report-Only` for 1 week
2. Analyze reports, fix violations
3. Switch to enforcing mode

---

### Issue #2: Same-Context Plugin Execution (No Isolation)

- **Title:** Plugins Execute in Host JavaScript Context Without Sandboxing
- **Severity:** Blocker
- **Category:** Security

**Evidence:**

```typescript:91-217:apps/shell-web/src/components/WorkflowLoader.tsx
const loadWorkflow = useCallback(async (isRetry: boolean = false) => {
  // ...
  const remoteModule = await loadRemoteModule(plugin.name, plugin.remoteUrl);
  // Plugin code runs in same context - can access window, document, localStorage
```

`PluginSandbox.tsx` exists but is NOT used in the default loading path.

**Why this must be addressed:**
- A malicious plugin can read `localStorage.getItem('naap_auth_token')`
- Can hijack `window.fetch` to intercept all API calls
- Can modify other plugins' DOM or state

**Impact on plugin authors (DevX):**
- No isolation means plugin conflicts are possible
- Authors may accidentally break other plugins
- No clear security contract for what plugins can/cannot access

**Recommended fix:**
1. **Short-term:** Document the trust model; plugins are "trusted by installation"
2. **Medium-term:** Add optional iframe sandbox mode via manifest flag
3. **Long-term:** Implement web worker isolation for untrusted plugins

**Minimal patch approach:**
Add `plugin.json` field: `"isolation": "none" | "iframe" | "worker"`

When `isolation: "iframe"`, use `PluginSandbox.tsx`:
```typescript
if (plugin.isolation === 'iframe') {
  return <PluginSandbox plugin={plugin} shell={shell} />;
}
```

**Test(s) to add:**
- Integration: Verify sandboxed plugin cannot access `window.parent`
- E2E: Confirm host state is not visible to sandboxed plugin

**Rollout plan:**
1. Week 1: Document trust model in SDK guide
2. Week 2: Add `isolation` manifest field (default: `none`)
3. Week 3: Enable `iframe` mode for marketplace plugins

---

### Issue #3: Dev Plugin Registration Requires Manual localStorage Manipulation

- **Title:** Dev Plugin Onboarding Friction
- **Severity:** Blocker
- **Category:** DevX

**Evidence:**
From the developer workflow investigation:
```javascript
// Required manual step in browser console
localStorage.setItem('naap-dev-plugins', JSON.stringify([{
  name: 'my-plugin',
  remoteUrl: 'http://localhost:3010/assets/remoteEntry.js',
  // ...
}]));
location.reload();
```

**Why this must be addressed:**
- First-time plugin developers will fail at this step
- JSON syntax errors in console break the entire dev flow
- No feedback if registration fails

**Impact on plugin authors (DevX):**
- "Hello World" time jumps from 5 minutes to 30+ minutes
- Error-prone; typos cause silent failures
- Completely undiscoverable without reading docs

**Recommended fix:**
`naap-plugin dev` should automatically register via URL parameter or local file.

**Minimal patch approach:**
Enhance `naap-plugin dev` to:
1. Write `.naap/dev-registration.json` with plugin config
2. Open browser with `?dev-plugin=...` URL parameter
3. Shell already supports URL-based dev plugins (line 148-167 in PluginContext.tsx)

```bash
# After running naap-plugin dev
open "http://localhost:3000/#/my-plugin?dev-plugin=http://localhost:3010/remoteEntry.js"
```

**Follow-up hardening:**
- Add `naap-plugin register` command for explicit registration
- Show registration status in terminal with QR code for mobile testing

**Test(s) to add:**
- CLI test: `naap-plugin dev` opens browser with correct URL
- E2E: Plugin appears in navigation after dev server starts

---

### Issue #4: Inconsistent API Response Formats

- **Title:** Three Different Response Shapes Across Services
- **Severity:** High
- **Category:** Reliability / DevX

**Evidence:**
```typescript
// Format 1: base-svc (routes/team.ts)
{ success: true, data: { ... }, error: null }

// Format 2: gateway-manager-svc
{ id: '123', name: 'gateway' }  // Plain object

// Format 3: developer-svc
{ error: 'Not found' }  // Error-only object
```

**Why this must be addressed:**
- Plugin authors cannot write consistent error handling
- `useApiClient` cannot provide typed responses
- Debugging is difficult when errors are formatted differently

**Impact on plugin authors (DevX):**
- Must check `response.success`, `response.error`, `response.data`, and raw object
- Copy-paste error handling code that doesn't work across services
- Runtime surprises when switching between plugin and host APIs

**Recommended fix:**
Standardize on a single response envelope:
```typescript
interface ApiResponse<T> {
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

**Minimal patch approach:**
1. Create `packages/utils/src/response.ts` with helper functions
2. Migrate `base-svc` first (it's closest to target format)
3. Update other services incrementally

**Test(s) to add:**
- Contract test: All endpoints return `ApiResponse<T>` shape
- SDK test: `useApiClient` correctly unwraps responses

---

### Issue #5: Duplicate Type Definitions in SDK

- **Title:** Type Conflicts Cause Compilation Errors
- **Severity:** High
- **Category:** DevX

**Evidence:**
```typescript
// packages/plugin-sdk/src/types/services.ts
export interface StorageUploadOptions { /* shape A */ }

// packages/plugin-sdk/src/types/integrations.ts
export interface StorageUploadOptions { /* shape B - different! */ }

// types/index.ts tries to exclude but both are exported
export * from './services.js';
export * from './integrations.js';
```

**Why this must be addressed:**
- TypeScript compilation fails with "Duplicate identifier" errors
- IDE autocomplete shows wrong type
- Plugin authors get cryptic "Type X is not assignable to type X" errors

**Impact on plugin authors (DevX):**
- Immediate blocker when importing from `@naap/plugin-sdk`
- Workaround requires manual type casting or ignoring
- Erodes trust in SDK quality

**Recommended fix:**
1. Consolidate types into single source of truth in `types/services.ts`
2. Re-export from `integrations.ts` using type aliases
3. Mark deprecated types with `@deprecated` JSDoc

**Minimal patch approach:**
```typescript
// integrations.ts
export type { StorageUploadOptions } from './services.js';
// Remove duplicate definition
```

**Test(s) to add:**
- Build test: `tsc --noEmit` passes with no duplicate identifier errors
- Import test: Single import gets correct type

---

## 3. DevX Deep Dive (MOST IMPORTANT)

### A) Plugin Author Journey

**Score: 6/10**

| Criterion | Rating | Notes |
|-----------|--------|-------|
| Hello plugin time-to-success | 5/10 | CLI scaffolding works, but dev registration is manual |
| Required boilerplate | 7/10 | `mount()` function is minimal; manifest is comprehensive |
| Consistency across plugins | 6/10 | Examples exist but use different patterns |
| Quality of templates | 7/10 | `frontend-only` and `full-stack` templates are good |

**Key Friction Points:**
1. Manual dev plugin registration (see Issue #3)
2. No single-command "start shell + plugin" workflow
3. Must read docs to understand `ShellContext` vs `AuthContext`

**Improvements:**
- Add `naap-plugin dev --auto-register` (S)
- Create `./bin/start.sh --with-plugin my-plugin` (M)
- Add "Quick Start" section to CLI output after create (S)

---

### B) Plugin API Design

**Score: 7/10**

| Criterion | Rating | Notes |
|-----------|--------|-------|
| Registration clarity | 8/10 | `mount()` + `plugin.json` is clean |
| TypeScript quality | 6/10 | Type conflicts reduce this score |
| Stable contracts | 7/10 | Version negotiation exists but passive |
| Backward compatibility | 8/10 | Zero breaking changes policy documented |

**Strengths:**
- `ShellContext` provides all services in one place
- `plugin.json` manifest is comprehensive and validated
- Topological dependency sorting works correctly

**Weaknesses:**
- No runtime capability negotiation
- Version mismatches are logged but don't block loading
- `useAuth` hook name collision with shell context

**Improvements:**
- Rename `ShellContext.useAuth` to `useAuthService` (S)
- Add `shell.capabilities.has('ai')` for runtime checks (M)
- Add `BREAKING_CHANGES.md` to SDK package (S)

---

### C) Errors & Debugging Experience

**Score: 7/10**

| Criterion | Rating | Notes |
|-----------|--------|-------|
| Error message actionability | 6/10 | Some errors are generic ("Internal error") |
| Manifest validation | 8/10 | Comprehensive validation at build and runtime |
| Failure diagnosis speed | 7/10 | Circuit breaker logs help, but metrics are local |
| Plugin-scoped logging | 8/10 | `createPluginLogger(pluginName)` works well |

**Evidence of Good Design:**
```typescript:53-63:apps/shell-web/src/components/PluginErrorBoundary.tsx
override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
  pluginFailed(pluginName, `${error.name}: ${error.message}`);
  console.error(`Plugin "${pluginName}" crashed:`, {
    error: error.message,
    componentStack: errorInfo.componentStack,
  });
}
```

**Improvements:**
- Add structured error codes: `NAAP_ERR_001: Plugin load timeout` (M)
- Surface health metrics in shell dev tools panel (L)
- Add `naap-plugin doctor` command for diagnosing issues (M)

---

### D) Local Dev Workflow

**Score: 6/10**

| Criterion | Rating | Notes |
|-----------|--------|-------|
| Hot reload | 8/10 | Vite HMR works for frontend; backend uses tsx watch |
| Running host + plugin | 5/10 | Requires two terminals, manual registration |
| Mocking host services | 6/10 | `createTestShell()` exists but underdocumented |
| Build speed | 7/10 | Vite is fast; backend builds are acceptable |

**Current Workflow (Too Many Steps):**
```bash
# Terminal 1: Start shell
./bin/start.sh --shell

# Terminal 2: Start plugin dev
cd plugins/my-plugin && naap-plugin dev

# Terminal 3: Register in browser console (!)
localStorage.setItem('naap-dev-plugins', ...)
```

**Proposed Golden Path:**
```bash
# Single command
naap-plugin dev --shell
# Opens browser at http://localhost:3000/#/my-plugin
```

**Improvements:**
- Integrate shell start into `naap-plugin dev --shell` (M)
- Auto-register via URL parameter (S)
- Add `--watch` mode for backend with automatic restart (S)

---

### E) Documentation Quality

**Score: 7/10**

| Criterion | Rating | Notes |
|-----------|--------|-------|
| Getting started | 7/10 | `docs/plugin-developer-guide.md` is comprehensive |
| API reference | 6/10 | JSDoc exists but not auto-generated to HTML |
| Examples | 7/10 | `hello-world` and `todo-list` are good |
| Troubleshooting | 5/10 | Scattered across multiple `.md` files |

**Documentation Gaps:**
1. No single "5-minute quickstart" for impatient devs
2. No API reference website (TypeDoc/Storybook)
3. Troubleshooting is fragmented

**Improvements:**
- Create `QUICKSTART.md` (1 page, copy-paste commands) (S)
- Generate TypeDoc site for SDK (M)
- Consolidate troubleshooting into `TROUBLESHOOTING.md` (S)

---

### DevX Fix List (Prioritized)

| Priority | Issue | Complexity | Impact |
|----------|-------|------------|--------|
| 1 | Auto-register dev plugins via URL param | S | High |
| 2 | Consolidate duplicate SDK types | S | High |
| 3 | Rename `useAuth` to `useAuthService` in ShellContext | S | Medium |
| 4 | Create 1-page QUICKSTART.md | S | High |
| 5 | Add `naap-plugin dev --shell` integrated mode | M | High |
| 6 | Generate TypeDoc API reference | M | Medium |
| 7 | Add `naap-plugin doctor` diagnostics | M | Medium |
| 8 | Standardize API response format | M | High |
| 9 | Add runtime capability checks (`shell.capabilities`) | M | Medium |
| 10 | Surface health metrics in dev tools panel | L | Low |

---

### Proposed "Golden Path" Plugin Template

```
my-plugin/
├── plugin.json                 # Manifest (validated at build + runtime)
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # mount() + unmount() only
│   │   ├── pages/
│   │   │   └── HomePage.tsx    # Main route component
│   │   └── hooks/
│   │       └── usePluginApi.ts # Calls own backend via useApiClient
│   ├── vite.config.ts          # Module Federation pre-configured
│   └── package.json
├── backend/                    # Optional
│   ├── src/
│   │   ├── server.ts           # Express with standard middleware
│   │   └── routes/
│   │       └── api.ts          # Standard response format
│   └── package.json
└── tests/
    ├── frontend/
    │   └── App.test.tsx        # Uses createTestShell()
    └── backend/
        └── api.test.ts         # Contract tests
```

**Key Patterns Enforced:**
1. `mount()` only renders; initialization in `init()` if async needed
2. All API calls via `useApiClient({ pluginName: 'my-plugin' })`
3. All errors use `useError()` hook for consistent UX
4. Backend responses use `ApiResponse<T>` shape
5. Tests use `createTestShell()` for mocking

---

## 4. Production Readiness Checklist

### Security

| Item | Status | Evidence | Recommendation |
|------|--------|----------|----------------|
| CSP headers | Fail | `nginx/naap.conf` missing CSP | Add CSP with report-only first |
| Plugin isolation | Weak | `WorkflowLoader` uses same context | Add opt-in iframe sandbox |
| Permissions model | Pass | `PermissionService.ts` with resource:action | Document in SDK guide |
| CSRF protection | Weak | Only `base-svc` has middleware | Add to all services |
| Input validation | Weak | Missing Zod schemas | Add validation middleware |
| Plugin manifest validation | Pass | `PluginValidationService.ts` | Comprehensive |

### Reliability

| Item | Status | Evidence | Recommendation |
|------|--------|----------|----------------|
| Failure containment | Pass | `PluginErrorBoundary` + circuit breaker | Documented |
| Timeouts | Pass | 30s mount timeout in `WorkflowLoader` | Good |
| Retries | Pass | Auto-retry with exponential backoff | Good |
| Plugin crash doesn't crash host | Pass | Error boundary catches React errors | Good |

### Performance

| Item | Status | Evidence | Recommendation |
|------|--------|----------|----------------|
| Plugin load time | Pass | Metrics tracked in `PluginMetricsService` | Add budget alerts |
| Bundle size | Weak | No size limits enforced | Add 500KB warning |
| Shared deps | Pass | React/ReactDOM shared via Module Federation | Good |
| Lazy loading | Pass | Plugins load on route navigation | Good |
| Memory leaks | Weak | `unmount()` called but no validation | Add WeakRef tracking |

### Compatibility

| Item | Status | Evidence | Recommendation |
|------|--------|----------|----------------|
| Browser support | Weak | Not specified | Document ES2020+ requirement |
| Semver | Pass | Version checks in `resolveDependencies` | Good |
| Version negotiation | Weak | Passive (log warning, don't block) | Add strict mode option |
| Shell compatibility | Pass | `shell.minVersion/maxVersion` in manifest | Good |

### Observability

| Item | Status | Evidence | Recommendation |
|------|--------|----------|----------------|
| Metrics | Pass | `PluginMetricsService` tracks loads/errors | Export to Prometheus |
| Tracing | Weak | Correlation IDs in API client only | Add OpenTelemetry |
| Structured logs | Pass | `createPluginLogger` with plugin scope | Good |
| Error reporting | Weak | Console.error only | Add Sentry integration |

### Testing

| Item | Status | Evidence | Recommendation |
|------|--------|----------|----------------|
| Contract tests | Weak | Manifest validation only | Add mount() contract tests |
| Integration tests | Pass | `pluginLifecycle.integration.test.ts` | Good |
| E2E smoke tests | Pass | `bin/smoke.sh` + Playwright | Good |
| SDK mock utilities | Weak | `createTestShell()` underdocumented | Add examples |

### Build & Release

| Item | Status | Evidence | Recommendation |
|------|--------|----------|----------------|
| CI gates | Weak | Not visible in repo | Add GitHub Actions |
| Reproducible builds | Pass | `package-lock.json` + `pnpm-lock.yaml` | Good |
| Changelog | Weak | Manual only | Add conventional commits |
| Signed artifacts | Fail | No code signing | Add GPG signing for plugins |

### Governance

| Item | Status | Evidence | Recommendation |
|------|--------|----------|----------------|
| Plugin review process | Weak | Manual testing only | Add automated security scan |
| Kill switch | Fail | No remote disable | Add feature flag per plugin |
| Permission prompts | Fail | No install-time consent | Add permissions dialog |

---

## 5. "Golden Interfaces" Proposal

### 5.1 Minimal Stable Core Plugin Interface

```typescript
/**
 * Core Plugin Module Interface
 * This is the ONLY interface plugins MUST implement.
 */
export interface PluginModule {
  /**
   * Optional async initialization.
   * Called once before mount(). Errors here prevent mounting.
   */
  init?: (context: ShellContext) => Promise<void>;

  /**
   * Required mount function.
   * Renders the plugin UI into the container.
   * Must return an unmount function for cleanup.
   */
  mount: (container: HTMLElement, context: ShellContext) => (() => void) | void;

  /**
   * Plugin metadata for shell discovery.
   */
  metadata?: {
    name: string;
    version: string;
  };
}

/**
 * Minimal ShellContext for plugins.
 * All services are typed and mockable.
 */
export interface ShellContext {
  // Required services
  readonly auth: IAuthService;
  readonly navigate: (path: string) => void;
  readonly eventBus: IEventBus;
  readonly notifications: INotificationService;
  readonly logger: ILoggerService;
  readonly permissions: IPermissionService;
  
  // Optional services (may be undefined)
  readonly theme?: IThemeService;
  readonly integrations?: IIntegrationService;
  readonly tenant?: ITenantService;
  readonly team?: ITeamContext;
  readonly api?: IApiClient;
  
  // Shell metadata
  readonly version: string;
}
```

### 5.2 Manifest Schema (JSON)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "NAAP Plugin Manifest",
  "type": "object",
  "required": ["name", "displayName", "version", "frontend"],
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9-]*$",
      "description": "Unique plugin identifier (kebab-case)"
    },
    "displayName": {
      "type": "string",
      "maxLength": 50
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+(-[a-z0-9.]+)?$"
    },
    "shell": {
      "type": "object",
      "properties": {
        "minVersion": { "type": "string" },
        "maxVersion": { "type": "string" }
      }
    },
    "permissions": {
      "type": "object",
      "properties": {
        "shell": {
          "type": "array",
          "items": { "enum": ["navigation", "notifications", "theme", "auth", "events", "integrations"] }
        }
      }
    },
    "isolation": {
      "type": "string",
      "enum": ["none", "iframe", "worker"],
      "default": "none"
    }
  }
}
```

### 5.3 Capability-Based Permissions Model

```typescript
/**
 * Permission check at runtime.
 * Plugins declare required permissions in manifest.
 * Shell validates at load time.
 */
interface PluginPermissions {
  // Shell permissions (what host services plugin can access)
  shell: ShellPermission[];
  
  // API permissions (what other plugin APIs this can call)
  apis: string[];  // e.g., ["my-wallet:read", "marketplace:*"]
  
  // External permissions (network access)
  external: string[];  // e.g., ["https://api.openai.com/*"]
}

type ShellPermission = 
  | 'navigation'      // Can call navigate()
  | 'notifications'   // Can show notifications
  | 'theme'           // Can read/change theme
  | 'auth'            // Can access user info
  | 'events'          // Can emit/listen to events
  | 'integrations';   // Can use AI/Storage/Email

// Runtime check
if (!shell.permissions.can('integrations', 'use')) {
  throw new Error('Plugin does not have integrations permission');
}
```

### 5.4 Version Negotiation Mechanism

```typescript
/**
 * Version negotiation at plugin load time.
 */
interface VersionNegotiation {
  // Plugin declares compatibility
  manifest: {
    shell: {
      minVersion: "1.0.0",
      maxVersion: "2.x"
    }
  };
  
  // Shell checks at load time
  isCompatible: (pluginManifest, shellVersion) => CompatibilityResult;
}

interface CompatibilityResult {
  compatible: boolean;
  reason?: string;
  deprecationWarning?: string;
}

// Behavior:
// 1. If compatible: load normally
// 2. If deprecated: load with console warning
// 3. If incompatible: skip loading, show error in UI
```

### 5.5 Host Service SDK (Typed, Mockable)

```typescript
// Example: Using API client in a plugin
import { useApiClient, useAuth, useNotify } from '@naap/plugin-sdk';

export function MyPluginPage() {
  const api = useApiClient({ pluginName: 'my-plugin' });
  const { user } = useAuth();
  const notify = useNotify();

  const handleSubmit = async (data: FormData) => {
    try {
      const result = await api.post<CreateResourceResponse>('/resources', data);
      notify.success('Resource created');
      return result.data;
    } catch (error) {
      notify.error(error.message);
    }
  };
}

// Testing with mocks
import { createTestShell } from '@naap/plugin-sdk/testing';

test('creates resource', async () => {
  const shell = createTestShell({
    user: { id: '1', name: 'Test' },
    apiMock: {
      'POST /resources': { success: true, data: { id: '123' } }
    }
  });
  
  render(<ShellProvider value={shell}><MyPluginPage /></ShellProvider>);
  // ... assertions
});
```

---

## 6. Final Output

### 6.1 Prioritized Issue List (Blockers First)

| Rank | Issue | Severity | Category | Effort |
|------|-------|----------|----------|--------|
| 1 | No CSP headers | Blocker | Security | 1d |
| 2 | Same-context execution undocumented | Blocker | Security | 2d |
| 3 | Dev plugin registration friction | Blocker | DevX | 1d |
| 4 | Duplicate types in SDK | High | DevX | 2d |
| 5 | Inconsistent API response format | High | Reliability | 3d |
| 6 | CSRF protection missing on services | High | Security | 2d |
| 7 | No runtime capability checks | Medium | DevX | 2d |
| 8 | Input validation missing | High | Security | 5d |
| 9 | No API documentation site | Medium | DevX | 3d |
| 10 | No kill switch for plugins | Medium | Governance | 2d |

### 6.2 DevX Fix List (Top 10)

| Rank | Fix | Complexity | DevX Impact |
|------|-----|------------|-------------|
| 1 | Auto-register dev plugins via `?dev-plugin=` URL | S | Unblocks onboarding |
| 2 | Consolidate duplicate SDK types | S | Fixes compilation |
| 3 | Create 1-page QUICKSTART.md | S | Reduces time-to-hello |
| 4 | Rename `useAuth` → `useAuthService` in ShellContext | S | Reduces confusion |
| 5 | Add `naap-plugin dev --shell` integrated mode | M | Single-command dev |
| 6 | Standardize API response format | M | Consistent error handling |
| 7 | Generate TypeDoc API reference site | M | Discoverability |
| 8 | Add `naap-plugin doctor` diagnostics | M | Faster troubleshooting |
| 9 | Add runtime `shell.capabilities.has()` | M | Feature detection |
| 10 | Document SDK patterns with annotated examples | M | Best practices |

### 6.3 Release Plan (3 Weeks)

#### Week 1: Security & DevX Blockers
**Goal:** Remove all Blocker-severity issues

| Day | Task | Owner |
|-----|------|-------|
| 1 | Add CSP headers to nginx (report-only) | DevOps |
| 1-2 | Document trust model; add isolation manifest field | Security |
| 2 | Auto-register dev plugins via URL param in CLI | SDK Team |
| 3-4 | Consolidate duplicate SDK types | SDK Team |
| 5 | Create QUICKSTART.md | Docs |

**Deliverables:**
- [ ] CSP in report-only mode
- [ ] `isolation` field in manifest schema
- [ ] `naap-plugin dev` opens browser with auto-registration
- [ ] SDK compiles without duplicate identifier errors
- [ ] 1-page quickstart in repo root

#### Week 2: API & DevX Quality
**Goal:** Improve developer experience

| Day | Task | Owner |
|-----|------|-------|
| 1 | Rename `useAuth` → `useAuthService` | SDK Team |
| 2-4 | Standardize API response format (start with base-svc) | Backend |
| 3-5 | Add CSRF middleware to remaining services | Backend |
| 5 | Generate TypeDoc site from SDK | SDK Team |

**Deliverables:**
- [ ] No hook name collisions
- [ ] `base-svc` uses `ApiResponse<T>` format
- [ ] All services have CSRF protection
- [ ] TypeDoc site deployed

#### Week 3: Hardening & Governance
**Goal:** Production-ready polish

| Day | Task | Owner |
|-----|------|-------|
| 1-2 | Add input validation (Zod) to critical endpoints | Backend |
| 3 | Add `naap-plugin dev --shell` mode | SDK Team |
| 4 | Add plugin kill switch via feature flag | Platform |
| 5 | Switch CSP to enforcing mode | DevOps |

**Deliverables:**
- [ ] Critical endpoints validated
- [ ] Single-command plugin development
- [ ] Remote plugin disable capability
- [ ] CSP enforcing with no violations

---

## Appendix: Evidence References

| File | Description |
|------|-------------|
| `nginx/naap.conf` | Nginx config missing CSP |
| `apps/shell-web/src/components/WorkflowLoader.tsx` | Plugin loading without isolation |
| `apps/shell-web/src/context/PluginContext.tsx` | Dev plugin handling (lines 148-167) |
| `packages/plugin-sdk/src/types/services.ts` | Type definitions (duplicates) |
| `packages/plugin-sdk/src/types/integrations.ts` | Conflicting type definitions |
| `apps/shell-web/src/components/PluginSandbox.tsx` | Unused iframe sandbox |
| `apps/shell-web/src/services/PermissionService.ts` | Permission implementation |
| `docs/plugin-developer-guide.md` | Developer documentation |

---

**Report prepared by:** AI Principal Engineer + Staff DX Architect  
**Review required by:** Technical Lead, Security Team, DevX Lead  
**Next action:** Prioritize Week 1 tasks and assign owners
