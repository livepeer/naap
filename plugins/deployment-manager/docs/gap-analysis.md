# Gap Analysis: NaaP Deployment Manager vs Chutes.ai Custom Chutes

This document compares the NaaP Deployment Manager plugin with [Chutes.ai Custom Chutes](https://chutes.ai/custom-chutes).

---

## Chutes.ai Custom Chutes Flow

1. **Define Image**: Python `Image()` builder — base OS, install deps, set workdir, layer caching
2. **Define Chute**: `Chute()` with name, image, `NodeSelector`(gpu_count, min_vram), concurrency, `@chute.cord()` decorators with Pydantic schemas
3. **Deploy**: `chutes deploy <ref> --accept-fee` — uploads image, registers, creates config

---

## NaaP Deployment Manager Flow

1. **Choose Template**: Curated (AI Runner, Scope) or custom Docker image
2. **Configure Resources**: Pick provider (6 options + SSH bridge), GPU model/VRAM/count, env vars, concurrency, cost preview
3. **Deploy & Monitor**: One-click deploy with live status, health monitoring, version badges, retry

---

## Gap Analysis Table

| Feature | Chutes.ai | NaaP | Status | Notes |
|---------|-----------|------|--------|-------|
| Image Building | Built-in `Image()` builder with `run_command()`, layer caching | Pre-built Docker images only | OPEN | Future: Dockerfile builder or registry integration |
| API Endpoint Definition | `@chute.cord()` decorators with Pydantic schemas | Deploys containers as-is | OPEN | Future: custom endpoint definition layer |
| Concurrency Control | `concurrency=N` per chute | `concurrency` config in DeployConfig, passed to provider scaling | **CLOSED** | Implemented in all 6 adapters |
| Auto-scaling | Built-in | Provider-native (fal.ai, RunPod) | LOW | Already handled by providers |
| Cost/Fee Visibility | Shows fee before deploy | CostEstimationService + CostPreview component in Step 2 | **CLOSED** | Color-coded hourly/daily/monthly with GPU breakdown |
| Startup Hooks | `@chute.on_startup()` | Container is the startup | N/A | Container lifecycle is the startup |
| Persistent Storage | Full DB | PrismaDeploymentStore backed by PostgreSQL (ServerlessDeployment model) | **CLOSED** | IDeploymentStore abstraction with InMemory fallback |
| Auth Propagation | Built-in | `providerFetch()` utility with per-user SecretStore for auth injection | **CLOSED** | All 6 adapters use centralized auth context |
| Credential Management | N/A (single platform) | Per-user SecretStore with save/test/status UI per provider | **CLOSED** | ProviderCredentialConfig component |
| Template Marketplace | N/A | Only 2 hardcoded + custom | OPEN | Future: template sharing/import |
| Log Streaming | Built-in | Only SSH bridge has logs | OPEN | Future: add for serverless |
| Environment Variables | Env config support | `envVars` config in DeployConfig + EnvVarsEditor UI component | **CLOSED** | Injected as `-e` flags (SSH) or `env` field (serverless) |
| Health Customization | Basic | Configurable port/endpoint per template | **NaaP ADVANTAGE** | |
| Multi-Provider | Single platform | 6 providers + SSH bridge | **NaaP ADVANTAGE** | |
| Version Management | Manual | GitHub releases polling + update badges | **NaaP ADVANTAGE** | |
| Monitoring UI | Basic dashboard | Traffic light health, deployment list, detail, audit | **NaaP ADVANTAGE** | |

---

## Closed Gaps (This PR)

1. **Persistent Storage** — `IDeploymentStore` interface with `InMemoryDeploymentStore` (testing/fallback) and `PrismaDeploymentStore` (production). Orchestrator refactored to use the store abstraction. Prisma schema extended with `envVars`, `concurrency`, `estimatedCostPerHour` fields.

2. **Auth Propagation** — Centralized `providerFetch()` utility in `lib/providerFetch.ts` with per-user `SecretStore` for credential management. Express middleware extracts auth headers from incoming requests. Each adapter calls upstream APIs directly with injected auth.

4. **Cost Estimation** — `CostEstimationService` with hardcoded per-provider GPU pricing tables + fallback to adapter `getGpuOptions()` pricing. `CostPreview` React component renders color-coded cost cards (green/yellow/red) with hourly/daily/monthly breakdown. Integrated in Step 2 of DeploymentWizard.

5. **Environment Variables** — `envVars: Record<string, string>` added to `DeployConfig`, `UpdateConfig`, validation schemas, and all 6 adapters. SSH bridge injects as `docker run -e KEY=VALUE` flags. Serverless providers pass as `env` field in API payloads. `EnvVarsEditor` React component provides key-value pair editing UI.

6. **Concurrency Control** — `concurrency: number` added to `DeployConfig`, validation (1-100), and all serverless adapters (maps to `max_concurrency`, `maxWorkers`, `max_instances`, `max_containers`, `max_replica`). Configurable in Step 2 of DeploymentWizard.

---

## Remaining Open Gaps

1. **Image Building / Dockerfile Support** — Dockerfile editor or container registry integration for custom image building
2. **API Endpoint Definition** — Custom endpoint definition layer with schema validation
3. **Template Marketplace** — Template sharing, import/export, community templates
4. **Log Streaming for Serverless** — Real-time log streaming from serverless providers

---

## NaaP Advantages Over Chutes.ai

1. **Multi-provider support** — 6 serverless providers + SSH bridge vs single platform
2. **Curated template system** with GitHub releases version management
3. **Comprehensive health monitoring** with traffic light system
4. **Audit trail** with full action logging
5. **Extensible adapter pattern** — add new providers via `IProviderAdapter`
6. **Rate limiting** on API endpoints
7. **SSH bridge** for bare-metal / VM deployments (unique capability)
8. **Cost estimation** with per-provider GPU pricing and visual breakdown
9. **Persistent storage** with PostgreSQL via Prisma ORM
10. **Direct provider API integration** with per-user credential management
