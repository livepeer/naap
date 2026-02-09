# NAAP Platform Architecture

## Overview

The NAAP (Network as a Platform) is a production-ready micro-frontend architecture for the Livepeer Network Monitor. It follows vertical slicing principles where each workflow is independently deployable and owned by separate teams.

## Architectural Principles

### 1. Micro-Frontends with UMD/CDN
- **Shell Application**: Owns global layout, navigation, authentication, and routing
- **Workflow Remotes**: Each domain is a separate MFE loaded at runtime via UMD bundles
- **Shared Dependencies**: React, React Router, Framer Motion provided by the shell at runtime

### 2. Vertical Slicing (Domain Ownership)
- One workflow = One vertical slice = One team
- Each workflow owns its frontend, backend, and database
- Duplication across workflows is explicitly allowed

### 3. API Design Pattern
All endpoints follow: `/api/{version}/{workflow}/{feature}/...`
- Example: `/api/v1/gateway-manager/gateways/:id/orchestrators`

## Directory Structure

```
naap-platform/
├── apps/
│   ├── web-next/               # Next.js shell (auth, layout, nav, routing)
│   └── workflows/
│       ├── gateway-manager-web/
│       ├── orchestrator-manager-web/
│       ├── capacity-planner-web/
│       ├── network-analytics-web/
│       ├── marketplace-web/
│       └── community-web/
│
├── services/
│   ├── base-svc/               # Core service (modular routes — see base-svc/README.md)
│   │   └── src/routes/         # 10+ domain-scoped route modules (factory pattern)
│   └── workflows/
│       ├── gateway-manager-svc/
│       ├── orchestrator-manager-svc/
│       ├── capacity-planner-svc/
│       ├── network-analytics-svc/
│       ├── marketplace-svc/
│       └── community-svc/
│
├── packages/
│   ├── ui/                     # Shared UI components
│   ├── theme/                  # Design tokens, Tailwind config
│   ├── utils/                  # Shared utilities
│   ├── types/                  # TypeScript interfaces
│   ├── api-client/             # Typed API clients
│   └── config/                 # Shared configuration
│
├── scripts/
│   ├── start.sh                # Start platform services
│   ├── stop.sh                 # Stop all services
│   └── smoke.sh                # Health check tests
│
└── docs/
    ├── architecture.md         # This file
    ├── refactor-plan.md        # Migration plan
    └── runbook.md              # Operations guide
```

## Workflow Communication

### Event Bus (Mitt)
- Shell provides event bus via `ShellContext`
- No direct imports between workflows
- Events: `auth:login`, `auth:logout`, `theme:change`, `notification:show`

### Shell Context API
```typescript
interface ShellContext {
  authToken: () => Promise<string>;
  user: () => UserContext;
  navigate: (path: string) => void;
  eventBus: Emitter<ShellEvents>;
  theme: ThemeTokens;
}
```

## Port Assignments

### Frontend (Development)
| Service | Port |
|---------|------|
| web-next (shell) | 3000 |
| gateway-manager-web | 3001 |
| orchestrator-manager-web | 3002 |
| capacity-planner-web | 3003 |
| network-analytics-web | 3004 |
| marketplace-web | 3005 |
| community-web | 3006 |

### Backend Services
| Service | Port |
|---------|------|
| base-svc | 4000 |
| gateway-manager-svc | 4001 |
| orchestrator-manager-svc | 4002 |
| capacity-planner-svc | 4003 |
| network-analytics-svc | 4004 |
| marketplace-svc | 4005 |
| community-svc | 4006 |

## Technology Stack

- **Frontend**: React 19, Vite 6, TypeScript, Tailwind CSS, Framer Motion
- **Plugin Loading**: UMD/CDN via `createPluginConfig` from `@naap/plugin-build/vite`
- **Backend**: Node.js, Express, TypeScript
- **Monorepo**: Nx
- **Shared State**: Mitt event bus
