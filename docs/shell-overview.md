# Shell Application Overview

## Executive Summary

The NAAP Shell is the core host application that provides a unified platform for running micro-frontend (MFE) plugins. It implements a modular architecture following SOLID principles, enabling plugins to leverage shared services without implementing them independently.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Shell Application                          │
├──────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │   Auth UI    │  │  Plugin UI   │  │    Admin UI              │  │
│  │  Login/Reg   │  │  Settings    │  │  User Mgmt / Audit       │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   Shell Context (V2)                         │   │
│  │  ┌─────────┐ ┌───────┐ ┌────────┐ ┌───────┐ ┌─────────────┐ │   │
│  │  │  Auth   │ │ Theme │ │ Logger │ │ Events│ │Notifications│ │   │
│  │  └─────────┘ └───────┘ └────────┘ └───────┘ └─────────────┘ │   │
│  │  ┌────────────┐ ┌─────────────┐ ┌─────────────────────────┐ │   │
│  │  │ Permission │ │ Integration │ │   Navigation Service    │ │   │
│  │  └────────────┘ └─────────────┘ └─────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Plugin Context                            │   │
│  │  Plugin Registry │ User Preferences │ Dynamic Module Loader  │   │
│  └──────────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────────┤
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐           │
│  │ Plugin A  │ │ Plugin B  │ │ Plugin C  │ │    ...    │           │
│  │ (MFE)     │ │ (MFE)     │ │ (MFE)     │ │           │           │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘           │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Backend Services                            │
├─────────────────────────────────────────────────────────────────────┤
│  base-svc (Port 4000)                                               │
│  ├── Authentication (Email/Password, OAuth, Session)               │
│  ├── RBAC (Roles, Permissions, Delegation)                         │
│  ├── Plugin Registry (Packages, Versions, Installations)           │
│  ├── Secret Vault (Encrypted credentials, API key mapping)         │
│  ├── Integration Proxy (AI, Storage, Email)                        │
│  ├── Audit Logging (All sensitive operations)                      │
│  └── Plugin Lifecycle (Install/Upgrade/Uninstall events)           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implemented Features

### 1. Authentication System ✅ **Fully Implemented**

| Feature | Status | Location |
|---------|--------|----------|
| Email/Password Registration | ✅ | `POST /api/v1/auth/register` |
| Email/Password Login | ✅ | `POST /api/v1/auth/login` |
| OAuth (Google, GitHub) | ✅ | `GET /api/v1/auth/oauth/:provider` |
| Session Management | ✅ | JWT tokens with validation |
| Login/Register UI | ✅ | `apps/web-next/src/app/(auth)/` |
| Protected Routes | ✅ | `ProtectedRoute` component |

**Usage:**
```tsx
import { useAuth } from '../context/AuthContext';

function MyComponent() {
  const { user, isAuthenticated, login, logout, hasRole } = useAuth();
  
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (!hasRole('gateway-manager:admin')) return <AccessDenied />;
  
  return <AdminPanel user={user} />;
}
```

### 2. Role-Based Access Control (RBAC) ✅ **Fully Implemented**

| Feature | Status | Description |
|---------|--------|-------------|
| System Roles | ✅ | `system:root`, `system:admin`, `system:operator`, `system:viewer` |
| Plugin Roles | ✅ | `<plugin>:admin`, `<plugin>:user` per plugin |
| Role Assignment | ✅ | System admin can assign roles via UI |
| Delegated Admin | ✅ | Plugin admins manage their own plugin users |
| Permission Checking | ✅ | `hasRole()`, `hasPermission()` |
| Audit Logging | ✅ | All role changes logged |

**Role Hierarchy:**
```
system:root (database-only)
    └── system:admin (can manage users, plugins)
        └── system:operator (infrastructure operations)
            └── system:viewer (read-only)

gateway-manager:admin
    └── gateway-manager:user
```

### 3. Plugin Management ✅ **Fully Implemented**

| Feature | Status | Description |
|---------|--------|-------------|
| Plugin Registry | ✅ | Database-backed plugin metadata |
| Plugin Installation | ✅ | Install from marketplace |
| Plugin Uninstallation | ✅ | Remove installed plugins |
| User Preferences | ✅ | Per-user plugin visibility/order |
| Dynamic Loading | ✅ | Runtime UMD/CDN loading |
| Sidebar Integration | ✅ | Auto-generated from plugin config |
| **Multi-Tenant Support** | ✅ | Virtual installations with isolated config |

### 3.1 Multi-Tenant Plugin Architecture ✅ **NEW**

| Feature | Status | Description |
|---------|--------|-------------|
| Physical Deployments | ✅ | Single deployment per plugin (one per platform) |
| Virtual Installations | ✅ | Per-user installation with isolated config |
| Lazy Provisioning | ✅ | First user triggers actual deployment |
| Reference Counting | ✅ | Cleanup when last user uninstalls |
| Tenant Configuration | ✅ | Per-user settings (encrypted secrets) |
| Tenant Middleware | ✅ | Request context with tenant info |

**Database Models:**
- `PluginDeployment`: Physical deployment of a plugin (one per platform)
- `TenantPluginInstall`: Per-user virtual installation
- `TenantPluginConfig`: User-specific configuration

**API Endpoints:**
- `GET /api/v1/tenant/installations` - List user's virtual installations
- `POST /api/v1/tenant/installations` - Create virtual installation
- `DELETE /api/v1/tenant/installations/:id` - Virtual uninstall
- `GET/PUT /api/v1/tenant/installations/:id/config` - Tenant configuration
- `GET /api/v1/deployments` - List physical deployments (admin)
- `GET /api/v1/deployments/stats` - Deployment statistics (admin)

**Plugin Manifest Structure:**
```typescript
interface PluginManifest {
  name: string;                    // Unique identifier
  displayName: string;             // UI display name
  version: string;                 // Semver
  description?: string;
  icon?: string;                   // Lucide icon name
  category: PluginCategory;
  author?: { name: string; email?: string };
  routes: PluginRoute[];           // Frontend routes
  backend?: BackendConfig;         // Backend requirements
  rbac?: PluginRBAC;              // Role definitions
}
```

### 4. Shared Frontend Services ✅ **Fully Implemented**

All services are accessible via `ShellContextV2`:

| Service | Status | Description |
|---------|--------|-------------|
| `auth` | ✅ | User authentication state and methods |
| `notifications` | ✅ | Toast notifications (success, error, info, warning) |
| `eventBus` | ✅ | Inter-plugin communication |
| `theme` | ✅ | Light/dark mode with CSS variables |
| `logger` | ✅ | Structured logging with context |
| `permissions` | ✅ | Permission checking |
| `integrations` | ✅ | AI, Storage, Email service facades |
| `navigate` | ✅ | Programmatic navigation with events |

**Usage via Plugin SDK:**
```tsx
import { useShell } from '@naap/plugin-sdk';

function PluginComponent() {
  const shell = useShell();
  
  // Use shared services
  shell.notifications.success('Operation completed!');
  shell.eventBus.emit('plugin:data-updated', { id: 123 });
  shell.navigate('/gateway-manager/details/1');
}
```

### 5. Integration Services ⚠️ **Partially Implemented**

| Integration | Status | Notes |
|-------------|--------|-------|
| AI (OpenAI) | ⚠️ | Proxy implemented, needs API key config |
| Storage (S3) | ⚠️ | Proxy implemented, needs credentials |
| Email (SendGrid) | ⚠️ | Proxy implemented, needs API key |

Backend integration endpoints exist at `/api/v1/integrations/:provider/*`. Services use the Secret Vault to resolve credentials.

### 6. Secret Vault ✅ **Fully Implemented**

| Feature | Status | Description |
|---------|--------|-------------|
| Encrypted Storage | ✅ | AES-256-GCM encryption |
| CRUD Operations | ✅ | Store, retrieve, rotate, delete |
| Key Mappings | ✅ | Map global keys to plugins |
| Scoped Secrets | ✅ | Global vs plugin-specific |

**Backend API:**
- `POST /api/v1/secrets` - Store a secret
- `GET /api/v1/secrets` - List secrets (metadata only)
- `POST /api/v1/secrets/:key/rotate` - Rotate secret
- `DELETE /api/v1/secrets/:key` - Delete secret

### 7. User Management UI ✅ **Fully Implemented**

Accessible at `/admin/users` for `system:admin` users:

| Feature | Status |
|---------|--------|
| View all users | ✅ |
| Search/filter users | ✅ |
| Assign roles | ✅ |
| Revoke roles | ✅ |
| View all roles | ✅ |
| Audit log viewer | ✅ |

---

## Service Interfaces (Plugin SDK)

Plugins should use these interfaces from `@naap/plugin-sdk`:

### INotificationService
```typescript
interface INotificationService {
  success(message: string, options?: NotificationOptions): void;
  error(message: string, options?: NotificationOptions): void;
  info(message: string, options?: NotificationOptions): void;
  warning(message: string, options?: NotificationOptions): void;
  dismiss(id: string): void;
  dismissAll(): void;
}
```

### IAuthService
```typescript
interface IAuthService {
  getUser(): AuthUser | null;
  getToken(): Promise<string>;
  hasRole(role: string): boolean;
  hasPermission(resource: string, action: string): boolean;
  isAuthenticated(): boolean;
  onAuthStateChange(callback: (user: AuthUser | null) => void): () => void;
}
```

### IEventBus
```typescript
interface IEventBus {
  emit<T>(event: string, data?: T): void;
  on<T>(event: string, callback: (data: T) => void): () => void;
  off<T>(event: string, callback: (data: T) => void): void;
  once<T>(event: string, callback: (data: T) => void): () => void;
}
```

### IIntegrationService
```typescript
interface IIntegrationService {
  ai: IAIService;       // OpenAI completions, chat, embeddings
  storage: IStorageService;  // S3 upload, download, list
  email: IEmailService;      // SendGrid send, templates
  isConfigured(type: 'ai' | 'storage' | 'email'): boolean;
}
```

### ITenantService (Multi-Tenant)
```typescript
interface ITenantService {
  // List user's virtual installations
  listInstallations(): Promise<TenantInstallation[]>;
  
  // Get installation by plugin name
  getInstallationByPlugin(pluginName: string): Promise<TenantInstallation | null>;
  
  // Install a plugin (virtual installation)
  install(packageName: string, config?: Record<string, unknown>): Promise<{
    installation: TenantInstallation;
    isFirstInstall: boolean;
  }>;
  
  // Uninstall (virtual - cleanup only if last user)
  uninstall(installId: string): Promise<{ success: boolean; shouldCleanup: boolean }>;
  
  // Get/update tenant-specific configuration
  getConfig(installId: string): Promise<TenantConfig>;
  updateConfig(installId: string, config: Partial<TenantConfig>): Promise<TenantConfig>;
}
```

---

## File Structure

```
apps/web-next/                   # Next.js 15 Shell (migrated from shell-web)
├── src/
│   ├── app/                     # Next.js App Router pages
│   │   ├── (auth)/              # Auth pages (login, register, etc.)
│   │   ├── (dashboard)/         # Dashboard pages
│   │   │   ├── admin/           # Admin UI pages
│   │   │   ├── dashboard/       # Dashboard home
│   │   │   ├── plugins/         # Plugin loader pages
│   │   │   └── settings/        # Settings pages
│   │   └── api/                 # API routes
│   │       └── v1/              # All API endpoints
│   ├── components/              # React components
│   │   ├── Layout.tsx           # Sidebar, TopBar, main layout
│   │   ├── PluginLoader.tsx     # Dynamic UMD plugin loader
│   │   └── ...
│   ├── contexts/                # React contexts
│   │   └── shell-context.tsx    # Unified shell context (V2)
│   ├── lib/                     # Utilities
│   │   ├── api/                 # API utilities
│   │   ├── plugins/             # Plugin loading utilities
│   │   └── ...
│   └── middleware.ts            # Auth & route middleware

services/base-svc/
├── src/
│   ├── server.ts               # Express API server
│   └── services/
│       ├── auth.ts             # Authentication logic
│       ├── rbac.ts             # Role-based access control
│       ├── delegation.ts       # Delegated admin
│       ├── lifecycle.ts        # Plugin lifecycle + audit
│       ├── secrets.ts          # Secret vault
│       ├── encryption.ts       # AES encryption
│       └── ...

packages/plugin-sdk/
├── src/
│   ├── types/
│   │   ├── manifest.ts         # Plugin manifest types
│   │   ├── services.ts         # Service interfaces
│   │   └── context.ts          # Shell context types
│   ├── hooks/
│   │   ├── useShell.ts         # Access shell context
│   │   └── usePluginConfig.ts  # Plugin configuration
│   ├── components/
│   │   ├── RequireRole.tsx     # Role-based rendering
│   │   └── PluginAdminPanel.tsx # Admin panel scaffold
│   └── utils/
│       ├── validation.ts       # Manifest validation
│       └── api.ts              # API client factories
```

---

## Recently Completed Features (Production Readiness Update)

### Security Hardening - COMPLETED

| Feature | Status | Description |
|---------|--------|-------------|
| **Password Reset Flow** | DONE | `POST /api/v1/auth/forgot-password` + UI pages |
| **Email Verification** | DONE | `POST /api/v1/auth/verify-email` + verification tokens |
| **Rate Limiting** | DONE | 5 req/min for auth endpoints, 429 response |
| **API URL Configuration** | DONE | Centralized in `config/api.ts`, configurable via env |

### Context Consolidation - COMPLETED

| Feature | Status | Description |
|---------|--------|-------------|
| **V1 Context Removed** | DONE | Deleted `ShellContext.tsx`, using V2 only |
| **Compatibility Adapter** | DONE | `contextAdapter.ts` bridges V1 plugins to V2 context |
| **SDK Updated** | DONE | V1 hooks marked `@deprecated` in plugin-sdk |
| **Hardcoded URLs Removed** | DONE | All frontend files use `API_URL` from config |

### Admin UI - COMPLETED

| Feature | Status | Location |
|---------|--------|----------|
| **Secret Management** | DONE | `/admin/secrets` - Create, rotate, delete secrets |
| **Integrations Dashboard** | DONE | `/admin/integrations` - View and test integrations |

### Plugin Examples - COMPLETED

| Example | Location | Description |
|---------|----------|-------------|
| **Hello World** | `examples/hello-world/` | Minimal frontend-only plugin |
| **Todo List** | `examples/todo-list/` | Full-stack with RBAC |
| **Examples README** | `examples/README.md` | Setup guide and templates |

---

## Recently Completed Features (Phase 1-3)

### Security Hardening - COMPLETED

| Feature | Status | Description |
|---------|--------|-------------|
| **CSRF Protection** | DONE | Token middleware in base-svc, included in all auth requests |
| **Session Expiry UI** | DONE | Modal warning 5 min before expiry with refresh/logout |
| **Account Lockout** | DONE | Lock after 5 failed attempts for 30 minutes |

### Plugin Lifecycle - COMPLETED

| Feature | Status | Description |
|---------|--------|-------------|
| **Plugin Health Monitoring** | DONE | `PluginHealthService` tracks load times, retries, recovery |
| **Plugin Dependency Resolution** | DONE | Topological sort, missing dependency warnings |
| **Plugin Data Migration** | DONE | `PluginMigration` model, SDK utilities in `@naap/plugin-sdk` |

### Real-time Features - COMPLETED

| Feature | Status | Description |
|---------|--------|-------------|
| **WebSocket Server** | DONE | `ws://localhost:4000/ws` with auth and event broadcast |
| **API Standardization** | DONE | Response helpers: `success()`, `error()`, error codes |
| **E2E Tests** | DONE | Playwright setup with auth, plugin, RBAC tests |

---

## Remaining Gaps

### Low Priority / Future

| Feature | Priority | Description |
|---------|----------|-------------|
| **Multi-tenancy** | Low | No organization/workspace isolation |
| **i18n/Localization** | Low | No internationalization support |

### Technical Debt - Reduced

| Issue | Status |
|-------|--------|
| V1/V2 Context Duplication | RESOLVED - V1 removed, adapter for backward compat |
| Hardcoded API URLs | RESOLVED - Centralized config |
| Missing TypeScript Strict Mode | Ongoing - Some `any` types remain |
| Inconsistent API Responses | RESOLVED - Standard helpers available |

---

## Recommended Next Steps

All planned phases (Security, Plugin Lifecycle, Real-time) are now complete. Recommended next steps:

### Future Enhancements (Low Priority)
1. Multi-tenancy / Organization support
2. Internationalization (i18n)
3. TypeScript strict mode adoption

---

## Marketplace Plugins

The following plugins are available in the marketplace and seeded as pre-installed:

| Plugin | Category | Description |
|--------|----------|-------------|
| Gateway Manager | monitoring | Manage AI gateway infrastructure |
| Orchestrator Manager | monitoring | Monitor orchestrators on Livepeer |
| Capacity Planner | monitoring | Plan and manage capacity |
| Network Analytics | analytics | Comprehensive network metrics |
| Community Hub | social | Forum and discussions |
| Developer API Manager | developer | API key management |
| My Wallet | finance | MetaMask wallet and staking |

## Plugin Examples

Two example plugins are available in the `examples/` directory:

| Example | Description | Location |
|---------|-------------|----------|
| **Hello World** | Minimal frontend-only plugin | `examples/hello-world/` |
| **Todo List** | Full-stack with backend and RBAC | `examples/todo-list/` |

See [examples/README.md](../examples/README.md) for setup instructions.

---

## Seeded Test Users

| Email | Password | Role |
|-------|----------|------|
| admin@livepeer.org | livepeer | system:admin |
| gateway@livepeer.org | livepeer | gateway-manager:admin |
| orchestrator@livepeer.org | livepeer | orchestrator-manager:admin |
| capacity@livepeer.org | livepeer | capacity-planner:admin |
| analytics@livepeer.org | livepeer | network-analytics:admin |
| marketplace@livepeer.org | livepeer | marketplace:admin |
| community@livepeer.org | livepeer | community:admin |
| developer@livepeer.org | livepeer | developer-api:admin |
| wallet@livepeer.org | livepeer | my-wallet:admin |
| viewer@livepeer.org | livepeer | system:viewer |

---

## Quick Start for Plugin Developers

### 1. Access Shell Services

```tsx
import { useShell } from '@naap/plugin-sdk';

export function MyPluginComponent() {
  const { auth, notifications, eventBus, navigate, theme } = useShell();
  
  const handleAction = async () => {
    if (!auth.hasRole('my-plugin:admin')) {
      notifications.error('Admin access required');
      return;
    }
    
    try {
      await doSomething();
      notifications.success('Action completed!');
      eventBus.emit('my-plugin:action-completed', { timestamp: Date.now() });
    } catch (error) {
      notifications.error('Action failed: ' + error.message);
    }
  };
  
  return (
    <button onClick={handleAction}>
      Do Action
    </button>
  );
}
```

### 2. Protect Routes by Role

```tsx
import { RequireRole } from '@naap/plugin-sdk';

export function AdminSection() {
  return (
    <RequireRole role="my-plugin:admin" fallback={<AccessDenied />}>
      <AdminPanel />
    </RequireRole>
  );
}
```

### 3. Use Integration Services

```tsx
import { useShell } from '@naap/plugin-sdk';

export function AIChat() {
  const { integrations, notifications } = useShell();
  
  const handleSubmit = async (prompt: string) => {
    if (!integrations.isConfigured('ai')) {
      notifications.warning('AI not configured. Contact admin.');
      return;
    }
    
    const result = await integrations.ai.complete(prompt, {
      model: 'gpt-4',
      maxTokens: 1000,
    });
    
    return result.content;
  };
}
```

### 4. Access Tenant Configuration (Multi-Tenant)

```tsx
import { useTenant, usePluginInstallation, usePluginTenantConfig } from '@naap/plugin-sdk';

export function PluginWithTenantConfig() {
  // Get the tenant service
  const tenant = useTenant();
  
  // Get this plugin's installation for the current user
  const { installation, loading } = usePluginInstallation('my-plugin');
  
  // Get the user's configuration for this plugin
  const { config, updateConfig } = usePluginTenantConfig(installation?.id);
  
  const handleSaveApiKey = async (apiKey: string) => {
    await updateConfig({
      settings: { ...config?.settings, apiKey },
    });
  };
  
  if (loading) return <Loading />;
  
  return (
    <div>
      <p>Your API Key: {config?.settings?.apiKey || 'Not set'}</p>
      <button onClick={() => handleSaveApiKey('new-key')}>
        Update API Key
      </button>
    </div>
  );
}
```

---

## Conclusion

The NAAP Shell is a **production-ready** foundation for building plugin-based applications with:

**Authentication & Security:**
- ✅ Email/password and OAuth authentication
- ✅ Password reset and email verification flows
- ✅ Rate limiting on authentication endpoints
- ✅ CSRF protection with token validation
- ✅ Session expiry notification with auto-refresh
- ✅ Account lockout after failed attempts

**Plugin Management:**
- ✅ Dynamic plugin loading with UMD/CDN bundles
- ✅ Plugin health monitoring with retry logic
- ✅ Plugin dependency resolution
- ✅ Plugin data migration framework
- ✅ Backward compatibility via V1 adapter

**Real-time & Developer Experience:**
- ✅ WebSocket server for real-time events
- ✅ Standardized API response format
- ✅ E2E test suite with Playwright
- ✅ Example plugins for onboarding

**Infrastructure:**
- ✅ Secret vault for encrypted credentials
- ✅ Admin UI for users, secrets, integrations
- ✅ Centralized API configuration
- ✅ Audit logging for all operations

All planned phases (Security, Plugin Lifecycle, Real-time) are complete.

Refer to:
- [Plugin Developer Guide](./plugin-developer-guide.md) for plugin development
- [Examples README](../examples/README.md) for example plugins
