# Livepeer Universal Inference Adapter — Planning Document

## Vision

Any developer can take any AI model or workflow (LLM, ComfyUI, text-to-image, text-to-video, etc.), deploy it to any serverless GPU provider (fal.ai, Replicate, RunPod) or self-hosted GPU, and have it automatically become a Livepeer network-enabled inference service — with zero changes to go-livepeer, zero dependency on ai-runner.

## Context & Key Insight

### Current State

**go-livepeer** has two paths for AI inference:

1. **Built-in AI pipeline** (`server/ai_http.go`, `core/ai.go`, `ai/worker/`) — Tightly coupled to ai-runner. Adding a new pipeline requires: new capability enum, new Go interface method, new HTTP handler, new worker case, OpenAPI regeneration, Go codegen. ~8 files touched per pipeline.

2. **BYOC system** (`byoc/`) — Already provides a generic external capability framework:
   - `POST /capability/register` — register any HTTP service as a capability
   - `POST /capability/unregister` — remove a capability
   - `POST /process/request/*` — proxy requests to registered capability URL with payment
   - `GET /process/token` — issue payment tokens for clients
   - `POST /ai/stream/start|stop|update|payment` — streaming support
   - Capacity management, payment processing, balance tracking — all built-in

**ai-runner** — Monolithic Python container. Every pipeline is a hardcoded module in `src/runner/pipelines/`. Adding a new model means: write pipeline code, update FastAPI routes, regenerate OpenAPI spec, rebuild Docker image, regenerate Go bindings. Rigid and slow to extend.

### Key Insight

**BYOC is already 90% of the answer.** The orchestrator side is done. What's missing is a thin adapter layer that sits between "I have a Docker container running inference" and "it's registered and working on Livepeer." This adapter is ~300-400 lines of code.

### Orchestrator-to-Inference Mapping: 1:N

**One orchestrator serves many inference services.** This is already built into BYOC.

`ExternalCapabilities.Capabilities` is a `map[string]*ExternalCapability` — each entry has its own name, URL, capacity, price, and load tracking. The orchestrator routes requests by capability name to the correct backend URL (`GetUrlForCapability()`), reserves capacity per-capability (`ReserveExternalCapabilityCapacity()`), and bills per-capability (`DebitFees()` with `ManifestID = capability name`).

This means a single orchestrator deployment can simultaneously offer:

```
One go-livepeer orchestrator (:7935)
  ├── capability: "llama3-70b"     → adapter :9090 → Replicate LLM    (capacity=4, $0.001/s)
  ├── capability: "flux-image-gen" → adapter :9091 → fal.ai Flux      (capacity=2, $0.005/s)
  ├── capability: "whisper-v3"     → adapter :9092 → RunPod Whisper    (capacity=8, $0.0005/s)
  └── capability: "custom-ocr"     → adapter :9093 → local container   (capacity=1, $0.002/s)
```

Each capability is independent: different backend, different price, different capacity. Multiple adapters register their capabilities with the same orchestrator. The adapter design (one adapter = one capability) is intentional — it keeps each adapter simple and independently deployable. Adding a new capability = adding one more adapter+backend pair to the docker-compose.

NaaP's deployment wizard should support "add capability to existing deployment" in addition to "new full deployment" — but for Phase 1, each deployment is a complete stack.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Livepeer Network                              │
│                                                                      │
│  ┌──────────────┐          ┌───────────────────────────────────────┐ │
│  │ livepeer-sdk  │────────▶│  Livepeer Orchestrator (go-livepeer)  │ │
│  │ (client)      │         │                                       │ │
│  └──────────────┘          │  BYOC Server (already exists):        │ │
│                            │   POST /capability/register           │ │
│                            │   POST /process/request/*  ──proxy──┐ │ │
│                            │   GET  /process/token               │ │ │
│                            │   POST /ai/stream/*                 │ │ │
│                            └─────────────────────────────────────│─┘ │
│                                                                  │   │
│  ┌───────────────────────────────────────────────────────────────▼─┐ │
│  │      livepeer-inference-adapter  (NEW — lightweight sidecar)    │ │
│  │                                                                  │ │
│  │  Startup:  register capability with orchestrator                 │ │
│  │  Runtime:  receive proxied requests → forward to backend         │ │
│  │  Health:   monitor backend, re-register on recovery              │ │
│  │  Shutdown: unregister capability                                 │ │
│  │                                                                  │ │
│  │  Config: ORCH_URL, ORCH_SECRET, CAPABILITY_NAME,                │ │
│  │          BACKEND_URL, PRICE, CAPACITY                            │ │
│  └──────────────────────────────────────────┬───────────────────────┘ │
│                                             │                         │
│  ┌──────────────────────────────────────────▼───────────────────────┐ │
│  │           Inference Backend (any HTTP container)                  │ │
│  │                                                                   │ │
│  │  Option A: Self-hosted container (HF TGI, ComfyUI, vLLM, etc.) │ │
│  │  Option B: Serverless proxy → fal.ai / Replicate / RunPod API    │ │
│  │  Option C: Any HTTP service with a POST endpoint                  │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

### Deployment Topologies

The adapter and serverless proxy are **CPU-only, lightweight (~50MB each)** containers. They don't need a GPU. NaaP's deployment wizard presents three topology options. The user chooses based on their infrastructure.

---

#### Topology 1: All-in-One Self-Hosted GPU

**Everything on a single GPU machine with a public IP.**

```
┌──────────────────────────────────────────────────────────┐
│  Single GPU Server (bare metal / cloud VM, public IP)    │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  docker-compose up                                  │  │
│  │                                                     │  │
│  │  go-livepeer orchestrator     :7935  (public)       │  │
│  │  livepeer/inference-adapter   :9090  (internal)     │  │
│  │  model container (TGI/vLLM)   :8080  (internal/GPU) │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ORCH_URL=http://localhost:7935                          │
│  BACKEND_URL=http://localhost:8080                       │
│  Adapter registers as: http://localhost:9090/inference   │
└──────────────────────────────────────────────────────────┘
```

**What NaaP does:** Deploys a single docker-compose via SshBridgeAdapter to the GPU server. The compose includes go-livepeer, adapter, and model container. One machine, one deployment, one public IP.

**Pros:**
- Simplest possible setup — single docker-compose, single machine
- Zero network hops between components (all localhost)
- Lowest latency — GPU inference result goes straight back to orchestrator
- No public IP issues — the machine already has one for go-livepeer
- Full control over GPU, model loading, warm-up times
- Works offline / air-gapped (no external API calls)

**Cons:**
- Single point of failure — if machine goes down, everything goes down
- Scaling = buying more GPU machines (vertical only)
- GPU utilization may be low if traffic is bursty
- Operator must manage GPU drivers, CUDA, model weights
- Fixed capacity — can't burst beyond the GPU's throughput

**Best for:** Operators who already have GPU hardware, want full control, or need guaranteed low latency.

---

#### Topology 2: Serverless GPU Provider (All-on-Provider)

**go-livepeer + adapter + proxy all deployed to a serverless GPU provider (fal.ai, RunPod, etc.), with the model also on the same provider.**

```
┌──────────────────────────────────────────────────────────────┐
│  Serverless GPU Provider (e.g., RunPod, fal.ai)              │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Pod / Container Group (provider-assigned public IP)    │  │
│  │                                                         │  │
│  │  go-livepeer orchestrator     :7935  (public*)          │  │
│  │  livepeer/inference-adapter   :9090  (internal)         │  │
│  │  model container (TGI/vLLM)   :8080  (internal/GPU)    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  * Public IP via provider's port forwarding / load balancer  │
└──────────────────────────────────────────────────────────────┘
```

**What NaaP does:** Deploys via RunPodAdapter/FalAdapter. Same docker-compose as Topology 1, but running on provider infrastructure. NaaP handles provider API calls for deploy/destroy/status.

**Challenges — Public IP:**

| Challenge | Detail | Mitigation |
|---|---|---|
| **Ephemeral IPs** | Serverless pods get new IPs on restart. go-livepeer needs a stable address for clients to discover it. | Use provider's static endpoint URL (RunPod provides `https://<pod-id>-7935.proxy.runpod.net`). Configure go-livepeer's `-serviceAddr` to this URL. |
| **Port exposure** | Providers may only expose certain ports or require explicit port mapping. | RunPod: expose port 7935 via TCP proxy. fal.ai: may not support long-running servers well (designed for request/response). |
| **Cold starts** | If pod scales to zero, go-livepeer loses its on-chain registration and clients can't find it. | Use "always-on" tier (RunPod) or minimum 1 replica. Accept higher cost for reliability. |
| **Provider limitations** | Not all providers support long-running server processes. fal.ai is request/response oriented. Replicate doesn't support custom servers. | RunPod is the best fit (supports persistent pods). fal.ai/Replicate better suited for Topology 3. |
| **Networking between containers** | Provider may not support docker-compose natively. May need single-container with supervisord or provider-specific multi-container config. | RunPod supports multi-container pods. fal.ai does not. For fal.ai, use single container with supervisord or switch to Topology 3. |

**Pros:**
- No hardware to manage — provider handles GPU, drivers, CUDA
- Pay-per-use GPU (cheaper than owning if traffic is intermittent)
- Provider handles hardware failures, GPU replacement
- Scales with provider's infrastructure
- Same localhost architecture as Topology 1 (once running)

**Cons:**
- Public IP is not guaranteed stable (provider-dependent)
- Cold start latency if pod scales down
- Provider lock-in for networking/port exposure
- More expensive than self-hosted for sustained high traffic
- Some providers (fal.ai, Replicate) don't support this topology well — they're request/response, not long-running server
- Debugging is harder (no SSH, limited logs depending on provider)

**Best for:** Operators who want GPU without managing hardware, using RunPod or similar providers that support persistent pods with public endpoints.

---

#### Topology 3: Split — CPU Orchestrator + Remote Serverless Inference

**go-livepeer + adapter + proxy on a cheap CPU machine with a public IP. Model runs independently on any serverless provider. The proxy calls the provider API over HTTPS.**

```
┌──────────────────────────────────────────────────────────┐
│  CPU Machine (cheap VM, $5-20/mo, public IP)             │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  docker-compose up                                  │  │
│  │                                                     │  │
│  │  go-livepeer orchestrator     :7935  (public)       │  │
│  │  livepeer/inference-adapter   :9090  (internal)     │  │
│  │  livepeer/serverless-proxy    :8080  (internal)     │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Proxy calls out to provider API over HTTPS ─────────┐   │
└──────────────────────────────────────────────────────│───┘
                                                       │
                                                       ▼
┌──────────────────────────────────────────────────────────┐
│  Serverless Provider (fal.ai / Replicate / RunPod / HF)  │
│                                                          │
│  Model runs on their GPU infrastructure                  │
│  (deployed independently, or already exists as           │
│   a public API endpoint on the provider)                 │
└──────────────────────────────────────────────────────────┘
```

**What NaaP does:** Two-part deployment:
1. Deploy go-livepeer + adapter + proxy to a CPU machine (via SshBridgeAdapter to a cheap VM, or even locally)
2. The model is either already running on the provider (existing fal.ai endpoint) or NaaP deploys it via FalAdapter/ReplicateAdapter/RunPodAdapter

The serverless proxy bridges the two — it sits on the CPU machine and makes outbound HTTPS calls to the provider's inference API.

**This is the most flexible topology.** Any existing serverless inference on fal.ai, Replicate, RunPod, HuggingFace Inference Endpoints, or even a custom API can be brought onto the Livepeer network without modifying the inference service at all.

**Pros:**
- **Any existing inference service** can be brought to Livepeer — no modification needed
- CPU machine is cheap ($5-20/mo on Hetzner, DigitalOcean, Fly.io)
- Stable public IP (it's a regular VM)
- Model can scale independently on the provider (auto-scaling, multi-GPU)
- Can aggregate multiple models — run multiple adapter+proxy pairs on one CPU machine
- Provider handles all GPU complexity (drivers, CUDA, model loading, scaling)
- Mix and match providers — one adapter for fal.ai Flux, another for Replicate Llama
- Best cost efficiency for bursty traffic (pay provider per-inference, not per-hour)

**Cons:**
- **Extra network latency** — proxy → provider API round-trip adds 50-500ms depending on provider and model. For LLMs with streaming, this is mostly the time-to-first-token; subsequent tokens stream normally. For image/video generation, the model inference time (seconds) dominates, so the extra hop is negligible.
- **Provider cold starts** — fal.ai and Replicate may have cold starts (5-30s) if the model isn't warm. This is a provider-side issue, not adapter-side. Mitigation: use providers with warm instances or "keep-alive" options.
- **Provider reliability** — if fal.ai has an outage, your capability goes down. Adapter's health monitor will auto-unregister. Mitigation: could failover to another provider (future enhancement).
- **Double billing** — you pay the serverless provider per-inference AND charge the Livepeer client. Price must cover provider cost + margin. No automatic cost tracking in Phase 1.
- **Provider rate limits** — some providers have rate limits or queue depths. Adapter's CAPACITY config should be set to match provider limits.
- **Request/response format** — provider APIs have different formats (fal.ai queue system, Replicate prediction model, RunPod runsync). The serverless proxy handles this translation, but each provider needs its own implementation.

**Scalability analysis:**

| Dimension | Rating | Detail |
|---|---|---|
| **Horizontal (more models)** | Excellent | Add another adapter+proxy pair per model. CPU machine handles dozens. |
| **Horizontal (more throughput)** | Good | Provider auto-scales GPU. Proxy is stateless, can be replicated. CPU machine is rarely the bottleneck (just proxying HTTP). |
| **Vertical (bigger models)** | Excellent | Provider handles GPU sizing. Switch from A100 to H100 on provider side. |
| **Multi-region** | Good | Deploy CPU machines in multiple regions, each pointing to nearest provider endpoint. |

**Performance analysis:**

| Metric | Impact | Detail |
|---|---|---|
| **Latency overhead** | +50-200ms | One extra HTTP hop (proxy → provider). Negligible for generation tasks (seconds). Noticeable for real-time (sub-100ms) use cases. |
| **Throughput** | Minimal impact | Proxy is async, handles concurrent requests. CPU machine can proxy thousands of requests/sec. |
| **Streaming** | Works well | SSE passthrough from provider through proxy through adapter to client. Time-to-first-token adds the proxy hop; subsequent tokens flow at network speed. |
| **Cold start** | Provider-dependent | 0s (warm) to 30s+ (cold). Not adapter's problem. Set CAPACITY=0 during cold start via health monitor. |

**Reliability analysis:**

| Failure Mode | Impact | Recovery |
|---|---|---|
| CPU machine down | All capabilities offline | Adapter auto-unregisters (or times out). Restart machine, adapter re-registers. |
| Provider API down | Affected capabilities fail | Health monitor detects, unregisters capability. Re-registers when provider recovers. |
| Provider cold start | First request slow | Subsequent requests fast. Consider provider warm-keeping. |
| Network partition (CPU ↔ provider) | Requests fail with timeout | Health monitor detects, unregisters. Recovers when network restores. |
| go-livepeer crash | All capabilities offline | Adapter's heartbeat re-registers when orch restarts. |

**Best for:** Operators who want to offer inference on Livepeer without owning GPUs. Bringing existing serverless inference (already deployed on fal.ai, Replicate, etc.) onto the network. Maximum flexibility and lowest upfront cost.

---

#### Topology Comparison Summary

| | Topology 1: All-in-One | Topology 2: All-on-Provider | Topology 3: Split CPU + Serverless |
|---|---|---|---|
| **Complexity** | Lowest | Medium | Low-Medium |
| **Cost (low traffic)** | High (GPU idle) | Medium (pay-per-use GPU) | Lowest ($5 VM + per-inference) |
| **Cost (high traffic)** | Lowest (amortized GPU) | Medium | Highest (per-inference adds up) |
| **Latency** | Lowest (all localhost) | Low (all localhost on pod) | +50-200ms per request |
| **Public IP** | Easy (VM has it) | Tricky (provider-dependent) | Easy (VM has it) |
| **Scalability** | Vertical only | Provider-managed | Best (provider auto-scales) |
| **Reliability** | SPOF (one machine) | Provider-managed | Distributed (CPU + provider) |
| **Bring existing inference** | No (must run locally) | No (must run on pod) | Yes (any HTTP endpoint) |
| **GPU management** | You manage | Provider manages | Provider manages |
| **Provider compatibility** | N/A | RunPod (best), others limited | All providers (fal.ai, Replicate, RunPod, HF, custom) |

#### NaaP Template: Topology Selection

NaaP's deployment wizard presents topology as the first decision:

```
Step 1: Select Deployment Topology
  ┌─────────────────────────────────────────────────────────────────┐
  │  ( ) Topology 1: All-in-One Self-Hosted GPU                    │
  │      Everything on your GPU machine. Simplest setup.           │
  │      Requires: GPU server with public IP                       │
  │                                                                │
  │  ( ) Topology 2: All-on-Serverless-GPU                         │
  │      Everything on a serverless GPU provider pod.              │
  │      Requires: RunPod account (recommended)                    │
  │                                                                │
  │  ( ) Topology 3: CPU Orchestrator + Remote Inference           │
  │      Orchestrator on cheap VM. Model on any provider.          │
  │      Requires: VM with public IP + provider API key            │
  │      Best for: bringing existing inference to Livepeer         │
  └─────────────────────────────────────────────────────────────────┘

Step 2: (varies by topology — see wizard flow below)
```

### Request Flow

```
Client (livepeer-sdk)
  │
  │  1. GET /process/token (get payment token + ticket params)
  │  2. POST /process/request/ (with Livepeer payment headers)
  ▼
Orchestrator (go-livepeer BYOC)
  │
  │  • Verify signature, check capacity, process payment
  │  • Proxy request to registered capability URL (localhost:9090)
  ▼
Adapter (livepeer-inference-adapter)  [on same machine]
  │
  │  • Forward to backend (localhost:8080)
  ▼
Backend (inference container or serverless-proxy)  [on same machine]
  │
  │  Self-hosted: run inference locally on GPU
  │  Serverless:  call fal.ai/Replicate API over HTTPS → return result
  ▼
Response flows back: Backend → Adapter → Orchestrator → Client
                     (Orchestrator debits fees on success)
```

## Component Details

### Component 1: `livepeer-inference-adapter`

**What it is:** A lightweight Python process (~300-400 lines) that bridges any inference backend to a Livepeer BYOC orchestrator.

**Where the code lives:** `~/Documents/mycodespace/NaaP/containers/livepeer-inference-adapter/`

This lives in the **NaaP monorepo** under a new `containers/` top-level directory. Rationale:
- **Co-located with the deployment template** — the deployment-manager plugin that deploys it is in the same repo. One PR to change adapter code + template together.
- **Not part of the NaaP project build** — it's a Python project, not an npm package. npm workspaces (`packages/*`, `apps/*`, `plugins/*/frontend`, etc.) don't include `containers/*`. Nx ignores it. Vercel build ignores it.
- **No dependency on livepeer-sdk** — adapter talks pure HTTP to BYOC endpoints. No shared Python code needed.
- **Built as Docker only** — only built when the deployment-manager creates a deployment. CI/CD builds and pushes the Docker image separately.
- **Not part of NaaP's `npm install` or `npm run build`** — zero impact on NaaP development workflow.

**How it integrates with NaaP monorepo:**
```
NaaP/
├── apps/                            # npm workspace — Next.js app
├── packages/                        # npm workspace — shared TS packages
├── plugins/                         # npm workspace — plugins (frontend + backend)
│   └── deployment-manager/          # deploys containers defined below
├── services/                        # npm workspace — microservices
├── containers/                      # NEW — NOT in npm workspaces, NOT in Nx
│   ├── README.md                    # Explains this directory's purpose
│   ├── livepeer-inference-adapter/  # Python, Dockerfile only
│   └── livepeer-serverless-proxy/   # Python, Dockerfile only
├── package.json                     # workspaces: ["packages/*", "apps/*", ...] — no "containers/*"
├── nx.json                          # Nx ignores containers/ (no project.json inside)
└── vercel.json                      # Vercel builds apps/web-next only
```

**Directory structure:**
```
containers/livepeer-inference-adapter/
├── src/
│   └── livepeer_adapter/
│       ├── __init__.py
│       ├── main.py              # Entry point, signal handlers
│       ├── config.py            # Load from env vars + optional YAML
│       ├── registrar.py         # Register/unregister with orchestrator BYOC
│       ├── proxy.py             # HTTP server: receive from orch → forward to backend
│       └── health.py            # Backend health monitoring, auto re-register
├── Dockerfile
├── pyproject.toml
├── README.md
└── tests/
```

**What it does:**

| Lifecycle Event | Action |
|---|---|
| Startup | Wait for backend health → POST `/capability/register` on orchestrator |
| Running | HTTP server receives proxied requests from orchestrator, forwards to backend |
| Health fail | Detect backend down → POST `/capability/unregister` → wait for recovery → re-register |
| Shutdown (SIGTERM) | POST `/capability/unregister` → exit cleanly |

**Configuration (env vars):**
```bash
# Required
ORCH_URL=https://orchestrator.example.com     # Orchestrator BYOC endpoint
ORCH_SECRET=secret123                         # TranscoderSecret for auth
CAPABILITY_NAME=llama3-70b-chat               # Unique name on network
BACKEND_URL=http://localhost:8080             # Where inference container listens

# Optional
ADAPTER_PORT=9090                             # Port adapter listens on (for orch to proxy to)
ADAPTER_HOST=0.0.0.0                          # Bind address
CAPACITY=4                                    # Concurrent request slots
PRICE_PER_UNIT=1000                           # Price in base units
PRICE_SCALING=1000000                         # Scaling denominator
PRICE_CURRENCY=USD                            # Auto-converted to ETH by orchestrator
BACKEND_HEALTH_PATH=/health                   # Health check endpoint on backend
BACKEND_INFERENCE_PATH=/v1/chat/completions   # Inference endpoint on backend
BACKEND_TIMEOUT=120                           # Request timeout in seconds
HEALTH_CHECK_INTERVAL=15                      # Seconds between health checks
REGISTER_INTERVAL=30                          # Seconds between re-registration heartbeats
```

**Key design decisions:**
- **No request translation by default** — adapter passes through request/response as-is. The backend is expected to expose an HTTP API. If format mapping is needed, users can set `REQUEST_TRANSFORM` and `RESPONSE_TRANSFORM` as Jinja2 templates (optional, Phase 2+).
- **Adapter exposes its own HTTP server** — The orchestrator's BYOC proxy sends requests to the adapter's URL (the `url` field in capability registration). The adapter then forwards to the backend. This extra hop is necessary because the adapter's public URL may differ from the backend's internal URL (e.g., backend is on localhost, adapter has a public IP).
- **Stateless** — No database, no persistent state. Can be restarted freely.

### Component 2: Serverless Provider Proxy (optional, for fal.ai/Replicate/RunPod)

**What it is:** When the inference backend is a serverless API (not a local container), this thin HTTP proxy translates between a standard local HTTP interface and the provider's API.

**Where the code lives:** `~/Documents/mycodespace/NaaP/containers/livepeer-serverless-proxy/`

Same `containers/` directory in NaaP monorepo. Same isolation rules — not in npm workspaces, not in Nx, not in Vercel build. Published as Docker image: `livepeer/serverless-proxy`.

**Directory structure:**
```
containers/livepeer-serverless-proxy/
├── src/
│   └── serverless_proxy/
│       ├── __init__.py
│       ├── main.py
│       ├── server.py            # FastAPI: /health + /inference
│       └── providers/
│           ├── base.py          # Abstract: health() + inference()
│           ├── fal_ai.py
│           ├── replicate.py
│           ├── runpod.py
│           └── huggingface.py   # HF Inference Endpoints
├── Dockerfile
├── pyproject.toml
└── tests/
```

**How NaaP knows about it:**

The deployment-manager plugin (in `plugins/deployment-manager/`) references the Docker images built from `containers/`. The connection:

1. `containers/livepeer-inference-adapter/Dockerfile` → builds `livepeer/inference-adapter` image
2. `containers/livepeer-serverless-proxy/Dockerfile` → builds `livepeer/serverless-proxy` image
3. `plugins/deployment-manager/` generates docker-compose YAML referencing these images
4. NaaP's provider adapters (FalAdapter, RunPodAdapter, SshBridgeAdapter) deploy the compose to the target host

The deployment-manager doesn't import or build the Python code — it only references the Docker image names. In development, images are built locally (`docker build containers/livepeer-inference-adapter`). In production, CI/CD builds and pushes them to a registry.

### Component 3: NaaP Deployment Manager Template

**What it is:** A new built-in template in the deployment-manager plugin, alongside the existing `ai-runner` and `scope` templates.

**Where the code lives:** `~/Documents/mycodespace/NaaP/plugins/deployment-manager/`

Changes needed:

1. **New template entry** in `TemplateRegistry.ts` (add to `BUILT_IN_TEMPLATES`)
2. **Template configuration** with topology selection + Livepeer-specific fields
3. **Frontend wizard steps** — topology-aware, shows relevant options per topology
4. **Docker compose generation** — generates different compose files per topology

**Template definition** (added to `BUILT_IN_TEMPLATES` in `TemplateRegistry.ts`):
```typescript
{
  id: 'livepeer-inference',
  name: 'Livepeer Inference Adapter',
  description: 'Deploy any AI model as a Livepeer network-enabled inference service. Choose from 3 deployment topologies: self-hosted GPU, serverless GPU, or split CPU + remote inference.',
  icon: '🔗',
  dockerImage: 'livepeer/inference-adapter',
  healthEndpoint: '/health',
  healthPort: 9090,
  defaultGpuModel: 'A100',
  defaultGpuVramGb: 40,
  category: 'curated',
  githubOwner: 'livepeer',
  githubRepo: 'livepeer-sdk',
}
```

**Deployment wizard flow (frontend):**
```
Step 1: Select template → "Livepeer Inference Adapter"

Step 2: Select Deployment Topology
        ├─ Topology 1: All-in-One Self-Hosted GPU
        ├─ Topology 2: All-on-Serverless-GPU (RunPod recommended)
        └─ Topology 3: CPU Orchestrator + Remote Inference

Step 3: (varies by topology)

  Topology 1 & 2:
    3a. Select model
        ├─ HuggingFace model ID (e.g., meta-llama/Llama-3.1-70B-Instruct)
        └─ Custom Docker image URL
    3b. Select GPU provider (Topology 1: SSH Bridge; Topology 2: RunPod/fal.ai)
    3c. Select GPU type + VRAM

  Topology 3:
    3a. Select inference source
        ├─ Existing fal.ai endpoint (model ID)
        ├─ Existing Replicate model (model version)
        ├─ Existing RunPod serverless endpoint (endpoint ID)
        ├─ Existing HuggingFace Inference Endpoint (URL)
        └─ Custom HTTP endpoint (any URL)
    3b. Enter provider API credentials
    3c. Select where to run CPU stack (SSH Bridge to VM, or local)

Step 4: Configure Livepeer settings (all topologies)
        ├─ Orchestrator secret
        ├─ Capability name (auto-suggested from model name)
        ├─ Pricing (price per unit, currency)
        └─ Capacity (concurrent slots)

Step 5: Review & Deploy
```

**What gets generated per topology:**

| Topology | Docker Compose Contents | Deployed To |
|---|---|---|
| 1: All-in-One | go-livepeer + adapter + model container (GPU) | SSH Bridge to GPU server |
| 2: All-on-Provider | go-livepeer + adapter + model container (GPU) | RunPod pod (or similar) |
| 3: Split | go-livepeer + adapter + serverless-proxy | SSH Bridge to CPU VM (model on provider) |

## Implementation Plan

### Source Code & Branches

**All adapter, proxy, and template work happens in the NaaP monorepo:**
```
Repository: ~/Documents/mycodespace/NaaP
Branch:     feature/livepeer-inference-adapter
```

New directories in NaaP (NOT part of npm workspaces / Nx / Vercel):
- `containers/livepeer-inference-adapter/` — Python, Dockerfile (Phase 1)
- `containers/livepeer-serverless-proxy/` — Python, Dockerfile (Phase 2)

Changes to existing NaaP code:
- `plugins/deployment-manager/` — template, wizard, compose generation (Phase 3)

**Client-side SDK work happens in livepeer-sdk:**
```
Repository: ~/Documents/mycodespace/livepeer-sdk
Branch:     feature/byoc-inference-client
```

Changes to `livepeer-python-gateway/` — generic BYOC inference client (Phase 4).

**No changes to go-livepeer needed.** The existing BYOC system (`byoc/` package, `master` branch) is used as-is. Reference go-livepeer's `master` branch for BYOC API compatibility during development.

### Monorepo Isolation Strategy

The `containers/` directory is **physically in the NaaP repo but logically separate from the NaaP project:**

```
NaaP repo isolation:
┌─────────────────────────────────────────────────────────────────┐
│  npm workspaces: packages/*, apps/*, services/*, plugins/*/...  │
│  Nx build graph: discovers projects via package.json in above   │
│  Vercel build:   plugins → Next.js app                         │
│  npm install:    installs deps for all workspace packages       │
│                                                                  │
│  ALL OF THE ABOVE IGNORE containers/                             │
├─────────────────────────────────────────────────────────────────┤
│  containers/                                                     │
│  ├── livepeer-inference-adapter/    (Python, pyproject.toml)     │
│  └── livepeer-serverless-proxy/     (Python, pyproject.toml)     │
│                                                                  │
│  Built separately:                                               │
│    docker build -t livepeer/inference-adapter containers/livepeer-inference-adapter │
│    docker build -t livepeer/serverless-proxy containers/livepeer-serverless-proxy   │
│                                                                  │
│  CI/CD: separate GitHub Actions workflow for containers/          │
│  Triggered: on changes to containers/** path                     │
│  Pushed to: Docker Hub or GitHub Container Registry              │
└─────────────────────────────────────────────────────────────────┘
```

**Why this is safe:**
- `npm install` at NaaP root won't touch `containers/` (no `package.json`, not in workspaces)
- `nx run-many --target=build` won't find them (no Nx project config)
- `vercel-build.sh` won't touch them (only builds plugins + Next.js)
- `containers/` has zero TypeScript, zero npm deps, zero JS tooling
- The only connection is: `plugins/deployment-manager/` references Docker image names as strings in template config

---

### Phase 1: Core Adapter

**Goal:** A working adapter that registers any local HTTP inference backend with a Livepeer BYOC orchestrator, receives proxied requests, and forwards them. This is the foundation — all three topologies depend on it.

**Location:** `~/Documents/mycodespace/NaaP/containers/livepeer-inference-adapter/`

**Essential TODOs:**

- [ ] **P1.1: Create feature branch + project scaffolding**
  - `cd ~/Documents/mycodespace/NaaP && git checkout -b feature/livepeer-inference-adapter`
  - Create `containers/` top-level directory with `README.md` explaining its purpose
  - Create `containers/livepeer-inference-adapter/` directory
  - `pyproject.toml` with dependencies (aiohttp, pyyaml)
  - Basic Dockerfile (python:3.11-slim, ~50MB)
  - Verify BYOC API contract by reading go-livepeer `byoc/job_orchestrator.go` — confirm `/capability/register` request format matches `ExternalCapability` struct in `core/external_capabilities.go`

- [ ] **P1.2: Config module** (`config.py`)
  - Load from env vars, validate required: `ORCH_URL`, `ORCH_SECRET`, `CAPABILITY_NAME`, `BACKEND_URL`
  - Defaults: `ADAPTER_PORT=9090`, `CAPACITY=1`, `HEALTH_CHECK_INTERVAL=15`, `REGISTER_INTERVAL=30`, `BACKEND_HEALTH_PATH=/health`, `BACKEND_TIMEOUT=120`

- [ ] **P1.3: Registrar module** (`registrar.py`)
  - `register()` — POST `{ORCH_URL}/capability/register`, Authorization: `{ORCH_SECRET}`, body: JSON matching `ExternalCapability` struct
  - `unregister()` — POST `{ORCH_URL}/capability/unregister`, body: capability name string
  - `heartbeat_loop()` — re-register every `REGISTER_INTERVAL` seconds (covers orch restarts, capability expiry)
  - Log registration success/failure clearly

- [ ] **P1.4: Proxy server** (`proxy.py`)
  - aiohttp server on `ADAPTER_PORT`
  - `POST /inference` and `POST /inference/{path}` — forward to `{BACKEND_URL}{BACKEND_INFERENCE_PATH}/{path}`
  - Pass through Content-Type, stream SSE responses (`text/event-stream`) chunk-by-chunk
  - `GET /health` — return 200 if backend is healthy
  - Timeout: `BACKEND_TIMEOUT` seconds

- [ ] **P1.5: Health monitor** (`health.py`)
  - Poll backend health endpoint, state machine: `WAITING → HEALTHY → UNHEALTHY`
  - On HEALTHY: register. On UNHEALTHY: unregister. On recovery: re-register.

- [ ] **P1.6: Main entry point** (`main.py`)
  - Wire config → health → registrar → proxy. SIGTERM/SIGINT handler: unregister + shutdown.

- [ ] **P1.7: Dockerfile + docker-compose for testing**
  - Dockerfile for adapter image
  - `docker-compose.test.yaml`: adapter + mock backend (simple Flask/FastAPI that returns canned responses) + real go-livepeer orchestrator (or mock BYOC endpoints)
  - Test: register → send request → get response → unregister

**Exit criteria:** `docker run livepeer/inference-adapter` registers with a go-livepeer orchestrator running BYOC, forwards a request to a backend, returns the response. Health monitoring works. Clean shutdown unregisters.

---

### Phase 2: Serverless Provider Proxy

**Goal:** A thin HTTP service that wraps serverless provider APIs behind `/health` + `/inference`, enabling Topology 3. The adapter treats it like any local backend.

**Location:** `~/Documents/mycodespace/NaaP/containers/livepeer-serverless-proxy/`

**Essential TODOs:**

- [ ] **P2.1: Project scaffolding**
  - Create `containers/livepeer-serverless-proxy/` in NaaP (same feature branch)
  - `pyproject.toml` — keep deps minimal per provider (optional extras: `pip install .[fal,replicate,runpod]`)
  - Dockerfile

- [ ] **P2.2: Provider interface** (`providers/base.py`)
  ```python
  class Provider(ABC):
      async def health(self) -> bool: ...
      async def inference(self, request: dict, headers: dict) -> Union[dict, AsyncIterator[str]]: ...
  ```

- [ ] **P2.3: fal.ai provider** (`providers/fal_ai.py`) — IMPLEMENT FIRST
  - Submit to fal.ai queue API → poll for result or stream
  - Handle queue status (IN_QUEUE → IN_PROGRESS → COMPLETED)
  - Config: `FAL_KEY`, `FAL_MODEL_ID`

- [ ] **P2.4: Replicate provider** (`providers/replicate.py`)
  - Create prediction → poll/stream
  - Config: `REPLICATE_API_TOKEN`, `REPLICATE_MODEL`

- [ ] **P2.5: RunPod provider** (`providers/runpod.py`)
  - Call `/runsync` (sync) or `/run` + poll (async)
  - Config: `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`

- [ ] **P2.6: HTTP server** (`server.py`)
  - `GET /health`, `POST /inference`, `POST /inference/{path}`
  - Select provider from `PROVIDER` env var
  - Return provider response as-is (JSON or SSE stream)

- [ ] **P2.7: End-to-end test with adapter**
  - `docker-compose.test.yaml`: adapter + serverless-proxy (with fal.ai mock or real API key)
  - Verify: adapter → proxy → provider → response back

**Exit criteria:** `docker-compose up` with adapter + serverless-proxy successfully proxies a request to fal.ai (or other provider) and returns the result through the adapter.

---

### Phase 3: NaaP Deployment Manager Integration

**Goal:** NaaP deployment wizard supports all 3 topologies. Users select topology → configure → deploy. Docker compose is generated per topology.

**Location:** `~/Documents/mycodespace/NaaP/plugins/deployment-manager/` (same feature branch `feature/livepeer-inference-adapter`)

**Essential TODOs:**

- [ ] **P3.1: Template registration** (`backend/src/services/TemplateRegistry.ts`)
  - Add `livepeer-inference` to `BUILT_IN_TEMPLATES`
  - Include topology metadata in template definition

- [ ] **P3.2: Topology + config types** (`backend/src/types/index.ts`)
  ```typescript
  type LivepeerTopology = 'all-in-one' | 'all-on-provider' | 'split-cpu-serverless';

  interface LivepeerInferenceConfig {
    topology: LivepeerTopology;
    // Livepeer settings (all topologies)
    orchestratorSecret: string;
    capabilityName: string;
    pricePerUnit: number;
    priceScaling: number;
    priceCurrency: string;
    capacity: number;
    // Model settings (topology 1 & 2)
    modelId?: string;           // HuggingFace model ID
    modelImage?: string;        // Custom Docker image
    // Serverless settings (topology 3)
    serverlessProvider?: string; // fal-ai | replicate | runpod | huggingface
    serverlessApiKey?: string;
    serverlessModelId?: string;
    // Infrastructure
    publicIp?: string;          // For go-livepeer -serviceAddr
    gpuModel?: string;
    gpuVramGb?: number;
  }
  ```

- [ ] **P3.3: Docker compose builder** (`backend/src/services/LivepeerComposeBuilder.ts`)
  - `buildCompose(config: LivepeerInferenceConfig): string` — returns docker-compose YAML
  - **Topology 1 compose:** go-livepeer + adapter + model container (GPU runtime)
  - **Topology 2 compose:** same as Topology 1 (deployed to provider pod, go-livepeer `-serviceAddr` uses provider endpoint URL)
  - **Topology 3 compose:** go-livepeer + adapter + serverless-proxy (no GPU)
  - All composes include: health checks, restart policies, shared docker network, env vars

- [ ] **P3.4: Frontend wizard — topology selection step**
  - New component: `TopologySelector` — radio cards for 3 topologies with description, pros/cons summary
  - Conditionally shows subsequent steps based on topology

- [ ] **P3.5: Frontend wizard — model/provider steps**
  - **Topology 1 & 2:** HuggingFace model browser OR custom Docker image input. GPU type selector.
  - **Topology 3:** Provider dropdown (fal.ai, Replicate, RunPod, HF, custom URL) + API key + model ID

- [ ] **P3.6: Frontend wizard — Livepeer config step** (all topologies)
  - Orchestrator secret, capability name (auto-suggest), pricing, capacity

- [ ] **P3.7: Frontend wizard — infrastructure step**
  - **Topology 1:** SSH host/port/user for GPU server (existing SshBridgeAdapter flow)
  - **Topology 2:** Provider account selection (existing RunPodAdapter flow) + GPU tier
  - **Topology 3:** SSH host for CPU VM + provider API key for inference

- [ ] **P3.8: Deploy flow integration**
  - `DeploymentOrchestrator` calls `LivepeerComposeBuilder.buildCompose()` to generate compose
  - Passes compose to appropriate `IProviderAdapter.deploy()` (SshBridgeAdapter or RunPodAdapter)
  - Stores topology + config in deployment metadata for status display

- [ ] **P3.9: Post-deployment status view**
  - Deployment detail page shows: topology, capability name, orchestrator URL, pricing, capacity
  - Health monitor checks adapter `/health` endpoint
  - For Topology 3: show provider status (is fal.ai reachable?)

**Exit criteria:** User can go through NaaP wizard, pick any topology, configure settings, and have NaaP generate + deploy the correct docker-compose. All 3 topologies work end-to-end.

---

### Phase 4: livepeer-sdk Client Integration

**Goal:** Python SDK clients can discover and call any registered BYOC capability by name, with automatic payment handling. This is the consumer side — how apps use the deployed inference services.

**Location:** `~/Documents/mycodespace/livepeer-sdk/livepeer-python-gateway/` (separate branch: `feature/byoc-inference-client`)

**Essential TODOs:**

- [ ] **P4.1: Generic inference client**
  - Add `BYOCClient` class (or extend existing client) with `async def inference(capability, request, stream=False)`
  - Flow: connect to orchestrator → get job token → submit request with payment → return response
  - Reference: `byoc/job_orchestrator.go` for the exact header format (`Livepeer`, `Livepeer-Eth-Address`, `Livepeer-Payment`, `Livepeer-Capability`)

- [ ] **P4.2: Job token acquisition**
  - `GET /process/token` with `Livepeer-Eth-Address` (base64-encoded `{addr, sig}`) and `Livepeer-Capability` headers
  - Parse `JobToken` response: ticket params, price, balance, capacity

- [ ] **P4.3: Request submission with payment**
  - Build `JobRequest` JSON: `{id, request, parameters, capability, sender, sig, timeout_seconds}`
  - Sign `request + parameters` with sender's private key
  - `POST /process/request/{path}` with `Livepeer` header (base64 job request)
  - Include `Livepeer-Payment` header with payment ticket when balance is low
  - Support SSE streaming response (async iterator)

- [ ] **P4.4: Example scripts**
  - `examples/byoc_inference_llm.py` — call LLM capability with streaming
  - `examples/byoc_inference_image.py` — call text-to-image capability

**Exit criteria:** `client.inference("llama3-70b", {"messages": [...]}, stream=True)` works against a deployed Topology 1/2/3 stack with automatic payment.

---

### Phase 5: Polish, Templates & Documentation

**Goal:** Pre-built configs for popular models, CI/CD, docs. Make it production-ready.

**Essential TODOs:**

- [ ] **P5.1: Pre-built model configs** (in livepeer-sdk repo, `examples/` or `templates/`)
  - Llama 3.1 70B (TGI, Topology 1) — docker-compose + env template
  - Flux image gen (fal.ai, Topology 3) — docker-compose + env template
  - Whisper (RunPod serverless, Topology 3) — docker-compose + env template

- [ ] **P5.2: CI/CD** (GitHub Actions in NaaP repo)
  - New workflow: `.github/workflows/containers.yml` — triggered on `containers/**` path changes
  - Build + push `livepeer/inference-adapter:latest` and `livepeer/serverless-proxy:latest`
  - Run Python tests for `containers/` on PR
  - Tag releases independently from NaaP app releases
  - Does NOT interfere with existing NaaP CI (Vercel, plugin builds, etc.)

- [ ] **P5.3: Documentation** (in NaaP `docs/` and `containers/*/README.md`)
  - Quickstart: "Deploy Llama 3.1 to Livepeer in 5 minutes" (Topology 1)
  - Quickstart: "Bring fal.ai Flux to Livepeer" (Topology 3)
  - Architecture guide with topology diagrams
  - Pricing guide
  - Troubleshooting (health check failures, registration issues, payment errors)

- [ ] **P5.4: NaaP marketplace listing**
  - Publish `livepeer-inference` template to NaaP marketplace plugin
  - Screenshots, description, topology comparison

**Exit criteria:** A developer can follow the quickstart, deploy a model on Livepeer, and call it from livepeer-sdk, in under 30 minutes.

---

## Architectural Decisions & Rationale

### Why NOT put the adapter in go-livepeer?

| Reason | Detail |
|---|---|
| **BYOC already exists** | The orchestrator side (`byoc/`) handles registration, proxying, payment, capacity. No Go code changes needed. |
| **Adapter is worker-side** | It runs alongside the inference backend, not alongside the orchestrator. It's operationally separate. |
| **Python, not Go** | Adapter is a lightweight Python process. Go would be overkill for ~300 lines of HTTP proxying. |
| **Independence** | Adapter can be versioned, released, and deployed independently of go-livepeer releases. |

### Why put adapter + proxy in NaaP monorepo (not livepeer-sdk)?

| Reason | Detail |
|---|---|
| **Co-located with deployment template** | The deployment-manager plugin that deploys these containers is in NaaP. One PR to change adapter + template together. |
| **No dependency on livepeer-sdk** | Adapter talks HTTP to BYOC endpoints. Proxy talks HTTP to provider APIs. Zero shared Python code with livepeer-sdk. |
| **Clean isolation** | `containers/` directory is invisible to npm, Nx, Vercel. Python projects with `pyproject.toml`, not `package.json`. Zero impact on NaaP's JS toolchain. |
| **Single repo for operator tooling** | NaaP is the operator's platform. Adapter + proxy are operator-side components (deployed by the operator alongside the orchestrator). They belong with the operator's tooling, not the client SDK. |
| **livepeer-sdk stays client-focused** | livepeer-sdk is for consumers of inference services (the BYOC client in Phase 4). Adapter + proxy are for providers of inference services. Different audiences, different repos. |

### Why a separate serverless proxy instead of building it into the adapter?

| Reason | Detail |
|---|---|
| **Separation of concerns** | Adapter handles Livepeer registration + proxying. Serverless proxy handles provider-specific API translation. |
| **Reusability** | Serverless proxy can be used without Livepeer (plain HTTP proxy to fal.ai). Adapter can be used without serverless (direct to local container). |
| **Composability** | Self-hosted GPU: adapter → local container (no proxy). Serverless: adapter → proxy → provider API. Same adapter either way. |
| **Simpler testing** | Each component testable independently. |

### How NaaP deployment-manager ties it together

```
NaaP Deployment Manager
  │
  ├── Template: "livepeer-inference"  (in BUILT_IN_TEMPLATES, like ai-runner and scope)
  │     Defines: adapter image, health endpoint, config schema, topology options
  │
  ├── Provider Adapter: FalAdapter / RunPodAdapter / SshBridgeAdapter
  │     Handles: deploy / destroy / status / health-check on the provider
  │     NOTE: These handle DEPLOYMENT lifecycle, not runtime inference
  │
  ├── LivepeerComposeBuilder (NEW service)
  │     Generates docker-compose.yaml based on selected topology
  │
  ├── Deployment Orchestrator
  │     Manages: lifecycle, multi-container coordination
  │
  └── What gets deployed (three topology paths):

        TOPOLOGY 1 — All-in-One Self-Hosted GPU:
        ┌─────────────────────────────────────────────────────┐
        │ Deployed to: GPU server via SshBridgeAdapter        │
        │                                                     │
        │ Container 1: go-livepeer orchestrator  :7935        │
        │   Env: -serviceAddr=http://<public-ip>:7935         │
        │                                                     │
        │ Container 2: livepeer/inference-adapter :9090        │
        │   Env: ORCH_URL=http://localhost:7935                │
        │        ORCH_SECRET, CAPABILITY_NAME                  │
        │        BACKEND_URL=http://localhost:8080              │
        │        PRICE, CAPACITY                               │
        │                                                     │
        │ Container 3: model container (on GPU)  :8080        │
        │   Image: ghcr.io/huggingface/text-generation-inference │
        │   Env: MODEL_ID=meta-llama/Llama-3.1-70B-Instruct   │
        └─────────────────────────────────────────────────────┘

        TOPOLOGY 2 — All-on-Serverless-GPU:
        ┌─────────────────────────────────────────────────────┐
        │ Deployed to: RunPod pod via RunPodAdapter           │
        │                                                     │
        │ Same 3 containers as Topology 1, but on a provider  │
        │ pod. go-livepeer's -serviceAddr set to provider's   │
        │ assigned public endpoint URL.                       │
        │                                                     │
        │ NOTE: go-livepeer needs stable reachable URL.       │
        │ RunPod provides: https://<pod-id>-7935.proxy.runpod.net │
        └─────────────────────────────────────────────────────┘

        TOPOLOGY 3 — CPU Orchestrator + Remote Inference:
        ┌─────────────────────────────────────────────────────┐
        │ Deployed to: CPU VM via SshBridgeAdapter            │
        │                                                     │
        │ Container 1: go-livepeer orchestrator  :7935        │
        │   Env: -serviceAddr=http://<public-ip>:7935         │
        │                                                     │
        │ Container 2: livepeer/inference-adapter :9090        │
        │   Env: ORCH_URL=http://localhost:7935                │
        │        ORCH_SECRET, CAPABILITY_NAME                  │
        │        BACKEND_URL=http://localhost:8080              │
        │        PRICE, CAPACITY                               │
        │                                                     │
        │ Container 3: livepeer/serverless-proxy :8080        │
        │   Env: PROVIDER=fal-ai                               │
        │        FAL_KEY=...                                    │
        │        FAL_MODEL_ID=fal-ai/flux/dev                  │
        └─────────────────────────────────────────────────────┘
        Model runs on fal.ai cloud (already deployed or existing).
        Proxy calls fal.ai API over HTTPS.
```

The deployment-manager's existing `IProviderAdapter.deploy()` interface already supports `DeployConfig` with `dockerImage`, `artifactConfig`, and provider-specific fields. The `livepeer-inference` template extends this with topology selection + Livepeer-specific config that gets passed as container environment variables.

**Key: NaaP provider adapters vs. serverless proxy — different roles:**
- NaaP `FalAdapter` = deploys/destroys containers on fal.ai infrastructure (deployment lifecycle)
- `livepeer/serverless-proxy` = runtime HTTP process that calls fal.ai inference API (request proxying)
- They are complementary, not overlapping. NaaP deploys the proxy container; the proxy handles runtime traffic.

**Key: go-livepeer is included in the docker-compose for all topologies.**
This is a deliberate design choice — the operator deploys a complete Livepeer node + inference stack as one unit. go-livepeer doesn't need to be pre-existing on the machine.

### Why this is simple, effective, and reliable

| Property | How it's achieved |
|---|---|
| **Simple** | ~300 line adapter. Config-driven. No code changes to go-livepeer. No new protocols. |
| **Effective** | Leverages battle-tested BYOC payment/capacity system. Any HTTP backend works. |
| **Reliable** | Health monitoring with auto-unregister/re-register. Clean shutdown. Stateless adapter (restart-safe). Orchestrator handles payment atomicity. |
| **No performance penalty** | Single HTTP hop (orch → adapter → backend). Streaming passthrough for SSE. No serialization overhead. |
| **Extensible** | New provider = new file in `serverless_proxy/providers/`. New model = new template config. Zero framework code changes. |

## Open Questions

1. ~~**Adapter public URL**~~ **RESOLVED** — All 3 topologies co-locate adapter with go-livepeer on the same machine. Adapter registers as `localhost:9090`. No NAT/tunnel needed.

2. ~~**Where do adapter/proxy run?**~~ **RESOLVED** — Three topologies defined. User chooses in NaaP wizard. See "Deployment Topologies" section.

3. ~~**Multi-capability per adapter**~~ **RESOLVED** — One orchestrator serves N capabilities (1:N). One adapter = one capability. For multiple models, run multiple adapter instances (different ports) on the same machine, each registering a different capability name with the same orchestrator. See "Orchestrator-to-Inference Mapping: 1:N" section. NaaP future enhancement: "add capability to existing deployment."

4. **Dynamic pricing**: Phase 1 uses static pricing. Future: adapter could query provider cost APIs and adjust dynamically. Especially useful for Topology 3 where provider costs vary.

5. **Capability discovery for clients**: Clients currently need the orchestrator URL. Future: network-wide capability registry so clients can discover "who serves llama3-70b" across all orchestrators.

6. **Request format standardization**: Phase 1 is passthrough. Future: optional OpenAI-compatible translation layer in the adapter (e.g., all LLM capabilities accept OpenAI chat completion format regardless of backend).

7. **go-livepeer Docker image**: Topologies 1-3 all include go-livepeer in the docker-compose. Need to confirm the official go-livepeer Docker image (`livepeer/go-livepeer`) supports BYOC flags and is suitable for compose-based deployment. May need a lightweight config template for orchestrator settings (ETH key, network, service address).

---

## What Can and Cannot Be Supported

### BYOC Protocol Capabilities (What the Wire Supports)

The BYOC system in go-livepeer provides exactly **three interaction patterns**:

| Pattern | BYOC Endpoint | How It Works | Billing |
|---|---|---|---|
| **Request-response** | `POST /process/request/{path}` | Client sends POST body, gets full response back | Per wall-clock second (`chargeForCompute(start, ...)`) |
| **SSE streaming** | `POST /process/request/{path}` | Client sends POST, gets `text/event-stream` back. Orch debits every 5s while stream is open. | Per 5-second interval |
| **Bidirectional live streaming** | `POST /ai/stream/start` | Creates trickle protocol channels: video in, video out, control, events, data (JSONL). Orch monitors and debits continuously. | Per 23-second interval |

**Payment model:** `PricePerUnit / PixelsPerUnit` ratio = price per compute unit. For BYOC, "compute unit" = 1 second of wall-clock time. Minimum balance required: `price * 60` (1 minute). Uses probabilistic micropayment tickets (ETH L2).

### The Core Question: What Existing Endpoints Can Be Published?

**YES — any HTTP POST endpoint that follows request→response or request→SSE stream can be published on the Livepeer network via Topology 3.** The adapter + proxy just need to:
1. Accept the request from the orchestrator
2. Forward it to the backend endpoint
3. Return the response

The backend doesn't know it's on Livepeer. The adapter handles registration. The orchestrator handles payment. It's transparent.

### What CAN Be Supported

#### Tier 1: Perfect Fit (request-response, stateless, compute-bound)

These map directly to BYOC's request-response pattern. Per-second billing makes sense because the cost correlates with compute time.

| Service Type | Examples | How It Works |
|---|---|---|
| **LLM inference** | OpenAI-compatible APIs, Ollama, vLLM, TGI, LiteLLM | POST chat completion → response or SSE stream. Streaming supported natively. |
| **Image generation** | Stable Diffusion, Flux, DALL-E-like APIs, fal.ai image models | POST prompt → image response. 2-30s per request. |
| **Video generation** | Runway, Pika, fal.ai video models | POST prompt → video URL. 10-120s per request. |
| **Audio generation** | TTS (ElevenLabs, Bark), music gen | POST text → audio response. |
| **Audio transcription** | Whisper, Deepgram | POST audio file → text response. |
| **Image analysis** | OCR, image captioning, object detection, CLIP | POST image → JSON response. |
| **Embeddings** | Sentence transformers, OpenAI embeddings | POST text → vector response. |
| **Code generation** | Code Llama, StarCoder, Copilot-like APIs | POST prompt → code response (SSE streaming). |
| **Document processing** | PDF extraction, summarization | POST document → structured response. |
| **Translation** | Language translation APIs | POST text → translated text. |
| **Any HuggingFace Inference Endpoint** | Any model deployed on HF | POST → response. All HF endpoints are HTTP POST. |
| **Any fal.ai model** | 100+ models on fal.ai | POST → queue → result. Proxy handles queue polling. |
| **Any Replicate model** | 1000+ models on Replicate | POST → prediction → result. Proxy handles polling. |

#### Tier 2: Works With Caveats (stateless but unusual patterns)

| Service Type | Caveat | Workaround |
|---|---|---|
| **Multi-step workflows (ComfyUI)** | ComfyUI has a WebSocket API for progress, and workflows can be complex JSON. | Use ComfyUI's `/prompt` REST API (POST workflow JSON → poll for result). Proxy handles polling. No WebSocket needed for basic use. |
| **Batch processing** | Multiple items in one request. BYOC bills per-second, so large batches are fine — billed for total wall time. | Works as-is. Set `BACKEND_TIMEOUT` high enough for batch completion. |
| **Long-running jobs (>2 min)** | BYOC default timeout is per `timeout_seconds` in job request. For very long jobs (video gen, large batch). | Set high timeout. Orchestrator supports up to 15+ minutes. SSE streaming for progress updates. |
| **File upload (multipart)** | BYOC proxies the raw POST body including multipart form data. | Works — `Content-Type: multipart/form-data` is passed through. Backend receives the file. |
| **File download (large responses)** | Response body is proxied in full. Large files (videos, images) work but consume memory on the orchestrator. | Works for responses up to ~100MB. For very large files, return a URL to a storage service instead of the file itself. |

#### Tier 3: Technically Possible But Poor Fit

| Service Type | Why It's a Poor Fit | Could It Work? |
|---|---|---|
| **Transcoding** | go-livepeer already does transcoding natively via its built-in pipeline (not BYOC). It has its own segment-based pricing, B-frame handling, codec negotiation. Registering a transcoding service as a BYOC capability would bypass all of this and lose go-livepeer's transcoding optimizations. | **Don't do this.** Use go-livepeer's native transcoding. It's already on the network. BYOC is for capabilities go-livepeer doesn't have natively. |
| **CDN / Content Delivery** | CDN is about geographic proximity to users. A single orchestrator + adapter on one machine serves from one location. CDN value = many edge nodes. BYOC has one endpoint. Also, CDN is typically pull-based (client requests content), while BYOC is push-based (client sends request body). | **Partially.** You could register a "fetch from origin + return cached content" capability. But you'd need orchestrators in multiple regions, each with their own adapter, to get CDN-like geographic distribution. The adapter itself doesn't provide this. |
| **S3 / Object Storage** | Storage is stateful (files persist). BYOC is stateless (request-response). Billing per-second doesn't match storage billing (per-GB-month). Uploading works (POST file → store), but how do you bill for ongoing storage? | **Upload/download works.** POST file → adapter → S3 PUT, or GET file → adapter → S3 GET. But ongoing storage costs are not covered by BYOC billing. The operator eats the storage cost or must build a separate billing layer. |
| **Database queries** | BYOC could technically proxy a POST containing a SQL query and return results. But: no connection pooling, no transactions, no persistent connections, no auth beyond Livepeer payment. Per-second billing for a 50ms query is wasteful. | **Technically possible** but impractical. Every query is a fresh HTTP request through the full BYOC stack. Latency overhead (~10-50ms for local, ~100-300ms for Topology 3) dominates for fast queries. No session/transaction support. |
| **Kafka / Message Queue** | Pub/sub pattern. Consumers need long-lived connections. Producers need guaranteed delivery. BYOC is request-response with timeout. No persistent subscriptions. | **Cannot work.** BYOC fundamentally doesn't support the pub/sub pattern. You'd need to build a completely different protocol. |
| **WebSocket services** | BYOC proxies HTTP. It does not support WebSocket upgrade (`101 Switching Protocols`). The orchestrator's HTTP proxy reads the full response body. | **Cannot work** without go-livepeer changes. The BYOC proxy in `job_orchestrator.go` reads `resp.Body` fully — it doesn't support bidirectional WebSocket. The trickle-based streaming (`/ai/stream/`) is the closest equivalent but uses a different protocol. |
| **gRPC services** | BYOC is HTTP/1.1 request-response. gRPC uses HTTP/2 with bidirectional streaming, specific framing, and trailers. | **Cannot work** as-is. Would need a gRPC-to-HTTP translation layer (like grpc-gateway) in front of the service, which defeats the purpose. |
| **Real-time bidirectional (gaming, collaboration)** | Requires sub-10ms latency and persistent connections. BYOC adds HTTP overhead per interaction. | **Cannot work.** BYOC is not designed for real-time bidirectional communication. The trickle streaming gets close for video but has segment-level granularity (~seconds), not frame-level. |

### Summary: The Boundary

```
┌─────────────────────────────────────────────────────────────────┐
│                    WORKS PERFECTLY                                │
│                                                                  │
│  Any HTTP POST → JSON/binary/SSE response service               │
│  (AI inference, processing, transformation, analysis)            │
│                                                                  │
│  Billing: per-second of compute time makes sense                 │
│  Pattern: stateless request → response                           │
│  Latency: seconds-scale is fine (generation tasks)               │
├─────────────────────────────────────────────────────────────────┤
│                    WORKS WITH CAVEATS                             │
│                                                                  │
│  File upload/download (size limits)                              │
│  Long-running batch jobs (set high timeout)                      │
│  Multi-step workflows (use REST API, not WebSocket)              │
│  Storage upload (but not ongoing storage billing)                │
├─────────────────────────────────────────────────────────────────┤
│                    DOES NOT WORK                                  │
│                                                                  │
│  Transcoding (use go-livepeer native — already on network)       │
│  WebSocket / gRPC / bidirectional protocols                      │
│  Pub/sub (Kafka, MQTT, message queues)                           │
│  Persistent connections (database sessions, connection pools)    │
│  Real-time bidirectional (<100ms round-trip)                     │
│  Ongoing storage billing (S3 monthly costs)                      │
│  Geographic distribution (CDN multi-edge)                        │
└─────────────────────────────────────────────────────────────────┘
```

### Can Transcoding Be Supported?

**It already is — natively.** go-livepeer's original purpose is transcoding. It has:
- Segment-based transcoding pipeline (`server/broadcast.go`, `core/transcoder.go`)
- Hardware-accelerated encoding (NVENC, VAAPI)
- B-frame handling, codec negotiation
- Its own pricing model (per-pixel)
- Built-in orchestrator ↔ transcoder protocol (gRPC)

**Do NOT register transcoding as a BYOC capability.** It would bypass go-livepeer's optimized transcoding pipeline and use a suboptimal HTTP proxy path instead. Transcoding is already a first-class citizen on the Livepeer network.

### Can CDN Be Supported?

**Not effectively with this architecture.** CDN requires:
1. **Many edge nodes** geographically distributed — BYOC is one orchestrator in one location
2. **Caching** — BYOC is stateless, no cache layer
3. **Pull model** — CDN serves content on demand; BYOC is push (client sends request)

To make CDN work on Livepeer, you'd need a fundamentally different architecture: multiple orchestrators with a discovery layer that routes clients to the nearest one, plus a caching layer. This is beyond the adapter scope.

### Can "General Services" Be Brought to Livepeer?

The adapter makes Livepeer a **paid compute network for HTTP services**. It works well for:
- **Compute-bound services** where billing per-second matches cost structure
- **Stateless services** where each request is independent
- **Services with seconds-scale latency** where HTTP overhead is negligible

It does NOT make Livepeer a general-purpose cloud platform. Services that need persistent state, persistent connections, sub-100ms latency, or non-HTTP protocols need their own infrastructure. The Livepeer protocol (probabilistic micropayments + orchestrator discovery) is designed for compute work, not for storage, messaging, or CDN.

**The sweet spot is exactly what it says: inference.** Any AI model, any processing pipeline, any transformation service that takes input and produces output via HTTP POST. That's a massive surface area — every model on HuggingFace, every endpoint on fal.ai/Replicate/RunPod, every custom inference container.
