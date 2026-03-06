# Deployment Manager — Architecture Documentation

## 1. Plugin Architecture Diagram (ASCII art)

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           DEPLOYMENT MANAGER PLUGIN                                        │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │  FRONTEND (React SPA)                                                              │   │
│  │  • Dev: port 3117                                                                  │   │
│  │  • Prod: CDN bundle at /cdn/plugins/deployment-manager/                            │   │
│  │                                                                                    │   │
│  │  Pages: DeploymentWizard (3-step), DeploymentList, DeploymentDetail,               │   │
│  │         ProviderSettings, AuditPage                                                │   │
│  │                                                                                    │   │
│  │  Components: TemplateSelector, ProviderSelector, GpuConfigForm, SshHostConfig,   │   │
│  │              HealthIndicator, VersionBadge, DeploymentLogs, StatusTimeline,       │   │
│  │              AuditTable, ArtifactSelector, ProviderCredentialConfig               │   │
│  │                                                                                    │   │
│  │  Hooks: useDeployments, useProviders, useGpuOptions, useHealthPolling              │   │
│  └──────────────────────────────────────────────────┬──────────────────────────────┘   │
│                                                       │                                 │
│                                                       │ HTTP /api/v1/deployment-manager │
│                                                       ▼                                 │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │  BACKEND (Express.js, port 4117)                                                 │   │
│  │                                                                                    │   │
│  │  Routes: /providers, /deployments, /templates, /health, /audit, /credentials      │   │
│  │                                                                                    │   │
│  │  Services:                                                                         │   │
│  │  • DeploymentOrchestrator — state machine (PENDING→DEPLOYING→VALIDATING→ONLINE,   │   │
│  │    with UPDATING, FAILED, DESTROYED)                                              │   │
│  │  • ProviderAdapterRegistry — Strategy pattern for provider adapters               │   │
│  │  • TemplateRegistry — curated + custom templates                                   │   │
│  │  • HealthMonitorService — periodic health polling                                  │   │
│  │  • VersionCheckerService — GitHub releases polling                                │   │
│  │  • AuditService — action logging                                                   │   │
│  │  • RateLimiter — request throttling                                                │   │
│  │  • SecretStore — per-user credential storage                                       │   │
│  │                                                                                    │   │
│  │  Adapters (IProviderAdapter → providerFetch → upstream API):                       │   │
│  │  FalAdapter     → https://rest.fal.ai                                              │   │
│  │  RunPodAdapter   → https://rest.runpod.io/v1                                       │   │
│  │  ReplicateAdapter→ https://api.replicate.com/v1                                    │   │
│  │  BasetenAdapter  → https://api.baseten.co/v1                                       │   │
│  │  ModalAdapter    → https://api.modal.com/v1                                        │   │
│  │  SshBridgeAdapter→ http://localhost:2222 (SSH Bridge service)                       │   │
│  └──────────────────────────────────────────────────┬──────────────────────────────┘   │
│                                                       │                                 │
│                                               providerFetch (direct)                    │
│                                                       │                                 │
│                                                       ▼                                 │
│                                     ┌─────────────────────────────────────────┐         │
│                                     │  Upstream Provider APIs (direct calls)  │         │
│                                     │  No service-gateway dependency          │         │
│                                     └─────────────────────────────────────────┘         │
│                                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │  DATABASE (PostgreSQL, schema: plugin_deployment_manager)                          │   │
│  │  • ServerlessDeployment — deployment records                                      │   │
│  │  • DmDeploymentStatusLog — status transition log                                  │   │
│  │  • DmDeploymentAuditLog — action audit trail                                      │   │
│  │  • DmDeploymentHealthLog — health check results                                    │   │
│  │  • DmProviderAuthConfig — provider auth configs                                     │   │
│  │  • DmDeploymentTemplate — deployment templates                                     │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                           │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

## 2. Deployment Control Flow (Mermaid sequence diagram)

```mermaid
sequenceDiagram
    actor User
    participant Frontend as Frontend (React)
    participant Backend as Backend (Express)
    participant Orchestrator as DeploymentOrchestrator
    participant Adapter as ProviderAdapter
    participant Provider as Provider API (fal/runpod/etc)
    participant HealthMonitor as HealthMonitorService
    participant VersionChecker as VersionCheckerService

    %% Step 0: Template selection
    User->>Frontend: Select template in wizard (Step 0)
    Frontend->>Backend: GET /templates
    Backend-->>Frontend: templates list

    %% Step 1: Provider + GPU config
    User->>Frontend: Configure provider + GPU (Step 1)
    Frontend->>Backend: GET /providers/:slug/gpu-options
    Backend-->>Frontend: GPU options

    %% Step 2: Deploy action
    User->>Frontend: Click Deploy (Step 2)
    Frontend->>Backend: POST /deployments (create config)
    Backend->>Orchestrator: create(config)
    Orchestrator->>Orchestrator: PENDING
    Backend-->>Frontend: deployment ID

    Frontend->>Backend: POST /deployments/:id/deploy
    Backend->>Orchestrator: deploy(id)
    Orchestrator->>Orchestrator: PENDING → DEPLOYING

    Orchestrator->>Adapter: deploy(config)
    Adapter->>Provider: providerFetch (direct HTTP to upstream API)
    Provider-->>Adapter: response
    Adapter-->>Orchestrator: ProviderDeployment (providerDeploymentId, endpointUrl)

    alt SSH Bridge mode
        loop poll until ONLINE/FAILED
            Orchestrator->>Adapter: getStatus(providerDeploymentId)
            Adapter->>Provider: providerFetch (direct)
            Provider-->>Adapter: status
            Adapter-->>Orchestrator: ONLINE or FAILED
        end
    end

    Orchestrator->>Orchestrator: → VALIDATING
    Orchestrator->>Adapter: healthCheck(providerDeploymentId, endpointUrl)
    Adapter->>Provider: providerFetch (health endpoint)
    Provider-->>Adapter: health response
    Adapter-->>Orchestrator: HealthResult

    alt healthy
        Orchestrator->>Orchestrator: ONLINE (GREEN)
    else unhealthy
        Orchestrator->>Orchestrator: FAILED (RED)
    end

    Orchestrator-->>Backend: DeploymentRecord
    Backend-->>Frontend: deployment

    %% Background services
    loop periodic
        HealthMonitor->>Orchestrator: list(ONLINE)
        HealthMonitor->>Adapter: healthCheck each deployment
        HealthMonitor->>Orchestrator: update healthStatus (GREEN/ORANGE/RED)
    end

    loop periodic (e.g. 30 min)
        VersionChecker->>Orchestrator: list(ONLINE)
        VersionChecker->>VersionChecker: getLatestVersion (GitHub releases)
        VersionChecker->>Orchestrator: set hasUpdate, latestAvailableVersion
    end
```

## 3. State Machine Diagram (Mermaid state diagram)

```mermaid
stateDiagram-v2
    [*] --> PENDING: create

    PENDING --> DEPLOYING: deploy
    PENDING --> DESTROYED: destroy

    DEPLOYING --> VALIDATING: deployed (adapter returns)
    DEPLOYING --> FAILED: error

    VALIDATING --> ONLINE: healthy (healthCheck OK)
    VALIDATING --> FAILED: unhealthy (healthCheck fails)

    ONLINE --> UPDATING: update
    ONLINE --> DESTROYED: destroy

    UPDATING --> VALIDATING: updated (adapter returns)
    UPDATING --> FAILED: error

    FAILED --> DEPLOYING: retry
    FAILED --> DESTROYED: destroy

    DESTROYED --> [*]
```

**Valid transitions (from code):**

| From      | To                                  |
|-----------|-------------------------------------|
| PENDING   | DEPLOYING, DESTROYED                |
| DEPLOYING | VALIDATING, FAILED                  |
| VALIDATING| ONLINE, FAILED                     |
| ONLINE    | UPDATING, DESTROYED                 |
| UPDATING  | VALIDATING, FAILED                  |
| FAILED    | DEPLOYING, DESTROYED                |
| DESTROYED | (terminal)                          |

## 4. Service Dependency Graph

```
                    ┌───────────────────────────────┐
                    │  ProviderAdapterRegistry      │
                    │  (Strategy pattern)           │
                    └───────────────┬───────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
            ▼                       ▼                       ▼
┌───────────────────────┐ ┌───────────────────────┐ ┌─────────────────────┐
│ DeploymentOrchestrator │ │ HealthMonitorService   │ │ Routes: /providers   │
│ (state machine)        │◄│ (periodic polling)     │ │ /providers/:slug/   │
└───────────┬───────────┘ └───────────┬───────────┘ │ gpu-options          │
            │                           │             └─────────────────────┘
            │  uses registry.get(slug)  │
            │  for healthCheck          │
            │                           │
            ├───────────────────────────┼───────────────────────────────────┐
            │                           │                                   │
            ▼                           ▼                                   ▼
┌───────────────────┐     ┌───────────────────┐               ┌───────────────────┐
│ AuditService       │     │ TemplateRegistry  │               │ Routes:            │
│ (action log)       │     │ (curated+custom)  │               │ /deployments       │
└───────────────────┘     └─────────┬─────────┘               │ /templates         │
                                    │                          │ /health            │
                                    │                          │ /audit             │
                                    ▼                          │ /credentials       │
                        ┌───────────────────────┐             └───────────────────┘
                        │ VersionCheckerService │
                        │ (GitHub releases)     │
                        └───────────┬───────────┘
                                    │
                                    │ depends on: orchestrator, templateRegistry
                        ┌───────────┴───────────┐
                        │ GithubReleasesAdapter │
                        │ → api.github.com      │
                        └───────────────────────┘

                        ┌───────────────────────┐
                        │ SecretStore            │
                        │ (per-user credentials) │
                        └───────────────────────┘
                            used by: /credentials routes
```

**Dependency summary:**

| Service                 | Depends on                                              |
|-------------------------|---------------------------------------------------------|
| DeploymentOrchestrator  | ProviderAdapterRegistry, AuditService                   |
| HealthMonitorService    | ProviderAdapterRegistry, DeploymentOrchestrator         |
| VersionCheckerService   | DeploymentOrchestrator, TemplateRegistry                |
| TemplateRegistry        | GithubReleasesAdapter (internal)                         |
| AuditService            | (none — standalone)                                     |
| SecretStore             | (none — standalone)                                     |
| RateLimiter             | (none — used by deployments router)                    |
| Routes /deployments     | DeploymentOrchestrator, RateLimiter                     |
| Routes /providers       | ProviderAdapterRegistry                                 |
| Routes /templates       | TemplateRegistry                                        |
| Routes /health          | HealthMonitorService, DeploymentOrchestrator             |
| Routes /audit           | AuditService                                            |
| Routes /credentials     | ProviderAdapterRegistry, SecretStore                     |

## 5. Key Design Decisions

### No Service Gateway Dependency

The deployment manager calls provider APIs **directly** via `providerFetch()`. Each adapter
defines its own `ProviderApiConfig` with the upstream URL and auth format. This eliminates:

- Connector provisioning and ownership complexity
- Double-hop latency (DM → Gateway proxy → upstream)
- Cross-plugin Prisma model coupling
- Mandatory `service-gateway` plugin dependency

### Provider Auth Injection

Each adapter's `ProviderApiConfig` declares:
- `authType`: `'bearer'`, `'header'`, or `'none'`
- `authHeaderTemplate`: e.g., `'Bearer {{secret}}'` or `'Key {{secret}}'`
- `secretNames`: which secrets are required (e.g., `['api-key']`)

The `credentials.ts` routes handle secret storage via `SecretStore`, and adapters receive
auth tokens injected at call time.

### Extensibility

Adding a new provider requires only:
1. Implement `IProviderAdapter` with a `ProviderApiConfig`
2. Register in `server.ts`
3. No gateway connector setup, no database migrations, no admin API calls
