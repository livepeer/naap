# NAAP Platform Architecture

## Overview

NaaP (Network as a Platform) is a **micro-frontend plugin platform** for the Livepeer network. It follows a vertical slicing architecture where each plugin is independently developed and loaded at runtime via UMD bundles.

## Architectural Principles

### 1. Micro-Frontends with UMD/CDN
- **Shell Application**: Next.js 15 App Router — owns layout, navigation, authentication, and routing
- **Plugins**: Each plugin is a separate React app compiled to a UMD bundle and loaded at runtime
- **Shared Dependencies**: React, React Router provided by the shell at runtime

### 2. Vertical Slicing (Plugin Ownership)
- One plugin = One vertical slice
- Each plugin owns its frontend, API routes, and database schema
- Plugins communicate through the shell's event bus, not direct imports

### 3. Single Database, Multi-Schema Isolation
- One PostgreSQL database (`naap`) with separate schemas per plugin
- All models defined centrally in `packages/database/prisma/schema.prisma`
- All services import from `@naap/database`

### 4. API Design Pattern
All endpoints follow: `/api/v1/{plugin-name}/{resource}/...`

Response envelope:
```typescript
// Success: { success: true, data: T, meta?: { page, limit, total } }
// Error:   { success: false, error: { code, message } }
```

## Directory Structure

```
naap/
├── apps/
│   └── web-next/                # Next.js 15 shell application
│       ├── src/app/             # App Router pages and layouts
│       ├── src/app/api/v1/      # API route handlers (46+ routes)
│       └── src/content/docs/    # Published documentation (MDX)
│
├── plugins/                     # 11 built-in plugins
│   ├── capacity-planner/        # Infrastructure capacity planning
│   ├── community/               # Discussion forums
│   ├── daydream-video/          # Real-time AI video generation
│   ├── developer-api/           # API key management
│   ├── gateway-manager/         # AI gateway management
│   ├── marketplace/             # Plugin marketplace
│   ├── my-dashboard/            # Embedded analytics
│   ├── my-wallet/               # Token management
│   ├── network-analytics/       # Network statistics
│   ├── orchestrator-manager/    # Orchestrator management
│   └── plugin-publisher/        # Plugin publishing
│
├── packages/
│   ├── database/                # Unified Prisma client + schema
│   ├── plugin-sdk/              # Frontend SDK (hooks, context)
│   ├── plugin-build/            # Vite build config for plugins
│   ├── plugin-server-sdk/       # Backend SDK (middleware, auth)
│   ├── types/                   # Shared TypeScript interfaces
│   └── utils/                   # Shared utilities
│
├── bin/                         # Platform scripts
│   ├── setup.sh                 # Deprecated — redirects to start.sh
│   ├── start.sh                 # Start/validate platform
│   ├── stop.sh                  # Stop platform
│   └── vercel-build.sh          # Vercel build script
│
└── docs/                        # Internal documentation
```

## Plugin Loading Flow

1. User navigates to `/my-plugin`
2. Middleware rewrites to `/plugins/myPlugin`
3. Plugin loader fetches manifest from registry
4. UMD bundle is loaded from CDN route (`/cdn/plugins/...`)
5. Plugin's `mount()` is called with `ShellContext`
6. Plugin renders inside the container
7. API calls go through `/api/v1/my-plugin/*` route handlers

## Shell Context API

```typescript
interface ShellContext {
  auth: IAuthService;        // Authentication & authorization
  navigate: NavigateFunction; // Client-side navigation
  eventBus: IEventBus;       // Inter-plugin communication
  theme: IThemeService;      // Theme management (light/dark)
  notifications: INotificationService;  // Toast notifications
  integrations: IIntegrationService;    // AI, storage, email
  logger: ILoggerService;    // Structured logging
  permissions: IPermissionService;      // Permission checking
  tenant?: ITenantService;   // Tenant context
  team?: ITeamContext;       // Team context
}
```

## Deployment

### Production (Vercel)
The entire platform deploys to **Vercel** as a single Next.js application:
- Shell UI + API route handlers serve all plugin backends
- Plugin UMD bundles served via same-origin CDN routes
- Database: Managed PostgreSQL (e.g., Neon) via `DATABASE_URL`
- No separate Express servers in production

### Local Development
- Shell runs on port 3000
- Plugin backends run as standalone Express servers on ports 4001-4012
- Single PostgreSQL via Docker on port 5432
- Plugin frontend hot-reload via Vite dev servers

## Technology Stack

- **Frontend**: React 18+, Next.js 15, TypeScript, Tailwind CSS
- **Plugin Loading**: UMD bundles via `@naap/plugin-build/vite`
- **Backend (Vercel)**: Next.js API Route Handlers
- **Backend (Local)**: Express.js
- **Database**: PostgreSQL 16, Prisma ORM (multi-schema)
- **Monorepo**: Nx, npm workspaces
- **CI/CD**: GitHub Actions, Vercel
