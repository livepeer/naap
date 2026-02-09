# NAAP Platform Baseline Audit

## Current Architecture Inventory

### Shell Services (apps/shell-web/src/)

| Service | Location | Status | Notes |
|---------|----------|--------|-------|
| ShellContext | `context/ShellContext.tsx` | Active | Auth, navigation, theme, event bus |
| PluginContext | `context/PluginContext.tsx` | Active | Plugin loading, dev mode support |
| ModuleLoader | `utils/moduleLoader.ts` | Active | Dynamic ES module loading |
| WorkflowLoader | `components/WorkflowLoader.tsx` | Active | Mount/unmount plugins |

### SDK Exports (packages/plugin-sdk/src/)

| Export | Location | Status | Notes |
|--------|----------|--------|-------|
| Types | `types/` | Partial | Needs consolidation with shell types |
| Hooks | `hooks/` | Partial | useShell, useIntegration exist |
| Integrations | `integrations/` | Skeleton | OpenAI, S3, SendGrid stubs |
| Utils | `utils/` | Minimal | API client, validation |

### Plugin Patterns (Duplicated Logic)

| Pattern | Found In | Action |
|---------|----------|--------|
| Mount boilerplate | All 7 plugins | Extract to SDK helper |
| ShellContext storage | All 7 plugins | Provide via SDK context |
| MemoryRouter setup | All 7 plugins | Extract to SDK wrapper |
| Loading states | All 7 plugins | Move to @naap/ui |
| Error states | All 7 plugins | Move to @naap/ui |
| Search/filter UI | 5+ plugins | Move to @naap/ui |
| Toast notifications | Settings, plugins | Centralize in shell |
| API fetch patterns | All 7 plugins | Provide SDK API client |

### Type Inconsistencies

| Location | Issue |
|----------|-------|
| `shell-web/ShellContext.tsx` | Uses `UserContext` from `@naap/types` |
| `plugin-sdk/types/context.ts` | Defines `ShellUser` (different shape) |
| Plugins | Import from `@naap/types`, not SDK |

---

## Compatibility Requirements

### Current Plugin Contract (v1)

```typescript
// What plugins currently expect
interface ShellContext {
  authToken: () => Promise<string>;
  user: UserContext;
  navigate: (path: string) => void;
  eventBus: Emitter<ShellEvents>;
  theme: ThemeTokens;
  isDark: boolean;
  toggleTheme: () => void;
  isSidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

interface WorkflowManifest {
  name: string;
  version: string;
  routes: string[];
  mount(container: HTMLElement, context: ShellContext): () => void;
}
```

### Target Plugin Contract (v2)

```typescript
// Enhanced contract with generalized services
interface ShellContext {
  // Auth (enhanced)
  auth: IAuthService;
  
  // Navigation (same)
  navigate: (path: string) => void;
  
  // Event bus (typed)
  eventBus: IEventBus;
  
  // Theme (same)
  theme: IThemeService;
  
  // NEW: Notifications
  notifications: INotificationService;
  
  // NEW: Integrations
  integrations: IIntegrationService;
  
  // NEW: Logging
  logger: ILoggerService;
  
  // NEW: Permissions
  permissions: IPermissionService;
}
```

### Adapter Strategy

1. Create `CompatibilityShellContext` that maps v1 → v2
2. Deprecate v1 fields with console warnings
3. Provide migration guide for plugin authors
4. Remove v1 compatibility in major version

---

## Baseline Snapshots

### API Endpoints (base-svc)

- `GET /api/v1/base/plugins` - List plugins
- `GET /api/v1/base/plugins/personalized` - User-specific plugins
- `POST /api/v1/base/user/preferences` - Save preferences
- `GET /api/v1/integrations` - List integrations
- `POST /api/v1/integrations/:type/configure` - Configure integration
- `POST /api/v1/integrations/:type/call` - Proxy integration call

### Plugin Loading Flow

1. Shell starts → PluginProvider fetches plugins from API
2. Routes generated dynamically from plugin manifests
3. WorkflowLoader mounts plugin when route matches
4. Plugin receives ShellContext, renders in container
5. Plugin unmounts when route changes

---

## Risk Areas

| Risk | Mitigation |
|------|------------|
| Breaking existing plugins | Compatibility adapters |
| Type mismatches | Single source of truth in SDK |
| Performance regression | Benchmark before/after |
| Missing functionality | Comprehensive test coverage |

---

## Phase 0 Deliverables

- [x] Inventory document (this file)
- [x] Compatibility adapter layer (packages/plugin-sdk/src/compat/)
- [x] Service interfaces defined (packages/plugin-sdk/src/types/services.ts)
- [ ] Snapshot tests for current behavior
- [ ] Migration checklist for plugins
