# NaaP Plugin Development Skill

> Agent skill for creating, modifying, and reviewing NaaP plugins.
> Read this document **before** writing any plugin code.

---

## 1. When to Use This Skill

Use this skill when:

- Creating a new NaaP plugin from scratch
- Adding frontend pages, backend routes, or database models to an existing plugin
- Reviewing a plugin PR for architecture and UX compliance
- Removing / uninstalling a plugin cleanly

Do **not** use this skill for changes to the shell app itself (`apps/web-next` layouts, shell navigation logic, shared packages).

---

## 2. Architecture Overview

NaaP plugins are **UMD micro-frontends** loaded at runtime by the shell.

```text
Shell (apps/web-next)
 ├── Sidebar reads plugin metadata from DB
 ├── PluginLoader fetches UMD bundle from CDN route
 ├── Calls plugin.mount(container, shellContext)
 └── Plugin renders inside an isolated React root
```

### What lives WHERE

| Location | Contents | Removable with plugin? |
|---|---|---|
| `plugins/{name}/` | `plugin.json`, `frontend/`, `backend/`, `docs/`, `connectors/` | Yes |
| `packages/database/prisma/schema.prisma` | Prisma models under `@@schema("plugin_{name}")` | Manual removal |
| `apps/web-next/src/app/api/v1/{name}/` | Next.js API route handlers | Manual removal |
| `apps/web-next/src/middleware.ts` | One entry in `PLUGIN_ROUTE_MAP` | Manual removal |

The **plugin folder** (`plugins/{name}/`) is self-contained. Three categories of code live outside it as exceptions (detailed in Section 8).

---

## 3. Plugin Scaffold

Every plugin must have this minimum file tree:

```text
plugins/{name}/
├── plugin.json                          # Manifest (required)
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── App.tsx                      # Root component + createPlugin()
│       ├── mount.tsx                    # UMD entry point
│       ├── globals.css                  # Tailwind + plugin-theme.css
│       └── __tests__/
│           └── App.test.tsx             # SDK test utilities
├── backend/                             # Optional
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── server.ts                    # Express entry
│       ├── routes/                      # Route modules
│       └── __tests__/
└── docs/                                # Optional
```

### 3.1 plugin.json

```json
{
  "$schema": "https://plugins.naap.io/schema/plugin.json",
  "name": "{kebab-name}",
  "displayName": "{Human Name}",
  "version": "1.0.0",
  "description": "One-line description of what the plugin does.",
  "category": "{category}",
  "author": {
    "name": "NAAP Team",
    "email": "team@naap.io",
    "url": "https://naap.io"
  },
  "repository": "https://github.com/naap/plugins/tree/main/{kebab-name}",
  "license": "MIT",
  "keywords": ["{keyword1}", "{keyword2}"],
  "icon": "{LucideIconName}",

  "shell": {
    "minVersion": "0.1.0",
    "maxVersion": "2.x"
  },

  "frontend": {
    "entry": "./frontend/dist/production/{kebab-name}.js",
    "devPort": {unique-port},
    "routes": ["/{prefix}", "/{prefix}/*"],
    "navigation": {
      "label": "{Display Label}",
      "icon": "{LucideIconName}",
      "order": {number},
      "group": "{main|platform|social|networking|operations}"
    }
  },

  "backend": {
    "entry": "./backend/dist/server.js",
    "devEntry": "./backend/src/server.ts",
    "devPort": {unique-port-4xxx},
    "port": {unique-port-42xx},
    "healthCheck": "/healthz",
    "apiPrefix": "/api/v1/{kebab-name}",
    "resources": {
      "memory": "256Mi",
      "cpu": "0.25"
    }
  },

  "database": {
    "type": "postgresql",
    "schema": "plugin_{snake_name}"
  },

  "permissions": {
    "shell": ["navigation", "notifications", "theme", "auth"],
    "apis": [],
    "external": []
  },

  "rbac": {
    "roles": [
      {
        "name": "{kebab-name}:admin",
        "displayName": "{Name} Admin",
        "description": "Full access",
        "permissions": ["{kebab-name}:read", "{kebab-name}:write", "{kebab-name}:admin"]
      },
      {
        "name": "{kebab-name}:user",
        "displayName": "{Name} User",
        "description": "Read-only access",
        "permissions": ["{kebab-name}:read"]
      }
    ],
    "defaultRole": "{kebab-name}:user"
  },

  "isolation": "none",

  "config": {
    "schema": {}
  }
}
```

**Isolation modes** control plugin sandboxing:
- `"none"` (default) — plugin runs in the same context as the shell. Use for trusted, first-party plugins.
- `"iframe"` — plugin runs in a sandboxed iframe with `postMessage` communication. Use for untrusted or marketplace plugins.
- `"worker"` — plugin runs in a Web Worker (future, maximum isolation).

**Rules for plugin.json:**

- `name` must be kebab-case and unique across all plugins.
- `$schema` should use the hosted URL `https://plugins.naap.io/schema/plugin.json` (or `../../packages/plugin-sdk/plugin.schema.json` for local-only plugins).
- `icon` must be a valid [Lucide](https://lucide.dev/icons/) icon name (PascalCase).
- `shell.minVersion` / `maxVersion` declare shell compatibility range.
- `frontend.routes` must follow the pattern `["/{prefix}", "/{prefix}/*"]`.
- `frontend.devPort` and `backend.devPort` must not collide with existing plugins. Scan all existing `plugin.json` files as the primary source of truth for reserved ports. Optionally check `packages/plugin-sdk/src/config/ports.ts` for legacy entries (this file is incomplete and may not cover newer plugins).
- RBAC roles follow `{plugin-name}:{role}` convention. RBAC is recommended but optional (some core plugins like `community` omit it).
- `database.schema` uses `plugin_{snake_case_name}` and declares the PostgreSQL schema for Prisma models.
- `config.schema` defines plugin-specific settings (e.g., default rate limits, timeouts). Leave as `{}` if not needed.
- Omit `backend`, `database`, and `config` sections entirely if the plugin is frontend-only.
- Optional fields not shown above: `dependencies` (array of other plugin names), `lifecycle` (hooks: `postInstall`, `preUpdate`, `postUpdate`, `preUninstall`), `isCore` (boolean for built-in plugins), `integrations` (required/optional external integrations).

### 3.2 frontend/package.json

```json
{
  "name": "@naap/plugin-{kebab-name}",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port {devPort}",
    "build": "vite build --mode production",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.24.0",
    "lucide-react": "^0.511.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.5.0",
    "typescript": "^5.6.3",
    "vite": "^6.4.1",
    "vitest": "^3.2.1",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0"
  },
  "peerDependencies": {
    "@naap/plugin-sdk": "*"
  }
}
```

### 3.3 frontend/vite.config.ts

```typescript
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: '{kebab-name}',
  displayName: '{Human Name}',
  globalName: 'NaapPlugin{PascalName}',
});
```

`createPluginConfig` handles:
- UMD library output with React externalized
- Tailwind + PostCSS
- Manifest validation (rejects bundles that accidentally include React internals)
- Output to `dist/production/{kebab-name}.js` and `.css`

### 3.4 frontend/src/App.tsx

```tsx
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import {
  createPlugin,
  useAuthService,
  useThemeService,
  useNotify,
} from '@naap/plugin-sdk';

const HomePage: React.FC = () => {
  const auth = useAuthService();
  const theme = useThemeService();
  const notify = useNotify();
  const user = auth.getUser();

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">
        {/* Page content */}
      </h1>
    </div>
  );
};

const PluginApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/*" element={<HomePage />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: '{kebab-name}',
  version: '1.0.0',
  routes: ['/{prefix}', '/{prefix}/*'],
  App: PluginApp,
});

export const mount = plugin.mount;
export default plugin;
```

**Mandatory patterns:**

- Always use `MemoryRouter` from `react-router-dom` (not `BrowserRouter`). The shell controls the browser URL.
- Always use `createPlugin()` from `@naap/plugin-sdk` to wrap the root component.
- Export `mount` as a named export and the plugin object as the default export.

### 3.5 frontend/src/mount.tsx

```tsx
import plugin from './App';

const PLUGIN_GLOBAL_NAME = 'NaapPlugin{PascalName}';

export const mount = plugin.mount;
export const unmount = (plugin as any).unmount;
export const getContext = (plugin as any).getContext;
export const metadata = (plugin as any).metadata || {
  name: '{camelCaseName}',
  version: '1.0.0',
};

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>)[PLUGIN_GLOBAL_NAME] = {
    mount,
    unmount,
    getContext,
    metadata,
  };
}

export default { mount, unmount, getContext, metadata };
```

The `PLUGIN_GLOBAL_NAME` must match the `globalName` in `vite.config.ts`. Convention: `NaapPlugin{PascalCaseName}`.

### 3.6 frontend/src/globals.css

```css
@import '@naap/plugin-sdk/styles/plugin-theme.css';
@tailwind base;
@tailwind components;
@tailwind utilities;
```

---

## 4. Frontend Conventions

### 4.1 SDK Hooks

All shell services are accessed through hooks from `@naap/plugin-sdk`:

| Hook | Purpose |
|---|---|
| `useAuthService()` | Full auth service (getUser, isAuthenticated, hasRole, getToken) |
| `useUser()` | Shorthand for current user object |
| `useIsAuthenticated()` | Boolean auth state check |
| `useThemeService()` | Light/dark mode, theme changes |
| `useNotify()` | Toast notifications (`.success()`, `.error()`, `.info()`) |
| `useEvents()` | Event bus (`.emit()`, `.on()`) |
| `useNavigate()` | Shell-level navigation |
| `useCapabilities()` | Feature capability checks |
| `usePluginConfig()` | Plugin-specific configuration |
| `useApiClient()` | HTTP client with auth headers |
| `useTeam()` / `useCurrentTeam()` | Team/org context |
| `usePermissions()` | RBAC permission checks |
| `useQuery()` / `useMutation()` | Data fetching with cache |
| `useWebSocket()` | WebSocket connections |
| `useOverlay()` | Modal/overlay management |
| `useKeyboardShortcut()` | Keyboard shortcut registration |

Never access `window.__SHELL_CONTEXT__` directly. Always use hooks.

### 4.2 Routing

- Use `MemoryRouter` with `Routes` and `Route` from `react-router-dom`.
- For multi-page plugins, define routes relative to the plugin root:

```tsx
<MemoryRouter>
  <Routes>
    <Route path="/" element={<ListPage />} />
    <Route path="/create" element={<CreatePage />} />
    <Route path="/:id" element={<DetailPage />} />
    <Route path="/*" element={<ListPage />} />
  </Routes>
</MemoryRouter>
```

- For plugins with their own sidebar navigation, render a `<nav>` inside the plugin container. Do **not** try to inject items into the shell sidebar.

### 4.3 API Calls

Frontend-to-backend communication uses the shell's API client:

```tsx
const api = useApiClient();

const items = await api.get('/api/v1/{plugin-name}/items');
const created = await api.post('/api/v1/{plugin-name}/items', { name: 'New' });
```

All requests automatically include auth headers, CSRF tokens, and correlation IDs.

---

## 5. Backend Conventions (When Needed)

A backend is only needed when the plugin requires:
- Server-side business logic beyond simple CRUD
- Persistent connections (SSH, WebSocket pools)
- Background jobs or long-running processes
- External API integration with secrets

### 5.1 Server Setup

**Option A: `@naap/plugin-server-sdk` (recommended)**

```typescript
import 'dotenv/config';
import { createPluginServer } from '@naap/plugin-server-sdk';
import { readFileSync } from 'node:fs';

const pluginConfig = JSON.parse(
  readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')
);

const { app, start } = createPluginServer({
  name: pluginConfig.name,
  port: process.env.PORT || pluginConfig.backend?.devPort,
});

// Register routes
app.get('/api/items', async (req, res) => {
  res.json({ success: true, data: [] });
});

start();
```

`createPluginServer` provides: CORS, helmet, compression, `/healthz`, JWT auth middleware, rate limiting, graceful shutdown.

**Option B: Plain Express** (only for advanced cases needing full control)

```typescript
import express from 'express';
const app = express();
app.use(express.json());

app.get('/healthz', (_, res) => res.json({ status: 'ok' }));

const PORT = Number(process.env.PORT ?? 4100);
const server = app.listen(PORT);

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
```

### 5.2 Response Format

All API responses must follow the standard envelope:

```typescript
// Success
{ success: true, data: T }
{ success: true, data: T[], meta: { page, pageSize, total, totalPages } }

// Error
{ success: false, error: "Human-readable message" }
{ success: false, error: "Validation failed", details: zodError.format() }
```

### 5.3 Validation

Use Zod for request validation:

```typescript
import { z } from 'zod';

const CreateItemSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
});

router.post('/items', async (req, res) => {
  const parsed = CreateItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: parsed.error.format(),
    });
  }
  // ... use parsed.data
});
```

### 5.4 Database Access

Import the shared Prisma client. In plugin backends, import directly from `@naap/database`. In Next.js API routes, use the shell's local re-export `@/lib/db`.

```typescript
// Plugin backend (Express server)
import { prisma } from '@naap/database';

// Next.js API route (apps/web-next)
import { prisma } from '@/lib/db';

const items = await prisma.myPluginItem.findMany({
  where: { teamId },
});
```

For resilience during development without a database:

```typescript
let db: typeof import('@naap/database').prisma | null = null;

async function initDatabase() {
  try {
    const { prisma } = await import('@naap/database');
    db = prisma;
    await db.$connect();
    return true;
  } catch {
    console.warn('Database not available, using in-memory fallback');
    return false;
  }
}
```

---

## 6. Shared UI Components and Design Tokens

### 6.1 Required Packages

Every plugin frontend must use:

| Package | Purpose |
|---|---|
| `@naap/plugin-sdk` | Hooks, mount utilities, testing |
| `@naap/ui` | Shared UI components |
| `@naap/theme` | Design tokens (colors, typography, spacing, motion) |
| `@naap/types` | Shared TypeScript types |
| `lucide-react` | Icons (only Lucide, no other icon libraries) |

### 6.2 Available UI Components

From `@naap/ui`:

**Layout:** `Card`, `Modal`

**Data display:** `Badge`, `Stat`, `VersionBadge`, `DataTable`, `Tooltip`, `ReleaseNotesViewer`

**Forms:** `Button`, `Input`, `Textarea`, `Select`, `Label`, `SearchInput`, `FilterBar`, `Toggle`, `Tabs`

**Feedback:** `EmptyState`, `LoadingState`, `LoadingSpinner`, `Skeleton`, `SkeletonCard`, `ConfirmDialog`

Always prefer `@naap/ui` components over building custom equivalents. If a component does not exist in `@naap/ui`, build it using the same Tailwind token patterns.

### 6.3 Design Tokens

From `@naap/theme`:

- **Surface colors:** `--bg-primary` (#121212), `--bg-secondary` (#1A1A1A), `--bg-tertiary` (#222222)
- **Text hierarchy:** `--text-primary` (100%), `--text-secondary` (70%), `--text-body` (60%), `--text-muted` (40%), `--text-disabled` (25%)
- **Accent:** `--accent-green` (#18794E, Livepeer brand green)
- **Status:** green=success, amber=warning, rose=error, blue=info

Use CSS variables for all colors -- never hardcode hex values.

```tsx
// Correct
<h1 className="text-[var(--text-primary)]">Title</h1>
<p className="text-[var(--text-body)]">Body text</p>
<div className="bg-[var(--bg-secondary)] border border-[var(--bg-border)]">

// Also correct -- Tailwind semantic classes
<button className="bg-primary text-primary-foreground">

// Wrong -- hardcoded colors
<h1 className="text-white">Title</h1>
<div className="bg-gray-900">
```

---

## 7. UX / Design Compliance Checklist

Every plugin must pass these checks before merging:

### Layout

- [ ] Content renders inside the `PluginLoader` container. No duplicate sidebar or top bar.
- [ ] Main content area uses `p-6 max-w-6xl mx-auto` or equivalent comfortable padding.
- [ ] No horizontal scrolling at standard viewport widths (>= 1024px).
- [ ] Plugin fills the available height (`min-h-full` or flex layout).

### Theme

- [ ] Supports both light and dark mode via CSS variables from `plugin-theme.css`.
- [ ] No hardcoded color values. All colors reference CSS variables or Tailwind semantic tokens.
- [ ] Background colors use the surface scale: `--bg-primary` -> `--bg-secondary` -> `--bg-tertiary`.
- [ ] Text uses the opacity hierarchy: primary (headings), secondary (labels), body (content), muted (metadata).

### Typography

- [ ] Headings use `font-semibold` or `font-bold`, never raw font weights.
- [ ] Body text uses default (400) weight.
- [ ] Font sizes follow Tailwind scale (`text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`).
- [ ] Monospace text (code, IDs, addresses) uses `font-mono`.

### States

- [ ] **Loading:** Shows `LoadingState`, `Skeleton`, or `SkeletonCard` from `@naap/ui`. Never a blank page.
- [ ] **Empty:** Shows `EmptyState` from `@naap/ui` with a clear call-to-action. Never a blank page.
- [ ] **Error:** Caught by an error boundary. Displays error message with a retry action.
- [ ] **No auth:** Gracefully handles `auth.getUser()` returning null (show appropriate message or redirect).

### Interactions

- [ ] Buttons use `Button` from `@naap/ui` with appropriate variant (`primary`, `secondary`, `ghost`, `destructive`).
- [ ] Destructive actions require confirmation via `ConfirmDialog`.
- [ ] Success/error feedback uses `useNotify()` toasts, not custom alert components.
- [ ] Forms show inline validation errors below the relevant field.

### Icons

- [ ] All icons come from `lucide-react`.
- [ ] No emoji used as icons.
- [ ] Sidebar icon (`plugin.json` `navigation.icon`) is a valid Lucide icon name.

### Animations

- [ ] Animations are subtle and match shell motion tokens from `@naap/theme`.
- [ ] Framer Motion is acceptable but keep animations under 300ms for UI transitions.
- [ ] No animations that block user interaction.

### Accessibility

- [ ] Interactive elements are keyboard-navigable (Tab, Enter, Escape).
- [ ] Form inputs have associated `<label>` elements or `aria-label`.
- [ ] Color is not the sole means of conveying information (pair with icons or text).

---

## 8. Exception Files (Outside Plugin Folder)

Three categories of code **must** live outside `plugins/{name}/`. Document each one clearly in the PR description so reviewers can track them.

### 8.1 Prisma Schema

**File:** `packages/database/prisma/schema.prisma`

Add plugin models under a dedicated PostgreSQL schema:

```prisma
model MyPluginItem {
  id        String   @id @default(cuid())
  teamId    String
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@schema("plugin_my_plugin")
}
```

Rules:
- Schema name: `plugin_{snake_case_name}` (e.g., `plugin_service_gateway`).
- Always include `teamId` for multi-tenant isolation.
- Always include `createdAt` and `updatedAt`.
- Use `@id @default(cuid())` for primary keys.
- Run `npx prisma migrate dev --name add_{plugin_name}_models` after adding models.

**Clean removal:** Delete the models, create a migration that drops the schema.

### 8.2 Next.js API Routes

**Directory:** `apps/web-next/src/app/api/v1/{plugin-name}/`

Each route file follows the Next.js App Router convention:

```typescript
import { NextRequest } from 'next/server';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { validateCSRF } from '@/lib/api/csrf';
import { prisma } from '@/lib/db';

// GET routes can be public (no auth) or protected -- choose per endpoint.
export async function GET(request: NextRequest) {
  // For public read endpoints, auth is optional:
  const token = getAuthToken(request);
  const authUser = token ? await validateSession(token) : null;

  const items = await prisma.myPluginItem.findMany({
    where: { teamId: request.headers.get('x-team-id') || undefined },
  });

  return success(items);
}

// Write endpoints MUST validate auth AND CSRF.
export async function POST(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return errors.unauthorized();

  const authUser = await validateSession(token);
  if (!authUser) return errors.unauthorized();

  const csrfError = validateCSRF(request, token);
  if (csrfError) return csrfError;

  const body = await request.json();
  // Validate with Zod, then create...

  return success(created);
}
```

Rules:
- Write endpoints (POST, PUT, PATCH, DELETE) **must** validate session via `getAuthToken` + `validateSession` and **must** validate CSRF via `validateCSRF`.
- Read endpoints (GET) may be public or protected depending on the use case.
- `validateSession` returns an `authUser` object (with `.id`, `.email`, etc.), not a session object.
- Import Prisma from `@/lib/db` (the shell's local re-export), not directly from `@naap/database`.
- Use the standard response helpers from `@/lib/api/response` (`success`, `errors`, `successPaginated`).
- The `success()` helper accepts an optional second argument for pagination metadata: `success(data, { page, pageSize, total, totalPages })`.
- Group routes under `apps/web-next/src/app/api/v1/{plugin-name}/`.
- For routes with dynamic params: `apps/web-next/src/app/api/v1/{plugin-name}/[id]/route.ts`.
- Apply rate limiting for write endpoints.

**Clean removal:** Delete the entire `apps/web-next/src/app/api/v1/{plugin-name}/` directory.

### 8.3 Middleware Route Map

**File:** `apps/web-next/src/middleware.ts`

Add one entry to `PLUGIN_ROUTE_MAP`:

```typescript
const PLUGIN_ROUTE_MAP: Record<string, string> = {
  // ... existing entries ...
  '/{prefix}': '{camelCaseName}',
};
```

The key is the vanity URL prefix (e.g., `/gateway`). The value is the camelCase plugin name matching the DB record (e.g., `serviceGateway`).

**Clean removal:** Remove the single line from `PLUGIN_ROUTE_MAP`.

---

## 9. Testing Requirements

### 9.1 Frontend Tests

Copy the test template from `plugins/__template__/frontend/src/__tests__/App.test.tsx`.

Required test coverage:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  MockShellProvider,
  renderWithShell,
  createMockUser,
  createMockTeam,
  testPluginContract,
} from '@naap/plugin-sdk/testing';

describe('Plugin Component', () => {
  it('renders without crashing', () => {
    render(
      <MockShellProvider>
        <PluginApp />
      </MockShellProvider>
    );
    expect(screen.getByText(/expected content/)).toBeInTheDocument();
  });
});

describe('Plugin Contract', () => {
  testPluginContract(() => import('../mount'));
});
```

Minimum test scenarios:
- Renders without crashing in `MockShellProvider`
- Renders with authenticated user context
- Renders with team context
- Handles missing/null user gracefully
- Plugin contract validation passes (mount/unmount interface)

### 9.2 Backend Tests (if applicable)

- Use Vitest with `environment: 'node'`
- Test route handlers with mock request/response
- Test service layer logic independently
- Place tests in `backend/src/__tests__/*.test.ts`

---

## 10. Local Development

### 10.1 Prerequisites

Before starting local dev, ensure:
- PostgreSQL running locally (or `DATABASE_URL` pointing to a dev database)
- `npm install` at the repo root
- `apps/web-next/.env.local` exists (auto-created by `start.sh` if missing)

### 10.2 Starting the Dev Environment

```bash
# Smart start: shell + core services + only changed plugins
./bin/start.sh

# Full start: shell + core + all plugin backends
./bin/start.sh --all

# Dev mode for a specific plugin (frontend HMR + backend)
./bin/start.sh dev {plugin-name}

# Start shell + named plugin backends only
./bin/start.sh {plugin-name} [another-plugin...]

# Other commands
./bin/start.sh status    # Check what's running
./bin/start.sh logs      # Tail logs
./bin/start.sh list      # List discovered plugins
./bin/stop.sh            # Stop everything
```

`start.sh` performs these steps automatically:
1. Ensures `.env.local` exists with default values
2. Builds only plugins whose source hash has changed
3. Copies built bundles to `dist/plugins/{name}/1.0.0/`
4. Runs `sync-plugin-registry.ts` to update the DB
5. Starts the Next.js shell on port 3000
6. Starts requested plugin backends on their configured ports
7. Verifies plugins are accessible at `http://localhost:3000/cdn/plugins/{name}/1.0.0/{name}.js`

### 10.3 How Plugin Loading Works Locally

```text
Browser → http://localhost:3000/{prefix}
  → middleware rewrites to /plugins/{camelCaseName}
  → PluginLoader fetches /cdn/plugins/{name}/1.0.0/{name}.js
  → CDN route reads from dist/plugins/{name}/1.0.0/{name}.js on disk
  → UMD bundle loads, mount(container, shellContext) called
```

The CDN route at `apps/web-next/src/app/cdn/plugins/[pluginName]/[version]/[...file]/route.ts` serves bundles from the `dist/plugins/` directory at the monorepo root. In dev mode, response headers include `Cache-Control: no-cache` to avoid stale bundles.

### 10.4 Plugin Backend Proxying (Local)

Plugin frontends call `/api/v1/{plugin-name}/*` on the shell origin. The catch-all route at `apps/web-next/src/app/api/v1/[plugin]/[...path]/route.ts` proxies these requests to the plugin backend:

```text
Frontend fetch('/api/v1/my-plugin/items')
  → Next.js catch-all route
  → Reads PLUGIN_PORTS config for 'myPlugin'
  → Proxies to http://localhost:{port}/items
```

Port resolution uses `packages/plugin-sdk/src/config/ports.ts` and can be overridden with environment variables (e.g., `MY_PLUGIN_URL=http://localhost:4050`).

### 10.5 Environment Variables for Local Dev

The following are auto-created in `apps/web-next/.env.local` by `start.sh`:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXTAUTH_SECRET=dev-secret-change-me-in-production-min-32-chars
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/naap
BASE_SVC_URL=http://localhost:4000
PLUGIN_SERVER_URL=http://localhost:3100
```

If your plugin backend needs a custom URL override, add:

```env
{UPPER_SNAKE_PLUGIN_NAME}_URL=http://localhost:{port}
```

### 10.6 Building Plugins Manually

```bash
# Build all plugins (with caching -- skips unchanged)
./bin/build-plugins.sh

# Build a specific plugin
./bin/build-plugins.sh --plugin {name}

# Force rebuild (ignore cache)
./bin/build-plugins.sh --force --plugin {name}

# Parallel build
./bin/build-plugins.sh --parallel
```

Output goes to `dist/plugins/{name}/1.0.0/`. A `.build-hash` file tracks source changes to skip unchanged builds.

### 10.7 Local Dev Checklist for New Plugins

After scaffolding a new plugin:

1. Add `plugins/{name}/frontend` (and `plugins/{name}/backend` if applicable) to root `package.json` workspaces.
2. Run `npm install` at the repo root.
3. Add your plugin's entry to `PLUGIN_ROUTE_MAP` in `apps/web-next/src/middleware.ts`.
4. If the plugin has a backend, register its port in `packages/plugin-sdk/src/config/ports.ts`.
5. Run `./bin/start.sh dev {name}` to start with HMR.
6. Navigate to `http://localhost:3000/{prefix}` to verify the plugin loads.
7. Check the browser console for errors.

---

## 11. Vercel Production Deployment

### 11.1 How the Vercel Build Works

`vercel.json` uses `./bin/vercel-build.sh` as the build command. The build pipeline:

1. Build `@naap/plugin-build` and `@naap/plugin-utils` packages.
2. Run `./bin/build-plugins.sh --parallel` to build all plugin UMD bundles to `dist/plugins/`.
3. Copy `dist/plugins/*` to `apps/web-next/public/cdn/plugins/` for static serving.
4. Run `prisma db push` to sync the database schema.
5. Run `npx tsx bin/sync-plugin-registry.ts` to sync plugin records and generate `plugin-routes.json`.
6. Run `next build` in `apps/web-next`.

CI caches `dist/plugins/` by content hash. When the cache hits, steps 1-2 are skipped via `SKIP_PLUGIN_BUILD=true`.

### 11.2 Critical: Plugin Backends on Vercel

**Plugin backends (Express servers) do NOT run on Vercel.** This is the most important deployment constraint.

On Vercel, the catch-all proxy route (`/api/v1/[plugin]/[...path]`) returns **501 Not Implemented** for any plugin whose URL resolves to `localhost`. Every plugin endpoint that must work in production **must** have a dedicated Next.js API route handler in `apps/web-next/src/app/api/v1/{plugin-name}/`.

```text
                    ┌─────────────────────────┐
                    │     Plugin Backend       │
                    │  (Express, standalone)   │
                    │   LOCAL DEV ONLY         │
                    └──────────┬──────────────┘
                               │ proxied via catch-all
                               │ (localhost:{port})
┌───────────┐     ┌────────────┴──────────────┐
│  Browser  │────▶│  /api/v1/{plugin}/*       │
└───────────┘     │  Next.js API Routes       │
                  │  (works on Vercel)         │
                  └───────────────────────────┘
```

**Two valid patterns for plugin endpoints:**

| Pattern | When to use | Local dev | Vercel |
|---|---|---|---|
| **Next.js API routes only** (recommended) | Simple CRUD, standard request/response | Works | Works |
| **Next.js routes + Express backend** | Long-lived connections (SSH, WS), background jobs | Routes proxy to Express backend | Routes handle logic directly; Express is for local dev convenience or runs as a separate service outside Vercel |

If your plugin uses a standalone backend, the Next.js API routes in `apps/web-next/src/app/api/v1/{plugin-name}/` must implement the same endpoints independently -- they cannot rely on the Express backend being available on Vercel.

### 11.3 Vercel Configuration for Plugins

`vercel.json` already includes plugin-related configuration. When adding a new plugin, you typically do **not** need to modify `vercel.json`. The existing config handles:

```json
{
  "functions": {
    "app/api/v1/[plugin]/**": { "maxDuration": 30 }
  },
  "headers": [
    {
      "source": "/cdn/plugins/:name/:version/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }
      ]
    }
  ],
  "rewrites": [
    { "source": "/plugin-assets/:path*", "destination": "/cdn/plugins/:path*" }
  ]
}
```

If your plugin API routes need a longer timeout (default is 30s), add a specific entry:

```json
{
  "functions": {
    "app/api/v1/{plugin-name}/**": { "maxDuration": 60 }
  }
}
```

### 11.4 CDN Bundle Serving in Production

Plugin UMD bundles are served from `apps/web-next/public/cdn/plugins/` as static files. The CDN route handler is the same as local dev -- it reads from `dist/plugins/` relative to the app root.

The URL pattern is identical across environments:

```text
/cdn/plugins/{name}/1.0.0/{name}.js
/cdn/plugins/{name}/1.0.0/{name}.css
```

For user-published plugins (via the plugin marketplace), bundles are uploaded to **Vercel Blob** storage and served from `blob.vercel-storage.com`. This requires the `BLOB_READ_WRITE_TOKEN` environment variable.

### 11.5 Environment Variables on Vercel

Set these in the Vercel project settings (or via `vercel env`):

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Yes | Auth secret (min 32 chars) |
| `NEXT_PUBLIC_APP_URL` | Yes | Production URL |
| `BLOB_READ_WRITE_TOKEN` | If using plugin publisher | Vercel Blob for CDN uploads |
| `{PLUGIN}_URL` | If backend runs externally | Override catch-all proxy target |

Plugin backends that run as external services (outside Vercel) need their URL set as an env var (e.g., `SERVICE_GATEWAY_URL=https://gw.example.com`). Without this, the catch-all returns 501.

### 11.6 CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/ci.yml`) handles:

- **Path filters**: Changes in `plugins/**` or `packages/plugin-build/**` trigger plugin-related jobs.
- **Plugin tests**: Per-changed-plugin test runs, plus SDK compatibility matrix.
- **Build caching**: `dist/plugins/` is cached by content hash. Unchanged plugins skip rebuild.
- **Deploy**: On push to `main`, runs `vercel build --prod` then `vercel deploy --prebuilt --prod`.

No plugin-specific CI configuration is needed -- the existing pipeline auto-discovers and builds all plugins.

### 11.7 Vercel Deployment Checklist for New Plugins

After the plugin works locally, verify Vercel readiness:

1. **API routes exist as Next.js handlers** -- Every endpoint the frontend calls must have a corresponding route file in `apps/web-next/src/app/api/v1/{plugin-name}/`. The catch-all proxy will **not** work on Vercel for localhost backends.
2. **No `fs` / `path` imports in API routes** -- Vercel serverless functions support `fs` for reading bundled files, but avoid writing to the filesystem. Use the database or Vercel Blob for persistence.
3. **No long-lived connections in API routes** -- Vercel functions are stateless and short-lived (max 30-60s). If you need WebSockets or SSH pools, those must run as a separate service outside Vercel, with its URL set as an env var.
4. **Bundle builds successfully** -- Run `./bin/build-plugins.sh --plugin {name}` and confirm output in `dist/plugins/{name}/`.
5. **Registry sync works** -- Run `npx tsx bin/sync-plugin-registry.ts` and verify the plugin appears in `apps/web-next/src/generated/plugin-routes.json`.
6. **No new env vars required without defaults** -- If the plugin needs new environment variables, document them and ensure the plugin degrades gracefully when they're missing.
7. **Function duration** -- If any API route needs more than 30s, add a `functions` entry to `vercel.json`.

---

## 12. Production Readiness Checklist

Before merging any plugin, verify:

### Manifest

- [ ] `plugin.json` is valid (passes `validateManifest` from `@naap/plugin-sdk`).
- [ ] `name` is unique, kebab-case, no conflicts with existing plugins.
- [ ] `frontend.devPort` and `backend.devPort` (if any) do not collide.
- [ ] `icon` is a valid Lucide icon name.
- [ ] RBAC roles are defined with appropriate permissions.

### Build

- [ ] `vite build --mode production` succeeds without errors.
- [ ] UMD bundle does NOT contain React internals (validated by build plugin).
- [ ] Bundle size is reasonable (< 500KB gzipped for the JS bundle).

### Backend (if applicable)

- [ ] `/healthz` endpoint returns 200.
- [ ] Graceful shutdown handlers for SIGTERM and SIGINT.
- [ ] Write endpoints (POST/PUT/PATCH/DELETE) validate session and CSRF (`validateSession` + `getAuthToken` + `validateCSRF`).
- [ ] Read endpoints are either public or protected, with explicit intent documented.
- [ ] Write endpoints have rate limiting.
- [ ] No secrets in client-accessible responses.

### Database (if applicable)

- [ ] Models use dedicated `@@schema("plugin_{name}")`.
- [ ] All models include `teamId` for multi-tenant isolation.
- [ ] Migration created and tested (`npx prisma migrate dev`).

### Frontend

- [ ] All UX checklist items from Section 7 pass.
- [ ] Tests pass (`vitest run`).
- [ ] Plugin contract test passes (`testPluginContract`).
- [ ] No console errors or warnings in browser.

### Local Dev

- [ ] `./bin/start.sh dev {name}` starts the plugin successfully.
- [ ] Plugin loads at `http://localhost:3000/{prefix}`.
- [ ] Plugin backend (if any) responds on its configured port.
- [ ] Hot reload works when editing frontend source.

### Vercel Deployment

- [ ] All plugin API endpoints have dedicated Next.js route handlers (not relying on catch-all proxy to localhost).
- [ ] No `fs.writeFile` or persistent filesystem usage in API routes.
- [ ] No long-lived connections (WebSocket pools, SSH) in serverless route handlers.
- [ ] Plugin builds via `./bin/build-plugins.sh --plugin {name}` without errors.
- [ ] Registry sync produces correct `plugin-routes.json` entry.
- [ ] Any new environment variables are documented and have sensible defaults or graceful fallbacks.
- [ ] Function timeout is sufficient (default 30s; add `vercel.json` entry if more is needed).

### Integration

- [ ] Entry added to `PLUGIN_ROUTE_MAP` in middleware.
- [ ] Plugin appears in sidebar after registry sync.
- [ ] Navigation to vanity URL (e.g., `/gateway`) loads the plugin correctly.
- [ ] Plugin loads from CDN bundle (not just dev server).

---

## 13. Clean Removal Procedure

To fully remove a plugin:

1. **Delete plugin folder:** `rm -rf plugins/{name}/`
2. **Remove Prisma models:** Delete all models with `@@schema("plugin_{name}")` from `packages/database/prisma/schema.prisma`.
3. **Create migration:** `npx prisma migrate dev --name remove_{name}_models`
4. **Delete API routes:** `rm -rf apps/web-next/src/app/api/v1/{name}/`
5. **Remove middleware entry:** Delete the `'/{prefix}': '{camelCaseName}'` line from `PLUGIN_ROUTE_MAP` in `apps/web-next/src/middleware.ts`.
6. **Remove workspace entries:** Delete `plugins/{name}/frontend` and `plugins/{name}/backend` from root `package.json` workspaces.
7. **Re-sync registry:** `npx tsx bin/sync-plugin-registry.ts` (auto-soft-disables the plugin in DB).
8. **Verify:** Run `npm install` to update the lockfile, then `npm run build` to confirm no broken imports.

---

## Appendix A: Port Allocation

The file `packages/plugin-sdk/src/config/ports.ts` contains the authoritative **backend port map**. Individual `plugin.json` files are the source of truth for **frontend dev ports** and may also contain plugin-specific backend devPort overrides.

General ranges:
- Frontend dev ports: `3001`-`3199` (check existing `plugin.json` files for collisions)
- Backend dev ports: `4000`-`4199` (core services at `4000-4099`, extended plugins at `4100-4199`)
- Backend production ports: `4100`-`4299`

Always check both `packages/plugin-sdk/src/config/ports.ts` and all existing `plugin.json` files before picking a new port.

## Appendix B: Naming Conventions

| Context | Format | Example |
|---|---|---|
| Plugin folder | `kebab-case` | `service-gateway` |
| `plugin.json` name | `kebab-case` | `service-gateway` |
| DB / middleware | `camelCase` | `serviceGateway` |
| UMD global | `PascalCase` with `NaapPlugin` prefix | `NaapPluginServiceGateway` |
| npm package | `@naap/plugin-{kebab-name}` | `@naap/plugin-service-gateway` |
| Prisma schema | `snake_case` with `plugin_` prefix | `plugin_service_gateway` |
| RBAC roles | `{kebab-name}:{role}` | `service-gateway:admin` |
| API prefix | `/api/v1/{kebab-name}` | `/api/v1/service-gateway` |

## Appendix C: SDK Hook Quick Reference

```typescript
import {
  // Auth & User
  useAuthService, useUser, useIsAuthenticated,

  // Shell Services
  useThemeService, useNotify, useEvents, useNavigate,
  useCapabilities, usePermissions, useLogger,

  // Data
  useApiClient, usePluginApi, useQuery, useMutation,

  // Team & Tenant
  useTeam, useCurrentTeam, useTeamRole, useTeamPermission,
  useTenant, useTenantId,

  // Plugin Config
  usePluginConfig, useConfigValue,

  // Events
  usePluginEvent, useEventRequest, useEventHandler,

  // Advanced
  useWebSocket, useOverlay, useKeyboardShortcut,
  useIntegration, usePluginAdmin,
} from '@naap/plugin-sdk';
```
