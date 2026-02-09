# Plugin Architecture

## Overview

The NaaP plugin system uses **UMD/CDN bundles** to dynamically load micro-frontends at runtime. Each plugin is a self-contained application with optional backend services, integrated with the shell through a standardized context API.

---

## 1. Plugin Lifecycle Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            PLUGIN LIFECYCLE                                  │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
  │  DISCOVERY   │────▶│ INSTALLATION │────▶│   LOADING    │────▶│   RUNNING    │
  └──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
         │                    │                    │                    │
         ▼                    ▼                    ▼                    ▼
  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
  │ Marketplace  │     │ Create       │     │ Fetch UMD    │     │ Mount React  │
  │ lists        │     │ Installation │     │ bundle from  │     │ component    │
  │ PluginPackage│     │ record       │     │ CDN          │     │ in container │
  │ entries      │     │              │     │              │     │              │
  └──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                              │                    │                    │
                              ▼                    ▼                    ▼
                       ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
                       │ Increment    │     │ Access UMD   │     │ Plugin uses  │
                       │ activeInstall│     │ global and   │     │ ShellContext │
                       │ counter      │     │ call mount() │     │ for auth/API │
                       └──────────────┘     └──────────────┘     └──────────────┘

  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
  │ UNINSTALL    │────▶│   CLEANUP    │────▶│   STOPPED    │
  └──────────────┘     └──────────────┘     └──────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
  │ Delete       │     │ Decrement    │     │ If counter=0 │
  │ Installation │     │ activeInstall│     │ stop backend │
  │ record       │     │ counter      │     │ archive data │
  └──────────────┘     └──────────────┘     └──────────────┘
```

---

## 2. Plugin Loading Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PLUGIN LOADING SEQUENCE                              │
└─────────────────────────────────────────────────────────────────────────────┘

  Browser                    Shell                      Plugin Server
     │                         │                              │
     │  Navigate to /my-wallet │                              │
     │─────────────────────────▶                              │
     │                         │                              │
     │                    ┌────┴────┐                         │
     │                    │ Plugin  │                         │
     │                    │ Context │                         │
     │                    └────┬────┘                         │
     │                         │                              │
     │                         │ GET /api/v1/teams/:id/my-plugins
     │                         │──────────────────────────────▶
     │                         │                              │
     │                         │◀─ { plugins: [...] } ────────│
     │                         │                              │
     │                    ┌────┴────┐                         │
     │                    │Workflow │                         │
     │                    │ Loader  │                         │
     │                    └────┬────┘                         │
     │                         │                              │
     │                         │ Load UMD bundle (script tag) │
     │                         │──────────────────────────────▶
     │                         │                              │
     │                         │◀─ UMD/CDN bundle ────────────│
     │                         │                              │
     │                    ┌────┴────┐                         │
     │                    │  UMD   │                         │
     │                    │ Loader  │                         │
     │                    └────┬────┘                         │
     │                         │                              │
     │                         │ window[pluginName]           │
     │                         │ mount(container, context)    │
     │                         │                              │
     │◀── Rendered Plugin ─────│                              │
     │                         │                              │
```

---

## 3. Frontend-Backend Integration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PLUGIN FRONTEND ↔ BACKEND ARCHITECTURE                    │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────┐
  │                              BROWSER                                      │
  │  ┌─────────────────────────────────────────────────────────────────────┐ │
  │  │                         Shell (Host App)                             │ │
  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │ │
  │  │  │ AuthContext  │  │ TeamContext  │  │  EventBus   │               │ │
  │  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │ │
  │  │         │                 │                 │                        │ │
  │  │         └─────────────────┼─────────────────┘                        │ │
  │  │                           ▼                                          │ │
  │  │                  ┌─────────────────┐                                 │ │
  │  │                  │  ShellContext   │                                 │ │
  │  │                  │  (V1 or V2 API) │                                 │ │
  │  │                  └────────┬────────┘                                 │ │
  │  │                           │                                          │ │
  │  │  ┌────────────────────────┼────────────────────────┐                │ │
  │  │  │                        ▼                        │                │ │
  │  │  │  ┌─────────────────────────────────────────┐   │                │ │
  │  │  │  │        Plugin (UMD/CDN Bundle)             │   │                │ │
  │  │  │  │                                          │   │                │ │
  │  │  │  │   ┌──────────────────────────────────┐  │   │                │ │
  │  │  │  │   │ mount(container, shellContext) { │  │   │                │ │
  │  │  │  │   │   // Access auth token           │  │   │                │ │
  │  │  │  │   │   const token = context.auth()   │  │   │                │ │
  │  │  │  │   │                                  │  │   │                │ │
  │  │  │  │   │   // Make API calls              │  │   │                │ │
  │  │  │  │   │   fetch('/api/v1/my-wallet/...',│  │   │                │ │
  │  │  │  │   │     headers: context.getApiHeaders())│  │                │ │
  │  │  │  │   │                                  │  │   │                │ │
  │  │  │  │   │   // Emit events                 │  │   │                │ │
  │  │  │  │   │   context.eventBus.emit(...)    │  │   │                │ │
  │  │  │  │   │ }                                │  │   │                │ │
  │  │  │  │   └──────────────────────────────────┘  │   │                │ │
  │  │  │  │                                          │   │                │ │
  │  │  │  └─────────────────────────────────────────┘   │                │ │
  │  │  └─────────────────────────────────────────────────┘                │ │
  │  └─────────────────────────────────────────────────────────────────────┘ │
  └───────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      │ HTTPS (Bearer Token + CSRF)
                                      ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                              BACKEND                                      │
  │                                                                           │
  │  ┌─────────────────────────────────────────────────────────────────────┐ │
  │  │                     API Gateway / Base Service                       │ │
  │  │                     (localhost:4000)                                 │ │
  │  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐            │ │
  │  │  │ Auth Middleware│  │ CSRF Validate │  │ Rate Limiter  │            │ │
  │  │  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘            │ │
  │  │          └──────────────────┼──────────────────┘                     │ │
  │  │                             ▼                                        │ │
  │  │                    ┌─────────────────┐                               │ │
  │  │                    │  Route Handler  │                               │ │
  │  │                    └────────┬────────┘                               │ │
  │  └─────────────────────────────┼───────────────────────────────────────┘ │
  │                                │                                          │
  │         ┌──────────────────────┼──────────────────────┐                  │
  │         ▼                      ▼                      ▼                  │
  │  ┌──────────────┐       ┌──────────────┐       ┌──────────────┐         │
  │  │  my-wallet   │       │ my-dashboard │       │   gateway    │         │
  │  │   backend    │       │   backend    │       │   manager    │         │
  │  │ :4008        │       │ :4009        │       │  (internal)  │         │
  │  └──────┬───────┘       └──────┬───────┘       └──────────────┘         │
  │         │                      │                                         │
  │         ▼                      ▼                                         │
  │  ┌──────────────────────────────────────────────────────────────────┐   │
  │  │                    PostgreSQL Database                            │   │
  │  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  │   │
  │  │  │ naap_base  │  │ my_wallet  │  │my_dashboard│  │  shared    │  │   │
  │  │  │  schema    │  │  schema    │  │  schema    │  │  tables    │  │   │
  │  │  └────────────┘  └────────────┘  └────────────┘  └────────────┘  │   │
  │  └──────────────────────────────────────────────────────────────────┘   │
  └─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Multi-Tenant Deployment Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       MULTI-TENANT PLUGIN DEPLOYMENT                         │
└─────────────────────────────────────────────────────────────────────────────┘

                          ┌─────────────────────────────────┐
                          │       PluginPackage             │
                          │  (e.g., "myWallet")             │
                          │  - name, displayName            │
                          │  - category, icon               │
                          │  - isCore: false                │
                          └────────────┬────────────────────┘
                                       │
                                       │ has versions
                                       ▼
                          ┌─────────────────────────────────┐
                          │       PluginVersion             │
                          │  - version: "1.0.0"             │
                          │  - frontendUrl: CDN URL         │
                          │  - backendImage: docker:tag     │
                          │  - manifest: JSON               │
                          └────────────┬────────────────────┘
                                       │
                                       │ deployed as
                                       ▼
                          ┌─────────────────────────────────┐
                          │      PluginDeployment           │
                          │  (ONE per plugin - shared)      │
                          │  - status: 'running'            │
                          │  - frontendUrl: actual URL      │
                          │  - backendUrl: actual URL       │
                          │  - activeInstalls: 47           │◀──── Reference count
                          │  - healthStatus: 'healthy'      │
                          └────────────┬────────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
         ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
         │ TeamPluginInstall│ │ TeamPluginInstall│ │TenantPluginInstall│
         │  Team A          │ │  Team B          │ │  Personal User    │
         │  - sharedConfig  │ │  - sharedConfig  │ │  - userConfig     │
         │  - enabled: true │ │  - enabled: true │ │  - enabled: true  │
         └────────┬─────────┘ └────────┬─────────┘ └──────────────────┘
                  │                    │
                  ▼                    ▼
         ┌──────────────────┐ ┌──────────────────┐
         │TeamMemberPlugin  │ │TeamMemberPlugin  │
         │  Access          │ │  Access          │
         │  - visible: true │ │  - visible: true │
         │  - canUse: true  │ │  - canConfigure  │
         │  - personalConfig│ │  - personalConfig│
         └──────────────────┘ └──────────────────┘
```

---

## 5. Event Communication

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EVENT BUS COMMUNICATION                              │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
  │   Shell     │         │  EventBus   │         │   Plugin    │
  │             │         │ (Singleton) │         │             │
  └──────┬──────┘         └──────┬──────┘         └──────┬──────┘
         │                       │                       │
         │ emit('team:change')   │                       │
         │──────────────────────▶│                       │
         │                       │ on('team:change')     │
         │                       │──────────────────────▶│
         │                       │                       │
         │                       │   emit('wallet:connected')
         │                       │◀──────────────────────│
         │ on('wallet:connected')│                       │
         │◀──────────────────────│                       │
         │                       │                       │

  ┌─────────────────────────────────────────────────────────────────────────┐
  │ Standard Events:                                                         │
  │                                                                           │
  │ Shell → Plugins:              Plugins → Shell:                           │
  │ ├─ team:change               ├─ wallet:connected                         │
  │ ├─ auth:login                ├─ wallet:disconnected                      │
  │ ├─ auth:logout               ├─ plugin:config:changed                    │
  │ ├─ theme:change              └─ plugin:error                             │
  │ ├─ plugin:installed                                                      │
  │ └─ plugin:uninstalled        Plugin → Plugin (via EventBus):             │
  │                              └─ Any custom event                          │
  └─────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Scalability Architecture Assessment

### Current Single-Instance Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CURRENT: SINGLE DEPLOYMENT MODEL                          │
└─────────────────────────────────────────────────────────────────────────────┘

  Users (1-1000)
      │
      ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                          Load Balancer                                    │
  └──────────────────────────────┬──────────────────────────────────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          ▼                      ▼                      ▼
  ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
  │  Shell Web   │       │  Shell Web   │       │  Shell Web   │
  │  Instance 1  │       │  Instance 2  │       │  Instance 3  │
  └──────────────┘       └──────────────┘       └──────────────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                   Plugin CDN (Static Assets)                              │
  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
  │  │my-wallet │  │dashboard │  │ gateway  │  │ market   │                 │
  │  │remote.js │  │remote.js │  │remote.js │  │remote.js │                 │
  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘                 │
  └─────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                     Single Plugin Backend                                 │
  │  ┌──────────────────────────────────────────────────────────────────┐   │
  │  │                    my-wallet-svc :4008                            │   │
  │  │  - Single Node.js process                                         │   │
  │  │  - In-memory rate limiting                                        │   │
  │  │  - Direct DB connection                                           │   │
  │  └──────────────────────────────────────────────────────────────────┘   │
  │                                 │                                        │
  │                                 ▼                                        │
  │  ┌──────────────────────────────────────────────────────────────────┐   │
  │  │                PostgreSQL (Single Instance)                       │   │
  │  └──────────────────────────────────────────────────────────────────┘   │
  └─────────────────────────────────────────────────────────────────────────┘

  BOTTLENECKS:
  ├─ Single backend process (CPU/Memory bound)
  ├─ In-memory rate limiting (not shared across instances)
  ├─ Single database connection pool
  └─ No horizontal scaling for plugin backends
```

### Scalable Model for 100K+ Users

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   SCALED: DISTRIBUTED PLUGIN ARCHITECTURE                    │
└─────────────────────────────────────────────────────────────────────────────┘

  Users (100K+)
      │
      ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                    Global CDN (CloudFlare/Fastly)                         │
  │  - Edge caching for static assets                                         │
  │  - Geographic distribution                                                │
  │  - DDoS protection                                                        │
  └──────────────────────────────┬──────────────────────────────────────────┘
                                 │
      ┌──────────────────────────┼──────────────────────────────┐
      ▼                          ▼                              ▼
  ┌──────────┐             ┌──────────┐                  ┌──────────┐
  │CDN Edge  │             │CDN Edge  │                  │CDN Edge  │
  │ US-West  │             │ EU-West  │                  │ AP-East  │
  └────┬─────┘             └────┬─────┘                  └────┬─────┘
       │                        │                              │
       │ Cache: UMD bundles, chunks, assets                     │
       │                        │                              │
       └────────────────────────┼──────────────────────────────┘
                                │
                                ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                      API Gateway (Kong/AWS API Gateway)                   │
  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐                │
  │  │ Rate Limiting │  │ Auth Validate │  │ Request Route │                │
  │  │ (Redis-based) │  │ (JWT/Session) │  │ (per plugin)  │                │
  │  └───────────────┘  └───────────────┘  └───────────────┘                │
  └──────────────────────────────┬──────────────────────────────────────────┘
                                 │
       ┌─────────────────────────┼─────────────────────────┐
       ▼                         ▼                         ▼
  ┌──────────────┐        ┌──────────────┐         ┌──────────────┐
  │ base-svc     │        │ my-wallet-svc│         │my-dashboard  │
  │ Kubernetes   │        │ Kubernetes   │         │ Kubernetes   │
  │ Deployment   │        │ Deployment   │         │ Deployment   │
  └──────┬───────┘        └──────┬───────┘         └──────┬───────┘
         │                       │                        │
         │                       │                        │
         ▼                       ▼                        ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │                    Kubernetes Cluster                                  │
  │                                                                        │
  │  my-wallet-svc:                                                       │
  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐         │
  │  │ Pod 1   │ │ Pod 2   │ │ Pod 3   │ │ Pod 4   │ │ Pod N   │         │
  │  │ :4008   │ │ :4008   │ │ :4008   │ │ :4008   │ │ :4008   │         │
  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘         │
  │       │           │           │           │           │               │
  │       └───────────┴───────────┴───────────┴───────────┘               │
  │                               │                                        │
  │  HPA (Horizontal Pod Autoscaler):                                     │
  │  - Scale on CPU > 70%                                                 │
  │  - Scale on Memory > 80%                                              │
  │  - Scale on request queue depth                                       │
  │  - Min: 3 pods, Max: 50 pods                                          │
  │                               │                                        │
  └───────────────────────────────┼────────────────────────────────────────┘
                                  │
       ┌──────────────────────────┼──────────────────────────┐
       ▼                          ▼                          ▼
  ┌──────────────┐         ┌──────────────┐          ┌──────────────┐
  │    Redis     │         │  PostgreSQL  │          │ Object Store │
  │   Cluster    │         │   Cluster    │          │   (S3/GCS)   │
  │              │         │              │          │              │
  │ - Sessions   │         │ - Primary    │          │ - Uploads    │
  │ - Rate limit │         │ - 2 Replicas │          │ - Backups    │
  │ - Cache      │         │ - PgBouncer  │          │ - Assets     │
  │ - Pub/Sub    │         │   (pooling)  │          │              │
  └──────────────┘         └──────────────┘          └──────────────┘
```

---

## 7. Scaling Requirements by User Count

| Users | Frontend | Backend | Database | Cache | Monitoring |
|-------|----------|---------|----------|-------|------------|
| 1K | Single CDN | 1 instance | Single DB | Optional | Basic logs |
| 10K | CDN + cache | 2-3 instances | Primary + replica | Redis | APM |
| 50K | Multi-region CDN | 5-10 pods + HPA | Read replicas | Redis cluster | Full observability |
| 100K+ | Global CDN | 20+ pods, multi-region | Sharded/partitioned | Redis cluster | Distributed tracing |

---

## 8. Plugin Developer Checklist for Scalability

### Frontend (Mandatory)
```
□ Use code splitting (dynamic imports for large components)
□ Lazy load heavy dependencies
□ Implement loading states and skeletons
□ Cache API responses appropriately
□ Handle offline/degraded states gracefully
□ Minimize bundle size (< 500KB gzipped)
□ Use shared dependencies from shell (React, etc.)
```

### Backend (Mandatory)
```
□ Stateless design (no in-memory sessions)
□ External session store (Redis)
□ Connection pooling (PgBouncer or similar)
□ Distributed rate limiting (Redis-based)
□ Health check endpoint (/healthz)
□ Graceful shutdown handling
□ Request timeout configuration
□ Error tracking integration (Sentry/etc.)
```

### Database (Mandatory)
```
□ Indexed queries (no full table scans)
□ Connection pool limits configured
□ Query timeout set
□ Prepared statements used
□ No N+1 query patterns
□ Pagination on list endpoints
□ Soft deletes for audit trail
```

### Deployment (Mandatory)
```
□ Docker containerization
□ Resource limits defined (CPU/Memory)
□ Liveness and readiness probes
□ Rolling deployment strategy
□ Environment-based configuration
□ Secrets management (not hardcoded)
□ Log aggregation configured
```

---

## 9. Plugin Isolation Guarantees

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PLUGIN ISOLATION BOUNDARIES                             │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────┐
  │ FRONTEND ISOLATION                                                        │
  │                                                                           │
  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                  │
  │  │  Plugin A   │    │  Plugin B   │    │  Plugin C   │                  │
  │  │  (my-wallet)│    │ (dashboard) │    │  (gateway)  │                  │
  │  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                  │
  │         │                  │                  │                          │
  │         │   Shared: React, ReactDOM (via UMD globals)                    │
  │         │   Isolated: Plugin code, state, styles                         │
  │         │                  │                  │                          │
  │  ┌──────┴──────────────────┴──────────────────┴──────┐                  │
  │  │                     Shell Host                      │                  │
  │  │  - Manages plugin mounting/unmounting               │                  │
  │  │  - Provides ShellContext (read-only for plugins)   │                  │
  │  │  - Controls navigation and routing                  │                  │
  │  └─────────────────────────────────────────────────────┘                  │
  └─────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────┐
  │ BACKEND ISOLATION                                                         │
  │                                                                           │
  │  Plugin A Backend          Plugin B Backend          Plugin C Backend    │
  │  ┌─────────────┐          ┌─────────────┐          ┌─────────────┐      │
  │  │ :4008       │          │ :4009       │          │ :4010       │      │
  │  │ CPU: 500m   │          │ CPU: 1000m  │          │ CPU: 250m   │      │
  │  │ Mem: 512Mi  │          │ Mem: 1Gi    │          │ Mem: 256Mi  │      │
  │  └──────┬──────┘          └──────┬──────┘          └──────┬──────┘      │
  │         │                        │                        │              │
  │  ┌──────┴────┐            ┌──────┴────┐            ┌──────┴────┐        │
  │  │ DB Schema │            │ DB Schema │            │ DB Schema │        │
  │  │ my_wallet │            │ dashboard │            │  gateway  │        │
  │  └───────────┘            └───────────┘            └───────────┘        │
  │                                                                           │
  │  ISOLATION GUARANTEES:                                                   │
  │  ✓ Separate process/container (crash isolation)                          │
  │  ✓ Resource limits (CPU/Memory quotas)                                   │
  │  ✓ Database schema isolation (no cross-plugin access)                    │
  │  ✓ Network policies (can restrict inter-plugin communication)            │
  │  ✓ Independent scaling (each plugin scales independently)                │
  │  ✓ Independent deployment (deploy without affecting others)              │
  └─────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Preventing Plugin Loading Failures

The plugin-server must be running for plugins to load. Here's how to ensure reliability:

### Development Environment
```bash
# Add to bin/start.sh - Health check loop
start_with_health_check() {
  local service=$1
  local port=$2
  local max_retries=30

  # Start service
  nohup npx tsx src/server.ts > logs/$service.log 2>&1 &

  # Wait for health
  for i in $(seq 1 $max_retries); do
    if curl -s http://localhost:$port/healthz > /dev/null; then
      echo "✓ $service is healthy"
      return 0
    fi
    sleep 1
  done
  echo "✗ $service failed to start"
  return 1
}

# Usage
start_with_health_check "plugin-server" 3100
start_with_health_check "base-svc" 4000
```

### Production Environment
```yaml
# Kubernetes deployment with health checks
apiVersion: apps/v1
kind: Deployment
metadata:
  name: plugin-server
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: plugin-server
        livenessProbe:
          httpGet:
            path: /healthz
            port: 3100
          initialDelaySeconds: 10
          periodSeconds: 5
        readinessProbe:
          httpGet:
            path: /healthz
            port: 3100
          initialDelaySeconds: 5
          periodSeconds: 3
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 500m
            memory: 512Mi
```

---

## Summary

The NaaP plugin architecture provides:

1. **UMD/CDN bundles** for dynamic loading of micro-frontends
2. **Multi-tenant deployment** with reference counting for efficient resource usage
3. **Strong isolation** between plugins at both frontend and backend levels
4. **Event-driven communication** for loose coupling
5. **Scalability path** from single instance to 100K+ users

For production at scale, focus on:
- CDN for static assets
- Kubernetes for backend scaling
- Redis for distributed state
- Database connection pooling
- Comprehensive monitoring
