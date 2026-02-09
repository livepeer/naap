# NAAP Plugin SDK - Developer Guide

**Version:** 2.0.0
**Last Updated:** February 6, 2026

The complete guide for building plugins on the NAAP (Network as a Platform) ecosystem.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Core Concepts](#core-concepts)
3. [API Reference](#api-reference)
4. [CLI Reference](#cli-reference)
5. [Cookbook](#cookbook)
6. [Migration Guide](#migration-guide)
7. [Troubleshooting](#troubleshooting)

---

# Quick Start

## Prerequisites

- Node.js 18+
- npm or yarn
- Basic knowledge of React and TypeScript

## Create Your First Plugin

```bash
# Install the SDK globally (or use npx)
npm install -g @naap/plugin-sdk

# Create a new plugin
naap-plugin create my-first-plugin

# Follow the prompts to select:
# - Template: full-stack, frontend-only, or backend-only
# - Category: analytics, monitoring, social, developer, productivity

# Enter the plugin directory
cd my-first-plugin

# Start development
naap-plugin dev
```

## Plugin Structure

A full-stack plugin has this directory structure:

```
my-plugin/
├── plugin.json              # Plugin manifest (required)
├── frontend/
│   ├── package.json
│   ├── vite.config.ts       # Vite config with UMD/CDN build
│   └── src/
│       ├── App.tsx          # Main application component
│       ├── mount.tsx        # Plugin mount/unmount entry point
│       ├── globals.css      # Global styles (Tailwind)
│       └── pages/           # Page components
├── backend/
│   ├── package.json
│   ├── Dockerfile
│   └── src/
│       ├── server.ts        # Express server entry
│       └── routes/          # API routes
└── tests/
    ├── unit/
    └── e2e/
```

## Basic Plugin Example

```typescript
// frontend/src/mount.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ShellProvider } from '@naap/plugin-sdk';
import type { ShellContext } from '@naap/plugin-sdk';
import App from './App';
import './globals.css';

let root: ReturnType<typeof createRoot> | null = null;

export function mount(container: HTMLElement, context: ShellContext) {
  root = createRoot(container);
  root.render(
    <React.StrictMode>
      <ShellProvider value={context}>
        <BrowserRouter basename={context.pluginBasePath}>
          <App />
        </BrowserRouter>
      </ShellProvider>
    </React.StrictMode>
  );
}

export function unmount() {
  if (root) {
    root.unmount();
    root = null;
  }
}
```

```typescript
// frontend/src/App.tsx
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';

export function App() {
  return (
    <div className="min-h-screen bg-background">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;
```

---

# Core Concepts

## Architecture Overview

NAAP is a micro-frontend platform where plugins extend the core shell application. Each plugin:

- Has its own frontend (React) and optional backend (Express/Node.js)
- Integrates seamlessly with the shell's authentication, navigation, and theming
- Can communicate with other plugins via an event bus
- Is loaded dynamically using UMD/CDN

```
┌─────────────────────────────────────────────────────────────────────┐
│                           NAAP Shell                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │
│  │   Auth   │  │  Theme   │  │   Nav    │  │    Event Bus     │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      Plugin Container                        │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │   │
│  │  │  Plugin A   │  │  Plugin B   │  │  Plugin C   │   ...    │   │
│  │  │  (React)    │  │  (React)    │  │  (React)    │          │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘          │   │
│  └─────────┼────────────────┼────────────────┼──────────────────┘   │
└────────────┼────────────────┼────────────────┼──────────────────────┘
             │                │                │
             ▼                ▼                ▼
      ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
      │  Backend A   │ │  Backend B   │ │  Backend C   │
      │  (Express)   │ │  (Express)   │ │  (Express)   │
      └──────────────┘ └──────────────┘ └──────────────┘
```

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Shell** | The host application providing authentication, navigation, theming |
| **Plugin** | An independent module with frontend UI and optional backend API |
| **ShellContext** | React context providing access to shell services |
| **UMD/CDN** | Plugin loading system that loads UMD bundles at runtime from a CDN or local server |
| **Plugin Manifest** | `plugin.json` file describing the plugin's metadata and configuration |

## Plugin Manifest

The `plugin.json` file is the heart of your plugin configuration:

```json
{
  "name": "my-plugin",
  "displayName": "My Plugin",
  "version": "1.0.0",
  "description": "A brief description of what the plugin does",
  "category": "productivity",

  "frontend": {
    "entry": "./frontend/dist/production/my-plugin.js"
  },

  "backend": {
    "entry": "./backend/dist/server.js",
    "port": 3001,
    "healthCheck": "/healthz"
  },

  "permissions": [
    {
      "role": "team:member",
      "actions": ["read", "create"]
    },
    {
      "role": "team:admin",
      "actions": ["read", "create", "update", "delete"]
    }
  ],

  "settings": {
    "schema": {
      "type": "object",
      "properties": {
        "refreshInterval": {
          "type": "number",
          "description": "Data refresh interval in seconds",
          "default": 30
        }
      }
    }
  }
}
```

### Manifest Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | URL-safe identifier (lowercase, hyphens only) |
| `displayName` | Yes | Human-readable name |
| `version` | Yes | Semantic version (e.g., "1.0.0") |
| `description` | Yes | Brief description |
| `category` | Yes | One of: analytics, monitoring, social, developer, productivity |
| `frontend` | No | Frontend configuration |
| `backend` | No | Backend configuration |
| `permissions` | No | Role-based permissions |
| `settings` | No | Plugin settings schema |

## Multi-Tenancy Architecture

NAAP implements a **dual-tenant model** supporting both individual users and teams.

### Tenant Types

| Tenant Type | Scope | Use Case |
|-------------|-------|----------|
| **User Tenant** | Individual user | Personal plugins, solo workflows |
| **Team Tenant** | Organization/Team | Shared plugins, collaborative workflows |

### Data Model

```
┌─────────────────────────────────────────────────────────────────┐
│                      USER TENANT SCOPE                          │
├─────────────────────────────────────────────────────────────────┤
│  User                                                           │
│    └── TenantPluginInstall (userId, pluginId)                  │
│          └── TenantPluginConfig (personalConfig)               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      TEAM TENANT SCOPE                          │
├─────────────────────────────────────────────────────────────────┤
│  Team (owner, slug)                                             │
│    ├── TeamMember (userId, role: owner|admin|member|viewer)    │
│    └── TeamPluginInstall (teamId, pluginId)                    │
│          ├── sharedConfig (team-wide settings)                 │
│          └── TeamMemberPluginAccess (memberId, installId)      │
│                ├── visible, canUse, canConfigure               │
│                └── personalConfig (member overrides)           │
└─────────────────────────────────────────────────────────────────┘
```

### Using Team Context in Plugins

```tsx
import { useTeam, useTeamRole, useTeamPluginConfig } from '@naap/plugin-sdk';

function MyPluginPage() {
  const { currentTeam, teams, switchTeam } = useTeam();
  const { role, hasPermission } = useTeamRole();
  const { config, updatePersonalConfig } = useTeamPluginConfig();

  if (!currentTeam) {
    return <PersonalView />;
  }

  return (
    <div>
      <h1>Team: {currentTeam.name}</h1>
      <p>Your role: {role}</p>
      {hasPermission('configure') && <SettingsButton />}
    </div>
  );
}
```

## Database Architecture

NAAP uses a **unified database architecture** with PostgreSQL multi-schema support:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PostgreSQL Database                              │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    'public' schema                            │  │
│  │  Users, Teams, Auth, Sessions, Plugin Registry, Marketplace  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐          │
│  │plugin_community│ │ plugin_wallet  │ │plugin_dashboard│   ...    │
│  │   Posts, Tags  │ │  Transactions  │ │   Dashboards   │          │
│  │   Comments     │ │  Staking       │ │   Preferences  │          │
│  └────────────────┘ └────────────────┘ └────────────────┘          │
└─────────────────────────────────────────────────────────────────────┘
```

### Using the Database in Your Plugin

```typescript
// Import from the unified database package
import { prisma } from '@naap/database';

// Access your plugin's tables
const items = await prisma.myAppItem.findMany({
  where: { teamId: team.id },
});

// Transactions work across schemas
await prisma.$transaction([
  prisma.myAppItem.create({ data: { ... } }),
  prisma.auditLog.create({ data: { action: 'item_created', ... } }),
]);
```

---

# API Reference

## Core APIs

### `createPlugin(options)`

Creates a plugin module for UMD/CDN loading.

```typescript
import { createPlugin } from '@naap/plugin-sdk';

export default createPlugin({
  manifest: {
    name: 'myPlugin',
    displayName: 'My Plugin',
    version: '1.0.0',
    description: 'Description',
    author: 'Your Name',
    icon: 'Box',
  },
  mount: () => import('./App'),
});
```

### `createPluginMount(Component, options?)`

Wraps a React component with plugin error boundary and lifecycle management.

```typescript
import { createPluginMount } from '@naap/plugin-sdk';
import { MyApp } from './MyApp';

export default createPluginMount(MyApp, {
  onMount: (shell) => console.log('Plugin mounted', shell),
  onUnmount: () => console.log('Plugin unmounted'),
});
```

## React Hooks

### Authentication Hooks

#### `useAuth()`

Access authentication state and methods.

```typescript
import { useAuth } from '@naap/plugin-sdk';

function MyComponent() {
  const { user, isAuthenticated, hasRole, hasPermission } = useAuth();

  if (!isAuthenticated) {
    return <div>Please log in</div>;
  }

  return (
    <div>
      <h1>Welcome {user?.displayName}</h1>
      {hasRole('admin') && <AdminPanel />}
    </div>
  );
}
```

**Returns:**
```typescript
{
  user: AuthUser | null;
  isAuthenticated: boolean;
  token: string | null;
  hasRole: (role: string) => boolean;
  hasPermission: (resource: string, action: string) => boolean;
}
```

#### `useUser()`

Get current user information.

```typescript
const { user, isLoading } = useUser();
```

#### `useIsAuthenticated()`

Check if user is authenticated.

```typescript
const isAuthenticated = useIsAuthenticated(); // boolean
```

#### `useUserHasRole(role: string)`

Check if user has specific role.

```typescript
const isAdmin = useUserHasRole('admin'); // boolean
```

#### `useUserHasPermission(resource: string, action: string)`

Check if user has specific permission.

```typescript
const canDelete = useUserHasPermission('posts', 'delete'); // boolean
```

### Shell Integration Hooks

#### `useShell()`

Access shell services and APIs.

```typescript
import { useShell } from '@naap/plugin-sdk';

function MyComponent() {
  const { services, navigate } = useShell();

  const handleClick = () => {
    services.notifications.success('Action completed!');
    navigate('/dashboard');
  };

  return <button onClick={handleClick}>Do Something</button>;
}
```

#### `useNotify()`

Shortcut for notification service.

```typescript
import { useNotify } from '@naap/plugin-sdk';

function SaveButton() {
  const notify = useNotify();

  const handleSave = async () => {
    try {
      await saveData();
      notify.success('Data saved successfully!');
    } catch (error) {
      notify.error('Failed to save data');
    }
  };

  return <button onClick={handleSave}>Save</button>;
}
```

#### `useNavigate()`

Get navigation function.

```typescript
import { useNavigate } from '@naap/plugin-sdk';

function BackButton() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/dashboard')}>Back</button>;
}
```

### API Client Hooks

#### `useApiClient()`

Get configured API client with authentication.

```typescript
import { useApiClient } from '@naap/plugin-sdk';

function DataFetcher() {
  const api = useApiClient();

  const fetchData = async () => {
    const response = await api.get('/api/v1/data');
    if (response.success) {
      console.log('Data:', response.data);
    }
  };

  return <button onClick={fetchData}>Fetch Data</button>;
}
```

**Returns:**
```typescript
{
  get: <T>(url: string, options?) => Promise<ApiResponse<T>>;
  post: <T>(url: string, data, options?) => Promise<ApiResponse<T>>;
  put: <T>(url: string, data, options?) => Promise<ApiResponse<T>>;
  delete: <T>(url: string, options?) => Promise<ApiResponse<T>>;
  patch: <T>(url: string, data, options?) => Promise<ApiResponse<T>>;
}
```

#### `usePluginApi()`

Simplified plugin-to-backend communication.

```typescript
import { usePluginApi } from '@naap/plugin-sdk';

function MyComponent() {
  const api = usePluginApi();

  // Automatically routes to your plugin's backend
  const data = await api.get('/items');
  await api.post('/items', { name: 'New Item' });
}
```

#### `useAuthHeaders()`

Get authentication headers for fetch requests.

```typescript
import { useAuthHeaders } from '@naap/plugin-sdk';

function CustomFetch() {
  const headers = useAuthHeaders();

  const fetchData = async () => {
    const response = await fetch('/api/data', { headers });
    return response.json();
  };
}
```

### Plugin Configuration Hooks

#### `usePluginConfig(scope?, options?)`

Unified plugin configuration hook with multi-level support.

```typescript
import { usePluginConfig } from '@naap/plugin-sdk';

interface MyConfig {
  theme: 'light' | 'dark';
  apiKey: string;
  features: string[];
}

function Settings() {
  const { config, updateConfig, loading } = usePluginConfig<MyConfig>('user');

  if (loading) return <div>Loading...</div>;

  const toggleTheme = async () => {
    await updateConfig({
      theme: config?.theme === 'light' ? 'dark' : 'light'
    });
  };

  return (
    <div>
      <p>Current theme: {config?.theme}</p>
      <button onClick={toggleTheme}>Toggle Theme</button>
    </div>
  );
}
```

**Configuration Scopes:**

```typescript
// User-specific config
const { config } = usePluginConfig<MyConfig>('user');

// Team-specific config (requires team context)
const { config } = usePluginConfig<MyConfig>('team');

// Tenant-specific config
const { config } = usePluginConfig<MyConfig>('tenant');

// Global plugin config
const { config } = usePluginConfig<MyConfig>('global');

// Auto-detect: uses team if in team context, else user
const { config } = usePluginConfig<MyConfig>();
```

**Merge Strategies:**

```typescript
// Override: Higher scope replaces lower scope
const { config } = usePluginConfig({ mergeStrategy: 'override' });

// Merge: Shallow merge (default)
const { config } = usePluginConfig({ mergeStrategy: 'merge' });

// Deep: Deep merge of nested objects
const { config } = usePluginConfig({ mergeStrategy: 'deep' });
```

#### `useConfigValue(key, defaultValue?)`

Get a single configuration value.

```typescript
import { useConfigValue } from '@naap/plugin-sdk';

function Feature() {
  const apiKey = useConfigValue<string>('apiKey', '');
  const enabled = useConfigValue<boolean>('features.advanced', false);
}
```

### Event Bus Hooks

#### `usePluginEvent(event?, callback?, options?)`

Type-safe event handling hook for plugin-to-plugin communication.

```typescript
import { usePluginEvent } from '@naap/plugin-sdk';

function MyComponent() {
  // Listen for events
  usePluginEvent('theme:change', (data) => {
    console.log('Theme changed to:', data.mode);
  });

  // Emit events
  const { emit } = usePluginEvent();
  emit('my-plugin:data-updated', { id: '123' });
}
```

#### Request/Response Pattern

```typescript
import { usePluginEvent, useEventRequest, useEventHandler } from '@naap/plugin-sdk';

// Making requests
function ProfileViewer() {
  const { request } = usePluginEvent();

  const loadProfile = async (userId: string) => {
    try {
      const profile = await request<{ id: string }, UserProfile>(
        'user-plugin:get-profile',
        { id: userId },
        { timeout: 5000 }
      );
      console.log('Got profile:', profile);
    } catch (error) {
      if (error.code === 'TIMEOUT') {
        console.error('Request timed out');
      } else if (error.code === 'NO_HANDLER') {
        console.error('No plugin is handling this request');
      }
    }
  };
}

// Handling requests
function UserDataProvider() {
  useEventHandler<{ id: string }, UserProfile>(
    'user-plugin:get-profile',
    async (data) => {
      const user = await fetchUserFromDatabase(data.id);
      return user;
    }
  );
}
```

#### `useEvents()`

Direct access to event bus.

```typescript
import { useEvents } from '@naap/plugin-sdk';
import { useEffect } from 'react';

function DataListener() {
  const events = useEvents();

  useEffect(() => {
    const handler = (data) => console.log('Data updated:', data);
    events.on('data:updated', handler);
    return () => events.off('data:updated', handler);
  }, [events]);
}
```

### Team & Tenant Hooks

#### `useTeam()`

Access team context and configuration.

```typescript
import { useTeam } from '@naap/plugin-sdk';

function TeamSelector() {
  const { currentTeam, teams, switchTeam } = useTeam();

  return (
    <select
      value={currentTeam?.id}
      onChange={(e) => switchTeam(e.target.value)}
    >
      {teams.map(team => (
        <option key={team.id} value={team.id}>
          {team.name}
        </option>
      ))}
    </select>
  );
}
```

#### `useTenant()`

Access tenant context and configuration.

```typescript
const { tenant, config, loading } = useTenant();
```

### Service Hooks

#### `useThemeService()`

Access theme service for dark/light mode.

```typescript
const { theme, toggleTheme, setTheme } = useThemeService();
```

#### `useLogger()`

Access logger service with structured logging.

```typescript
import { useLogger } from '@naap/plugin-sdk';

function DataProcessor() {
  const logger = useLogger();

  const processData = async (data) => {
    logger.info('Processing data', { count: data.length });
    try {
      // Process...
      logger.debug('Data processed successfully');
    } catch (error) {
      logger.error('Processing failed', { error });
    }
  };
}
```

#### `usePermissions()`

Access permission service.

```typescript
const { can, canAll, canAny } = usePermissions();
const canEdit = can('posts', 'update');
```

#### `useIntegrations()`

Access integration services (Storage, AI, Email).

```typescript
import { useIntegrations } from '@naap/plugin-sdk';

function FileUploader() {
  const { storage } = useIntegrations();

  const handleUpload = async (file: File) => {
    const { url } = await storage.upload(file, {
      path: 'uploads/',
      public: true,
    });
    console.log('Uploaded to:', url);
  };

  return <input type="file" onChange={(e) => handleUpload(e.target.files[0])} />;
}
```

### Error Handling Hooks

#### `useError()`

Centralized error handling.

```typescript
const { error, setError, clearError } = useError();
```

#### `useErrorHandler()`

Get error handler function.

```typescript
import { useErrorHandler } from '@naap/plugin-sdk';

function DataLoader() {
  const handleError = useErrorHandler();

  const loadData = async () => {
    try {
      const data = await fetchData();
      return data;
    } catch (error) {
      handleError(error);
    }
  };
}
```

## Type Definitions

### `AuthUser`

```typescript
interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  address: string | null;
  roles: string[];
  permissions: Array<{ resource: string; action: string }>;
}
```

### `PluginManifest`

```typescript
interface PluginManifest {
  name: string;
  displayName: string;
  version: string;
  description?: string;
  author?: string;
  icon?: string;
  routes?: string[];
  permissions?: string[];
  dependencies?: {
    plugins?: Array<{ name: string; version: string; optional?: boolean }>;
    shell?: string;
  };
}
```

### `ApiResponse<T>`

```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  correlationId?: string;
}
```

### `PluginEventMap`

```typescript
interface PluginEventMap {
  'shell:ready': { version: string };
  'auth:login': { userId: string; email?: string };
  'auth:logout': { userId?: string };
  'theme:change': { mode: 'light' | 'dark' };
  'navigation:change': { path: string };
  'team:change': { teamId: string | null };
  [key: string]: unknown;
}
```

### `EventRequestOptions`

```typescript
interface EventRequestOptions {
  timeout?: number;    // Default: 5000ms
  retries?: number;    // Default: 0
  retryDelay?: number; // Default: 1000ms
}
```

## Components

### `PluginErrorBoundary`

React error boundary for plugins.

```typescript
import { PluginErrorBoundary } from '@naap/plugin-sdk';

function MyPlugin() {
  return (
    <PluginErrorBoundary
      fallback={<div>Something went wrong</div>}
      onError={(error) => console.error(error)}
    >
      <MyApp />
    </PluginErrorBoundary>
  );
}
```

### `LoadingSpinner`

Reusable loading spinner.

```typescript
import { LoadingSpinner } from '@naap/plugin-sdk';

if (loading) {
  return <LoadingSpinner size="lg" />;
}
```

### `InlineSpinner`

Inline spinner for buttons/text.

```typescript
import { InlineSpinner } from '@naap/plugin-sdk';

<button disabled={saving}>
  {saving ? <><InlineSpinner /> Saving...</> : 'Save'}
</button>
```

### `LoadingOverlay`

Full-page loading overlay.

```typescript
import { LoadingOverlay } from '@naap/plugin-sdk';

{initializing && <LoadingOverlay message="Initializing plugin..." />}
```

---

# CLI Reference

## Installation

```bash
npm install -g @naap/plugin-sdk
# or use directly via npx:
npx naap-plugin <command>
```

## Development Commands

### `create`

Create a new plugin from template.

```bash
naap-plugin create [name] [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --template <type>` | Template: `full-stack`, `frontend-only`, `backend-only` | Interactive |
| `-c, --category <category>` | Plugin category | Interactive |
| `--skip-git` | Skip git initialization | `false` |
| `--skip-install` | Skip npm install | `false` |

**Examples:**
```bash
naap-plugin create my-dashboard --template full-stack --category analytics
```

### `dev`

Start development server with hot reload.

```bash
naap-plugin dev [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--shell <url>` | Shell application URL | `http://localhost:3000` |
| `-p, --port <port>` | Frontend dev server port | `5173` |
| `--backend-port <port>` | Backend dev server port | `3001` |
| `--with-shell` | Start shell alongside plugin | `false` |

### `test`

Run plugin tests.

```bash
naap-plugin test [options]
```

| Option | Description |
|--------|-------------|
| `--unit` | Run unit tests only |
| `--e2e` | Run E2E tests only |
| `--coverage` | Generate coverage report |
| `--watch` | Watch mode |

### `build`

Build plugin for production.

```bash
naap-plugin build [options]
```

| Option | Description |
|--------|-------------|
| `--analyze` | Analyze bundle size |
| `--skip-validation` | Skip UMD bundle validation |
| `--skip-security` | Skip security scan |

## Publishing Commands

### `package`

Create distributable package.

```bash
naap-plugin package [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <dir>` | Output directory | `./dist` |
| `-f, --format <format>` | Package format: `zip`, `tar`, `oci` | `zip` |

### `publish`

Publish plugin to registry.

```bash
naap-plugin publish [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-r, --registry <url>` | Registry URL | `https://plugins.naap.io` |
| `-t, --tag <tag>` | Version tag | `latest` |
| `--dry-run` | Simulate without uploading | `false` |
| `--access <access>` | Access level: `public`, `private` | `public` |

## Deployment Commands

### `deploy`

Deploy plugin to production.

```bash
naap-plugin deploy [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --strategy <strategy>` | Strategy: `immediate`, `blue-green`, `canary` | `blue-green` |
| `--canary-percent <n>` | Initial canary traffic % | `5` |
| `--auto-rollback` | Enable auto-rollback on failure | `true` |
| `--dry-run` | Show what would be deployed | `false` |

**Deployment Strategies:**

1. **immediate**: Full traffic switch immediately
2. **blue-green**: Zero-downtime switch after health checks pass
3. **canary**: Gradual traffic shift with monitoring

### `rollback`

Rollback to previous version.

```bash
naap-plugin rollback [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-v, --version <version>` | Specific version to rollback to | Previous |
| `-f, --force` | Force without confirmation | `false` |
| `--reason <reason>` | Reason for rollback (for audit) | - |

### `status`

Show plugin deployment status.

```bash
naap-plugin status [options]
```

| Option | Description |
|--------|-------------|
| `-w, --watch` | Watch in real-time |
| `--json` | Output as JSON |

### `logs`

Stream plugin logs.

```bash
naap-plugin logs [options]
```

| Option | Description |
|--------|-------------|
| `-f, --follow` | Follow log output |
| `-n, --lines <n>` | Number of lines |
| `--level <level>` | Filter: `debug`, `info`, `warn`, `error` |
| `--since <duration>` | Show logs since: `1h`, `30m`, `2d` |

## AI-Assisted Development Commands

### `generate`

Generate a complete plugin from a plugin.md specification file.

```bash
naap-plugin generate [spec-file] [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <dir>` | Output directory | Plugin name from spec |
| `--dry-run` | Preview files without writing | `false` |
| `--skip-tests` | Skip test file generation | `false` |
| `--skip-backend` | Skip backend code generation | `false` |
| `--api-key <key>` | Anthropic API key | `ANTHROPIC_API_KEY` env |

**Example:**
```bash
naap-plugin generate specs/expense-tracker.md --output ./plugins/my-plugin
```

### `iterate`

Modify existing plugin code with AI assistance.

```bash
naap-plugin iterate <instruction> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-f, --file <path>` | Target specific file | All source files |
| `-s, --story <id>` | Target specific user story (e.g., US-1) | - |
| `--diff` | Show diff without applying changes | `false` |
| `--dry-run` | Preview changes without applying | `false` |

**Examples:**
```bash
naap-plugin iterate "Add a delete confirmation dialog"
naap-plugin iterate "Add form validation" --file frontend/src/pages/CreateExpense.tsx
naap-plugin iterate "Implement all acceptance criteria" --story US-3
```

## Utility Commands

### `version`

Manage plugin version.

```bash
naap-plugin version [newVersion]
```

```bash
naap-plugin version patch  # 1.0.0 -> 1.0.1
naap-plugin version minor  # 1.0.0 -> 1.1.0
naap-plugin version major  # 1.0.0 -> 2.0.0
naap-plugin version 2.0.0  # Set specific version
```

### `deprecate`

Mark plugin version as deprecated.

```bash
naap-plugin deprecate [version] --message "Use v2.0 instead"
```

### `doctor`

Diagnose development environment issues.

```bash
naap-plugin doctor
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NAAP_REGISTRY_URL` | Registry URL | `https://plugins.naap.io` |
| `NAAP_REGISTRY_TOKEN` | Authentication token | - |
| `NAAP_SHELL_URL` | Shell application URL | `http://localhost:3000` |
| `ANTHROPIC_API_KEY` | Anthropic API key for AI commands | - |

## Exit Codes

| Code | Description |
|------|-------------|
| 0 | Success |
| 1 | General error |
| 2 | Configuration error |
| 3 | Authentication error |
| 4 | Build error |
| 5 | Deployment error |

---

# Cookbook

## Cross-Plugin Communication

### Wallet Balance Display in Dashboard

**my-wallet plugin (provider):**

```tsx
function WalletDataProvider() {
  const [balance, setBalance] = useState(0);

  // Expose wallet data to other plugins
  useEventHandler<void, { balance: number }>(
    'my-wallet:get-balance',
    async () => {
      return { balance };
    }
  );

  // Emit events when balance changes
  const { emit } = usePluginEvent();
  useEffect(() => {
    emit('my-wallet:balance-changed', { balance });
  }, [balance]);
}
```

**my-dashboard plugin (consumer):**

```tsx
function DashboardWalletWidget() {
  const [balance, setBalance] = useState<number | null>(null);
  const getBalance = useEventRequest<void, { balance: number }>('my-wallet:get-balance');

  // Initial load
  useEffect(() => {
    getBalance().then(data => setBalance(data.balance));
  }, []);

  // Listen for updates
  usePluginEvent('my-wallet:balance-changed', (data) => {
    setBalance(data.balance);
  });

  return <div>Balance: {balance ?? 'Loading...'}</div>;
}
```

## Backend-Only Plugins

Backend-only plugins expose APIs for other plugins:

```json
{
  "name": "shared-analytics-service",
  "displayName": "Shared Analytics Service",
  "version": "1.0.0",
  "description": "Provides analytics APIs for other plugins",
  "category": "developer",

  "backend": {
    "entry": "./backend/dist/server.js",
    "port": 3010,
    "healthCheck": "/healthz"
  }
}
```

**Consuming from another plugin:**

```tsx
import { useApiClient } from '@naap/plugin-sdk';

function Dashboard() {
  const api = useApiClient();

  async function trackEvent(eventName: string, data: Record<string, unknown>) {
    await api.post('/api/plugins/shared-analytics-service/analytics/track', {
      event: eventName,
      properties: data,
      pluginSource: 'my-dashboard',
    });
  }
}
```

## Page Component Pattern

```tsx
import React, { useState, useEffect } from 'react';
import { useAuth, useTeam, useNotify, useApiClient } from '@naap/plugin-sdk';
import { Loader2, AlertCircle, Plus } from 'lucide-react';

interface Item {
  id: string;
  name: string;
  createdAt: string;
}

export function ItemList() {
  const { hasPermission } = useAuth();
  const { currentTeam } = useTeam();
  const notify = useNotify();
  const api = useApiClient();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    loadItems();
  }, [currentTeam?.id]);

  async function loadItems() {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get<{ data: Item[] }>('/api/plugin/items');
      setItems(response.data);
    } catch (err) {
      setError('Failed to load items');
      notify.error('Failed to load items');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 p-4 bg-destructive/10 text-destructive rounded-lg">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
          <button onClick={loadItems} className="ml-auto underline">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Items</h1>
        {hasPermission('create') && (
          <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg">
            <Plus className="w-4 h-4" />
            Add Item
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground">No items yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map(item => (
            <li key={item.id} className="p-4 bg-card border border-border rounded-lg">
              {item.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

## Backend Route Pattern

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@naap/database';
import { requirePermission } from '../middleware/auth';

const router = Router();

const CreateItemSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

// GET /api/plugin/items
router.get('/', async (req, res) => {
  try {
    const { team } = req;
    const items = await prisma.item.findMany({
      where: { teamId: team.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: items });
  } catch (error) {
    console.error('Failed to fetch items:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/plugin/items
router.post('/', requirePermission('create'), async (req, res) => {
  try {
    const { user, team } = req;
    const data = CreateItemSchema.parse(req.body);

    const item = await prisma.item.create({
      data: {
        ...data,
        teamId: team.id,
        createdBy: user.id,
      },
    });

    res.status(201).json({ success: true, data: item });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: error.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
```

## Event Naming Conventions

Events follow a namespaced pattern: `namespace:action` or `namespace:entity:action`

### Shell Events (Reserved Prefixes)

| Prefix | Description | Example |
|--------|-------------|---------|
| `shell:` | Shell system events | `shell:ready`, `shell:error` |
| `auth:` | Authentication events | `auth:login`, `auth:logout` |
| `theme:` | Theme changes | `theme:change` |
| `navigation:` | Route changes | `navigation:change` |
| `notification:` | Toast notifications | `notification:show` |
| `team:` | Team context changes | `team:change` |
| `tenant:` | Tenant context changes | `tenant:change` |

### Plugin Events

```typescript
// Good - namespaced to plugin
emit('my-wallet:balance-updated', { balance: 100 });
emit('community:post-created', { postId: '123' });

// Bad - no namespace, could conflict
emit('balance-updated', { balance: 100 });
```

---

# Migration Guide

## SDK 1.x to 2.0

### Breaking Changes Summary

1. **Hook naming changes** - Resolved export conflicts
2. **Unified configuration API** - Single `usePluginConfig()` hook
3. **New type exports** - Fixed type conflicts
4. **Component return types** - Improved TypeScript compatibility

### Hook Naming Changes

#### `useHasRole` → `useUserHasRole`

```typescript
// Before (1.x)
import { useHasRole } from '@naap/plugin-sdk';
const isAdmin = useHasRole('admin');

// After (2.0)
import { useUserHasRole } from '@naap/plugin-sdk';
const isAdmin = useUserHasRole('admin');
```

#### `useHasPermission` → `useUserHasPermission`

```typescript
// Before (1.x)
import { useHasPermission } from '@naap/plugin-sdk';
const canDelete = useHasPermission('posts', 'delete');

// After (2.0)
import { useUserHasPermission } from '@naap/plugin-sdk';
const canDelete = useUserHasPermission('posts', 'delete');
```

### Unified Configuration API

```typescript
// Before (1.x)
import { useUserConfig, useTeamConfig, useGlobalConfig } from '@naap/plugin-sdk';

const userConfig = useUserConfig();
const teamConfig = useTeamConfig();
const config = { ...globalConfig, ...teamConfig, ...userConfig };

// After (2.0)
import { usePluginConfig } from '@naap/plugin-sdk';

// Automatically merges user + team + global configs
const { config, updateConfig, loading } = usePluginConfig();

// Or specify scope explicitly
const { config: userConfig } = usePluginConfig('user');
const { config: teamConfig } = usePluginConfig('team');
```

### Step-by-Step Migration

1. **Update Dependencies**
   ```bash
   npm install @naap/plugin-sdk@^2.0.0
   ```

2. **Update Hook Imports**
   - `useHasRole` → `useUserHasRole`
   - `useHasPermission` → `useUserHasPermission`

3. **Migrate Config Hooks**
   Replace multiple config hooks with `usePluginConfig()`

4. **Test Your Plugin**
   ```bash
   npm run dev
   ```

5. **Check for Warnings**
   SDK 2.0 adds runtime warnings for deprecated API usage.

### Migration Checklist

- [ ] Updated `@naap/plugin-sdk` to `^2.0.0`
- [ ] Replaced `useHasRole` with `useUserHasRole`
- [ ] Replaced `useHasPermission` with `useUserHasPermission`
- [ ] Migrated from separate config hooks to `usePluginConfig()`
- [ ] Tested plugin in dev mode
- [ ] Checked browser console for warnings
- [ ] Tested in both personal and team contexts

---

# Troubleshooting

## Common Issues

### "plugin.json not found"

Run commands from the plugin root directory containing plugin.json.

### "Not authenticated"

Run `naap-plugin login` or set `NAAP_REGISTRY_TOKEN` environment variable.

### "Health checks failed"

Ensure your backend has a `/healthz` endpoint returning 200 OK.

### "Deployment timed out"

Increase timeout with `--timeout` or check backend logs with `naap-plugin logs`.

### "useHasRole is not exported"

Hook was renamed to `useUserHasRole`:
```typescript
- import { useHasRole } from '@naap/plugin-sdk';
+ import { useUserHasRole } from '@naap/plugin-sdk';
```

### "Cannot find module '@naap/plugin-sdk/hooks'"

Direct imports from subpaths are not supported:
```typescript
- import { useAuth } from '@naap/plugin-sdk/hooks';
+ import { useAuth } from '@naap/plugin-sdk';
```

### Config not updating

Make sure to await `updateConfig()`:
```typescript
await updateConfig({ theme: 'dark' });
```

### Team config not loading

Check if you're in a team context:
```typescript
const { currentTeam } = useTeam();
if (!currentTeam) {
  return <div>Please select a team</div>;
}
```

### Event request timeout

The target plugin may not be loaded. Handle errors appropriately:
```typescript
try {
  const result = await request('plugin:action', data);
} catch (error) {
  if (error.code === 'TIMEOUT') {
    // Request timed out - plugin may not be loaded
  } else if (error.code === 'NO_HANDLER') {
    // No plugin registered a handler
  }
}
```

## Getting Help

- **CLI Help**: `naap-plugin --help` or `naap-plugin <command> --help`
- **Diagnostics**: `naap-plugin doctor`
- **Issues**: https://github.com/your-org/naap/issues

---

## Best Practices

### Code Organization

1. **Keep components small** - One component per file, single responsibility
2. **Use TypeScript strictly** - No `any` types, proper interfaces
3. **Separate concerns** - Pages, components, hooks, utils in different directories
4. **Handle all states** - Loading, error, empty, and success states

### Performance

1. **Lazy load routes** - Use React.lazy for page components
2. **Memoize expensive computations** - useMemo, useCallback
3. **Virtualize long lists** - Use react-virtual or similar
4. **Optimize images** - Use proper formats and sizes

### Security

1. **Validate all inputs** - Use Zod on backend
2. **Check permissions** - Always verify user can perform action
3. **Sanitize outputs** - Prevent XSS
4. **Use parameterized queries** - Prisma handles this

### Error Handling

```tsx
try {
  await api.post('/api/plugin/items', data);
  notify.success('Item created');
} catch (error) {
  if (error.response?.status === 400) {
    notify.error('Invalid data. Please check your input.');
  } else if (error.response?.status === 403) {
    notify.error('You do not have permission to create items.');
  } else {
    notify.error('Something went wrong. Please try again.');
  }
}
```

### Accessibility

1. **Use semantic HTML** - Proper heading hierarchy, landmarks
2. **Add ARIA labels** - For interactive elements
3. **Support keyboard navigation** - Focus management
4. **Ensure color contrast** - WCAG 2.1 AA compliance

---

**SDK Version:** 2.0.0
