# Livepeer Inference Adapter -- Implementation Plan

## Vision

Any developer can take any existing AI inference service -- whether self-hosted or on a serverless GPU provider (fal.ai, Replicate, RunPod) -- and bring it on-chain as a Livepeer network-enabled inference service, with zero changes to go-livepeer, zero dependency on ai-runner.

## Goal: Least Effort to On-Chain AI

The primary user journey (Topology 3 -- bring existing inference on-chain):

```
Step 1: Select "Livepeer Inference Adapter" template
Step 2: Pick your inference provider + model + API key
        Pick where to run orchestrator (SSH to your VM)
Step 3: Click Deploy

Everything else is auto-configured: orchestrator secret, capability name,
inter-container URLs, pricing defaults. Playground appears to test immediately.
```

---

## Context & Key Insight

### Current State

**go-livepeer** has two paths for AI inference:

1. **Built-in AI pipeline** -- Tightly coupled to ai-runner. ~8 files touched per pipeline addition.

2. **BYOC system** (`byoc/`) -- Already provides a generic external capability framework:
   - `POST /capability/register` -- register any HTTP service as a capability
   - `POST /capability/unregister` -- remove a capability
   - `POST /process/request/*` -- proxy requests to registered capability URL with payment
   - `GET /process/token` -- issue payment tokens for clients
   - Capacity management, payment processing, balance tracking -- all built-in

### Key Insight

**BYOC is already 90% of the answer.** The orchestrator side is done. What's missing is a thin adapter layer (~300-400 lines) that sits between "I have a running inference service" and "it's registered and working on Livepeer."

### Orchestrator-to-Inference Mapping: 1:N

One orchestrator serves many inference services. `ExternalCapabilities.Capabilities` is a `map[string]*ExternalCapability` -- each entry has its own name, URL, capacity, price, and load tracking.

---

## Phase 0: Spike -- Validate Prerequisites

**Before any implementation, validate two blockers:**

- [ ] **P0.1: go-livepeer Docker image supports BYOC flags** -- Confirm `livepeer/go-livepeer` Docker image can run as orchestrator with BYOC enabled (`-orchestrator`, `-orchSecret`, `-serviceAddr`, BYOC capability registration). If the official image doesn't support this, determine the minimal Dockerfile needed.
- [ ] **P0.2: BYOC API contract verification** -- Read `byoc/job_orchestrator.go` and `core/external_capabilities.go` in go-livepeer `master` branch. Confirm the exact JSON format for `/capability/register`, the required headers, and the `ExternalCapability` struct fields. Document the contract.

**Exit criteria:** A manually-started go-livepeer Docker container accepts `/capability/register` POST requests. The exact API contract is documented.

---

## Architecture

```
+---------------------------------------------------------------------+
|                        Livepeer Network                              |
|                                                                      |
|  +--------------+          +-------------------------------------+   |
|  | livepeer-sdk  |-------->|  Livepeer Orchestrator (go-livepeer) |   |
|  | (client)      |         |                                     |   |
|  +--------------+          |  BYOC Server (already exists):      |   |
|                            |   POST /capability/register         |   |
|                            |   POST /process/request/*  --proxy--+   |
|                            |   GET  /process/token               |   |
|                            +-------------------------------------+   |
|                                                                  |   |
|  +---------------------------------------------------------------v-+ |
|  |      livepeer-inference-adapter  (NEW -- lightweight sidecar)    | |
|  |                                                                  | |
|  |  Startup:  register capability with orchestrator                 | |
|  |  Runtime:  receive proxied requests -> forward to backend        | |
|  |  Health:   monitor backend, re-register on recovery              | |
|  |  Shutdown: unregister capability                                 | |
|  +------------------------------------------+-----------------------+ |
|                                             |                         |
|  +------------------------------------------v-----------------------+ |
|  |           Inference Backend (any HTTP service)                    | |
|  |                                                                   | |
|  |  Option A: Self-hosted container (TGI, vLLM, ComfyUI, etc.)     | |
|  |  Option B: Serverless proxy -> fal.ai / Replicate / RunPod API   | |
|  |  Option C: Any HTTP service with a POST endpoint                  | |
|  +-------------------------------------------------------------------+ |
+---------------------------------------------------------------------+
```

### Deployment Topologies

#### Topology 1: All-in-One Self-Hosted GPU

Everything on a single GPU machine with a public IP. Docker compose with 3 services: go-livepeer + adapter + model container.

**Best for:** Operators with GPU hardware who want full control.

#### Topology 2: All-on-Serverless-GPU (RunPod)

Same as Topology 1 but on a serverless GPU provider pod.

**Best for:** Operators who want GPU without managing hardware.

#### Topology 3: CPU Orchestrator + Remote Inference (PRIMARY)

**This is the primary topology for "bring existing AI on-chain."**

```
+----------------------------------------------------------+
|  CPU Machine (cheap VM, $5-20/mo, public IP)              |
|                                                           |
|  docker compose up (3 lightweight CPU services)           |
|                                                           |
|  go-livepeer orchestrator     :7935  (public)             |
|  livepeer/inference-adapter   :9090  (internal)           |
|  livepeer/serverless-proxy    :8080  (internal)           |
+-------------------------------|---------------------------+
                                |
                                v (HTTPS)
+----------------------------------------------------------+
|  Any existing inference service                           |
|  (fal.ai, Replicate, RunPod, HF, custom HTTP endpoint)   |
+----------------------------------------------------------+
```

**Any existing inference service can be brought to Livepeer -- no modification needed.**

### Request Flow

```
Client -> Orchestrator (verify payment, proxy) -> Adapter (forward) -> Backend (inference)
Response flows back: Backend -> Adapter -> Orchestrator -> Client
```

---

## Critical Integration Design: SSH Compose Adapter

### The Problem

The existing `SshBridgeAdapter` deploys a **single Docker container** per deployment. It generates a bash script with `docker run -d --name $containerName ...` and runs it via SSH. Its `destroy()`, `getStatus()`, and `healthCheck()` methods all assume a single container identified by name.

A Livepeer inference deployment requires **3 containers** (go-livepeer, adapter, proxy/model) managed as a unit via `docker compose`.

### The Solution: New `SshComposeAdapter` (SOLID-Compliant)

**Do NOT modify `SshBridgeAdapter`.** Instead, create a new adapter:

```
backend/src/adapters/SshComposeAdapter.ts   (NEW file)
```

`SshComposeAdapter implements IProviderAdapter` with slug `ssh-compose`:

```typescript
export class SshComposeAdapter implements IProviderAdapter {
  readonly slug = 'ssh-compose';
  readonly displayName = 'SSH Compose (Multi-Container)';
  readonly mode = 'ssh-bridge' as const;
  // ... same SSH bridge URL, same auth

  async getGpuOptions(): Promise<GpuOption[]> {
    // For Topology 3 (CPU), return a CPU-only option
    // For Topology 1, return full GPU list (same as SshBridgeAdapter)
    return [
      { id: 'CPU', name: 'CPU Only (no GPU)', vramGb: 0, available: true },
      { id: 'NVIDIA A100 80GB', name: 'NVIDIA A100 80GB', vramGb: 80, available: true },
      { id: 'NVIDIA H100 80GB', name: 'NVIDIA H100 80GB', vramGb: 80, available: true },
      { id: 'NVIDIA RTX 4090', name: 'NVIDIA RTX 4090', vramGb: 24, available: true },
      // ... same list as SshBridgeAdapter
    ];
  }

  async deploy(config: DeployConfig): Promise<ProviderDeployment> {
    // 1. SSH connect (same as SshBridgeAdapter)
    // 2. Read compose YAML from config.artifactConfig.composeYaml
    // 3. Generate deploy script:
    //    mkdir -p /opt/naap/<project>
    //    chmod 700 /opt/naap/<project>
    //    cat > /opt/naap/<project>/docker-compose.yml << 'COMPOSE_EOF'
    //    <compose yaml>
    //    COMPOSE_EOF
    //    chmod 600 /opt/naap/<project>/docker-compose.yml
    //    docker compose -p <project> -f /opt/naap/<project>/docker-compose.yml up -d
    //    # wait for health on adapter port
    // 4. Send script via /exec/script
    // 5. Return providerDeploymentId = "compose:<host>:<project>:<jobId>:<healthPort>:<healthEndpoint>"
  }

  async destroy(providerDeploymentId: string): Promise<void> {
    // Parse compose: prefix
    // Run: docker compose -p <project> down -v --remove-orphans
    // Run: rm -rf /opt/naap/<project>
  }

  async getStatus(providerDeploymentId: string): Promise<ProviderStatus> {
    // Same job-polling logic as SshBridgeAdapter
  }

  async update(providerDeploymentId: string, config: UpdateConfig): Promise<ProviderDeployment> {
    // 1. If config contains new composeYaml (in artifactConfig), overwrite remote compose file
    // 2. Run: docker compose -p <project> pull
    // 3. Run: docker compose -p <project> up -d --remove-orphans
    // 4. Wait for health
    // Returns same providerDeploymentId with new jobId
  }

  async healthCheck(providerDeploymentId: string, endpointUrl?: string): Promise<HealthResult> {
    // Curl adapter health port via SSH (same pattern as SshBridgeAdapter)
  }
}
```

**Why this works:**
- Same SSH bridge infrastructure (`/exec/script`, `/connect`)
- No changes to `SshBridgeAdapter`
- `ProviderAdapterRegistry` just registers one more adapter
- The wizard selects `ssh-compose` provider slug for Livepeer template
- All lifecycle operations (deploy/destroy/status/health) work correctly for multi-container

**`providerDeploymentId` format:** `compose:<host>:<project-name>:<jobId>:<healthPort>:<healthEndpoint>`

The `compose:` prefix distinguishes it from single-container deployments. The project name is the compose project name (`docker compose -p <project>`).

---

## Auto-Configuration Design

### Principle: Zero Manual Wiring

The NaaP wizard auto-generates all inter-component configuration. The user never manually sets `ORCH_URL`, `BACKEND_URL`, or `ORCH_SECRET`.

### What the User Provides vs. What NaaP Auto-Configures

| User Provides | NaaP Auto-Configures |
|---|---|
| Inference endpoint URL or provider + model | `BACKEND_URL` (docker compose service name) |
| Provider API key (if serverless) | Env var in serverless-proxy container |
| SSH host/user for orchestrator VM | SSH connection details |
| Public IP/domain (for orchestrator discovery) | go-livepeer `-serviceAddr` flag |
| | `ORCH_URL=http://go-livepeer:7935` (compose internal) |
| | `ORCH_SECRET` (auto-generated UUID) |
| | `CAPABILITY_NAME` (derived from model name) |
| | Docker network, health checks, restart policies |
| | All port mappings and service dependencies |

### LivepeerComposeBuilder: How It Generates YAML

```typescript
// NEW file: backend/src/services/LivepeerComposeBuilder.ts

export class LivepeerComposeBuilder {
  build(config: LivepeerInferenceConfig): string {
    const secret = config.orchestratorSecret || crypto.randomUUID();
    const capabilityName = config.capabilityName || this.deriveCapabilityName(config);

    // All inter-container URLs use compose service names -- auto-wired
    const orchUrl = 'http://go-livepeer:7935';
    const backendUrl = config.topology === 'split-cpu-serverless'
      ? 'http://serverless-proxy:8080'
      : 'http://model:8080';

    // Returns valid docker-compose YAML string
    // YAML values are sanitized to prevent injection
    return yaml.dump(composeObject);
  }

  // "fal-ai/flux/dev" -> "flux-dev"
  // "meta-llama/Llama-3.1-70B-Instruct" -> "llama-3-1-70b-instruct"
  deriveCapabilityName(config: LivepeerInferenceConfig): string { ... }
}
```

**YAML Sanitization:** All user-provided values (model IDs, API keys, hostnames) are sanitized before embedding in YAML. Use a proper YAML library (`js-yaml`) to generate the compose file -- never string interpolation.

### How LivepeerComposeBuilder Connects to the Deploy Flow

```
User clicks Deploy
  |
  v
DeploymentOrchestrator.create(config)
  |  config.providerSlug = 'ssh-compose'
  |  config.artifactConfig = {
  |    composeYaml: LivepeerComposeBuilder.build(livepeerConfig),
  |    composeProject: 'naap-livepeer-<timestamp>',
  |    topology: 'split-cpu-serverless',
  |    capabilityName: 'flux-dev',
  |    orchestratorSecret: '<auto-generated>',
  |  }
  v
DeploymentOrchestrator.deploy(id)
  |  registry.get('ssh-compose') -> SshComposeAdapter
  v
SshComposeAdapter.deploy(config)
  |  1. SSH connect
  |  2. Write config.artifactConfig.composeYaml to remote file
  |  3. docker compose up -d
  |  4. Wait for health
  v
Deployment ONLINE
```

**Key:** The `DeploymentOrchestrator` does NOT need modification. It already calls `adapter.deploy(config)` and passes through `artifactConfig`. The `SshComposeAdapter` reads `composeYaml` from `artifactConfig`.

### Data Storage: No Schema Changes Needed

Livepeer-specific data is stored in existing JSON columns:

| Field | Stored In | Example |
|---|---|---|
| Topology | `artifactConfig.topology` | `"split-cpu-serverless"` |
| Capability name | `artifactConfig.capabilityName` | `"flux-dev"` |
| Orchestrator secret | `artifactConfig.orchestratorSecret` | `"<uuid>"` |
| Compose project name | `artifactConfig.composeProject` | `"naap-livepeer-1709..."` |
| Compose YAML | `artifactConfig.composeYaml` | `"version: '3.8'..."` |
| Provider type | `artifactConfig.serverlessProvider` | `"fal-ai"` |

The `DeploymentRecord.artifactConfig` field (`Record<string, unknown>`) already exists and is used for template-specific configuration. No Prisma schema migration needed.

---

## Inference Playground Design

### Purpose

After deployment reaches ONLINE, the playground lets operators immediately test the full pipeline: client -> orchestrator -> adapter -> backend -> response.

### Design: New Component, Extends RequestTab Pattern

```
frontend/src/components/InferencePlayground.tsx    (NEW)
```

The `InferencePlayground` component:
1. Shows on deployment detail page when `templateId === 'livepeer-inference'`
2. Provides template-specific default request bodies (LLM chat, image gen, etc.)
3. Calls the existing `/deployments/:id/invoke` backend endpoint (reuses existing proxy)
4. Adds a "Pipeline Status" section checking adapter health + capability registration
5. Supports streaming display for LLM responses (SSE)

### Pipeline Status: New Endpoint in Existing Deployments Router

**Do NOT create a separate `inference.ts` route file.** Add to the existing `deployments.ts` router (consistent with existing pattern where all `/deployments/:id/*` routes live in one router):

```typescript
// In routes/deployments.ts (ADDITIVE -- new route handler at end of router)

router.get('/:id/pipeline-status', async (req, res) => {
  // Fetch deployment, check artifactConfig for livepeer-specific fields
  // Return: { adapterHealthy, backendReachable, capabilityRegistered }
});
```

This is ~20 lines added to an existing router, not a new file.

### Playground UI

```
+-------------------------------------------------------------------+
| Inference Playground                                               |
|                                                                    |
| Capability: flux-dev                        Status: [GREEN]       |
| Orchestrator: http://203.0.113.1:7935                             |
|                                                                    |
| Request Body (JSON):                                              |
| +---------------------------------------------------------------+ |
| | { "prompt": "a cat wearing a hat", "num_inference_steps": 28 }| |
| +---------------------------------------------------------------+ |
|                                                                    |
| [ Run Test ]                                                      |
|                                                                    |
| Response:                                    200 OK  |  3247ms   |
| +---------------------------------------------------------------+ |
| | { "images": [{ "url": "data:image/png;base64,..." }] }       | |
| +---------------------------------------------------------------+ |
|                                                                    |
| Pipeline Status:                                                   |
|   [OK] Adapter health         12ms                                |
|   [OK] Backend reachable      45ms                                |
|   [OK] Capability registered                                     |
+-------------------------------------------------------------------+
```

---

## Component Details

### Component 1: `livepeer-inference-adapter`

**Location:** `containers/livepeer-inference-adapter/` (NOT in npm workspaces, NOT in Nx, NOT in Vercel build)

```
containers/livepeer-inference-adapter/
|-- src/livepeer_adapter/
|   |-- __init__.py
|   |-- main.py              # Entry point, signal handlers
|   |-- config.py            # Load from env vars
|   |-- registrar.py         # Register/unregister with orchestrator BYOC
|   |-- proxy.py             # HTTP server: receive from orch -> forward to backend
|   \-- health.py            # Backend health monitoring
|-- Dockerfile
|-- pyproject.toml
|-- README.md
\-- tests/
    |-- test_config.py
    |-- test_registrar.py
    |-- test_proxy.py
    \-- test_health.py
```

### Component 2: Serverless Provider Proxy

**Location:** `containers/livepeer-serverless-proxy/`

```
containers/livepeer-serverless-proxy/
|-- src/serverless_proxy/
|   |-- __init__.py
|   |-- main.py
|   |-- server.py            # FastAPI: /health + /inference
|   \-- providers/
|       |-- base.py          # Abstract: health() + inference()
|       |-- fal_ai.py
|       |-- replicate.py
|       \-- runpod.py
|-- Dockerfile
|-- pyproject.toml
\-- tests/
```

### Component 3: NaaP Deployment Manager Integration

**All new files except 4 minimal additive changes:**

```
NEW files:
  backend/src/adapters/SshComposeAdapter.ts              # Multi-container SSH deploy
  backend/src/services/LivepeerComposeBuilder.ts         # Compose YAML generation
  backend/src/__tests__/ssh-compose-adapter.test.ts
  backend/src/__tests__/livepeer-compose-builder.test.ts
  backend/src/__tests__/bdd/livepeer-inference.feature.test.ts
  frontend/src/components/InferencePlayground.tsx         # Test playground
  frontend/src/components/LivepeerConfigForm.tsx          # Livepeer settings form
  frontend/src/__tests__/components/InferencePlayground.test.tsx
  frontend/src/__tests__/components/LivepeerConfigForm.test.tsx

ADDITIVE changes to existing files:
  backend/src/services/TemplateRegistry.ts    -> Add 1 entry to BUILT_IN_TEMPLATES array
  backend/src/server.ts                       -> Register SshComposeAdapter with ProviderAdapterRegistry
  backend/src/routes/deployments.ts           -> Add /:id/pipeline-status route handler (~20 lines)
  frontend/src/pages/DeploymentWizard.tsx     -> Conditional: show LivepeerConfigForm when template is livepeer
  frontend/src/pages/DeploymentDetail.tsx     -> Conditional: show InferencePlayground tab
```

### Template Registration

Added to `BUILT_IN_TEMPLATES` in `TemplateRegistry.ts`:

```typescript
{
  id: 'livepeer-inference',
  name: 'Livepeer Inference Adapter',
  description: 'Bring any AI inference service on-chain. Supports fal.ai, Replicate, RunPod, self-hosted, or any HTTP endpoint.',
  icon: '🔗',
  dockerImage: 'livepeer/inference-adapter',  // Primary image (adapter)
  healthEndpoint: '/health',
  healthPort: 9090,                           // Adapter health port
  defaultGpuModel: 'CPU',                     // Topology 3 default: no GPU needed
  defaultGpuVramGb: 0,
  category: 'curated',
  githubOwner: 'livepeer',
  githubRepo: 'go-livepeer',                  // For version checking
}
```

**Note on `dockerImage` field:** The `DeploymentTemplate` interface requires a single `dockerImage`. For the livepeer template, this is set to the adapter image (the primary component). The actual multi-container compose is generated by `LivepeerComposeBuilder` and stored in `artifactConfig.composeYaml`. The `dockerImage` field serves as the "canonical" image for display purposes and version tracking.

### Livepeer Types (added to `types/index.ts`)

```typescript
// ADDITIVE: new types, no existing types modified

export type LivepeerTopology = 'all-in-one' | 'all-on-provider' | 'split-cpu-serverless';

export interface LivepeerInferenceConfig {
  topology: LivepeerTopology;
  // Livepeer settings
  orchestratorSecret?: string;    // Auto-generated if omitted
  capabilityName?: string;        // Auto-derived from model if omitted
  pricePerUnit?: number;          // Default: 1000
  capacity?: number;              // Default: 4 (serverless), 1 (self-hosted)
  publicAddress?: string;         // For go-livepeer -serviceAddr
  // Model settings (topology 1 & 2)
  modelImage?: string;            // Docker image for model container
  // Serverless settings (topology 3)
  serverlessProvider?: string;    // fal-ai | replicate | runpod | custom
  serverlessApiKey?: string;
  serverlessModelId?: string;
  serverlessEndpointUrl?: string; // For custom HTTP endpoints
}
```

---

## Wizard Flow: How It Integrates with Existing Steps

### Existing Wizard Steps (unchanged for non-livepeer templates)

```
Step 0: Template        -> TemplateSelector (pick ai-runner, scope, custom, OR livepeer-inference)
Step 1: Resources       -> ProviderSelector, GpuConfigForm, SshHostConfig, EnvVarsEditor
Step 2: Deploy & Monitor -> Summary, Deploy button, status polling, logs
```

### Livepeer Template: Step 1 Changes

When `templateId === 'livepeer-inference'`, step 1 renders `LivepeerConfigForm` INSTEAD of the default GPU-centric resource config. This is handled by conditional rendering in `DeploymentWizard.renderStep1()`:

```typescript
// In DeploymentWizard.tsx (ADDITIVE change to renderStep1)
const renderStep1 = () => {
  if (selectedTemplate?.id === 'livepeer-inference') {
    return <LivepeerConfigForm
      form={form}
      onUpdate={updateForm}
      providers={providers}
    />;
  }
  // ... existing GPU-centric step 1 code (unchanged)
};
```

`LivepeerConfigForm` handles:
- Topology selection (Topology 3 default, Topology 1 for self-hosted, Topology 2 collapsed)
- Inference source config (provider dropdown, model ID, API key)
- SSH config for orchestrator VM (reuses existing `SshHostConfig` component)
- Collapsible advanced settings (capability name, pricing, capacity)

`canProceed()` modification for livepeer template (additive branch in existing switch):

```typescript
// In DeploymentWizard canProceed(), case 1 (ADDITIVE branch):
case 1:
  if (selectedTemplate?.id === 'livepeer-inference') {
    // Livepeer template: SSH host required, GPU not required for Topology 3
    if (!form.sshHost || !form.sshUsername) return false;
    // LivepeerConfigForm validates inference source internally
    return form.providerSlug === 'ssh-compose';
  }
  // ... existing GPU-centric validation (unchanged)
```

**Auto-selecting `ssh-compose` provider:** When template is selected in `handleSelectTemplate()`, auto-set the provider slug:

```typescript
// In handleSelectTemplate (ADDITIVE):
if (template.id === 'livepeer-inference') {
  updateForm('providerSlug', 'ssh-compose');
  updateForm('gpuModel', 'CPU');  // Default for Topology 3
  updateForm('gpuVramGb', 0);
}
```

This ensures:
- Provider slug is pre-set (user never picks `ssh-compose` from a dropdown)
- GPU model is pre-set to `'CPU'` so existing `canProceed` checks pass
- `LivepeerConfigForm` can override `gpuModel` if user selects Topology 1

### Step 2: Deploy & Monitor (extended)

After deployment reaches ONLINE, the `InferencePlayground` tab appears in `DeploymentDetail.tsx`:

```typescript
// In DeploymentDetail.tsx (ADDITIVE)
{deployment.templateId === 'livepeer-inference' && deployment.status === 'ONLINE' && (
  <InferencePlayground
    deploymentId={deployment.id}
    capabilityName={deployment.artifactConfig?.capabilityName}
    endpointUrl={deployment.endpointUrl}
  />
)}
```

---

## Branch Strategy & Environment Support

### Branch

```
Base:   feat/deployment-manager (latest)
Branch: feat/inference-adapter
```

### Local Development

```bash
# Start NaaP locally (existing flow)
npm run dev

# Build container images locally (only when testing actual deployments)
docker build -t livepeer/inference-adapter containers/livepeer-inference-adapter
docker build -t livepeer/serverless-proxy containers/livepeer-serverless-proxy
```

Frontend/backend plugin code runs in the existing NaaP dev server. Container images are only needed when deploying to a remote host.

### Vercel Production

No changes to Vercel build. The `containers/` directory:
- Not in npm workspaces (no `package.json`)
- Not in Nx project graph (no `project.json`)
- Not referenced by `vercel-build.sh`
- Container images built by separate CI/CD workflow

---

## Implementation Phases

### Phase 1: Core Adapter

**Goal:** A working adapter that registers any HTTP inference backend with a Livepeer BYOC orchestrator.

**Location:** `containers/livepeer-inference-adapter/`

**Tasks:**

- [ ] P1.1: Validate Phase 0 prerequisites (go-livepeer Docker + BYOC API contract)
- [ ] P1.2: Project scaffolding -- `containers/` directory, `pyproject.toml`, Dockerfile
- [ ] P1.3: Config module (`config.py`) -- env var loading, validation, defaults
- [ ] P1.4: Registrar module (`registrar.py`) -- register/unregister/heartbeat with BYOC
- [ ] P1.5: Proxy server (`proxy.py`) -- aiohttp server, request forwarding, SSE streaming
- [ ] P1.6: Health monitor (`health.py`) -- poll backend, state machine (WAITING/HEALTHY/UNHEALTHY)
- [ ] P1.7: Main entry point (`main.py`) -- wire modules, SIGTERM/SIGINT handlers
- [ ] P1.8: Dockerfile + docker-compose for testing

**Quality Gates:**

- [ ] P1.QG1: Design review -- module boundaries, config schema, BYOC API contract match
- [ ] P1.QG2: Code review -- Python code correctness, security, error handling
- [ ] P1.QG3: Unit tests -- >=85% coverage on config, registrar, proxy, health modules
- [ ] P1.QG4: BDD e2e tests

**BDD Scenarios:**

```gherkin
Feature: Adapter Lifecycle

  Scenario: Adapter registers capability on startup
    Given a healthy backend on port 8080
    And an orchestrator with BYOC enabled on port 7935
    When the adapter starts with CAPABILITY_NAME="test-model"
    Then the adapter registers "test-model" with the orchestrator
    And the adapter health endpoint returns 200

  Scenario: Adapter forwards inference request
    Given a registered adapter with capability "test-model"
    When the orchestrator proxies a POST request to the adapter
    Then the adapter forwards the request to the backend
    And returns the backend response to the orchestrator

  Scenario: Adapter unregisters on backend failure
    Given a registered adapter with a healthy backend
    When the backend health endpoint starts returning 503
    Then the adapter unregisters the capability
    And when the backend recovers, the adapter re-registers

  Scenario: Adapter unregisters on shutdown
    Given a registered adapter
    When the adapter receives SIGTERM
    Then the adapter unregisters the capability and exits cleanly

  Scenario: Adapter streams SSE responses
    Given a registered adapter with an SSE-capable backend
    When the orchestrator proxies a streaming POST request
    Then the adapter streams the SSE events back chunk-by-chunk
```

**Exit Criteria:** `docker run livepeer/inference-adapter` registers with go-livepeer BYOC, forwards requests, handles health monitoring, and shuts down cleanly.

---

### Phase 2: Serverless Provider Proxy

**Goal:** Thin HTTP service wrapping serverless APIs behind `/health` + `/inference` for Topology 3.

**Location:** `containers/livepeer-serverless-proxy/`

**Tasks:**

- [ ] P2.1: Project scaffolding -- directory, `pyproject.toml`, Dockerfile
- [ ] P2.2: Provider interface (`providers/base.py`) -- abstract `health()` + `inference()`
- [ ] P2.3: fal.ai provider -- queue API, polling, streaming
- [ ] P2.4: Replicate provider -- prediction API, polling
- [ ] P2.5: RunPod provider -- runsync/run API
- [ ] P2.6: HTTP server (`server.py`) -- FastAPI with `/health`, `/inference`
- [ ] P2.7: End-to-end test: adapter + proxy compose

**Quality Gates:**

- [ ] P2.QG1: Design review -- provider interface, error handling, timeout strategy
- [ ] P2.QG2: Code review -- all provider implementations
- [ ] P2.QG3: Unit tests -- >=85% coverage, mock provider APIs
- [ ] P2.QG4: BDD e2e tests

**BDD Scenarios:**

```gherkin
Feature: Serverless Proxy

  Scenario: Proxy forwards request to fal.ai
    Given a serverless proxy configured for fal.ai with a valid API key
    When a POST request is sent to /inference
    Then the proxy submits to fal.ai queue API
    And returns the inference result

  Scenario: Proxy reports unhealthy when provider is unreachable
    Given a serverless proxy configured for fal.ai
    When the fal.ai API is unreachable
    Then GET /health returns 503

  Scenario: Proxy handles provider queue polling
    Given a request submitted to fal.ai that enters the queue
    When the proxy polls for completion
    Then it returns the completed result when ready

  Scenario: Proxy returns error for invalid API key
    Given a serverless proxy with an invalid FAL_KEY
    When a POST request is sent to /inference
    Then it returns a 401 error with a clear message
```

**Exit Criteria:** Adapter + serverless-proxy compose successfully proxies a request through fal.ai.

---

### Phase 3: NaaP Integration -- Auto-Config Wizard + Playground

**Goal:** NaaP wizard deploys with auto-configured wiring. Playground tests the pipeline.

**Location:** `plugins/deployment-manager/`

**Tasks:**

- [ ] P3.1: `SshComposeAdapter` -- new provider adapter for multi-container SSH compose deployments
- [ ] P3.2: `LivepeerComposeBuilder` -- generates docker-compose YAML per topology with auto-wired env vars
- [ ] P3.3: Template registration -- add `livepeer-inference` to `BUILT_IN_TEMPLATES`
- [ ] P3.4: Livepeer types -- add `LivepeerInferenceConfig`, `LivepeerTopology` to `types/index.ts`
- [ ] P3.5: `LivepeerConfigForm` component -- topology + inference source + SSH + advanced settings
- [ ] P3.6: Wizard integration -- conditional rendering in step 1 for livepeer template
- [ ] P3.7: `InferencePlayground` component -- test deployed pipeline
- [ ] P3.8: Pipeline status endpoint -- `GET /:id/pipeline-status` in deployments router
- [ ] P3.9: DeploymentDetail integration -- show playground tab for livepeer deployments
- [ ] P3.10: Register `SshComposeAdapter` in `server.ts`
- [ ] P3.11: Deploy flow validation -- `canProceed()` logic for livepeer template

**Quality Gates:**

- [ ] P3.QG1: Design review -- wizard UX, compose correctness, SSH compose adapter lifecycle
- [ ] P3.QG2: Code review -- all new TS/TSX, verify no regressions
- [ ] P3.QG3: Unit tests -- >=85% coverage on SshComposeAdapter, LivepeerComposeBuilder, new components
- [ ] P3.QG4: BDD e2e tests

**BDD Scenarios -- Backend:**

```gherkin
Feature: Livepeer Inference Template

  Scenario: Template appears in template list
    Given the deployment manager is running
    When the user fetches templates
    Then "livepeer-inference" appears with category "curated"

  Scenario: Compose builder generates valid Topology 3 YAML
    Given a LivepeerInferenceConfig with topology "split-cpu-serverless"
    And serverlessProvider "fal-ai" and serverlessModelId "fal-ai/flux/dev"
    When LivepeerComposeBuilder.build() is called
    Then the YAML contains services: go-livepeer, inference-adapter, serverless-proxy
    And inference-adapter ORCH_URL is "http://go-livepeer:7935"
    And inference-adapter BACKEND_URL is "http://serverless-proxy:8080"
    And go-livepeer and inference-adapter share the same ORCH_SECRET

  Scenario: Compose builder generates valid Topology 1 YAML
    Given a LivepeerInferenceConfig with topology "all-in-one"
    And modelImage "ghcr.io/huggingface/text-generation-inference"
    When LivepeerComposeBuilder.build() is called
    Then the YAML contains services: go-livepeer, inference-adapter, model
    And the model service has runtime: nvidia configured

  Scenario: Capability name derived from model ID
    Given serverlessModelId "fal-ai/flux/dev"
    When deriveCapabilityName is called
    Then the result is "flux-dev"

  Scenario: SshComposeAdapter deploys compose via SSH
    Given a valid DeployConfig with providerSlug "ssh-compose"
    And artifactConfig containing composeYaml
    When SshComposeAdapter.deploy() is called
    Then it writes the compose file to the remote host
    And runs docker compose up -d
    And returns a providerDeploymentId with compose: prefix

  Scenario: SshComposeAdapter destroys compose deployment
    Given a deployed compose with project name "naap-livepeer-123"
    When SshComposeAdapter.destroy() is called
    Then it runs docker compose -p naap-livepeer-123 down
    And removes the compose directory

  Scenario: YAML values are sanitized
    Given a model ID containing YAML special characters ": {}"
    When the compose is generated
    Then the YAML is valid and the value is properly quoted

  Scenario: Pipeline status returns health info
    Given a deployed livepeer-inference deployment ONLINE
    When GET /deployments/:id/pipeline-status is called
    Then it returns adapter health status
```

**BDD Scenarios -- Frontend E2E:**

```gherkin
Feature: Livepeer Deployment Wizard

  Scenario: User deploys Topology 3 via wizard
    Given the user is on the deployment wizard
    When they select "Livepeer Inference Adapter" template
    And configure fal.ai provider with model "fal-ai/flux/dev" and API key
    And enter SSH host details for the orchestrator VM
    And click "Deploy Now"
    Then the deployment is created with providerSlug "ssh-compose"
    And artifactConfig contains auto-generated orchestratorSecret
    And artifactConfig.capabilityName is "flux-dev"

  Scenario: Playground appears after ONLINE
    Given a livepeer-inference deployment with status ONLINE
    When the user views the deployment detail page
    Then the "Inference Playground" section is visible
    And shows a default request body

  Scenario: Playground test executes successfully
    Given the Inference Playground for an ONLINE deployment
    When the user clicks "Run Test"
    Then the response is displayed with status code and timing
    And pipeline status shows all checks passing

  Scenario: GPU options hidden for Topology 3
    Given the user selected livepeer-inference template
    When they are on the configuration step
    Then GPU selection is not shown (Topology 3 is CPU-only)

  Scenario: Advanced settings collapsed by default
    Given the user is configuring a livepeer deployment
    Then capability name, pricing, and capacity are collapsed
    And auto-derived values are shown as placeholders
```

**Exit Criteria:** User selects livepeer template, enters provider + model + API key + SSH host, clicks deploy, and tests via playground. All 3 topologies generate valid compose YAML.

---

### Phase 4: livepeer-sdk Client Integration

**Goal:** Python SDK clients call registered BYOC capabilities with automatic payment.

**Location:** Separate repo `livepeer-sdk/livepeer-python-gateway/` (branch: `feature/byoc-inference-client`)

**Tasks:**

- [ ] P4.1: `BYOCClient` class -- `inference(capability, request, stream=False)`
- [ ] P4.2: Job token acquisition -- `GET /process/token` with auth headers
- [ ] P4.3: Request submission with payment -- `POST /process/request/{path}`
- [ ] P4.4: Example scripts -- LLM streaming, image generation

**Quality Gates:**

- [ ] P4.QG1: Design review -- client API surface, auth flow
- [ ] P4.QG2: Code review -- Python quality, error handling
- [ ] P4.QG3: Unit tests -- >=85% coverage with mocked responses
- [ ] P4.QG4: BDD e2e test -- client against deployed stack

**Exit Criteria:** `client.inference("flux-dev", {"prompt": "a cat"}, stream=False)` works against a deployed stack.

---

### Phase 5: Polish & Production Readiness

**Tasks:**

- [ ] P5.1: Pre-built model configs -- Llama 3.1 (TGI), Flux (fal.ai), Whisper (RunPod)
- [ ] P5.2: CI/CD -- `.github/workflows/containers.yml` for container image builds
- [ ] P5.3: Documentation -- quickstart, architecture guide, troubleshooting
- [ ] P5.4: NaaP marketplace listing

**Quality Gates:**

- [ ] P5.QG1: Documentation review -- completeness, accuracy
- [ ] P5.QG2: CI/CD review -- pipeline correctness
- [ ] P5.QG3: Integration test -- quickstart works end-to-end
- [ ] P5.QG4: Full lifecycle BDD -- deploy, test via playground, call via SDK, destroy

**Exit Criteria:** Developer follows quickstart, deploys model, calls it from SDK, in under 30 minutes.

---

## What Can and Cannot Be Supported

### Works Perfectly

Any HTTP POST -> JSON/binary/SSE response service: LLM inference, image gen, video gen, audio, embeddings, code gen, any HuggingFace/fal.ai/Replicate/RunPod model.

### Does Not Work

WebSocket/gRPC, pub/sub, persistent connections, real-time bidirectional (<100ms). Transcoding: use go-livepeer's native pipeline.

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| go-livepeer Docker image doesn't support BYOC | Blocks all topologies | Phase 0 spike validates before implementation |
| SshComposeAdapter deploy script fails | Deployment stuck in DEPLOYING | Timeout handling, clear error messages, compose project cleanup on failure |
| YAML injection via user input | Security vulnerability | Use `js-yaml` library for generation, never string interpolation |
| Partial compose startup (2/3 services start) | Unhealthy deployment | Compose health checks with `depends_on` + `healthcheck`. Adapter waits for backend before registering. |
| Orchestrator crash during registered capability | Capability lost | Adapter heartbeat loop re-registers every 30s |
| Provider API key exposed in compose YAML on remote host | Security | Compose file stored in `/opt/naap/<project>/` with restricted permissions (chmod 600, directory chmod 700). In NaaP DB, API keys stored in `artifactConfig` use the existing `SecretStore` encryption (same as provider credentials). The compose YAML on the remote host is the minimum necessary -- keys are in env vars inside the compose, not in separate files. |

---

## Quality Assessment

| Category | Weight | Score | Notes |
|---|---|---|---|
| **Completeness** | 15 | 14 | Phase 0 spike, all IProviderAdapter methods (deploy/destroy/update/getStatus/healthCheck/getGpuOptions) specified for SshComposeAdapter, data storage via existing artifactConfig |
| **Consistency** | 10 | 9 | Route in deployments router, types additive, ProviderMode reuses 'ssh-bridge' |
| **Simplicity** | 15 | 13 | 2 new frontend components, topology 3 default, auto-config, auto-select provider |
| **SOLID Compliance** | 15 | 14 | New SshComposeAdapter, no SshBridgeAdapter changes, additive wizard branches |
| **Test Coverage Plan** | 10 | 9 | >=85% target, BDD for all phases, failure mode scenarios |
| **E2E / BDD Quality** | 10 | 9 | Realistic scenarios including compose deploy/destroy, partial failures |
| **UX / Least Effort** | 10 | 9 | Auto-select ssh-compose, auto-set gpuModel=CPU, canProceed() detailed |
| **Architecture Fit** | 10 | 10 | Follows NaaP patterns, containers/ isolation, Vercel-safe, SecretStore for keys |
| **Risk Mitigation** | 5 | 5 | Phase 0 spike, YAML sanitization via js-yaml, compose permissions, SecretStore encryption |
| **Total** | 100 | **92** | |
