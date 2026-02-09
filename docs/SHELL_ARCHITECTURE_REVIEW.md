# Shell-Web Architecture Review & Improvement Plan

## Executive Summary

This comprehensive review of the shell-web application identifies **32 architectural issues** across five categories: SOLID principle violations, layer abstraction problems, architectural risks, and incomplete implementations. The issues range from critical security vulnerabilities to code maintainability concerns.

**Key Findings:**
- **2 Critical Issues**: Token exposure in localStorage, multiple sources of truth for team ID
- **7 High Priority Issues**: Affecting plugin stability and code maintainability
- **15 Medium Priority Issues**: Code quality and developer experience
- **8 Low Priority Issues**: Optimizations and minor inconsistencies

**Estimated Total Effort**: 15-20 developer days across 4 phases

---

## Part 1: Issues Identified

### Category A: SOLID Principle Violations

#### A1. Single Responsibility Principle (SRP) Violations

| ID | Issue | File | Severity | Effort | Plugin Impact |
|----|-------|------|----------|--------|---------------|
| SRP-1 | **PluginContext God Context** - 1000+ lines mixing validation, HTTP, caching, events, state | `context/PluginContext.tsx` | HIGH | Large | Medium |
| SRP-2 | **Duplicate Team Logic** - `setCurrentTeam` duplicated in ShellProviderV2 and ShellProvider | `context/ShellContextV2.tsx:155-202, 392-439` | MEDIUM | Small | None |
| SRP-3 | **AuthContext Mixed Concerns** - Renders SessionExpiryModal UI inside provider | `context/AuthContext.tsx:441-452` | MEDIUM | Small | None |

**SRP-1 Details - PluginContext Responsibilities (should be 6+ separate modules):**
```
Current PluginContext.tsx handles:
├── Plugin state management (lines 513-518)
├── API response validation (lines 143-290)
├── Dev plugin URL security validation (lines 51-94)
├── Team access validation (lines 113-120)
├── Dependency resolution (lines 477-510)
├── Retry logic with exponential backoff (lines 296-358)
├── Dev plugin registration/persistence (lines 926-966)
├── Event bus subscription management (lines 882-924)
└── Module unloading coordination (lines 821-830)
```

#### A2. Open/Closed Principle (OCP) Violations

| ID | Issue | File | Severity | Effort | Plugin Impact |
|----|-------|------|----------|--------|---------------|
| OCP-1 | **Hard-coded Team Role Permissions** - Static object requires code changes | `context/ShellContextV2.tsx:92-97` | MEDIUM | Medium | None |
| OCP-2 | **Hard-coded Allowed Plugin Hosts** - Empty array, no runtime config | `utils/moduleLoader.ts:222-228` | HIGH | Small | High |

#### A3. Liskov Substitution Principle (LSP) Violations

| ID | Issue | File | Severity | Effort | Plugin Impact |
|----|-------|------|----------|--------|---------------|
| LSP-1 | **V1/V2 Context Interface Mismatch** - `authToken()` throws instead of returning null | `utils/contextAdapter.ts:122-171` | HIGH | Small | High |
| LSP-2 | **TeamContext Function vs Value** - Inconsistent API between V1 and V2 | `utils/contextAdapter.ts:138-155` | MEDIUM | Small | Medium |

**LSP-1 Code Example:**
```typescript
// Problem: V1 plugins expect null on no-auth, but V2 throws
authToken: async () => {
  return v2.auth.getToken(); // Throws "Not authenticated" instead of null
}
```

#### A4. Interface Segregation Principle (ISP) Violations

| ID | Issue | File | Severity | Effort | Plugin Impact |
|----|-------|------|----------|--------|---------------|
| ISP-1 | **Fat TeamService Interface** - 18+ methods covering CRUD, members, plugins, access | `services/TeamService.ts:107-424` | MEDIUM | Medium | Low |
| ISP-2 | **Fat TenantService Interface** - Bundles installation, config, preferences | `services/TenantService.ts:46-101` | LOW | Medium | Low |

#### A5. Dependency Inversion Principle (DIP) Violations

| ID | Issue | File | Severity | Effort | Plugin Impact |
|----|-------|------|----------|--------|---------------|
| DIP-1 | **Direct localStorage Access** - 17+ direct accesses across codebase | Multiple files | HIGH | Medium | Low |
| DIP-2 | **Services Import Concrete Implementations** - No dependency injection | `services/PluginHealthService.ts:21-22` | MEDIUM | Medium | None |

**DIP-1 - Files with direct localStorage access:**
- `PluginContext.tsx` (lines 397, 638, 939, 955)
- `AuthContext.tsx` (lines 64, 69, 74, 466)
- `ShellContextV2.tsx` (lines 124, 142, 358, 379)
- `TeamService.ts` (line 109)
- `pages/admin/Secrets.tsx` (line 37)
- `pages/Settings.tsx` (lines 290, 413)

---

### Category B: Layer Abstraction Issues

| ID | Issue | Description | Severity | Effort |
|----|-------|-------------|----------|--------|
| LAY-1 | **PluginContext Mixes Concerns** | HTTP, validation, retry logic should be in services | HIGH | Large |
| LAY-2 | **TeamContextManager vs TeamService Overlap** | Three-way responsibility split for team logic | MEDIUM | Medium |
| LAY-3 | **AuthService vs AuthContext Overlap** | Duplicate responsibilities, AuthService underutilized | MEDIUM | Small |
| LAY-4 | **WorkflowLoader Contains Business Logic** | Retry, health tracking, V1/V2 adaptation in component | MEDIUM | Medium |
| LAY-5 | **Event Bus Circular Risk** | WeakSet doesn't track primitives, edge cases exist | MEDIUM | Small |

---

### Category C: Architectural Risks

#### C1. State Management Issues

| ID | Issue | Risk | Severity |
|----|-------|------|----------|
| STATE-1 | **Multiple Sources of Truth for Team ID** | Race conditions, inconsistent state | CRITICAL |
| STATE-2 | **Team Context Change During Plugin Load** | Stale plugins briefly displayed | MEDIUM |

**STATE-1 - Team ID read from 3 places:**
1. `localStorage.getItem('current_team_id')` - ShellContextV2.tsx:142, 379
2. `teamContext.getTeamId()` - PluginContext.tsx:636
3. `currentTeam?.id` state - ShellContextV2.tsx

#### C2. Memory Leaks

| ID | Issue | Location | Severity |
|----|-------|----------|----------|
| MEM-1 | **Cache Cleanup Interval Never Cleared** | `moduleLoader.ts:171-194` | MEDIUM |
| MEM-2 | **Event Listener Accumulation Risk** | `PluginContext.tsx:882-924` | MEDIUM |

#### C3. Race Conditions

| ID | Issue | Location | Severity |
|----|-------|----------|----------|
| RACE-1 | **Team Context Race Window** | `PluginContext.tsx:696-699` - ref set after fetch starts | MEDIUM |
| RACE-2 | **Concurrent Module Loads** | `moduleLoader.ts:359-364` - URL mismatch doesn't cancel old load | MEDIUM |

#### C4. Security Vulnerabilities

| ID | Issue | Risk | Severity | Effort |
|----|-------|------|----------|--------|
| SEC-1 | **Token in localStorage** | XSS can steal auth token | CRITICAL | Large |
| SEC-2 | **Dev Plugin localStorage Manipulation** | Malicious scripts could inject URLs | MEDIUM | Small |
| SEC-3 | **Inconsistent CSRF Protection** | Some API calls lack CSRF tokens | MEDIUM | Small |

#### C5. Performance Issues

| ID | Issue | Impact | Severity |
|----|-------|--------|----------|
| PERF-1 | **Full Plugin Refresh on Single Change** | O(n) on every install/uninstall | LOW |
| PERF-2 | **No Debouncing on Team Change** | Rapid switching causes concurrent API calls | LOW |

---

### Category D: Incomplete/Inconsistent Implementations

#### D1. Half-Implemented Features

| ID | Feature | Status | Location |
|----|---------|--------|----------|
| INC-1 | **Team Access Validation** | Stub returns true always | `PluginContext.tsx:113-120` |
| INC-2 | **WebSocket Integration** | Service exists but never connected | `services/WebSocketService.ts` |

#### D2. Inconsistent Patterns

| ID | Issue | Examples |
|----|-------|----------|
| PAT-1 | **Singleton Pattern Inconsistency** | EventBus uses getter, TeamService pre-instantiated, TenantService has factory |
| PAT-2 | **Error Handling Inconsistency** | TeamService throws, TenantService returns defaults |

**PAT-1 Examples:**
```typescript
// Pattern 1: Getter function (EventBusService.ts)
export const getEventBus = () => eventBusInstance;

// Pattern 2: Pre-instantiated export (TeamService.ts)
export const TeamService = new TeamServiceClass();

// Pattern 3: Factory + getter (TenantService.ts)
export function createTenantService() { ... }
export function getTenantService() { ... }
```

#### D3. Missing Test Coverage

| Area | Test Files | Lines of Code | Risk |
|------|------------|---------------|------|
| PluginContext | 0 | 1006 | HIGH |
| AuthContext | 0 | 454 | HIGH |
| ShellContextV2 | 0 | 500+ | HIGH |
| contextAdapter | 0 | 171 | HIGH |
| moduleLoader | 0 | 500+ | HIGH |
| All Services | 0 | 1500+ | HIGH |

**Only existing test:** `src/__tests__/plugin/security.test.ts`

---

## Part 2: Prioritized Issue Summary

### Priority 1: Critical (Fix Immediately)
| ID | Issue | Why Critical |
|----|-------|--------------|
| SEC-1 | Token exposure in localStorage | Security vulnerability - XSS token theft |
| STATE-1 | Multiple sources of truth for team ID | Data corruption, race conditions |

### Priority 2: High (Fix This Sprint)
| ID | Issue | Why High |
|----|-------|----------|
| SRP-1 | PluginContext God Context | Unmaintainable, untestable core code |
| LSP-1 | V1/V2 Context Interface Mismatch | Plugin breakage on auth errors |
| DIP-1 | Direct localStorage Access | Untestable, no SSR support |
| RACE-2 | Concurrent Module Loads | Plugin instability |
| OCP-2 | Hard-coded Allowed Plugin Hosts | Production deployment blocker |
| D3 | Missing Test Coverage | Refactoring risk |

### Priority 3: Medium (Fix This Quarter)
| ID | Issue |
|----|-------|
| SRP-2, SRP-3 | Duplicate code, mixed concerns |
| OCP-1, LSP-2 | Extension and substitution issues |
| ISP-1, DIP-2 | Fat interfaces, tight coupling |
| LAY-1 through LAY-5 | Layer abstraction problems |
| MEM-1, MEM-2 | Memory leak risks |
| RACE-1 | Team context race window |
| SEC-2, SEC-3 | Security improvements |
| PAT-1, PAT-2 | Pattern inconsistencies |
| INC-1 | Team access validation |

### Priority 4: Low (Backlog)
| ID | Issue |
|----|-------|
| ISP-2 | TenantService interface |
| PERF-1, PERF-2 | Performance optimizations |
| INC-2 | WebSocket integration |

---

## Part 3: Phased Implementation Plan

### Phase 1: Foundation & Security (Week 1-2)
**Goal:** Establish testing foundation and fix critical security issues

#### Phase 1.1: Storage Abstraction Layer
**Effort:** 2-3 days

Create a storage abstraction to enable testing and prepare for secure token storage:

```
New Files:
├── services/storage/
│   ├── IStorageService.ts      # Interface
│   ├── LocalStorageService.ts  # Browser implementation
│   ├── MemoryStorageService.ts # Test implementation
│   └── index.ts                # Factory/singleton
```

**Changes Required:**
1. Create `IStorageService` interface with get/set/remove/clear methods
2. Implement `LocalStorageService` wrapping localStorage
3. Implement `MemoryStorageService` for testing
4. Replace all 17+ direct localStorage calls with service
5. Update imports in: PluginContext, AuthContext, ShellContextV2, TeamService, Settings, Secrets

**Plugin Impact:** None - internal change

#### Phase 1.2: Team ID Single Source of Truth
**Effort:** 1-2 days

Enforce `TeamContextManager` as the only team ID source:

**Changes Required:**
1. Remove direct localStorage reads for team ID in ShellContextV2.tsx
2. Update PluginContext to always use `teamContext.getTeamId()`
3. Add validation that rejects direct localStorage access in CI/lint

**Plugin Impact:** None - internal change

#### Phase 1.3: Critical Test Coverage
**Effort:** 3-4 days

Add tests for critical paths before further refactoring:

```
New Test Files:
├── __tests__/
│   ├── context/
│   │   ├── PluginContext.test.tsx
│   │   ├── AuthContext.test.tsx
│   │   └── ShellContextV2.test.tsx
│   ├── services/
│   │   ├── TeamContextManager.test.ts
│   │   └── EventBusService.test.ts
│   └── utils/
│       ├── moduleLoader.test.ts
│       └── contextAdapter.test.ts
```

**Plugin Impact:** None

---

### Phase 2: PluginContext Decomposition (Week 3-4)
**Goal:** Break the God Context into focused services

#### Phase 2.1: Extract Plugin Validation Service
**Effort:** 2 days

```
New File: services/PluginValidationService.ts

Responsibilities:
├── validatePluginsResponse()      # From PluginContext lines 143-211
├── validateAndSanitizePlugins()   # From PluginContext lines 214-290
├── validateDevPluginUrl()         # From PluginContext lines 51-94
└── validateDependencies()         # From PluginContext lines 477-510
```

**Plugin Impact:** None - internal extraction

#### Phase 2.2: Extract Plugin API Service
**Effort:** 2 days

```
New File: services/PluginApiService.ts

Responsibilities:
├── fetchPersonalPlugins()         # From PluginContext lines 730-755
├── fetchTeamPlugins()             # From PluginContext lines 675-727
├── fetchWithRetry()               # From PluginContext lines 296-358
└── API response handling          # Centralized error handling
```

**Plugin Impact:** None - internal extraction

#### Phase 2.3: Extract Plugin Lifecycle Service
**Effort:** 2 days

```
New File: services/PluginLifecycleService.ts

Responsibilities:
├── registerDevPlugin()            # From PluginContext lines 926-948
├── unregisterDevPlugin()          # From PluginContext lines 950-966
├── updatePluginStates()           # From PluginContext lines 519-532
└── handlePluginUnload()           # From PluginContext lines 821-830
```

**Plugin Impact:** None - internal extraction

#### Phase 2.4: Simplify PluginContext
**Effort:** 1-2 days

After extraction, PluginContext becomes a thin orchestrator:

```typescript
// Simplified PluginContext (~200 lines instead of 1000+)
export const PluginProvider = ({ children }) => {
  const [plugins, setPlugins] = useState([]);
  const [loading, setLoading] = useState(true);

  const refreshPlugins = useCallback(async () => {
    const validated = await pluginApi.fetchPlugins(teamId);
    const resolved = pluginValidation.resolveDependencies(validated);
    pluginLifecycle.updateStates(resolved);
    setPlugins(resolved);
  }, [teamId]);

  // Event subscriptions
  usePluginEvents(refreshPlugins);

  return <PluginContext.Provider value={{ plugins, loading, refreshPlugins }}>{children}</PluginContext.Provider>;
};
```

**Plugin Impact:** None - same context API

---

### Phase 3: Interface Standardization (Week 5-6)
**Goal:** Fix LSP violations and standardize patterns

#### Phase 3.1: Fix V1/V2 Context Compatibility
**Effort:** 2 days

```
File: utils/contextAdapter.ts

Changes:
1. Wrap authToken() to catch and return null instead of throwing
2. Standardize team() return type
3. Add comprehensive JSDoc for plugin developers
4. Add deprecation warnings for V1 usage
```

**Plugin Impact:** HIGH
- V1 plugins will work correctly on auth errors
- Add migration guide for V1 → V2

#### Phase 3.2: Standardize Service Patterns
**Effort:** 2 days

Adopt consistent singleton pattern across all services:

```typescript
// Standard pattern for all services
interface ServiceFactory<T> {
  create: (deps: Dependencies) => T;
  getInstance: () => T;
  resetForTesting: () => void;
}

// Apply to:
// - EventBusService
// - AuthService
// - TeamService
// - TenantService
// - PluginHealthService
// - NotificationService
```

**Plugin Impact:** Low - same public API

#### Phase 3.3: Standardize Error Handling
**Effort:** 1-2 days

Create error handling utilities:

```
New File: utils/errors.ts

Exports:
├── ServiceError class
├── handleServiceError() - standard catch handler
├── wrapServiceCall() - wrapper for try/catch
└── ErrorBoundary updates
```

Apply to TeamService and TenantService for consistent behavior.

**Plugin Impact:** Medium - plugins need to handle errors consistently

---

### Phase 4: Architecture Cleanup (Week 7-8)
**Goal:** Clean up remaining issues and optimize

#### Phase 4.1: Fix Memory Leaks
**Effort:** 1 day

```
Files to update:
├── moduleLoader.ts - Add cleanup on app unmount
├── PluginContext.tsx - Ensure event listener cleanup
└── AuthContext.tsx - Clear session timers
```

**Plugin Impact:** None

#### Phase 4.2: Fix Race Conditions
**Effort:** 2 days

```
Files to update:
├── PluginContext.tsx - Set loadingTeamIdRef before fetch
├── moduleLoader.ts - Cancel old load on URL mismatch
└── Add request deduplication utility
```

**Plugin Impact:** Low - improves stability

#### Phase 4.3: Configure Allowed Plugin Hosts
**Effort:** 1 day

```
Changes:
1. Move ALLOWED_PLUGIN_HOSTS to environment config
2. Add runtime configuration API
3. Document host configuration for production
```

**Plugin Impact:** HIGH - enables production plugin deployment

#### Phase 4.4: Remove Duplicate Code
**Effort:** 1 day

```
Files to update:
├── ShellContextV2.tsx - Extract shared setCurrentTeam logic
├── AuthContext.tsx - Move SessionExpiryModal outside provider
└── Create shared utilities for common patterns
```

**Plugin Impact:** None

---

## Part 4: Plugin Migration Guide

### Breaking Changes by Phase

| Phase | Breaking Change | Plugin Action Required |
|-------|-----------------|----------------------|
| Phase 3.1 | V1 `authToken()` behavior change | None if handling null, update if expecting throw |
| Phase 3.3 | Error handling standardization | Update error handling to use new patterns |
| Phase 4.3 | Allowed hosts configuration | Ensure plugin host is in allowed list |

### V1 to V2 Migration Checklist

For plugin developers upgrading from V1 to V2:

```markdown
## V1 → V2 Migration Checklist

### Required Changes
- [ ] Change `mount(container, context)` to `mountV2(container, context)`
- [ ] Add `__contextVersion: 2` export
- [ ] Update auth token access: `context.authToken()` → `context.auth.getToken()`
- [ ] Update user access: `context.user()` → `context.auth.getUser()`
- [ ] Update team access: `context.team()` → `context.team`

### Recommended Changes
- [ ] Use `context.notifications` instead of custom toasts
- [ ] Use `context.logger` for consistent logging
- [ ] Subscribe to typed events via `context.eventBus`

### Testing
- [ ] Test with both personal and team contexts
- [ ] Test auth token refresh scenarios
- [ ] Test error handling for API failures
```

---

## Part 5: Effort Summary

| Phase | Description | Effort | Dependencies |
|-------|-------------|--------|--------------|
| 1.1 | Storage Abstraction | 2-3 days | None |
| 1.2 | Team ID Source of Truth | 1-2 days | None |
| 1.3 | Critical Test Coverage | 3-4 days | 1.1 |
| 2.1 | Plugin Validation Service | 2 days | 1.3 |
| 2.2 | Plugin API Service | 2 days | 2.1 |
| 2.3 | Plugin Lifecycle Service | 2 days | 2.2 |
| 2.4 | Simplify PluginContext | 1-2 days | 2.1-2.3 |
| 3.1 | V1/V2 Compatibility | 2 days | 2.4 |
| 3.2 | Service Pattern Standardization | 2 days | 1.1 |
| 3.3 | Error Handling Standardization | 1-2 days | 3.2 |
| 4.1 | Fix Memory Leaks | 1 day | 1.3 |
| 4.2 | Fix Race Conditions | 2 days | 2.4 |
| 4.3 | Configure Plugin Hosts | 1 day | None |
| 4.4 | Remove Duplicate Code | 1 day | 3.2 |

**Total Estimate:** 20-26 developer days

---

## Part 6: Success Criteria

### Phase 1 Complete When:
- [ ] All localStorage access goes through StorageService
- [ ] Team ID has single source of truth (verified by tests)
- [ ] Core contexts have >80% test coverage
- [ ] No critical security issues in scan

### Phase 2 Complete When:
- [ ] PluginContext < 300 lines
- [ ] Each extracted service has unit tests
- [ ] Plugin loading still works identically

### Phase 3 Complete When:
- [ ] V1 plugins work without errors
- [ ] All services follow same singleton pattern
- [ ] Error handling is consistent across services

### Phase 4 Complete When:
- [ ] No memory leaks in 24-hour test
- [ ] No race conditions in rapid team switching test
- [ ] Plugin hosts configurable via environment
- [ ] No duplicate code blocks > 10 lines

---

## Appendix A: File Change Summary

### New Files to Create
```
services/storage/
├── IStorageService.ts
├── LocalStorageService.ts
├── MemoryStorageService.ts
└── index.ts

services/
├── PluginValidationService.ts
├── PluginApiService.ts
├── PluginLifecycleService.ts

utils/
└── errors.ts

__tests__/
├── context/
│   ├── PluginContext.test.tsx
│   ├── AuthContext.test.tsx
│   └── ShellContextV2.test.tsx
├── services/
│   ├── TeamContextManager.test.ts
│   ├── EventBusService.test.ts
│   ├── PluginValidationService.test.ts
│   ├── PluginApiService.test.ts
│   └── PluginLifecycleService.test.ts
└── utils/
    ├── moduleLoader.test.ts
    └── contextAdapter.test.ts
```

### Files to Modify
```
context/
├── PluginContext.tsx (major refactor)
├── AuthContext.tsx (minor changes)
└── ShellContextV2.tsx (moderate changes)

services/
├── TeamService.ts (pattern update)
├── TenantService.ts (pattern update)
├── AuthService.ts (consolidation)
├── EventBusService.ts (pattern update)
└── PluginHealthService.ts (DI update)

utils/
├── moduleLoader.ts (race condition fixes)
└── contextAdapter.ts (V1/V2 fixes)

pages/
├── Settings.tsx (storage abstraction)
└── admin/Secrets.tsx (storage abstraction)
```

---

## Appendix B: Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Plugin breakage during refactor | Phase 1.3 adds tests first; feature flags for gradual rollout |
| Extended timeline | Each phase is independently valuable; can pause between phases |
| Team unfamiliarity with new patterns | Document patterns; pair programming on first implementations |
| Performance regression | Add performance tests in Phase 1.3 |
| Missing edge cases | Comprehensive test coverage before each refactor |

---

*Document generated: 2026-01-28*
*Review required before implementation*
